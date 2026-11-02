import type { Env } from "../../types/env";
import type { JobStatus } from "../processing/processing.types";
import { deleteJob, findJobByPdfSha256, insertJob } from "../processing/job.repository";
import { InvalidPdfError, loadPdf, sha256Hex } from "../processing/pdf-document";

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

export class UploadValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UploadValidationError";
    }
}

export type UploadResult = {
    jobId: string;
    status: JobStatus;
    /** True when a PDF with the same content was imported before; jobId is then that earlier job. */
    duplicate: boolean;
};

export function sanitizeFilename(filename: string): string {
    const basename = filename.split(/[/\\]/).pop() ?? "file";
    const sanitized = basename.replace(/[^a-zA-Z0-9._-]/g, "_");

    return sanitized.length > 0 ? sanitized : "unnamed_file";
}

/**
 * Validates the PDF, stores it as the job's immutable R2 snapshot, records the job and enqueues it. A PDF
 * whose content was imported before returns that job, so the same file never creates a second document.
 */
export async function processUpload(file: File, env: Env): Promise<UploadResult> {
    if (file.size === 0) {
        throw new UploadValidationError("Uploaded file cannot be empty");
    }

    if (!file.name || file.name.trim().length === 0) {
        throw new UploadValidationError("File must have a valid name");
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
        throw new UploadValidationError("File exceeds maximum limit of 50MB");
    }

    if (!file.name.toLowerCase().endsWith(".pdf")) {
        throw new UploadValidationError("Only .pdf files are supported");
    }

    const fileBuffer = await file.arrayBuffer();

    try {
        await loadPdf(fileBuffer);
    } catch (error: unknown) {
        if (error instanceof InvalidPdfError) {
            throw new UploadValidationError(error.message);
        }

        throw error;
    }

    const pdfSha256 = await sha256Hex(fileBuffer);
    const existing = await findJobByPdfSha256(env.DB, pdfSha256);

    if (existing) {
        return duplicateOf(existing);
    }

    const jobId = crypto.randomUUID();
    const r2Key = `uploads/${jobId}/${sanitizeFilename(file.name)}`;

    await env.FILE_STORAGE.put(r2Key, fileBuffer, {
        httpMetadata: { contentType: "application/pdf" },
    });

    try {
        await insertJob(env.DB, {
            id: jobId,
            fileKey: r2Key,
            originalFilename: file.name,
            mimeType: file.type || null,
            fileSize: file.size,
            pdfSha256,
        });
        await env.PROCESSING_QUEUE.send({ jobId });
    } catch (error: unknown) {
        // Without a queued job nothing may reference the snapshot: drop the job row (if it was written) and the file.
        try {
            await deleteJob(env.DB, jobId);
            await env.FILE_STORAGE.delete(r2Key);
        } catch (cleanupError: unknown) {
            console.error(`Failed to clean up the upload of job ${jobId}:`, cleanupError);
        }

        // A concurrent upload of the same PDF won the unique hash index: answer with its job.
        const winner = await findJobByPdfSha256(env.DB, pdfSha256);

        if (winner && winner.id !== jobId) {
            return duplicateOf(winner);
        }

        throw error;
    }

    return {
        jobId,
        status: "queued",
        duplicate: false,
    };
}

function duplicateOf(job: { id: string; status: JobStatus }): UploadResult {
    return { jobId: job.id, status: job.status, duplicate: true };
}
