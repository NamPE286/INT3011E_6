import { describe, expect, it } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { app } from "../src/app";
import { getJobById } from "../src/modules/processing/job.repository";
import { createMockEnv, withEnv, type MockEnvironment } from "./mocks";

async function upload(env: MockEnvironment, file?: File): Promise<Response> {
    const formData = new FormData();

    if (file) {
        formData.append("file", file);
    }

    const request = new Request("http://localhost/api/uploads", { method: "POST", body: formData });

    return app.fetch(withEnv(request, env));
}

describe("POST /api/uploads", () => {
    it("rejects a request without a file", async () => {
        const response = await upload(createMockEnv());

        expect(response.status).toBe(400);
    });

    it("rejects an empty file", async () => {
        const response = await upload(createMockEnv(), new File([], "empty.pdf", { type: "application/pdf" }));
        const body = (await response.json()) as { message: string };

        expect(response.status).toBe(400);
        expect(body.message).toContain("empty");
    });

    it("rejects a file that only pretends to be a PDF", async () => {
        const env = createMockEnv();
        const response = await upload(env, new File(["hello"], "fake.pdf", { type: "application/pdf" }));
        const body = (await response.json()) as { message: string };

        expect(response.status).toBe(400);
        expect(body.message).toContain("PDF header");
        expect(env.r2Store.size).toBe(0);
    });

    it("rejects a malformed PDF body behind a valid header", async () => {
        const env = createMockEnv();
        const response = await upload(env, new File(["%PDF-1.7 broken"], "broken.pdf", { type: "application/pdf" }));
        const body = (await response.json()) as { message: string };

        expect(response.status).toBe(400);
        expect(body.message).toContain("cannot be parsed");
        expect(env.queueMessages).toHaveLength(0);
    });

    it("stores the snapshot in R2, records the job in D1 and enqueues it", async () => {
        const env = createMockEnv();
        const pdfBytes = await Bun.file(new URL("./fixtures/sample.pdf", import.meta.url)).arrayBuffer();
        const response = await upload(env, new File([pdfBytes], "test contract.pdf", { type: "" }));
        const body = (await response.json()) as { jobId: string; status: string };

        expect(response.status).toBe(200);
        expect(body.status).toBe("queued");

        const [r2Key, r2Item] = Array.from(env.r2Store.entries())[0];
        expect(r2Key).toBe(`uploads/${body.jobId}/test_contract.pdf`);
        expect(r2Item.contentType).toBe("application/pdf");

        const job = await getJobById(env.DB, body.jobId);
        expect(job?.status).toBe("queued");
        expect(job?.file_key).toBe(r2Key);
        expect(env.queueMessages).toEqual([{ jobId: body.jobId }]);
    });

    it("accepts a generated multi-page PDF", async () => {
        const pdf = await PDFDocument.create();
        pdf.addPage();
        pdf.addPage();
        const response = await upload(createMockEnv(), new File([(await pdf.save()).slice()], "two-pages.pdf"));

        expect(response.status).toBe(200);
    });
});
