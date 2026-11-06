-- NEW Noxia data database only. Does not contain accounts or binary audio.
CREATE TABLE IF NOT EXISTS noxia_entities (
 user_id TEXT NOT NULL,
 collection TEXT NOT NULL CHECK(collection IN ('resources','playlists','templates','history')),
 entity_id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version > 0),
 data TEXT,
 deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,collection,entity_id)
);
CREATE TABLE IF NOT EXISTS noxia_rate_limits (
 key TEXT PRIMARY KEY,
 count INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS noxia_rate_expiry ON noxia_rate_limits(expires_at);
