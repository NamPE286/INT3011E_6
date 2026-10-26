CREATE TABLE provisions (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    parent_id TEXT,
    ordinal INTEGER NOT NULL,
    level TEXT NOT NULL,
    number TEXT NOT NULL,
    title TEXT,
    text TEXT,
    article_no TEXT,
    paragraph_no TEXT,
    point_no TEXT,
    page_start INTEGER,
    page_end INTEGER,
    source_quote TEXT,
    read_quality TEXT,
    content_role TEXT NOT NULL,
    relevance TEXT NOT NULL,
    container_provision_id TEXT,
    quoted_segments TEXT NOT NULL DEFAULT '[]',
    flags TEXT NOT NULL DEFAULT '[]',
    role_method TEXT NOT NULL,
    role_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (document_id) REFERENCES legal_documents(id) ON DELETE CASCADE
);

CREATE INDEX idx_provisions_document_ordinal ON provisions (document_id, ordinal);

CREATE INDEX idx_provisions_document_relevance ON provisions (document_id, relevance);

ALTER TABLE provisions ADD COLUMN source_snapshot_id TEXT;

ALTER TABLE provisions ADD COLUMN pdf_sha256 TEXT;

ALTER TABLE provisions ADD COLUMN read_method TEXT;

ALTER TABLE provisions ADD COLUMN source_regions TEXT NOT NULL DEFAULT '[]';
