import { describe, expect, it } from "bun:test";
import { app } from "../src/app";
import { createMockEnv } from "./mocks";

describe("GET /api/jobs/:jobId", () => {
    it("returns 404 for a nonexistent job", async () => {
        const mockEnv = createMockEnv();
        const request = new Request("http://localhost/api/jobs/nonexistent-id");
        (request as unknown as { env: unknown }).env = mockEnv;

        const response = await app.fetch(request);
        expect(response.status).toBe(404);

        const body = (await response.json()) as { message?: string };
        expect(body.message).toBe("Job not found");
    });

    it("returns job status and metadata for an existing job", async () => {
        const mockEnv = createMockEnv();
        const jobId = "test-job-123";
        const now = new Date().toISOString();

        mockEnv.d1Store.set(jobId, {
            id: jobId,
            file_key: `uploads/${jobId}/contract.pdf`,
            original_filename: "contract.pdf",
            mime_type: "application/pdf",
            file_size: 1024,
            status: "processing",
            step: "extracting",
            progress: 30,
            error_message: null,
            created_at: now,
            updated_at: now,
            completed_at: null,
        });

        const request = new Request(`http://localhost/api/jobs/${jobId}`);
        (request as unknown as { env: unknown }).env = mockEnv;

        const response = await app.fetch(request);
        expect(response.status).toBe(200);

        const body = (await response.json()) as {
            id: string;
            filename: string;
            status: string;
            step: string;
            progress: number;
            error: string | null;
            createdAt: string;
            updatedAt: string;
            completedAt: string | null;
            file_key?: string;
        };

        expect(body.id).toBe(jobId);
        expect(body.filename).toBe("contract.pdf");
        expect(body.status).toBe("processing");
        expect(body.step).toBe("extracting");
        expect(body.progress).toBe(30);
        expect(body.error).toBeNull();
        expect(body.createdAt).toBe(now);
        expect(body.updatedAt).toBe(now);
        expect(body.completedAt).toBeNull();

        // Verify internal storage details like file_key are NOT leaked to public API
        expect(body.file_key).toBeUndefined();
    });
});

