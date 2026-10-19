import type { D1Database, R2Bucket, Queue } from "@cloudflare/workers-types";

export interface ProcessingQueueMessage {
    jobId: string;
}

export interface Env {
    DB: D1Database;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    PDF_CHUNK_PAGES?: string;
    FILE_STORAGE: R2Bucket;
    PROCESSING_QUEUE: Queue<ProcessingQueueMessage>;
    INTERNAL_MCP_TOKEN?: string;
    INTERNAL_MCP_WRITE_TOKEN?: string;
}
