// Copy alongside common.mjs INSIDE the existing private identity Worker only.
// Wrap the unchanged browser Worker; never enable its public routes.
import { fail, json, handleError, readJSON, bearer, budget, constantEqual, digest, randomToken, hex, unhex } from './common.mjs';

const encoder = new TextEncoder();
const sessionLifetime = 7 * 86400000;
export async function legacyPasswordHash(password, salt, pepper) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(salt), iterations: 10000 }, key, 256);
  const hmac = await crypto.subtle.importKey('raw', unhex(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', hmac, bits));
}

async function mobileRoute(request, env) {
  if (env.MOBILE_AUTH_RELEASE_VERIFIED !== 'true' || env.AUTH_RELEASE_VERIFIED !== 'true') fail(503, 'unconfigured', '移动身份服务尚未验收。');
  if (!/^[a-f0-9]{64}$/.test(env.MOBILE_SERVICE_SECRET || '') || !constantEqual(request.headers.get('x-noxia-service'), env.MOBILE_SERVICE_SECRET)) fail(403, 'service', '服务未获授权。');
  if (!env.DB) fail(503, 'unconfigured', '身份数据库不可用。');
  if (request.method !== 'POST') fail(405, 'method', '请求方法不支持。');
  const path = new URL(request.url).pathname;
  if (path === '/internal/noxia/login') {
    // Input IP is overwritten by the gateway; only the shared-secret authenticated service may supply it.
    const ip = request.headers.get('x-noxia-client-ip') || 'unknown';
    await budget(env.DB, 'rate_limits', `noxia-auth-ip:${await digest(ip)}`, 30, 900);
    const value = await readJSON(request, 2048);
    if (typeof value.username !== 'string' || !/^[A-Za-z0-9_-]{3,32}$/.test(value.username) || typeof value.password !== 'string' || value.password.length < 6 || value.password.length > 128) fail(400, 'credentials_format', '用户名或密码格式无效。');
    const usernameKey = value.username.toLowerCase();
    await budget(env.DB, 'rate_limits', `noxia-auth-user:${usernameKey}`, 15, 900);
    if (!/^[a-f0-9]{64}$/i.test(env.PASSWORD_PEPPER || '')) fail(503, 'unconfigured', '身份服务缺少密码保护配置。');
    const stored = await env.DB.prepare('SELECT id,username,login_code_hash,password_salt,password_scheme,credential_version FROM users WHERE username_key=?').bind(usernameKey).first();
    const salt = /^[a-f0-9]{32}$/i.test(stored?.password_salt || '') ? stored.password_salt : '00000000000000000000000000000000';
    const hashed = await legacyPasswordHash(value.password, salt, env.PASSWORD_PEPPER);
    // generated-v1 is a legacy synthetic-code schema, deliberately not expanded to a new mobile attack surface.
    if (!stored || stored.password_scheme !== 'pbkdf2-sha256-10000-hmac-v1' || !constantEqual(hashed, stored.login_code_hash)) fail(401, 'credentials', '用户名或密码错误。');
    const accessToken = randomToken(), expiresAt = Date.now() + sessionLifetime;
    await env.DB.prepare('INSERT INTO noxia_mobile_sessions(token_hash,user_id,credential_version,expires_at) VALUES(?,?,?,?)').bind(await digest(accessToken), stored.id, stored.credential_version, expiresAt).run();
    return json({ user: { id: stored.id, username: stored.username }, accessToken, expiresAt });
  }
  const tokenHash = await digest(bearer(request));
  if (path === '/internal/noxia/logout') {
    await env.DB.prepare('DELETE FROM noxia_mobile_sessions WHERE token_hash=?').bind(tokenHash).run();
    return json({ ok: true });
  }
  if (path === '/internal/noxia/session') {
    const row = await env.DB.prepare('SELECT u.id,u.username,s.expires_at FROM noxia_mobile_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND s.credential_version=u.credential_version').bind(tokenHash, Date.now()).first();
    if (!row) fail(401, 'unauthenticated', '会话已过期，请重新登录。');
    return json({ user: { id: row.id, username: row.username }, expiresAt: row.expires_at });
  }
  fail(404, 'not_found', '接口不存在。');
}

export function withMobileIdentity(browserWorker) {
  return {
    async fetch(request, env, ctx) {
      if (new URL(request.url).pathname.startsWith('/internal/noxia/')) {
        try { return await mobileRoute(request, env); } catch (error) { return handleError(error); }
      }
      return browserWorker.fetch(request, env, ctx);
    },
    async scheduled(event, env, ctx) {
      if (browserWorker.scheduled) await browserWorker.scheduled(event, env, ctx);
      if (env.MOBILE_AUTH_RELEASE_VERIFIED === 'true') await env.DB.prepare('DELETE FROM noxia_mobile_sessions WHERE expires_at<=?').bind(Date.now()).run();
    }
  };
}
