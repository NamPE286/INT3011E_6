import type { D1Database } from "@cloudflare/workers-types";
import type { LegalDocument } from "./legal-types";

/** Atomic D1 commit: persistence and job completion either both succeed or both fail. */
export async function saveLegalDocument(
  db: D1Database,
  jobId: string,
  snapshotKey: string,
  textKey: string,
  document: LegalDocument,
): Promise<void> {
  const now = new Date().toISOString();
  const payload = JSON.stringify(document);
  await db.batch([
    db.prepare(`INSERT INTO legal_documents
      (id, job_id, document_title, json_content, snapshot_r2_key, extracted_text_r2_key, pdf_sha256, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(job_id) DO UPDATE SET
        document_title = excluded.document_title,
        json_content = excluded.json_content,
        snapshot_r2_key = excluded.snapshot_r2_key,
        extracted_text_r2_key = excluded.extracted_text_r2_key,
        pdf_sha256 = excluded.pdf_sha256`)
      .bind(jobId, jobId, document.document_title, payload, snapshotKey, textKey, document.source.pdf_sha256, now),
    db.prepare(`UPDATE processing_jobs SET status = 'completed', step = 'completed',
      progress = 100, error_message = NULL, updated_at = ?, completed_at = ? WHERE id = ?`)
      .bind(now, now, jobId),
  ]);
}
