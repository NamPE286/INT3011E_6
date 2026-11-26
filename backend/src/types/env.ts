import type { D1Database, R2Bucket, Queue } from "@cloudflare/workers-types";

/** Without `stage` the message reads the PDF; with it, it runs that preprocessing stage of the document. */
export interface ProcessingQueueMessage {
    jobId: string;
    stage?: string;
}

export interface Env {
    DB: D1Database;
    GEMINI_API_KEY?: string;
    GEMINI_MODEL?: string;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    PDF_CHUNK_PAGES?: string;
    FILE_STORAGE: R2Bucket;
    PROCESSING_QUEUE: Queue<ProcessingQueueMessage>;
    INTERNAL_MCP_TOKEN?: string;
    INTERNAL_MCP_WRITE_TOKEN?: string;
    BETTER_AUTH_SECRET?: string;
    BETTER_AUTH_URL?: string;
    TRUSTED_ORIGINS?: string;
}
