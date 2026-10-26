-- Semantic change detection (issue #19, SRS FR-13 / §8).
CREATE TABLE change_events (
    id TEXT PRIMARY KEY,
    traffic_violation_id TEXT NOT NULL,
    lineage_id TEXT NOT NULL,
    old_rule_id TEXT,
    new_rule_id TEXT,
    change_types TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '[]',
    evidence TEXT,
    effective_at TEXT,
    notes TEXT NOT NULL DEFAULT '[]',
    method TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_change_events_violation ON change_events (traffic_violation_id, effective_at);
