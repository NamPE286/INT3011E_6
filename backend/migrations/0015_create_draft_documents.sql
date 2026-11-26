-- Draft legislative documents authored in LexIDE.
CREATE TABLE IF NOT EXISTS draft_documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    document_number TEXT,
    document_type TEXT,
    agency TEXT,
    content TEXT NOT NULL,
    source_document_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_draft_documents_updated_at ON draft_documents (updated_at DESC);
