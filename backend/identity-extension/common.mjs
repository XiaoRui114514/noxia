const encoder = new TextEncoder();
export class ApiError extends Error {
  constructor(status, code, message, extra = {}) { super(message); Object.assign(this, { status, code, extra }); }
}
export function fail(status, code, message, extra) { throw new ApiError(status, code, message, extra); }
export function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
}
export function handleError(error) {
  return error instanceof ApiError ? json({ error: error.code, message: error.message, ...error.extra }, error.status)
    : json({ error: 'unavailable', message: '云端暂时不可用，本地数据已保留。' }, 503);
}
export function hex(bytes) { return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join(''); }
export function unhex(value) { return Uint8Array.from(value.match(/../g), part => parseInt(part, 16)); }
export async function digest(value) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
export function randomToken() { return hex(crypto.getRandomValues(new Uint8Array(32))); }
export function constantEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let different = 0; for (let i = 0; i < a.length; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return different === 0;
}
export async function readJSON(request, limit = 68 * 1024) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) fail(415, 'content_type', '需要 JSON。');
  if (Number(request.headers.get('content-length')) > limit) fail(413, 'too_large', '内容过大，请保留本地文件。');
  if (!request.body) fail(400, 'invalid_json', '请求内容无效。');
  const reader = request.body.getReader(), chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > limit) { await reader.cancel(); fail(413, 'too_large', '内容过大，请保留本地文件。'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let parsed; try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(400, 'invalid_json', '请求内容无效。'); }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') fail(400, 'invalid_json', '需要 JSON 对象。');
  return parsed;
}
export function bearer(request) {
  const value = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!value) fail(401, 'unauthenticated', '请重新登录。'); return value;
}
export async function budget(db, table, name, limit, seconds = 60) {
  const bucket = Math.floor(Date.now() / (seconds * 1000));
  const row = await db.prepare(`INSERT INTO ${table}(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`)
    .bind(`${name}:${bucket}`, (bucket + 1) * seconds * 1000).first();
  if (!Number.isInteger(row?.count)) fail(503, 'unavailable', '限流服务不可用。');
  if (row.count > limit) fail(429, 'rate_limited', '操作过于频繁，请稍后再试。');
}
