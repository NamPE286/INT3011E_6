import { describe, expect, it } from "bun:test";
import { app } from "../src/app";
import { createMockEnv } from "./mocks";

describe("POST /api/uploads", () => {
    it("rejects request when no file is provided", async () => {
        const mockEnv = createMockEnv();
        const formData = new FormData();

        const request = new Request("http://localhost/api/uploads", {
            method: "POST",
            body: formData,
        });
        (request as unknown as { env: unknown }).env = mockEnv;

        const response = await app.fetch(request);
        expect(response.status).toBe(400);

        const body = (await response.json()) as { message?: string };
        expect(body.message).toBeDefined();
    });

    it("rejects request when uploaded file is empty (0 bytes)", async () => {
        const mockEnv = createMockEnv();
        const formData = new FormData();
        const emptyFile = new File([], "empty.pdf", { type: "application/pdf" });
        formData.append("file", emptyFile);

        const request = new Request("http://localhost/api/uploads", {
            method: "POST",
            body: formData,
        });
        (request as unknown as { env: unknown }).env = mockEnv;

        const response = await app.fetch(request);
        expect(response.status).toBe(400);

        const body = (await response.json()) as { message?: string };
        expect(body.message).toContain("empty");
    });

    it("successfully uploads file, saves to R2, writes to D1, and enqueues to Queue", async () => {
        const mockEnv = createMockEnv();
        const formData = new FormData();
        const fileContent = "Sample document contents for testing";
        const testFile = new File([fileContent], "test_contract.pdf", {
            type: "application/pdf",
        });
        formData.append("file", testFile);

        const request = new Request("http://localhost/api/uploads", {
            method: "POST",
            body: formData,
        });
        (request as unknown as { env: unknown }).env = mockEnv;

        const response = await app.fetch(request);
        expect(response.status).toBe(200);

        const body = (await response.json()) as { jobId: string; status: string };
        expect(body.jobId).toBeDefined();
        expect(typeof body.jobId).toBe("string");
        expect(body.status).toBe("queued");

        // 1. Verify R2 storage
        expect(mockEnv.r2Store.size).toBe(1);
        const [r2Key, r2Item] = Array.from(mockEnv.r2Store.entries())[0];
        expect(r2Key).toContain(body.jobId);
        expect(r2Key).toContain("test_contract.pdf");
        expect(r2Item.contentType).toBe("application/pdf");

        // 2. Verify D1 database
        const d1Job = mockEnv.d1Store.get(body.jobId);
        expect(d1Job).toBeDefined();
        expect(d1Job?.id).toBe(body.jobId);
        expect(d1Job?.original_filename).toBe("test_contract.pdf");
        expect(d1Job?.status).toBe("queued");
        expect(d1Job?.step).toBe("queued");
        expect(d1Job?.progress).toBe(0);
        expect(d1Job?.file_key).toBe(r2Key);

        // 3. Verify Cloudflare Queue message
        expect(mockEnv.queueMessages.length).toBe(1);
        expect(mockEnv.queueMessages[0].jobId).toBe(body.jobId);
    });
});

