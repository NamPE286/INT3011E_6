import type { D1Database, R2Bucket, Queue } from "@cloudflare/workers-types";

export interface ProcessingQueueMessage {
    jobId: string;
}

export interface Env {
    DB: D1Database;
    FILE_STORAGE: R2Bucket;
    PROCESSING_QUEUE: Queue<ProcessingQueueMessage>;
}

