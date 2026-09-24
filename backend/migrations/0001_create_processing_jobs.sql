-- Migration: 0001_create_processing_jobs.sql
CREATE TABLE IF NOT EXISTS processing_jobs (
    id TEXT PRIMARY KEY,
    file_key TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    mime_type TEXT,
    file_size INTEGER NOT NULL,
    status TEXT NOT NULL,
    step TEXT,
    progress INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);

