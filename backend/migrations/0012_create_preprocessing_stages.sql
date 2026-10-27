-- Preprocessing checklist: one row per job and stage (its legal document) (docs/preprocessing.md). A missing row means
-- the stage has not run, so documents imported before this table are rerun when they are published.
CREATE TABLE preprocessing_stages (
    job_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (job_id, stage)
);
