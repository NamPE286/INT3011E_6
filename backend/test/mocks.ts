import type {
    D1Database,
    D1PreparedStatement,
    D1Response,
    D1Result,
    D1ExecResult,
    R2Bucket,
    Queue,
    R2Object,
    QueueSendResponse,
    QueueSendBatchResponse,
} from "@cloudflare/workers-types";
import type { Env, ProcessingQueueMessage } from "../src/types/env";
import type { ProcessingJobRecord } from "../src/modules/processing/processing.types";

export interface MockEnvironment extends Env {
    d1Store: Map<string, ProcessingJobRecord>;
    r2Store: Map<string, { content: ArrayBuffer; contentType?: string }>;
    queueMessages: ProcessingQueueMessage[];
}

export function createMockEnv(): MockEnvironment {
    const d1Store = new Map<string, ProcessingJobRecord>();
    const r2Store = new Map<string, { content: ArrayBuffer; contentType?: string }>();
    const queueMessages: ProcessingQueueMessage[] = [];

    const mockDb = {
        prepare(query: string): D1PreparedStatement {
            let boundParams: unknown[] = [];

            const statement = {
                bind(...values: unknown[]) {
                    boundParams = values;
                    return statement as unknown as D1PreparedStatement;
                },
                async first<T = unknown>(_colName?: string): Promise<T | null> {
                    if (query.includes("SELECT * FROM processing_jobs WHERE id = ?")) {
                        const id = boundParams[0] as string;
                        const job = d1Store.get(id);
                        return (job as T) ?? null;
                    }
                    return null;
                },
                async run(): Promise<D1Response> {
                    if (query.includes("INSERT INTO processing_jobs")) {
                        const [
                            id,
                            file_key,
                            original_filename,
                            mime_type,
                            file_size,
                            status,
                            step,
                            progress,
                            error_message,
                            created_at,
                            updated_at,
                            completed_at,
                        ] = boundParams;

                        d1Store.set(id as string, {
                            id: id as string,
                            file_key: file_key as string,
                            original_filename: original_filename as string,
                            mime_type: (mime_type as string) ?? null,
                            file_size: file_size as number,
                            status: status as ProcessingJobRecord["status"],
                            step: (step as ProcessingJobRecord["step"]) ?? null,
                            progress: progress as number,
                            error_message: (error_message as string) ?? null,
                            created_at: created_at as string,
                            updated_at: updated_at as string,
                            completed_at: (completed_at as string) ?? null,
                        });
                    } else if (query.includes("UPDATE processing_jobs")) {
                        const [
                            status,
                            step,
                            progress,
                            error_message,
                            updated_at,
                            completed_at,
                            id,
                        ] = boundParams;

                        const existing = d1Store.get(id as string);
                        if (existing) {
                            d1Store.set(id as string, {
                                ...existing,
                                status: status as ProcessingJobRecord["status"],
                                step: step as ProcessingJobRecord["step"],
                                progress: progress as number,
                                error_message: (error_message as string) ?? null,
                                updated_at: updated_at as string,
                                completed_at: (completed_at as string) ?? null,
                            });
                        }
                    }

                    return {
                        success: true,
                        meta: {},
                    } as unknown as D1Response;
                },
                async all<T = unknown>(): Promise<D1Result<T>> {
                    return {
                        success: true,
                        meta: {},
                        results: Array.from(d1Store.values()) as unknown as T[],
                    } as unknown as D1Result<T>;
                },
                async raw<T = unknown[]>(): Promise<T[]> {
                    return [] as T[];
                },
            };

            return statement as unknown as D1PreparedStatement;
        },
        async batch<T = unknown>(_statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
            return [];
        },
        async exec(_query: string): Promise<D1ExecResult> {
            return { count: 0, duration: 0 };
        },
        async dump(): Promise<ArrayBuffer> {
            return new ArrayBuffer(0);
        },
    } as unknown as D1Database;

    const mockR2: R2Bucket = {
        async put(
            key: string,
            value: unknown,
            options?: { httpMetadata?: { contentType?: string } }
        ): Promise<R2Object> {
            let buffer: ArrayBuffer;
            if (value instanceof ArrayBuffer) {
                buffer = value;
            } else if (typeof value === "string") {
                buffer = new TextEncoder().encode(value).buffer;
            } else {
                buffer = new ArrayBuffer(0);
            }

            r2Store.set(key, {
                content: buffer,
                contentType: options?.httpMetadata?.contentType,
            });

            return {
                key,
                version: "1",
                size: buffer.byteLength,
                etag: "mock-etag",
                uploaded: new Date(),
                httpMetadata: options?.httpMetadata,
            } as unknown as R2Object;
        },
        async get(key: string): Promise<R2Object | null> {
            const item = r2Store.get(key);
            if (!item) {
                return null;
            }
            return {
                key,
                size: item.content.byteLength,
                httpMetadata: { contentType: item.contentType },
                async arrayBuffer() {
                    return item.content;
                },
            } as unknown as R2Object;
        },
        async delete(keys: string | string[]): Promise<void> {
            const keyList = Array.isArray(keys) ? keys : [keys];
            for (const k of keyList) {
                r2Store.delete(k);
            }
        },
    } as unknown as R2Bucket;

    const mockQueue = {
        async send(message: ProcessingQueueMessage): Promise<QueueSendResponse> {
            queueMessages.push(message);
            return {} as QueueSendResponse;
        },
        async sendBatch(messages: Iterable<{ body: ProcessingQueueMessage }>): Promise<QueueSendBatchResponse> {
            for (const m of messages) {
                queueMessages.push(m.body);
            }
            return {} as QueueSendBatchResponse;
        },
    } as unknown as Queue<ProcessingQueueMessage>;

    return {
        DB: mockDb,
        FILE_STORAGE: mockR2,
        PROCESSING_QUEUE: mockQueue,
        d1Store,
        r2Store,
        queueMessages,
    };
}

