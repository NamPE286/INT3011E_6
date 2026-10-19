-- Migration: 0003_create_vocab_entries.sql
CREATE TABLE IF NOT EXISTS vocab_entries (
    id TEXT PRIMARY KEY,
    canonical_id TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    canonical_label TEXT NOT NULL,
    aliases TEXT NOT NULL DEFAULT '[]',
    definition TEXT,
    evidence TEXT,
    source_provision_id TEXT,
    source_document_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    vocabulary_version INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vocab_type ON vocab_entries(type);
CREATE INDEX IF NOT EXISTS idx_vocab_label ON vocab_entries(canonical_label);
CREATE INDEX IF NOT EXISTS idx_vocab_version ON vocab_entries(vocabulary_version);

CREATE TABLE IF NOT EXISTS vocab_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO vocab_metadata (key, value, updated_at)
VALUES ('vocabulary_version', '1', datetime('now'));
