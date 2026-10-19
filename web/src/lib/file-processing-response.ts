export type ProcessingStep =
    | "queued"
    | "preparing"
    | "extracting"
    | "analyzing"
    | "finalizing"
    | "completed"
    | "needs_review";

export type JobResponse = {
    status: "queued" | "processing" | "completed" | "failed" | "needs_review";
    step: ProcessingStep | null;
    progress: number;
    error: string | null;
};

export type JobSummary = JobResponse & {
    id: string;
    filename: string;
    fileSize: number;
    createdAt: string;
};

export type UploadResponse = {
    jobId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function parseJsonObject(responseText: string): Record<string, unknown> | null {
    try {
        const response: unknown = JSON.parse(responseText);

        return isRecord(response) ? response : null;
    } catch {
        return null;
    }
}

function isProcessingStep(value: unknown): value is ProcessingStep {
    return value === "queued"
        || value === "preparing"
        || value === "extracting"
        || value === "analyzing"
        || value === "finalizing"
        || value === "completed"
        || value === "needs_review";
}

export function parseUploadResponse(responseText: string): UploadResponse | null {
    const response = parseJsonObject(responseText);

    if (!response || typeof response.jobId !== "string" || response.jobId.length === 0) {
        return null;
    }

    return { jobId: response.jobId };
}

export function parseErrorMessage(responseText: string): string | null {
    const response = parseJsonObject(responseText);

    if (!response || typeof response.message !== "string") {
        return null;
    }

    return response.message;
}

export function isJobResponse(value: unknown): value is JobResponse {
    if (!isRecord(value)) {
        return false;
    }

    const hasValidStatus = value.status === "queued"
        || value.status === "processing"
        || value.status === "completed"
        || value.status === "failed"
        || value.status === "needs_review";
    const hasValidStep = value.step === null || isProcessingStep(value.step);
    const hasValidProgress = typeof value.progress === "number" && Number.isFinite(value.progress);
    const hasValidError = value.error === null || typeof value.error === "string";

    return hasValidStatus && hasValidStep && hasValidProgress && hasValidError;
}

function isJobSummary(value: unknown): value is JobSummary {
    if (!isRecord(value)) {
        return false;
    }

    const hasIdentity = typeof value.id === "string"
        && typeof value.filename === "string"
        && typeof value.fileSize === "number"
        && typeof value.createdAt === "string";

    return hasIdentity && isJobResponse(value);
}

/** Parses GET /api/jobs; one malformed row is skipped instead of hiding the whole list. */
export function parseJobList(value: unknown): JobSummary[] | null {
    if (!isRecord(value) || !Array.isArray(value.jobs)) {
        return null;
    }

    return value.jobs.filter(isJobSummary);
}

export function isJobActive(job: JobResponse): boolean {
    return job.status === "queued" || job.status === "processing";
}
