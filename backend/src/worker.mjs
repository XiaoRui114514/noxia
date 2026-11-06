import { ApiError, fail, json, handleError, readJSON, bearer, budget } from './common.mjs';

const collections = new Set(['resources', 'playlists', 'templates', 'history']);
const forbiddenKey = /(?:api[_-]?key|password|secret|credential|(?:access|refresh|session)[_-]?token|cookie|recovery[_-]?code|^__proto__$|^constructor$|^prototype$)/i;
const allowedFields = {
  resources: new Set(['id','title','author','kind','source','segments','generated','updatedAt','createdAt']),
  playlists: new Set(['id','title','name','items','createdAt','updatedAt']),
  templates: new Set(['id','name','title','steps','scope','createdAt','updatedAt']),
  history: new Set(['id','resourceId','position','completed','templateId','playedAt','source','updatedAt','createdAt','listenedSeconds'])
};
export function validateEntity(collection, entityId, value) {
  if (!Number.isSafeInteger(value.baseVersion) || value.baseVersion < 0) fail(400, 'version', '版本无效。');
  if (typeof value.deleted !== 'boolean') fail(400, 'deleted', '需要明确的删除状态。');
  if (value.deleted) {
    if (value.data !== null) fail(400, 'data', '删除记录的内容应为 null。');
    return null;
  }
  const data = value.data;
  if (!data || Array.isArray(data) || typeof data !== 'object' || data.id !== entityId) fail(400, 'data', '内容标识不匹配。');
  if (Object.keys(data).some(key => !allowedFields[collection].has(key))) fail(400, 'field', '包含不支持的字段。');
  let nodes = 0;
  const walk = (v, depth) => {
    if (++nodes > 4000 || depth > 16) fail(400, 'complexity', '内容结构过于复杂。');
    if (Array.isArray(v)) v.forEach(item => walk(item, depth + 1));
    else if (v && typeof v === 'object') for (const [key, child] of Object.entries(v)) {
      if (forbiddenKey.test(key)) fail(400, 'private_field', '内容包含凭据字段，拒绝上传。');
      walk(child, depth + 1);
    }
  };
  walk(data, 0);
  const serialized = JSON.stringify(data);
  if (new TextEncoder().encode(serialized).byteLength > 64 * 1024) fail(413, 'too_large', '单条内容超过 64 KiB，已保留本地副本。');
  return serialized;
}

