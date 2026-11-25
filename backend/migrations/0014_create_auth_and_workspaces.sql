-- Better Auth core tables (email + password authentication)
CREATE TABLE IF NOT EXISTS user (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    user_id TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_user_id ON session (user_id);
CREATE INDEX IF NOT EXISTS idx_session_token ON session (token);

CREATE TABLE IF NOT EXISTS account (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    id_token TEXT,
    access_token_expires_at INTEGER,
    refresh_token_expires_at INTEGER,
    scope TEXT,
    password TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_account_user_id ON account (user_id);

CREATE TABLE IF NOT EXISTS verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER,
    updated_at INTEGER
);

-- Multi-workspace instances per account
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    domain TEXT NOT NULL DEFAULT 'general',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (owner_user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces (owner_user_id);

-- Scope existing domain datasets to workspaces (default preserves backward compatibility)
ALTER TABLE processing_jobs ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
DROP INDEX IF EXISTS idx_processing_jobs_pdf_sha256;
CREATE UNIQUE INDEX idx_processing_jobs_workspace_sha256 ON processing_jobs (workspace_id, pdf_sha256);
CREATE INDEX idx_processing_jobs_workspace ON processing_jobs (workspace_id);

ALTER TABLE legal_documents ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX idx_legal_documents_workspace ON legal_documents (workspace_id);

ALTER TABLE document_relations ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE document_relations ADD COLUMN source_mode TEXT NOT NULL DEFAULT 'AI';
ALTER TABLE document_relations ADD COLUMN note TEXT;
CREATE INDEX idx_document_relations_workspace ON document_relations (workspace_id);

ALTER TABLE provision_relations ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE provision_relations ADD COLUMN source_mode TEXT NOT NULL DEFAULT 'AI';
CREATE INDEX idx_provision_relations_workspace ON provision_relations (workspace_id);

ALTER TABLE traffic_violations ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX idx_traffic_violations_workspace ON traffic_violations (workspace_id);

-- Manual and custom sanction-change graph edges (Mode 1: sanction severity shifts)
CREATE TABLE IF NOT EXISTS sanction_change_edges (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'default',
    from_document_id TEXT NOT NULL,
    to_document_id TEXT NOT NULL,
    from_provision_id TEXT,
    to_provision_id TEXT,
    behavior_summary TEXT NOT NULL,
    change_type TEXT NOT NULL,
    old_penalty_text TEXT,
    new_penalty_text TEXT,
    old_fine_min INTEGER,
    old_fine_max INTEGER,
    new_fine_min INTEGER,
    new_fine_max INTEGER,
    note TEXT,
    source_mode TEXT NOT NULL DEFAULT 'MANUAL',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sanction_change_edges_workspace ON sanction_change_edges (workspace_id);
