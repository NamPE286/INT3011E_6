import type { D1Database } from "@cloudflare/workers-types";
import type {
    JobResponse,
    JobStatus,
    ProcessingJobRecord,
    ProcessingStep,
} from "./processing.types";

const RECENT_JOB_LIMIT = 100;

export type NewJob = {
    id: string;
    fileKey: string;
    originalFilename: string;
    mimeType: string | null;
    fileSize: number;
};

export type JobStageUpdate = {
    status?: JobStatus;
    step?: ProcessingStep;
    progress?: number;
    errorMessage?: string | null;
    completedAt?: string | null;
};

export function toJobResponse(job: ProcessingJobRecord): JobResponse {
    return {
        id: job.id,
        filename: job.original_filename,
        fileSize: job.file_size,
        status: job.status,
        step: job.step,
        progress: job.progress,
        error: job.error_message,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
        completedAt: job.completed_at,
    };
}

export async function getJobById(db: D1Database, id: string): Promise<ProcessingJobRecord | null> {
    const record = await db
        .prepare("SELECT * FROM processing_jobs WHERE id = ?")
        .bind(id)
        .first<ProcessingJobRecord>();

    return record ?? null;
}

export async function getRecentJobs(db: D1Database): Promise<ProcessingJobRecord[]> {
    const result = await db
        .prepare("SELECT * FROM processing_jobs ORDER BY created_at DESC LIMIT ?")
        .bind(RECENT_JOB_LIMIT)
        .all<ProcessingJobRecord>();

    return result.results ?? [];
}

export async function insertJob(db: D1Database, job: NewJob): Promise<void> {
    const now = new Date().toISOString();

    await db
        .prepare(
            `INSERT INTO processing_jobs (
                id, file_key, original_filename, mime_type, file_size,
                status, step, progress, error_message, created_at, updated_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, 'queued', 'queued', 0, NULL, ?, ?, NULL)`
        )
        .bind(job.id, job.fileKey, job.originalFilename, job.mimeType, job.fileSize, now, now)
        .run();
}

/** Updates only the provided fields, so concurrent progress updates never overwrite each other's columns. */
export async function updateJobStage(db: D1Database, id: string, update: JobStageUpdate): Promise<void> {
    const assignments: string[] = ["updated_at = ?"];
    const values: (string | number | null)[] = [new Date().toISOString()];

    if (update.status !== undefined) {
        assignments.push("status = ?");
        values.push(update.status);
    }

    if (update.step !== undefined) {
        assignments.push("step = ?");
        values.push(update.step);
    }

    if (update.progress !== undefined) {
        assignments.push("progress = ?");
        values.push(Math.max(0, Math.min(100, Math.round(update.progress))));
    }

    if (update.errorMessage !== undefined) {
        assignments.push("error_message = ?");
        values.push(update.errorMessage);
    }

    if (update.completedAt !== undefined) {
        assignments.push("completed_at = ?");
        values.push(update.completedAt);
    }

    await db
        .prepare(`UPDATE processing_jobs SET ${assignments.join(", ")} WHERE id = ?`)
        .bind(...values, id)
        .run();
}
