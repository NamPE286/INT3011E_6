-- Evidence-backed document graph (issue #5, SRS FR-03 / §8).
-- Identity metadata read from each stored document, used to resolve references to canonical document ids.
CREATE TABLE document_metadata (
    document_id TEXT PRIMARY KEY,
    document_number TEXT,
    normalized_number TEXT,
    document_type TEXT,
    agency TEXT,
    issued_at TEXT,
    effective_from TEXT,
    effective_evidence TEXT,
    metadata_notes TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL,
    FOREIGN KEY (document_id) REFERENCES legal_documents(id) ON DELETE CASCADE
);

CREATE INDEX idx_document_metadata_number ON document_metadata (normalized_number);

-- Every reference + legal-action cue found in the full text, with its evidence and resolution status.
CREATE TABLE document_relation_candidates (
    id TEXT PRIMARY KEY,
    source_document_id TEXT NOT NULL,
    source_snapshot_id TEXT,
    source_provision_id TEXT,
    evidence_field TEXT NOT NULL,
    content_role TEXT,
    page_start INTEGER,
    page_end INTEGER,
    start_offset INTEGER NOT NULL,
    end_offset INTEGER NOT NULL,
    quoted_text TEXT NOT NULL,
    cue TEXT NOT NULL,
    raw_target_citation TEXT NOT NULL,
    target_document_number TEXT,
    action TEXT NOT NULL,
    proposed_relation_type TEXT NOT NULL,
    scope TEXT NOT NULL,
    resolved_target_document_id TEXT,
    status TEXT NOT NULL,
    resolution_reason TEXT NOT NULL,
    method TEXT NOT NULL,
    extractor_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (source_document_id) REFERENCES legal_documents(id) ON DELETE CASCADE
);

CREATE INDEX idx_relation_candidates_source ON document_relation_candidates (source_document_id);

CREATE INDEX idx_relation_candidates_number ON document_relation_candidates (target_document_number);

-- Accepted edges only. One row per (from, to, type, scope), its evidence is the set of ACCEPTED candidates
-- (and later verified provision relations) with the same key, so multi-edges and evidence are never merged away.
CREATE TABLE document_relations (
    id TEXT PRIMARY KEY,
    from_document_id TEXT NOT NULL,
    to_document_id TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    scope TEXT NOT NULL,
    verification_status TEXT NOT NULL,
    evidence_level TEXT NOT NULL,
    evidence_candidate_ids TEXT NOT NULL DEFAULT '[]',
    method TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (from_document_id, to_document_id, relation_type, scope)
);

CREATE INDEX idx_document_relations_to ON document_relations (to_document_id);
