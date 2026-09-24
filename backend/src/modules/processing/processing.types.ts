export type JobStatus = "queued" | "processing" | "completed" | "failed";

export type ProcessingStep =
    | "queued"
    | "preparing"
    | "extracting"
    | "analyzing"
    | "finalizing"
    | "completed";

export interface ProcessingJobRecord {
    id: string;
    file_key: string;
    original_filename: string;
    mime_type: string | null;
    file_size: number;
    status: JobStatus;
    step: ProcessingStep | null;
    progress: number;
    error_message: string | null;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
}

export interface JobResponse {
    id: string;
    filename: string;
    status: JobStatus;
    step: ProcessingStep | null;
    progress: number;
    error: string | null;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
}

export type Sleep = (milliseconds: number) => Promise<void>;

