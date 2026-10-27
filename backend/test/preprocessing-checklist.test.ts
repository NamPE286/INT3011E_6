import { describe, expect, it } from "bun:test";
import type { Message, MessageBatch } from "@cloudflare/workers-types";
import { app } from "../src/app";
import { handleProcessingBatch } from "../src/modules/processing/processing.consumer";
import { listPreprocessingStages, runPreprocessing } from "../src/modules/processing/preprocessing";
import type { ProcessingQueueMessage } from "../src/types/env";
import { createTestD1Database } from "./d1-test-db";
import { createMockEnv, withEnv, type MockEnvironment } from "./mocks";

const SEED_JOB_ID = "job-seed-nd100";
const SEED_DOCUMENT_ID = "doc-seed-nd100";

function seededEnv(): MockEnvironment {
    return createMockEnv({ DB: createTestD1Database() });
}

function request(env: MockEnvironment, path: string, init?: RequestInit): Promise<Response> {
    return Promise.resolve(app.fetch(withEnv(new Request(`http://localhost${path}`, init), env)));
}

/** Delivers queued messages to the consumer until the queue is empty, like the Workers runtime would. */
async function drainQueue(env: MockEnvironment): Promise<void> {
    while (env.queueMessages.length > 0) {
        const body = env.queueMessages.shift()!;
        const message = { body, ack() {}, retry() {} } as unknown as Message<ProcessingQueueMessage>;

        await handleProcessingBatch({ messages: [message] } as unknown as MessageBatch<ProcessingQueueMessage>, env);
    }
}

describe("preprocessing checklist", () => {
    it("lists every stage as pending for a document that was never preprocessed", async () => {
        const env = seededEnv();

        const stages = await listPreprocessingStages(env.DB, SEED_JOB_ID);

        expect(stages.map((stage) => stage.stage)).toEqual([
            "PROVISIONS",
            "DOCUMENT_GRAPH",
            "CHANGE_GRAPH",
            "VIOLATION_RULES",
            "IDENTITY",
            "HISTORY",
        ]);
        expect(stages.every((stage) => stage.status === "PENDING")).toBe(true);
    });

    it("marks each stage done when preprocessing runs", async () => {
        const env = seededEnv();

        await runPreprocessing(env.DB, SEED_JOB_ID, { model: "test-model" });

        const stages = await listPreprocessingStages(env.DB, SEED_JOB_ID);

        expect(stages.every((stage) => stage.status === "DONE")).toBe(true);
    });

    it("reruns the missing stages through the queue when an accepted document is published again", async () => {
        const env = seededEnv();

        const response = await request(env, `/api/jobs/${SEED_JOB_ID}/preprocessing`, { method: "POST" });
        const body = (await response.json()) as { startStage: string | null };

        expect(response.status).toBe(202);
        expect(body.startStage).toBe("PROVISIONS");

        await drainQueue(env);

        const rules = await env.DB.prepare("SELECT COUNT(*) AS count FROM violation_rules WHERE source_document_id = ?")
            .bind(SEED_DOCUMENT_ID)
            .first<{ count: number }>();
        const checklist = await request(env, `/api/jobs/${SEED_JOB_ID}/preprocessing`);
        const checklistBody = (await checklist.json()) as { stages: { stage: string; status: string }[] };

        expect(rules?.count).toBeGreaterThan(0);
        expect(checklistBody.stages.every((stage) => stage.status === "DONE")).toBe(true);
    });

    it("starts from the first stage that is not done", async () => {
        const env = seededEnv();

        await runPreprocessing(env.DB, SEED_JOB_ID, { model: "test-model" });
        await env.DB.prepare("UPDATE preprocessing_stages SET status = 'FAILED' WHERE stage = 'VIOLATION_RULES'").run();

        const response = await request(env, `/api/jobs/${SEED_JOB_ID}/preprocessing`, { method: "POST" });
        const body = (await response.json()) as { startStage: string | null };

        expect(body.startStage).toBe("VIOLATION_RULES");
    });

    it("has nothing to rerun when every stage is done", async () => {
        const env = seededEnv();

        await runPreprocessing(env.DB, SEED_JOB_ID, { model: "test-model" });

        const response = await request(env, `/api/jobs/${SEED_JOB_ID}/preprocessing`, { method: "POST" });
        const body = (await response.json()) as { startStage: string | null };

        expect(response.status).toBe(200);
        expect(body.startStage).toBeNull();
        expect(env.queueMessages).toHaveLength(0);
    });

    it("refuses to preprocess a document that still needs review", async () => {
        const env = seededEnv();
        await env.DB.prepare("UPDATE legal_documents SET review_status = 'REVIEW_REQUIRED'").run();

        const response = await request(env, `/api/jobs/${SEED_JOB_ID}/preprocessing`, { method: "POST" });

        expect(response.status).toBe(409);
    });
});
