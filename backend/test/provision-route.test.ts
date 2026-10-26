import { describe, expect, it } from "bun:test";
import { app } from "../src/app";
import { createMockEnv, withEnv } from "./mocks";

const SEED_JOB_ID = "job-seed-nd100";

describe("provision endpoints", () => {
    it("analyzes a stored document and then lists its provisions", async () => {
        const env = createMockEnv();
        const analyzeRequest = new Request(`http://localhost/api/jobs/${SEED_JOB_ID}/provisions/analyze`, { method: "POST" });

        const analyzeResponse = await app.fetch(withEnv(analyzeRequest, env));
        const analyzeBody = (await analyzeResponse.json()) as { summary: { total: number } };

        expect(analyzeResponse.status).toBe(200);
        expect(analyzeBody.summary.total).toBeGreaterThan(0);

        const listResponse = await app.fetch(withEnv(new Request(`http://localhost/api/jobs/${SEED_JOB_ID}/provisions`), env));
        const listBody = (await listResponse.json()) as { documentId: string; provisions: { id: string }[] };

        expect(listResponse.status).toBe(200);
        expect(listBody.documentId).toBe("doc-seed-nd100");
        expect(listBody.provisions).toHaveLength(analyzeBody.summary.total);
    });

    it("returns 404 when the job has no stored document", async () => {
        const env = createMockEnv();

        const listResponse = await app.fetch(withEnv(new Request("http://localhost/api/jobs/missing/provisions"), env));
        const analyzeResponse = await app.fetch(withEnv(new Request("http://localhost/api/jobs/missing/provisions/analyze", { method: "POST" }), env));

        expect(listResponse.status).toBe(404);
        expect(analyzeResponse.status).toBe(404);
    });

    it("returns 409 instead of analyzing a document that still needs review", async () => {
        const env = createMockEnv();
        await env.DB.prepare("UPDATE legal_documents SET review_status = 'REVIEW_REQUIRED'").run();

        const response = await app.fetch(withEnv(new Request(`http://localhost/api/jobs/${SEED_JOB_ID}/provisions/analyze`, { method: "POST" }), env));

        expect(response.status).toBe(409);
    });
});