async function identity(env, path, { method = 'POST', token, body, ip } = {}) {
  if (!env.IDENTITY?.fetch || !/^[a-f0-9]{64}$/.test(env.IDENTITY_SERVICE_SECRET || '')) fail(503, 'unconfigured', '账号网关尚未配置。');
  const headers = { 'Content-Type': 'application/json', 'X-Noxia-Service': env.IDENTITY_SERVICE_SECRET };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (ip) headers['X-Noxia-Client-IP'] = ip;
  let response;
  try { response = await env.IDENTITY.fetch(new Request(`https://identity.internal/internal/noxia/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })); }
  catch { fail(503, 'unavailable', '账号服务暂时不可用。'); }
  let result; try { result = await response.json(); } catch { fail(503, 'unavailable', '账号服务返回异常。'); }
  if (!response.ok) throw new ApiError(response.status, result.error || 'unavailable', result.message || '账号服务暂时不可用。');
  if (response.headers.has('set-cookie')) fail(503, 'identity_protocol', '账号服务尚未完成移动端配置。');
  return result;
}

function entity(row) {
  return row ? { id: row.entity_id, version: row.version, deleted: row.deleted === 1, data: row.data === null ? null : JSON.parse(row.data), updatedAt: row.updated_at } : { version: 0, data: null, deleted: false, updatedAt: null };
}

async function route(request, env) {
  if (env.MOBILE_RELEASE_VERIFIED !== 'true') fail(503, 'unconfigured', '移动账号服务尚未部署验收，可继续离线学习。');
  const url = new URL(request.url);
  if (url.protocol !== 'https:') fail(400, 'https_required', '需要 HTTPS。');
  // Native app protocol: never accept Cookie authentication or wildcard browser CORS.
  if (request.headers.has('cookie') || request.headers.has('origin')) fail(403, 'native_only', '此接口使用原生客户端会话。');
  const path = url.pathname;
  if (path === '/v1/auth/login' && request.method === 'POST') {
    const value = await readJSON(request, 2048);
    return json(await identity(env, 'login', { body: { username: value.username, password: value.password }, ip: request.headers.get('cf-connecting-ip') || 'unknown' }));
  }
  const token = bearer(request);
  if (path === '/v1/auth/logout' && request.method === 'POST') return json(await identity(env, 'logout', { token }));
  const current = await identity(env, 'session', { token });
  if (!current.user?.id || typeof current.user.id !== 'string') fail(503, 'identity_protocol', '账号响应无效。');
  if (path === '/v1/auth/me' && request.method === 'GET') return json(current);
  if (request.headers.get('x-account-id') !== current.user.id) fail(409, 'account_changed', '账号已切换，请重新确认同步账号。');
  const match = path.match(/^\/v1\/sync\/(resources|playlists|templates|history)(?:\/([A-Za-z0-9_-]{1,128}))?$/);
  if (!match || !collections.has(match[1])) fail(404, 'not_found', '接口不存在。');
  const [, collection, id] = match, userId = current.user.id;
  if (!env.DB) fail(503, 'unconfigured', '同步数据库尚未配置。');
  await budget(env.DB, 'noxia_rate_limits', `sync:${userId}`, 120);
  if (!id && request.method === 'GET') {
    const after = url.searchParams.get('after') || '';
    if (after && !/^[A-Za-z0-9_-]{1,128}$/.test(after)) fail(400, 'cursor', '分页参数无效。');
    // Include tombstones. ID cursor avoids losing same-millisecond updates.
    const out = await env.DB.prepare('SELECT entity_id,version,deleted,updated_at FROM noxia_entities WHERE user_id=? AND collection=? AND entity_id>? ORDER BY entity_id LIMIT 101').bind(userId, collection, after).all();
    const rows = out.results || [], page = rows.slice(0, 100);
    return json({ items: page.map(row => ({ id: row.entity_id, version: row.version, deleted: row.deleted === 1, updatedAt: row.updated_at })), next: rows.length > 100 ? page.at(-1).entity_id : null });
  }
  if (!id) fail(405, 'method', '需要记录标识。');
  if (request.method === 'GET') {
    const row = await env.DB.prepare('SELECT * FROM noxia_entities WHERE user_id=? AND collection=? AND entity_id=?').bind(userId, collection, id).first();
    return json(entity(row));
  }
  if (request.method !== 'PUT') fail(405, 'method', '请求方法不支持。');
  const value = await readJSON(request), data = validateEntity(collection, id, value), now = Date.now();
  const row = value.baseVersion === 0
    ? await env.DB.prepare('INSERT INTO noxia_entities(user_id,collection,entity_id,version,data,deleted,updated_at) VALUES(?,?,?,1,?,?,?) ON CONFLICT(user_id,collection,entity_id) DO NOTHING RETURNING *').bind(userId, collection, id, data, value.deleted ? 1 : 0, now).first()
    : await env.DB.prepare('UPDATE noxia_entities SET version=version+1,data=?,deleted=?,updated_at=? WHERE user_id=? AND collection=? AND entity_id=? AND version=? RETURNING *').bind(data, value.deleted ? 1 : 0, now, userId, collection, id, value.baseVersion).first();
  if (!row) {
    const latest = await env.DB.prepare('SELECT * FROM noxia_entities WHERE user_id=? AND collection=? AND entity_id=?').bind(userId, collection, id).first();
    fail(409, 'conflict', '另一台设备已有更新。请保留双方副本并选择后重试。', { current: entity(latest) });
  }
  return json(entity(row));
}

export default {
  async fetch(request, env) { try { return await route(request, env); } catch (error) { return handleError(error); } },
  async scheduled(_event, env) {
    await env.DB.prepare('DELETE FROM noxia_rate_limits WHERE expires_at<=?').bind(Date.now()).run();
    // Tombstones persist until all clients have acknowledged a separately designed compaction protocol.
  }
};
