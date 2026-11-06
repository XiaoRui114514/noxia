import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.mjs';
import { digest } from '../src/common.mjs';
import { withMobileIdentity, legacyPasswordHash } from '../identity-extension/mobile-extension.mjs';

// Synthetic test credentials only; never connects to Cloudflare or existing data.
const serviceSecret = 'ab'.repeat(32), pepper = 'cd'.repeat(32);
const password = 'SyntheticTestPassword123';
let identityDB, dataDB, env, identityEnv, identity;
function d1(sqlite) {
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() { return sqlite.prepare(sql).get(...values) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...values) }; },
        async run() { return sqlite.prepare(sql).run(...values); }
      };
    }
  };
}
function req(path, { method = 'GET', body, token, owner = 'user-a', headers: extra = {} } = {}) {
  const headers = { ...extra };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (owner) headers['X-Account-ID'] = owner;
  return new Request(`https://noxia.example${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function call(path, options) { const response = await worker.fetch(req(path, options), env); return { status: response.status, body: await response.json(), headers: response.headers }; }
async function login(username = 'test_a') {
  const result = await call('/v1/auth/login', { method: 'POST', body: { username, password } });
  expect(result.status).toBe(200); return result.body.accessToken;
}
const write = (token, baseVersion = 0, data = { id: 'item-a', name: '合成测试列表', items: [] }) => call('/v1/sync/playlists/item-a', { method: 'PUT', token, body: { baseVersion, deleted: false, data } });

beforeEach(async () => {
  identityDB = new DatabaseSync(':memory:'); dataDB = new DatabaseSync(':memory:');
  identityDB.exec('CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT,username_key TEXT,login_code_hash TEXT,password_salt TEXT,password_scheme TEXT,credential_version INTEGER); CREATE TABLE rate_limits(key TEXT PRIMARY KEY,count INTEGER,expires_at INTEGER);');
  identityDB.exec(readFileSync(new URL('../identity-extension/0001-mobile-sessions.sql', import.meta.url), 'utf8'));
  dataDB.exec(readFileSync(new URL('../migrations/0001-noxia.sql', import.meta.url), 'utf8'));
  const salt = '01'.repeat(16), hash = await legacyPasswordHash(password, salt, pepper);
  for (const [id, username] of [['user-a','test_a'],['user-b','test_b']]) identityDB.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,1)').run(id, username, username, hash, salt, 'pbkdf2-sha256-10000-hmac-v1');
  identityEnv = { DB: d1(identityDB), PASSWORD_PEPPER: pepper, MOBILE_SERVICE_SECRET: serviceSecret, MOBILE_AUTH_RELEASE_VERIFIED: 'true', AUTH_RELEASE_VERIFIED: 'true' };
  identity = withMobileIdentity({ fetch: () => new Response('legacy browser route') });
  env = { DB: d1(dataDB), IDENTITY_SERVICE_SECRET: serviceSecret, MOBILE_RELEASE_VERIFIED: 'true', IDENTITY: { fetch: request => identity.fetch(request, identityEnv) } };
});
afterEach(() => { identityDB.close(); dataDB.close(); });

describe('mobile identity and isolation', () => {
  it('fails closed until release gate, service binding and secret are configured', async () => {
    env.MOBILE_RELEASE_VERIFIED = 'false'; expect((await call('/v1/auth/login', { method: 'POST', body: {} })).status).toBe(503);
    env.MOBILE_RELEASE_VERIFIED = 'true'; env.IDENTITY_SERVICE_SECRET = ''; expect((await call('/v1/auth/login', { method: 'POST', body: {} })).status).toBe(503);
    env.IDENTITY_SERVICE_SECRET = 'ff'.repeat(32); expect((await call('/v1/auth/login', { method: 'POST', body: {} })).status).toBe(403);
  });
  it('reuses original users, stores only a token hash and returns no cookies', async () => {
    const token = await login('TEST_A');
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    const row = identityDB.prepare('SELECT * FROM noxia_mobile_sessions').get();
    expect(row.token_hash).toBe(await digest(token)); expect(row.token_hash).not.toBe(token); expect(row.user_id).toBe('user-a');
    const result = await call('/v1/auth/me', { token }); expect(result.body.user.id).toBe('user-a'); expect(result.headers.get('set-cookie')).toBeNull(); expect(result.headers.get('cache-control')).toBe('no-store');
  });
  it('revokes mobile sessions when original credential_version changes', async () => {
    const token = await login(); identityDB.prepare('UPDATE users SET credential_version=2 WHERE id=?').run('user-a');
    expect((await call('/v1/auth/me', { token })).status).toBe(401);
  });
  it('rejects expired tokens and logout is idempotent', async () => {
    const token = await login(); identityDB.prepare('UPDATE noxia_mobile_sessions SET expires_at=0').run();
    expect((await call('/v1/auth/me', { token })).status).toBe(401);
    expect((await call('/v1/auth/logout', { method: 'POST', token })).status).toBe(200);
    expect((await call('/v1/auth/logout', { method: 'POST', token })).status).toBe(200);
  });
  it('does not accept Cookie or browser origin for the native bearer protocol', async () => {
    const token = await login();
    for (const headers of [{ Cookie: 'learning=synthetic' }, { Origin: 'https://noxia.example' }]) expect((await call('/v1/auth/me', { token, headers })).status).toBe(403);
  });
  it('rejects missing tokens, wrong passwords, unsupported legacy scheme and direct internal requests', async () => {
    expect((await call('/v1/auth/me')).status).toBe(401);
    expect((await call('/v1/auth/login', { method: 'POST', body: { username: 'test_a', password: 'WrongPassword' } })).status).toBe(401);
    identityDB.exec("UPDATE users SET password_scheme='generated-v1'");
    expect((await call('/v1/auth/login', { method: 'POST', body: { username: 'test_a', password } })).status).toBe(401);
    const direct = await identity.fetch(req('/internal/noxia/login', { method: 'POST', body: {} }), identityEnv); expect(direct.status).toBe(403);
  });
  it('preserves the browser worker routing', async () => {
    const result = await identity.fetch(req('/api/auth/me'), identityEnv); expect(await result.text()).toBe('legacy browser route');
  });
  it('limits authentication attempts across worker calls using D1 counters', async () => {
    for (let i = 0; i < 15; i++) expect((await call('/v1/auth/login', { method: 'POST', body: { username: 'missing', password } })).status).toBe(401);
    expect((await call('/v1/auth/login', { method: 'POST', body: { username: 'missing', password } })).status).toBe(429);
  });
});

describe('versioned offline-safe entities', () => {
  it('writes and reads; a stale base cannot overwrite and returns latest copy', async () => {
    const token = await login(); expect((await write(token)).body.version).toBe(1);
    const updated = await write(token, 1, { id: 'item-a', name: '新标题', items: [] }); expect(updated.body.version).toBe(2);
    const stale = await write(token, 1); expect(stale.status).toBe(409); expect(stale.body.current.data.name).toBe('新标题');
    expect((await call('/v1/sync/playlists/item-a', { token })).body.version).toBe(2);
  });
  it('separates users and rejects stale account headers', async () => {
    const a = await login(), b = await login('test_b'); await write(a);
    expect((await call('/v1/sync/playlists/item-a', { token: b, owner: 'user-b' })).body.version).toBe(0);
    expect((await call('/v1/sync/playlists/item-a', { token: a, owner: 'user-b' })).status).toBe(409);
    expect((await call('/v1/sync/playlists', { token: b, owner: 'user-b' })).body.items).toEqual([]);
  });
  it('keeps a versioned tombstone and rejects stale resurrection', async () => {
    const token = await login(); await write(token);
    const deleted = await call('/v1/sync/playlists/item-a', { method: 'PUT', token, body: { baseVersion: 1, deleted: true, data: null } });
    expect(deleted.body).toMatchObject({ version: 2, deleted: true, data: null });
    expect((await write(token, 1)).status).toBe(409);
    expect((await call('/v1/sync/playlists', { token })).body.items[0].deleted).toBe(true);
  });
  it('rejects nested credentials, mismatched ids and oversized data before mutation', async () => {
    const token = await login();
    expect((await write(token, 0, { id: 'item-a', items: [{ apiKey: 'synthetic-not-a-secret' }] })).status).toBe(400);
    expect((await write(token, 0, { id: 'other' })).status).toBe(400);
    expect((await write(token, 0, { id: 'item-a', name: 'a'.repeat(70000) })).status).toBe(413);
    expect(dataDB.prepare('SELECT count(*) AS n FROM noxia_entities').get().n).toBe(0);
  });
  it('rejects invalid versions and unknown top level fields', async () => {
    const token = await login(); expect((await write(token, -1)).status).toBe(400);
    expect((await write(token, 0, { id: 'item-a', alien: true })).status).toBe(400);
  });
  it('paginates manifest without dropping tombstones', async () => {
    const token = await login(), insert = dataDB.prepare('INSERT INTO noxia_entities VALUES(?,?,?,1,NULL,1,1)');
    for (let i = 0; i < 101; i++) insert.run('user-a', 'history', `h${String(i).padStart(3, '0')}`);
    const page = await call('/v1/sync/history', { token }); expect(page.body.items).toHaveLength(100); expect(page.body.next).toBe('h099');
    const last = await call(`/v1/sync/history?after=${page.body.next}`, { token }); expect(last.body.items).toHaveLength(1); expect(last.body.next).toBeNull();
  });
  it('does not write after per-account sync budget is exhausted', async () => {
    const token = await login(), bucket = Math.floor(Date.now() / 60000);
    dataDB.prepare('INSERT INTO noxia_rate_limits VALUES(?,120,?)').run(`sync:user-a:${bucket}`, (bucket + 1) * 60000);
    expect((await write(token)).status).toBe(429); expect(dataDB.prepare('SELECT count(*) AS n FROM noxia_entities').get().n).toBe(0);
  });
});
