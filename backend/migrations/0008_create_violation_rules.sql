-- Traffic violation and sanction extraction (issue #15, SRS FR-08 / FR-09 / §8).
-- One row per extraction run so every rule can be traced to the method, model, prompt and vocabulary used.
CREATE TABLE extraction_runs (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    method TEXT NOT NULL,
    model TEXT,
    prompt_version TEXT,
    extractor_version TEXT NOT NULL,
    vocabulary_version_before INTEGER,
    vocabulary_version_after INTEGER,
    vocab_ids_used TEXT NOT NULL DEFAULT '[]',
    vocab_ids_created TEXT NOT NULL DEFAULT '[]',
    rejected_values TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    error TEXT,
    rule_count INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    finished_at TEXT
);

CREATE INDEX idx_extraction_runs_document ON extraction_runs (document_id, started_at);

CREATE TABLE violation_rules (
    id TEXT PRIMARY KEY,
    source_document_id TEXT NOT NULL,
    provision_id TEXT NOT NULL,
    governed_document_id TEXT NOT NULL,
    governed_provision_id TEXT NOT NULL,
    sanction_provision_id TEXT,
    behavior_text TEXT NOT NULL,
    article_title TEXT,
    subject_scope TEXT,
    semantic_ir TEXT NOT NULL,
    semantic_method TEXT NOT NULL,
    extraction_status TEXT NOT NULL,
    uncertainty_reasons TEXT NOT NULL DEFAULT '[]',
    evidence_level TEXT NOT NULL,
    extraction_run_id TEXT NOT NULL,
    effective_from TEXT,
    traffic_violation_id TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (source_document_id) REFERENCES legal_documents(id) ON DELETE CASCADE
);

CREATE INDEX idx_violation_rules_source ON violation_rules (source_document_id);

CREATE INDEX idx_violation_rules_governed ON violation_rules (governed_provision_id);

CREATE TABLE sanctions (
    id TEXT PRIMARY KEY,
    violation_rule_id TEXT NOT NULL UNIQUE,
    fine_min INTEGER,
    fine_max INTEGER,
    currency TEXT NOT NULL,
    warning_allowed INTEGER NOT NULL DEFAULT 0,
    point_deduction_applicability TEXT NOT NULL,
    points_deducted INTEGER,
    remedial_measures_json TEXT NOT NULL DEFAULT '[]',
    evidence_provision_ids TEXT NOT NULL DEFAULT '[]',
    FOREIGN KEY (violation_rule_id) REFERENCES violation_rules(id) ON DELETE CASCADE
);

CREATE TABLE sanction_effects (
    id TEXT PRIMARY KEY,
    sanction_id TEXT NOT NULL,
    effect_type TEXT NOT NULL,
    duration_min INTEGER,
    duration_max INTEGER,
    duration_unit TEXT,
    points INTEGER,
    target_json TEXT,
    raw_text TEXT NOT NULL,
    source_provision_id TEXT NOT NULL,
    FOREIGN KEY (sanction_id) REFERENCES sanctions(id) ON DELETE CASCADE
);

CREATE INDEX idx_sanction_effects_sanction ON sanction_effects (sanction_id);
