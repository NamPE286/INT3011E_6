-- Preserve original PDF snapshot in R2 under snapshots/{job_id}.pdf.
-- JSON is generated only from validated text and source locators.
CREATE TABLE IF NOT EXISTS legal_documents (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE,
  document_title TEXT NOT NULL,
  json_content TEXT NOT NULL,
  snapshot_r2_key TEXT NOT NULL,
  extracted_text_r2_key TEXT NOT NULL,
  pdf_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES processing_jobs(id)
);
