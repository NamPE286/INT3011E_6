import type { Queue, R2Bucket, R2Object, R2ObjectBody } from "@cloudflare/workers-types";
import type { Env, ProcessingQueueMessage } from "../src/types/env";
import { createTestD1Database } from "./d1-test-db";

export type StoredObject = {
    content: ArrayBuffer;
    contentType?: string;
};

export type MockEnvironment = Env & {
    r2Store: Map<string, StoredObject>;
    queueMessages: ProcessingQueueMessage[];
};

/** Real SQLite-backed D1 with all migrations, plus in-memory R2 and Queue doubles. */
export function createMockEnv(overrides: Partial<Env> = {}): MockEnvironment {
    const r2Store = new Map<string, StoredObject>();
    const queueMessages: ProcessingQueueMessage[] = [];

    const mockR2 = {
        async put(key: string, value: unknown, options?: { httpMetadata?: { contentType?: string } }) {
            const content = toArrayBuffer(value);
            r2Store.set(key, { content, contentType: options?.httpMetadata?.contentType });

            return { key, size: content.byteLength } as unknown as R2Object;
        },
        async get(key: string) {
            const item = r2Store.get(key);

            if (!item) {
                return null;
            }

            return {
                key,
                size: item.content.byteLength,
                async arrayBuffer() {
                    return item.content.slice(0);
                },
                async text() {
                    return new TextDecoder().decode(item.content);
                },
            } as unknown as R2ObjectBody;
        },
        async delete(keys: string | string[]) {
            for (const key of Array.isArray(keys) ? keys : [keys]) {
                r2Store.delete(key);
            }
        },
    } as unknown as R2Bucket;

    const mockQueue = {
        async send(message: ProcessingQueueMessage) {
            queueMessages.push(message);
        },
    } as unknown as Queue<ProcessingQueueMessage>;

    return {
        DB: createTestD1Database({ seedSampleDocument: false }),
        FILE_STORAGE: mockR2,
        PROCESSING_QUEUE: mockQueue,
        r2Store,
        queueMessages,
        ...overrides,
    };
}

export function withEnv(request: Request, env: Env): Request {
    (request as unknown as { env: unknown }).env = env;

    return request;
}

function toArrayBuffer(value: unknown): ArrayBuffer {
    if (value instanceof ArrayBuffer) {
        return value.slice(0);
    }

    if (value instanceof Uint8Array) {
        return value.slice().buffer;
    }

    if (typeof value === "string") {
        return new TextEncoder().encode(value).buffer;
    }

    throw new Error("Unsupported R2 value in test double");
}
