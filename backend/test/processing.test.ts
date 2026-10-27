import { describe, expect, it } from "bun:test";
import type { Message, MessageBatch } from "@cloudflare/workers-types";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { ProcessingQueueMessage } from "../src/types/env";
import { getJobById, insertJob } from "../src/modules/processing/job.repository";
import { getLegalDocumentByJobId } from "../src/modules/processing/legal-persistence";
import { handleProcessingBatch } from "../src/modules/processing/processing.consumer";
import { executeProcessingPipeline } from "../src/modules/processing/processing.service";
import { listProvisions } from "../src/modules/provisions/provision.repository";
import { block, createFakeOpenAi, goodPages } from "./openai-fake";
import { createMockEnv, type MockEnvironment } from "./mocks";

const JOB_ID = "job-nd-sample";

/** Hands queued messages to the consumer one at a time until the queue is empty. */
async function deliverQueuedMessages(env: MockEnvironment): Promise<void> {
    while (env.queueMessages.length > 0) {
        const body = env.queueMessages.shift()!;
        const message = { body, ack() {}, retry() {} } as unknown as Message<ProcessingQueueMessage>;

        await handleProcessingBatch({ messages: [message] } as unknown as MessageBatch<ProcessingQueueMessage>, env);
    }
}

async function createEnvWithPdf(pageCount: number): Promise<MockEnvironment> {
    const env = createMockEnv({ OPENAI_API_KEY: "test-key", OPENAI_MODEL: "test-model", PDF_CHUNK_PAGES: "2" });
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);

    for (let page = 0; page < pageCount; page++) {
        pdf.addPage().drawText(`Page ${page + 1} of a decree`, { x: 50, y: 700, size: 12, font });
    }

    const fileKey = `uploads/${JOB_ID}/sample.pdf`;
    await env.FILE_STORAGE.put(fileKey, await pdf.save());
    await insertJob(env.DB, {
        id: JOB_ID,
        fileKey,
        originalFilename: "sample.pdf",
        mimeType: "application/pdf",
        fileSize: 100,
    });

    return env;
}

const FIRST_CHUNK = {
    pages: goodPages(2),
    blocks: [
        block("text", { text: "CHÍNH PHỦ" }),
        block("title", { text: "NGHỊ ĐỊNH" }),
        block("title", { text: "Quy định xử phạt vi phạm hành chính" }),
        block("text", { text: "Căn cứ Luật Tổ chức Chính phủ ngày 19 tháng 6 năm 2015;" }),
        block("chapter", { number: "I", title: "NHỮNG QUY ĐỊNH CHUNG" }),
        block("article", { number: "1", title: "Phạm vi điều chỉnh" }),
        block("clause", { number: "1", text: "Nghị định này quy định về hành vi vi phạm hành chính." }),
        block("clause", { number: "2", text: "Tổ chức quy định tại khoản 1", page: 2 }),
    ],
};

const SECOND_CHUNK = {
    pages: goodPages(2),
    blocks: [
        block("text", { text: "Điều này gồm:", continues_previous: true }),
        block("point", { number: "a", text: "Cơ quan nhà nước;" }),
        block("point", { number: "b", text: "Đơn vị sự nghiệp công lập." }),
        block("article", { number: "2", title: "Hiệu lực thi hành", page: 2 }),
        block("text", { text: "Nghị định này có hiệu lực từ ngày 01 tháng 01 năm 2020.", page: 2 }),
        block("closing", { text: "TM. CHÍNH PHỦ THỦ TƯỚNG", page: 2 }),
    ],
};

