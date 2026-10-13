-- Used by scripts/data_ingest.py against `turso dev` or a Turso HTTP endpoint.
CREATE TABLE IF NOT EXISTS openf1_responses (
    url TEXT PRIMARY KEY,
    fetched_at TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    record_count INTEGER NOT NULL,
    payload BLOB NOT NULL -- gzip-compressed canonical OpenF1 JSON
);

CREATE TABLE IF NOT EXISTS replay_assets (
    session_key INTEGER NOT NULL,
    name TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    payload BLOB NOT NULL, -- JSON manifest: byte_length, chunk_size, chunk_count
    PRIMARY KEY (session_key, name)
);

CREATE TABLE IF NOT EXISTS replay_asset_chunks (
    session_key INTEGER NOT NULL,
    name TEXT NOT NULL,
    part INTEGER NOT NULL,
    payload BLOB NOT NULL, -- at most 512 KiB to respect HTTP binding limits
    PRIMARY KEY (session_key, name, part)
);
