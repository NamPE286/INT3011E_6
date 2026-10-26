-- Legal change graph (issue #11, SRS FR-06 / FR-07 / §8).
-- One row per amendment or repeal instruction, with its raw target citation and resolution status.
CREATE TABLE change_instructions (
    id TEXT PRIMARY KEY,
    source_document_id TEXT NOT NULL,
    source_provision_id TEXT NOT NULL,
    source_snapshot_id TEXT,
    operation TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    raw_target_citation TEXT NOT NULL,
    target_document_citation TEXT,
    target_document_number TEXT,
    target_is_self INTEGER NOT NULL DEFAULT 0,
    target_document_id TEXT,
    target_scope TEXT NOT NULL,
    target_locators TEXT NOT NULL DEFAULT '[]',
    new_text_provision_ids TEXT NOT NULL DEFAULT '[]',
    quoted_segments TEXT NOT NULL DEFAULT '[]',
    exceptions TEXT NOT NULL DEFAULT '[]',
    effective_from TEXT,
    resolution_status TEXT NOT NULL,
    resolution_reason TEXT NOT NULL,
    method TEXT NOT NULL,
    extractor_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (source_document_id) REFERENCES legal_documents(id) ON DELETE CASCADE
);

CREATE INDEX idx_change_instructions_source ON change_instructions (source_document_id);

-- First-class provision edges resolved from instructions, from the acting provision to the affected one.
CREATE TABLE provision_relations (
    id TEXT PRIMARY KEY,
    change_instruction_id TEXT NOT NULL,
    from_document_id TEXT NOT NULL,
    from_provision_id TEXT NOT NULL,
    to_document_id TEXT NOT NULL,
    to_provision_id TEXT,
    relation_type TEXT NOT NULL,
    target_locator TEXT NOT NULL,
    insertion_locator TEXT,
    new_text_provision_ids TEXT NOT NULL DEFAULT '[]',
    verification_status TEXT NOT NULL,
    evidence_level TEXT NOT NULL,
    evidence_text TEXT NOT NULL,
    effective_from TEXT,
    method TEXT NOT NULL,
    extractor_version TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_provision_relations_from ON provision_relations (from_provision_id);

CREATE INDEX idx_provision_relations_to ON provision_relations (to_provision_id);

CREATE INDEX idx_provision_relations_to_document ON provision_relations (to_document_id);

ALTER TABLE document_relations ADD COLUMN evidence_provision_relation_ids TEXT NOT NULL DEFAULT '[]';
