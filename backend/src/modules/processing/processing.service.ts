import type { D1Database } from "@cloudflare/workers-types";
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

interface ProcessingStage {
    status?: JobStatus;
    step: ProcessingStep;
    progress: number;
    delayMs: number;
}

const PROCESSING_STAGES: readonly ProcessingStage[] = [
    { status: "processing", step: "preparing", progress: 10, delayMs: 0 },
    { step: "extracting", progress: 30, delayMs: 3000 },
    { step: "analyzing", progress: 55, delayMs: 3000 },
    { step: "analyzing", progress: 75, delayMs: 3000 },
    { step: "finalizing", progress: 90, delayMs: 3000 },
];

export async function executeProcessingPipeline(
    db: D1Database,
    jobId: string,
    sleepFn: Sleep = defaultSleep
): Promise<void> {
    const job = await getJobById(db, jobId);
    if (!job) {
        console.warn(`[Processing] Job ${jobId} not found in D1, skipping.`);
        return;
    }

    if (job.status === "completed") {
        console.info(`[Processing] Job ${jobId} is already completed. Skipping.`);
        return;
    }

    try {
        for (const stage of PROCESSING_STAGES) {
            if (stage.delayMs > 0) {
                await sleepFn(stage.delayMs);
            }

            await updateJobStage(db, jobId, {
                status: stage.status,
                step: stage.step,
                progress: stage.progress,
            });
        }

        // Final 3-second delay before completion
        await sleepFn(3000);

        const completedAt = new Date().toISOString();
        await updateJobStage(db, jobId, {
            status: "completed",
            step: "completed",
            progress: 100,
            completedAt,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unexpected processing error";
        console.error(`[Processing] Job ${jobId} failed:`, message);

        await updateJobStage(db, jobId, {
            status: "failed",
            errorMessage: message,
        });
    }
}

