import { describe, expect, it } from "bun:test";
import { app } from "../src/app";
import { createTestD1Database } from "./d1-test-db";
import { createMockEnv, withEnv } from "./mocks";

const SEED_JOB_ID = "job-seed-nd100";

function postReview(jobId: string, body: unknown, env: ReturnType<typeof createMockEnv>): Promise<Response> {
    const request = new Request(`http://localhost/api/jobs/${jobId}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });

    return Promise.resolve(app.fetch(withEnv(request, env)));
}

async function markNeedsReview(env: ReturnType<typeof createMockEnv>): Promise<void> {
    await env.DB.batch([
        env.DB.prepare("UPDATE legal_documents SET review_status = 'REVIEW_REQUIRED'"),
        env.DB.prepare(
            `INSERT INTO processing_jobs (id, file_key, original_filename, file_size, status, step, progress, error_message, created_at, updated_at)
             VALUES (?, 'uploads/nd100.pdf', 'nd100.pdf', 1024, 'needs_review', 'needs_review', 100, '1 validation error(s)', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
        ).bind(SEED_JOB_ID),
    ]);
}

describe("document review", () => {
    it("accepts a document that needs review, completes its job and publishes it", async () => {
        const env = createMockEnv({ DB: createTestD1Database() });
        await markNeedsReview(env);

        const response = await postReview(SEED_JOB_ID, { decision: "accept" }, env);
        const body = (await response.json()) as { reviewStatus: string };

        expect(response.status).toBe(200);
        expect(body.reviewStatus).toBe("ACCEPTED");

        const job = await env.DB.prepare("SELECT status, error_message FROM processing_jobs WHERE id = ?").bind(SEED_JOB_ID).first<{ status: string; error_message: string | null }>();

        expect(job?.status).toBe("completed");
        expect(job?.error_message).toBeNull();
        expect(env.queueMessages).toEqual([{ jobId: SEED_JOB_ID, stage: "PROVISIONS" }]);

        const documentResponse = await app.fetch(withEnv(new Request(`http://localhost/api/jobs/${SEED_JOB_ID}/document`), env));
        const documentBody = (await documentResponse.json()) as { reviewStatus: string };

        expect(documentBody.reviewStatus).toBe("ACCEPTED");
    });

    it("returns 409 when the document does not need review", async () => {
        const env = createMockEnv({ DB: createTestD1Database() });

        const response = await postReview(SEED_JOB_ID, { decision: "accept" }, env);

        expect(response.status).toBe(409);
    });

    it("returns 404 when the job has no stored document", async () => {
        const env = createMockEnv({ DB: createTestD1Database() });

        const response = await postReview("missing", { decision: "accept" }, env);

        expect(response.status).toBe(404);
    });

    it("rejects an unknown decision", async () => {
        const env = createMockEnv({ DB: createTestD1Database() });
        await markNeedsReview(env);

        const response = await postReview(SEED_JOB_ID, { decision: "maybe" }, env);

        expect(response.status).toBe(400);
    });
});
