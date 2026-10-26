-- Rule lineage and validity intervals (issue #18, SRS FR-11 / FR-12 / §8).
CREATE TABLE rule_lineages (
    id TEXT PRIMARY KEY,
    traffic_violation_id TEXT NOT NULL,
    lineage_key TEXT NOT NULL,
    context_ir TEXT NOT NULL,
    rule_ids TEXT NOT NULL DEFAULT '[]',
    links TEXT NOT NULL DEFAULT '[]',
    history_version TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_rule_lineages_violation ON rule_lineages (traffic_violation_id);

-- When each rule applies and what ended it. Status at a given date is derived from this, never stored.
CREATE TABLE rule_intervals (
    rule_id TEXT PRIMARY KEY,
    lineage_id TEXT NOT NULL,
    valid_from TEXT,
    valid_to TEXT,
    end_type TEXT,
    end_evidence TEXT,
    successor_rule_id TEXT,
    warnings TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_rule_intervals_lineage ON rule_intervals (lineage_id);
