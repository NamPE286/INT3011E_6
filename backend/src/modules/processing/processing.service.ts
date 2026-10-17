import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "../../types/env";
import { extractPdfText } from "./pdf-extractor";
import { createSourceLines } from "./source-lines";
import { segmentLegalText } from "./legal-llm.service";
import { buildLegalDocument } from "./legal-validator";
import { saveLegalDocument } from "./legal-persistence";
import { NeedsReviewError } from "./legal-types";
import type {
    ProcessingJobRecord,
    JobResponse,
    ProcessingStep,
    JobStatus,
    Sleep,
} from "./processing.types";

export const defaultSleep: Sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

export function toJobResponse(job: ProcessingJobRecord): JobResponse {
    return {
        id: job.id,
        filename: job.original_filename,
        status: job.status,
        step: job.step,
        progress: job.progress,
        error: job.error_message,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
        completedAt: job.completed_at,
    };
}

export async function getJobById(
    db: D1Database,
    id: string
): Promise<ProcessingJobRecord | null> {
    const record = await db
        .prepare("SELECT * FROM processing_jobs WHERE id = ?")
        .bind(id)
        .first<ProcessingJobRecord>();

    return record ?? null;
}

export async function insertJob(
    db: D1Database,
    job: {
        id: string;
        fileKey: string;
        originalFilename: string;
        mimeType: string | null;
        fileSize: number;
    }
): Promise<ProcessingJobRecord> {
    const now = new Date().toISOString();
    const newRecord: ProcessingJobRecord = {
        id: job.id,
        file_key: job.fileKey,
        original_filename: job.originalFilename,
        mime_type: job.mimeType,
        file_size: job.fileSize,
        status: "queued",
        step: "queued",
        progress: 0,
        error_message: null,
        created_at: now,
        updated_at: now,
        completed_at: null,
    };

    await db
        .prepare(
            `INSERT INTO processing_jobs (
                id, file_key, original_filename, mime_type, file_size,
                status, step, progress, error_message, created_at, updated_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
            newRecord.id,
            newRecord.file_key,
            newRecord.original_filename,
            newRecord.mime_type,
            newRecord.file_size,
            newRecord.status,
            newRecord.step,
            newRecord.progress,
            newRecord.error_message,
            newRecord.created_at,
            newRecord.updated_at,
            newRecord.completed_at
        )
        .run();

    return newRecord;
}

export async function updateJobStage(
    db: D1Database,
    id: string,
    updates: {
        status?: JobStatus;
        step?: ProcessingStep;
        progress?: number;
        errorMessage?: string | null;
        completedAt?: string | null;
    }
): Promise<void> {
    const now = new Date().toISOString();
    const current = await getJobById(db, id);
    if (!current) {
        return;
    }

    const nextStatus = updates.status ?? current.status;
    const nextStep = updates.step !== undefined ? updates.step : current.step;
    const rawProgress = updates.progress !== undefined ? updates.progress : current.progress;
    const nextProgress = Math.max(0, Math.min(100, rawProgress));
    const nextErrorMessage =
        updates.errorMessage !== undefined ? updates.errorMessage : current.error_message;
    const nextCompletedAt =
        updates.completedAt !== undefined ? updates.completedAt : current.completed_at;

    await db
        .prepare(
            `UPDATE processing_jobs
             SET status = ?, step = ?, progress = ?, error_message = ?, updated_at = ?, completed_at = ?
             WHERE id = ?`
        )
        .bind(
            nextStatus,
            nextStep,
            nextProgress,
            nextErrorMessage,
            now,
            nextCompletedAt,
            id
        )
        .run();
}

/** Real PDF → text → LLM boundaries → exact legal content/locators → D1 pipeline. */
export async function executeProcessingPipeline(env: Env, jobId: string): Promise<void> {
    const db = env.DB;
    const job = await getJobById(db, jobId);
    if (!job) {
        // Invalid/unresolvable job is not a temporary error; do not loop forever.
        throw new NeedsReviewError(`Job ${jobId} does not exist in D1`);
    }
    if (job.status === "completed" || job.status === "needs_review") {
        return; // Idempotent for messages delivered more than once.
    }

    try {
        await updateJobStage(db, jobId, {
            status: "processing", step: "preparing", progress: 10,
            errorMessage: null,
        });
        const snapshotKey = `snapshots/${jobId}.pdf`;
        const textKey = `snapshots/${jobId}.extracted.json`;
        // If snapshot creation succeeded but a previous D1 operation failed, retry from it.
        const object = await env.FILE_STORAGE.get(job.file_key) ?? await env.FILE_STORAGE.get(snapshotKey);
        if (!object) throw new NeedsReviewError(`PDF missing in R2: ${job.file_key}`);
        const rawPdf = await object.arrayBuffer();
        const hashBytes = await crypto.subtle.digest("SHA-256", rawPdf);
        const pdfSha256 = Array.from(new Uint8Array(hashBytes), (b) => b.toString(16).padStart(2, "0")).join("");

        await updateJobStage(db, jobId, { step: "extracting", progress: 30 });
        const pages = await extractPdfText(rawPdf);
        const lines = createSourceLines(pages);
        if (!lines.length) throw new NeedsReviewError("No readable text in PDF");

        await updateJobStage(db, jobId, { step: "analyzing", progress: 55 });
        const segmentation = await segmentLegalText(lines, env.OPENAI_API_KEY ?? "", env.OPENAI_MODEL);
        const document = buildLegalDocument(segmentation, pages, lines, jobId, pdfSha256);

        await updateJobStage(db, jobId, { step: "finalizing", progress: 90 });
        // Preserve evidence FIRST. Only the temporary upload key will be removed.
        await env.FILE_STORAGE.put(snapshotKey, rawPdf, {
            httpMetadata: { contentType: "application/pdf" },
        });
        await env.FILE_STORAGE.put(textKey, JSON.stringify({
            extraction_version: "unpdf-v1",
            pages,
        }), { httpMetadata: { contentType: "application/json" } });
        await saveLegalDocument(db, jobId, snapshotKey, textKey, document);
        // Safe to remove temporary upload after D1 committed; keep snapshot indefinitely.
        if (job.file_key !== snapshotKey) {
            try {
                await env.FILE_STORAGE.delete(job.file_key);
            } catch (cleanupError) {
                console.warn(`[Processing] Temp R2 cleanup failed for ${jobId}`, cleanupError);
            }
        }
    } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : "Unknown PDF processing error";
        const review = error instanceof NeedsReviewError;
        console.error(`[Processing] ${review ? "Needs review" : "Failed"}: ${jobId}`, detail);
        await updateJobStage(db, jobId, {
            status: review ? "needs_review" : "failed",
            step: review ? "needs_review" : "finalizing",
            errorMessage: detail.slice(0, 1000),
        });
        // Temporary errors bubble to Queue consumer, which requests a retry.
        if (!review) throw error;
    }
}
