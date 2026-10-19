import type { Env } from "../../types/env";
import { insertJob } from "../processing/job.repository";
import { InvalidPdfError, loadPdf } from "../processing/pdf-document";

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

export class UploadValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UploadValidationError";
    }
}

export type UploadResult = {
    jobId: string;
    status: "queued";
};

export function sanitizeFilename(filename: string): string {
    const basename = filename.split(/[/\\]/).pop() ?? "file";
    const sanitized = basename.replace(/[^a-zA-Z0-9._-]/g, "_");

    return sanitized.length > 0 ? sanitized : "unnamed_file";
}

/** Validates the PDF, stores it as the job's immutable R2 snapshot, records the job and enqueues it. */
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
        });
        await env.PROCESSING_QUEUE.send({ jobId });
    } catch (error: unknown) {
        // Without a job or queue message nothing references the snapshot, so remove it.
        try {
            await env.FILE_STORAGE.delete(r2Key);
        } catch (cleanupError: unknown) {
            console.error(`Failed to remove orphaned R2 file ${r2Key}:`, cleanupError);
        }

        throw error;
    }

    return {
        jobId,
        status: "queued",
    };
}
