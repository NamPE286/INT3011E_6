-- LLM-only PDF extraction (issue #33): the title may be unknown, results that fail validation are kept
-- for review, and each document records the run that produced it.
CREATE TABLE legal_documents_v2 (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL UNIQUE,
    document_title TEXT,
    json_content TEXT NOT NULL,
    snapshot_r2_key TEXT NOT NULL,
    artifact_r2_key TEXT NOT NULL,
    pdf_sha256 TEXT NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'ACCEPTED',
    validation_issues TEXT NOT NULL DEFAULT '[]',
    page_count INTEGER,
    extraction_model TEXT,
    prompt_version TEXT,
    schema_version TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (job_id) REFERENCES processing_jobs(id)
);

INSERT INTO legal_documents_v2 (
    id, job_id, document_title, json_content, snapshot_r2_key, artifact_r2_key, pdf_sha256, created_at
)
SELECT id, job_id, document_title, json_content, snapshot_r2_key, extracted_text_r2_key, pdf_sha256, created_at
FROM legal_documents;

DROP TABLE legal_documents;

ALTER TABLE legal_documents_v2 RENAME TO legal_documents;
