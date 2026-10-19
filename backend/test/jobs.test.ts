import { describe, expect, it } from "bun:test";
import { app } from "../src/app";
import { insertJob, updateJobStage } from "../src/modules/processing/job.repository";
import { saveLegalDocument } from "../src/modules/processing/legal-persistence";
import type { LegalDocument } from "../src/modules/processing/legal-types";
import { createMockEnv, withEnv } from "./mocks";

async function createJob(env: ReturnType<typeof createMockEnv>, id: string, filename = "contract.pdf"): Promise<void> {
    await insertJob(env.DB, {
        id,
        fileKey: `uploads/${id}/${filename}`,
        originalFilename: filename,
        mimeType: "application/pdf",
        fileSize: 1024,
    });
}

const SAMPLE_DOCUMENT: LegalDocument = {
    document_title: "NGHỊ ĐỊNH Ví dụ",
    content: null,
    source: { snapshot_id: "job-with-document", pdf_sha256: "a".repeat(64), part_index: 1 },
    parts: [],
    chapters: [],
    sections: [],
    articles: [],
};

describe("GET /api/jobs/:jobId", () => {
    it("returns 404 for a nonexistent job", async () => {
        const env = createMockEnv();
        const response = await app.fetch(withEnv(new Request("http://localhost/api/jobs/nonexistent-id"), env));

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ message: "Job not found" });
    });

    it("returns job status without leaking storage keys", async () => {
        const env = createMockEnv();
        await createJob(env, "test-job-123");
        await updateJobStage(env.DB, "test-job-123", { status: "processing", step: "extracting", progress: 30 });

        const response = await app.fetch(withEnv(new Request("http://localhost/api/jobs/test-job-123"), env));
        const body = (await response.json()) as Record<string, unknown>;

        expect(response.status).toBe(200);
        expect(body.id).toBe("test-job-123");
        expect(body.filename).toBe("contract.pdf");
        expect(body.fileSize).toBe(1024);
        expect(body.status).toBe("processing");
        expect(body.step).toBe("extracting");
        expect(body.progress).toBe(30);
        expect(body.error).toBeNull();
        expect(body.completedAt).toBeNull();
        expect(body.file_key).toBeUndefined();
    });
});

describe("GET /api/jobs", () => {
    it("lists recent jobs newest first, including jobs that need review", async () => {
        const env = createMockEnv();
        await createJob(env, "older", "older.pdf");
        await new Promise((resolve) => setTimeout(resolve, 5));
        await createJob(env, "newer", "newer.pdf");
        await updateJobStage(env.DB, "newer", { status: "needs_review", step: "needs_review" });

        const response = await app.fetch(withEnv(new Request("http://localhost/api/jobs"), env));
        const body = (await response.json()) as { jobs: { id: string; status: string }[] };

        expect(response.status).toBe(200);
        expect(body.jobs.map((job) => job.id)).toEqual(["newer", "older"]);
        expect(body.jobs[0].status).toBe("needs_review");
    });
});

describe("GET /api/jobs/:jobId/document", () => {
    it("returns 404 until the job has a stored document", async () => {
        const env = createMockEnv();
        await createJob(env, "job-without-document");

        const response = await app.fetch(withEnv(new Request("http://localhost/api/jobs/job-without-document/document"), env));

        expect(response.status).toBe(404);
    });

    it("returns the legal JSON with review status, issues and run provenance", async () => {
        const env = createMockEnv();
        await createJob(env, "job-with-document");
        await saveLegalDocument(env.DB, {
            jobId: "job-with-document",
            snapshotKey: "uploads/job-with-document/contract.pdf",
            artifactKey: "runs/job-with-document/validated.json",
            document: SAMPLE_DOCUMENT,
            issues: [{ severity: "ERROR", code: "PAGE_PARTIAL", message: "Page 2 is marked PARTIAL", page: 2 }],
            pageCount: 2,
            model: "test-model",
            promptVersion: "test-prompt",
        });

        const response = await app.fetch(withEnv(new Request("http://localhost/api/jobs/job-with-document/document"), env));
        const body = (await response.json()) as {
            reviewStatus: string;
            issues: unknown[];
            extraction: { model: string; pageCount: number; schemaVersion: string };
            document: LegalDocument;
        };

        expect(response.status).toBe(200);
        expect(body.reviewStatus).toBe("REVIEW_REQUIRED");
        expect(body.issues).toHaveLength(1);
        expect(body.extraction.model).toBe("test-model");
        expect(body.extraction.pageCount).toBe(2);
        expect(body.extraction.schemaVersion).toBe("legal-json-v1");
        expect(body.document.document_title).toBe("NGHỊ ĐỊNH Ví dụ");
    });
});
