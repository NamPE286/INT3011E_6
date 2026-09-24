import type { Env } from "../../types/env";
import { insertJob } from "../processing/processing.service";

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

export class UploadValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UploadValidationError";
    }
}

export function sanitizeFilename(filename: string): string {
    const basename = filename.split(/[/\\]/).pop() ?? "file";
    const sanitized = basename.replace(/[^a-zA-Z0-9._-]/g, "_");
    return sanitized.length > 0 ? sanitized : "unnamed_file";
}

export interface UploadResult {
    jobId: string;
    status: "queued";
}

export async function processUpload(
    file: File,
    env: Env
): Promise<UploadResult> {
    if (!file) {
        throw new UploadValidationError("A valid file is required");
    }

    if (file.size === 0) {
        throw new UploadValidationError("Uploaded file cannot be empty");
    }

    if (!file.name || file.name.trim().length === 0) {
        throw new UploadValidationError("File must have a valid name");
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
        throw new UploadValidationError("File exceeds maximum limit of 50MB");
    }

    const jobId = crypto.randomUUID();
    const safeFilename = sanitizeFilename(file.name);
    const r2Key = `uploads/${jobId}/${safeFilename}`;

    // Upload to R2 object storage
    const fileBuffer = await file.arrayBuffer();
    await env.FILE_STORAGE.put(r2Key, fileBuffer, {
        httpMetadata: {
            contentType: file.type || "application/octet-stream",
        },
    });

    try {
        // Record job in D1
        await insertJob(env.DB, {
            id: jobId,
            fileKey: r2Key,
            originalFilename: file.name,
            mimeType: file.type || null,
            fileSize: file.size,
        });

        // Enqueue async processing job
        await env.PROCESSING_QUEUE.send({ jobId });

        return {
            jobId,
            status: "queued",
        };
    } catch (error: unknown) {
        // Partial failure cleanup: remove orphaned R2 object
        try {
            await env.FILE_STORAGE.delete(r2Key);
        } catch (cleanupError: unknown) {
            console.error(
                `Failed to remove orphaned R2 file ${r2Key}:`,
                cleanupError
            );
        }
        throw error;
    }
}