describe("PDF → legal JSON pipeline", () => {
    it("transcribes page ranges, merges them into the legal tree and completes the job", async () => {
        const env = await createEnvWithPdf(4);
        const openAi = createFakeOpenAi({ "1-2": FIRST_CHUNK, "3-4": SECOND_CHUNK });

        await executeProcessingPipeline(env, JOB_ID, { fetcher: openAi.fetcher });

        const job = await getJobById(env.DB, JOB_ID);
        const stored = await getLegalDocumentByJobId(env.DB, JOB_ID);

        expect(openAi.calls.sort()).toEqual(["1-2", "3-4"]);
        expect(job?.status).toBe("completed");
        expect(job?.progress).toBe(100);
        expect(stored?.reviewStatus).toBe("ACCEPTED");
        expect(stored?.issues).toEqual([]);
        expect(stored?.pageCount).toBe(4);
        expect(stored?.model).toBe("test-model");

        const document = stored!.document;
        expect(document.document_title).toBe("NGHỊ ĐỊNH Quy định xử phạt vi phạm hành chính");
        expect(document.content).toBe(
            "CHÍNH PHỦ\nCăn cứ Luật Tổ chức Chính phủ ngày 19 tháng 6 năm 2015;\nTM. CHÍNH PHỦ THỦ TƯỚNG",
        );
        expect(document.source.snapshot_id).toBe(JOB_ID);
        expect(document.source.pdf_sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(document.articles).toEqual([]);

        const chapter = document.chapters[0];
        expect(chapter.number).toBe("I");
        expect(chapter.source_locator.page_start).toBe(1);
        expect(chapter.source_locator.page_end).toBe(4);

        const [firstArticle, secondArticle] = chapter.articles;
        expect(firstArticle.title).toBe("Phạm vi điều chỉnh");
        expect(firstArticle.content).toBeNull();
        expect(firstArticle.source_locator.source_quote).toBe("Điều 1. Phạm vi điều chỉnh");

        const clauseTwo = firstArticle.clauses[1];
        expect(clauseTwo.content).toBe("Tổ chức quy định tại khoản 1 Điều này gồm:");
        expect(clauseTwo.source_locator.page_start).toBe(2);
        expect(clauseTwo.source_locator.page_end).toBe(3);
        expect(clauseTwo.points.map((point) => point.number)).toEqual(["a", "b"]);

        expect(secondArticle.content).toBe("Nghị định này có hiệu lực từ ngày 01 tháng 01 năm 2020.");
        expect(secondArticle.source_locator.page_start).toBe(4);

        const runKeys = Array.from(env.r2Store.keys()).filter((key) => key.startsWith(`runs/${JOB_ID}/`));
        expect(runKeys.some((key) => key.endsWith("/chunks/1-2.json"))).toBe(true);
        expect(runKeys.some((key) => key.endsWith("/validated.json"))).toBe(true);
        expect(env.r2Store.has(`uploads/${JOB_ID}/sample.pdf`)).toBe(true);
        expect(env.queueMessages).toEqual([{ jobId: JOB_ID, stage: "PROVISIONS" }]);

        await deliverQueuedMessages(env);

        const provisions = await listProvisions(env.DB, JOB_ID);
        const pointA = provisions.find((provision) => provision.id === `${JOB_ID}:dieu_1_khoan_2_diem_a`);

        expect(provisions[0]).toMatchObject({ level: "PREAMBLE", contentRole: "PREAMBLE_BASIS" });
        expect(pointA).toMatchObject({ sourceSnapshotId: JOB_ID, readMethod: expect.stringContaining("LLM:test-model") });
        expect(pointA?.pdfSha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it("resumes from checkpoints after a transient provider failure", async () => {
        const env = await createEnvWithPdf(4);
        const openAi = createFakeOpenAi({
            "1-2": FIRST_CHUNK,
            "3-4": [new Response("{}", { status: 503 }), SECOND_CHUNK],
        });

        await expect(executeProcessingPipeline(env, JOB_ID, { fetcher: openAi.fetcher })).rejects.toThrow("LLM HTTP 503");
        expect((await getJobById(env.DB, JOB_ID))?.status).toBe("failed");

        await executeProcessingPipeline(env, JOB_ID, { fetcher: openAi.fetcher });

        expect(openAi.calls.filter((range) => range === "1-2")).toHaveLength(1);
        expect((await getJobById(env.DB, JOB_ID))?.status).toBe("completed");
    });

    it("records a range as unreadable after repeated malformed output and requires review", async () => {
        const env = await createEnvWithPdf(4);
        const openAi = createFakeOpenAi({ "1-2": FIRST_CHUNK, "3-4": ["not json", "{\"pages\": 1}"] });

        await executeProcessingPipeline(env, JOB_ID, { fetcher: openAi.fetcher });

        const stored = await getLegalDocumentByJobId(env.DB, JOB_ID);
        const codes = stored?.issues.map((issue) => issue.code);

        expect((await getJobById(env.DB, JOB_ID))?.status).toBe("needs_review");
        expect(stored?.reviewStatus).toBe("REVIEW_REQUIRED");
        expect(codes).toContain("CHUNK_FAILED");
        expect(codes).toContain("PAGE_UNREADABLE");
    });

    it("flags a skipped article number instead of publishing silently", async () => {
        const env = await createEnvWithPdf(2);
        const openAi = createFakeOpenAi({
            "1-2": {
                pages: goodPages(2),
                blocks: [
                    block("title", { text: "LUẬT VÍ DỤ" }),
                    block("article", { number: "1", title: "Phạm vi" }),
                    block("article", { number: "3", title: "Hiệu lực", page: 2 }),
                    block("closing", { text: "CHỦ TỊCH QUỐC HỘI", page: 2 }),
                ],
            },
        });

        await executeProcessingPipeline(env, JOB_ID, { fetcher: openAi.fetcher });

        const stored = await getLegalDocumentByJobId(env.DB, JOB_ID);
        expect((await getJobById(env.DB, JOB_ID))?.status).toBe("needs_review");
        expect(stored?.issues.map((issue) => issue.code)).toEqual(["NUMBERING_GAP"]);
    });

    it("marks the job for review without calling the provider when no API key is configured", async () => {
        const env = await createEnvWithPdf(2);
        env.OPENAI_API_KEY = undefined;
        const openAi = createFakeOpenAi({});

        await expect(executeProcessingPipeline(env, JOB_ID, { fetcher: openAi.fetcher })).rejects.toThrow("OPENAI_API_KEY");

        const job = await getJobById(env.DB, JOB_ID);
        expect(job?.status).toBe("needs_review");
        expect(openAi.calls).toEqual([]);
    });

    it("does nothing when a duplicate message arrives for a finished job", async () => {
        const env = await createEnvWithPdf(4);
        const openAi = createFakeOpenAi({ "1-2": FIRST_CHUNK, "3-4": SECOND_CHUNK });

        await executeProcessingPipeline(env, JOB_ID, { fetcher: openAi.fetcher });
        await executeProcessingPipeline(env, JOB_ID, { fetcher: openAi.fetcher });

        expect(openAi.calls).toHaveLength(2);
    });
});

describe("Queue consumer acknowledgment / retry", () => {
    type TestMessage = Message<ProcessingQueueMessage> & { acked: boolean; retried: boolean };

    function createBatch(bodies: unknown[]): { batch: MessageBatch<ProcessingQueueMessage>; messages: TestMessage[] } {
        const messages = bodies.map((body) => {
            const message = {
                body,
                acked: false,
                retried: false,
                ack() {
                    message.acked = true;
                },
                retry() {
                    message.retried = true;
                },
            };

            return message as unknown as TestMessage;
        });

        return { batch: { messages } as unknown as MessageBatch<ProcessingQueueMessage>, messages };
    }

    it("acknowledges invalid messages and jobs that need review", async () => {
        const env = createMockEnv();
        const { batch, messages } = createBatch([{}, { jobId: "missing-job" }]);

        await handleProcessingBatch(batch, env);

        expect(messages.every((message) => message.acked && !message.retried)).toBe(true);
    });

    it("retries transient failures", async () => {
        const env = await createEnvWithPdf(2);
        const failingFetch = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
        const originalFetch = globalThis.fetch;
        globalThis.fetch = failingFetch;

        try {
            const { batch, messages } = createBatch([{ jobId: JOB_ID }]);
            await handleProcessingBatch(batch, env);

            expect(messages[0].retried).toBe(true);
            expect(messages[0].acked).toBe(false);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

