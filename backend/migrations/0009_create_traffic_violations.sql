-- Violation identity resolution (issue #17, SRS FR-10 / §4.5 / §8).
CREATE TABLE traffic_violations (
    id TEXT PRIMARY KEY,
    canonical_name TEXT NOT NULL,
    signature_key TEXT,
    semantic_ir TEXT NOT NULL,
    created_from_rule_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_traffic_violations_signature ON traffic_violations (signature_key);

CREATE TABLE violation_aliases (
    id TEXT PRIMARY KEY,
    traffic_violation_id TEXT NOT NULL,
    alias TEXT NOT NULL,
    normalized_alias TEXT NOT NULL,
    source_rule_id TEXT NOT NULL,
    source_document_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (traffic_violation_id, normalized_alias),
    FOREIGN KEY (traffic_violation_id) REFERENCES traffic_violations(id) ON DELETE CASCADE
);

CREATE INDEX idx_violation_aliases_normalized ON violation_aliases (normalized_alias);

-- Why each rule was matched, created or left ambiguous, with the candidates that were considered.
CREATE TABLE identity_decisions (
    violation_rule_id TEXT PRIMARY KEY,
    source_document_id TEXT NOT NULL,
    decision TEXT NOT NULL,
    traffic_violation_id TEXT,
    method TEXT NOT NULL,
    score REAL,
    candidates TEXT NOT NULL DEFAULT '[]',
    reasons TEXT NOT NULL DEFAULT '[]',
    model TEXT,
    decided_at TEXT NOT NULL
);

CREATE INDEX idx_identity_decisions_document ON identity_decisions (source_document_id);
