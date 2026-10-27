import type { D1Database } from "@cloudflare/workers-types";
import { LEGAL_SCHEMA_VERSION, type LegalDocument, type ValidationIssue } from "./legal-types";

export type ReviewStatus = "ACCEPTED" | "REVIEW_REQUIRED";

export type ExtractionResult = {
    jobId: string;
    snapshotKey: string;
    artifactKey: string;
    document: LegalDocument;
    issues: ValidationIssue[];
    pageCount: number;
    model: string;
    promptVersion: string;
};

export type StoredLegalDocument = {
    jobId: string;
    reviewStatus: ReviewStatus;
    issues: ValidationIssue[];
    pageCount: number | null;
    model: string | null;
    promptVersion: string | null;
    schemaVersion: string | null;
    snapshotKey: string;
    artifactKey: string;
    pdfSha256: string;
    createdAt: string;
    document: LegalDocument;
};

type LegalDocumentRow = {
    job_id: string;
    json_content: string;
    snapshot_r2_key: string;
    artifact_r2_key: string;
    pdf_sha256: string;
    review_status: ReviewStatus;
    validation_issues: string;
    page_count: number | null;
    extraction_model: string | null;
    prompt_version: string | null;
    schema_version: string | null;
    created_at: string;
};

/**
 * Saves the document and finishes the job in one D1 batch. Unverified results are stored for review
 * instead of being dropped, but the job is marked needs_review so nothing is published silently.
 */
export async function saveLegalDocument(db: D1Database, result: ExtractionResult): Promise<ReviewStatus> {
    const now = new Date().toISOString();
    const errors = result.issues.filter((issue) => issue.severity === "ERROR");
    const reviewStatus: ReviewStatus = errors.length === 0 ? "ACCEPTED" : "REVIEW_REQUIRED";
    const jobStatus = reviewStatus === "ACCEPTED" ? "completed" : "needs_review";
    const jobMessage = reviewStatus === "ACCEPTED" ? null : summarizeIssues(errors);

    await db.batch([
        db.prepare(
            `INSERT INTO legal_documents (
                id, job_id, document_title, json_content, snapshot_r2_key, artifact_r2_key, pdf_sha256,
                review_status, validation_issues, page_count, extraction_model, prompt_version, schema_version, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(job_id) DO UPDATE SET
                document_title = excluded.document_title,
                json_content = excluded.json_content,
                snapshot_r2_key = excluded.snapshot_r2_key,
                artifact_r2_key = excluded.artifact_r2_key,
                pdf_sha256 = excluded.pdf_sha256,
                review_status = excluded.review_status,
                validation_issues = excluded.validation_issues,
                page_count = excluded.page_count,
                extraction_model = excluded.extraction_model,
                prompt_version = excluded.prompt_version,
                schema_version = excluded.schema_version`
        ).bind(
            result.jobId,
            result.jobId,
            result.document.document_title,
            JSON.stringify(result.document),
            result.snapshotKey,
            result.artifactKey,
            result.document.source.pdf_sha256,
            reviewStatus,
            JSON.stringify(result.issues),
            result.pageCount,
            result.model,
            result.promptVersion,
            LEGAL_SCHEMA_VERSION,
            now,
        ),
        db.prepare(
            `UPDATE processing_jobs
             SET status = ?, step = ?, progress = 100, error_message = ?, updated_at = ?, completed_at = ?
             WHERE id = ?`
        ).bind(jobStatus, jobStatus, jobMessage, now, now, result.jobId),
    ]);

    return reviewStatus;
}

export async function getLegalDocumentByJobId(db: D1Database, jobId: string): Promise<StoredLegalDocument | null> {
    const row = await db
        .prepare(
            `SELECT job_id, json_content, snapshot_r2_key, artifact_r2_key, pdf_sha256, review_status,
                validation_issues, page_count, extraction_model, prompt_version, schema_version, created_at
             FROM legal_documents WHERE job_id = ?`
        )
        .bind(jobId)
        .first<LegalDocumentRow>();

    if (!row) {
        return null;
    }

    return {
        jobId: row.job_id,
        reviewStatus: row.review_status,
        issues: JSON.parse(row.validation_issues),
        pageCount: row.page_count,
        model: row.extraction_model,
        promptVersion: row.prompt_version,
        schemaVersion: row.schema_version,
        snapshotKey: row.snapshot_r2_key,
        artifactKey: row.artifact_r2_key,
        pdfSha256: row.pdf_sha256,
        createdAt: row.created_at,
        document: JSON.parse(row.json_content),
    };
}

/**
 * Marks a reviewed document as accepted and completes its job in one D1 batch. Returns false when the
 * document is not waiting for review, so a repeated or stale request changes nothing.
 */
export async function acceptReviewedDocument(db: D1Database, jobId: string): Promise<boolean> {
    const now = new Date().toISOString();

    const results = await db.batch([
        db.prepare("UPDATE legal_documents SET review_status = 'ACCEPTED' WHERE job_id = ? AND review_status = 'REVIEW_REQUIRED'").bind(jobId),
        db.prepare(
            `UPDATE processing_jobs
             SET status = 'completed', step = 'completed', error_message = NULL, updated_at = ?, completed_at = ?
             WHERE id = ? AND status = 'needs_review'`
        ).bind(now, now, jobId),
    ]);

    return (results[0]?.meta.changes ?? 0) > 0;
}

function summarizeIssues(issues: ValidationIssue[]): string {
    const preview = issues.slice(0, 3).map((issue) => issue.message).join("; ");
    const remaining = issues.length > 3 ? ` (+${issues.length - 3} more)` : "";

    return `${issues.length} validation error(s): ${preview}${remaining}`.slice(0, 1000);
}
