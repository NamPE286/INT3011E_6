import { describe, expect, it } from "bun:test";
import type { MessageBatch } from "@cloudflare/workers-types";
import type { ProcessingQueueMessage } from "../src/types/env";
import { executeProcessingPipeline } from "../src/modules/processing/processing.service";
import { handleProcessingBatch } from "../src/modules/processing/processing.consumer";
import { createMockEnv } from "./mocks";

describe("Processing Pipeline and Queue Consumer", () => {
    const immediateSleep = async (_ms: number): Promise<void> => {};

    it("transitions a queued job through all stages to completion", async () => {
        const mockEnv = createMockEnv();
        const jobId = "pipeline-job-1";
        const now = new Date().toISOString();

        mockEnv.d1Store.set(jobId, {
            id: jobId,
            file_key: `uploads/${jobId}/doc.pdf`,
            original_filename: "doc.pdf",
            mime_type: "application/pdf",
            file_size: 2048,
            status: "queued",
            step: "queued",
            progress: 0,
            error_message: null,
            created_at: now,
            updated_at: now,
            completed_at: null,
        });

        // Run with immediate sleep (0ms real delay)
        await executeProcessingPipeline(mockEnv.DB, jobId, immediateSleep);

        const updated = mockEnv.d1Store.get(jobId);
        expect(updated).toBeDefined();
        expect(updated?.status).toBe("completed");
        expect(updated?.step).toBe("completed");
        expect(updated?.progress).toBe(100);
        expect(updated?.completed_at).not.toBeNull();
        expect(updated?.error_message).toBeNull();
    });

    it("safely handles nonexistent job in processing pipeline", async () => {
        const mockEnv = createMockEnv();
        // Should not throw or crash
        await executeProcessingPipeline(
            mockEnv.DB,
            "nonexistent-id",
            immediateSleep
        );
        expect(mockEnv.d1Store.size).toBe(0);
    });

    it("does not reprocess already completed job (idempotent / deduplication)", async () => {
        const mockEnv = createMockEnv();
        const jobId = "already-completed-job";
        const completedTimestamp = "2026-09-23T12:00:00.000Z";

        mockEnv.d1Store.set(jobId, {
            id: jobId,
            file_key: `uploads/${jobId}/doc.pdf`,
            original_filename: "doc.pdf",
            mime_type: "application/pdf",
            file_size: 2048,
            status: "completed",
            step: "completed",
            progress: 100,
            error_message: null,
            created_at: completedTimestamp,
            updated_at: completedTimestamp,
            completed_at: completedTimestamp,
        });

        await executeProcessingPipeline(mockEnv.DB, jobId, immediateSleep);

        const job = mockEnv.d1Store.get(jobId);
        expect(job?.completed_at).toBe(completedTimestamp);
        expect(job?.updated_at).toBe(completedTimestamp);
    });

    it("marks job as failed if an error occurs during processing", async () => {
        const mockEnv = createMockEnv();
        const jobId = "failing-job";
        const now = new Date().toISOString();

        mockEnv.d1Store.set(jobId, {
            id: jobId,
            file_key: `uploads/${jobId}/doc.pdf`,
            original_filename: "doc.pdf",
            mime_type: "application/pdf",
            file_size: 2048,
            status: "queued",
            step: "queued",
            progress: 0,
            error_message: null,
            created_at: now,
            updated_at: now,
            completed_at: null,
        });

        const failingSleep = async (): Promise<void> => {
            throw new Error("Simulated storage failure during stage extraction");
        };

        await executeProcessingPipeline(mockEnv.DB, jobId, failingSleep);

        const job = mockEnv.d1Store.get(jobId);
        expect(job?.status).toBe("failed");
        expect(job?.error_message).toContain("Simulated storage failure");
    });

    it("processes queue message batch and acknowledges processed messages", async () => {
        const mockEnv = createMockEnv();
        const jobId = "queue-msg-job";
        const now = new Date().toISOString();

        mockEnv.d1Store.set(jobId, {
            id: jobId,
            file_key: `uploads/${jobId}/file.pdf`,
            original_filename: "file.pdf",
            mime_type: "application/pdf",
            file_size: 512,
            status: "queued",
            step: "queued",
            progress: 0,
            error_message: null,
            created_at: now,
            updated_at: now,
            completed_at: null,
        });

        let acknowledged = false;
        const fakeBatch: MessageBatch<ProcessingQueueMessage> = {
            queue: "int3011e-processing",
            metadata: {} as unknown as MessageBatch<ProcessingQueueMessage>["metadata"],
            messages: [
                {
                    id: "msg-1",
                    timestamp: new Date(),
                    body: { jobId },
                    attempts: 1,
                    ack: () => {
                        acknowledged = true;
                    },
                    retry: () => {},
                },
            ],
            ackAll: () => {},
            retryAll: () => {},
        };

        await handleProcessingBatch(fakeBatch, mockEnv, immediateSleep);

        expect(acknowledged).toBe(true);
        const job = mockEnv.d1Store.get(jobId);
        expect(job?.status).toBe("completed");
        expect(job?.progress).toBe(100);
    });
});
