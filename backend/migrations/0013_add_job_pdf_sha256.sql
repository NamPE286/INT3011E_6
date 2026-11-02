-- One import per PDF content (SRS AC 25): the upload looks a PDF up by its SHA-256 and returns the existing
-- job instead of storing a second snapshot. Jobs uploaded before this migration keep a NULL hash.
ALTER TABLE processing_jobs ADD COLUMN pdf_sha256 TEXT;

CREATE UNIQUE INDEX idx_processing_jobs_pdf_sha256 ON processing_jobs (pdf_sha256);
