-- ADDITIVE migration for the EXISTING identity database. Backup + approval first.
-- Do not run against production as part of Noxia CI.
CREATE TABLE IF NOT EXISTS noxia_mobile_sessions (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 credential_version INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS noxia_mobile_user ON noxia_mobile_sessions(user_id);
CREATE INDEX IF NOT EXISTS noxia_mobile_expiry ON noxia_mobile_sessions(expires_at);
