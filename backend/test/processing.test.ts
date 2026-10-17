/**
 * Pipeline PDF -> Legal JSON: unit tests without real Cloudflare or OpenAI calls.
 * Copy this file to backend/test/processing.test.ts.
 * Run: bun test test/processing.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { MessageBatch } from "@cloudflare/workers-types";
import type { Env, ProcessingQueueMessage } from "../src/types/env";
import type {
  ProcessingJobRecord,
  JobStatus,
} from "../src/modules/processing/processing.types";
import type {
  LegalDocument,
  PdfPage,
  Segmentation,
} from "../src/modules/processing/legal-types";
import { NeedsReviewError } from "../src/modules/processing/legal-types";

// 1) Simulate text extraction only. The real processing.service and validator
// remain unmocked, so their business logic is exercised by these tests.
const PAGES: PdfPage[] = [{
  page_number: 1,
  method: "TEXT_LAYER",
  quality: "GOOD",
  text: [
    "LUẬT VÍ DỤ",
    "Căn cứ Hiến pháp nước Cộng hòa xã hội chủ nghĩa Việt Nam;",
    "Điều 1. Phạm vi điều chỉnh",
    "Nội dung nguyên văn của Điều 1.",
  ].join("\n"),
}];

const VALID_SEGMENTATION: Segmentation = {
  document_title: "LUẬT VÍ DỤ",
  parts: [],
  chapters: [],
  sections: [],
  articles: [{
    number: "1",
    title: "Phạm vi điều chỉnh",
    start_line: 3,
    heading_end_line: 3,
    end_line: 4,
    clauses: [],
  }],
};

let extractionCalls = 0;
let extractionError: Error | null = null;

mock.module("../src/modules/processing/pdf-extractor", () => ({
  extractPdfText: async (_input: ArrayBuffer): Promise<PdfPage[]> => {
    extractionCalls++;
    if (extractionError) throw extractionError;
    return structuredClone(PAGES);
  },
}));

// Must import AFTER mock.module so processing.service uses the mocked extractor.
const { executeProcessingPipeline } = await import(
  "../src/modules/processing/processing.service"
);
const { handleProcessingBatch } = await import(
  "../src/modules/processing/processing.consumer"
);

// 2) In-memory D1 and R2 test doubles. Unexpected SQL fails loudly,
// so tests don't accidentally pass without persisting anything.
type SavedDocument = {
  job_id: string;
  document_title: string;
  document: LegalDocument;
  snapshot_r2_key: string;
  extracted_text_r2_key: string;
};

type Statement = {
  run: () => Promise<unknown>;
};

function makeJob(id: string, status: JobStatus = "queued"): ProcessingJobRecord {
  const createdAt = "2026-10-13T00:00:00.000Z";
  return {
    id,
    file_key: `uploads/${id}/test.pdf`,
    original_filename: "test.pdf",
    mime_type: "application/pdf",
    file_size: 64,
    status,
    step: status === "completed" ? "completed" : "queued",
    progress: status === "completed" ? 100 : 0,
    error_message: null,
    created_at: createdAt,
    updated_at: createdAt,
    completed_at: status === "completed" ? createdAt : null,
  };
}

function createTestEnv() {
  const jobs = new Map<string, ProcessingJobRecord>();
  const documents = new Map<string, SavedDocument>();
  const files = new Map<string, Uint8Array>();

  function bindStatement(sql: string, values: unknown[]) {
    const normalized = sql.replace(/\s+/g, " ").trim().toUpperCase();
    return {
      async first<T>(): Promise<T | null> {
        if (normalized.startsWith("SELECT * FROM PROCESSING_JOBS")) {
          return (jobs.get(String(values[0])) ?? null) as T | null;
        }
        throw new Error(`Unexpected D1 FIRST query: ${sql}`);
      },
      async run(): Promise<unknown> {
        if (normalized.startsWith("UPDATE PROCESSING_JOBS") &&
            normalized.includes("SET STATUS = 'COMPLETED'")) {
          const id = String(values[2]);
          const current = jobs.get(id);
          if (!current) throw new Error(`Missing job in fake D1: ${id}`);
          jobs.set(id, {
            ...current,
            status: "completed",
            step: "completed",
            progress: 100,
            error_message: null,
            updated_at: String(values[0]),
            completed_at: String(values[1]),
          });
          return { success: true };
        }
        if (normalized.startsWith("UPDATE PROCESSING_JOBS")) {
          const id = String(values[6]);
          const current = jobs.get(id);
          if (!current) throw new Error(`Missing job in fake D1: ${id}`);
          jobs.set(id, {
            ...current,
            status: values[0] as JobStatus,
            step: values[1] as ProcessingJobRecord["step"],
            progress: Number(values[2]),
            error_message: values[3] as string | null,
            updated_at: String(values[4]),
            completed_at: values[5] as string | null,
          });
          return { success: true };
        }
        if (normalized.startsWith("INSERT INTO LEGAL_DOCUMENTS")) {
          const jobId = String(values[1]);
          documents.set(jobId, {
            job_id: jobId,
            document_title: String(values[2]),
            document: JSON.parse(String(values[3])) as LegalDocument,
            snapshot_r2_key: String(values[4]),
            extracted_text_r2_key: String(values[5]),
          });
          return { success: true };
        }
        throw new Error(`Unexpected D1 RUN query: ${sql}`);
      },
    };
  }

  const fakeDb = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return bindStatement(sql, values);
        },
      };
    },
    async batch(statements: Statement[]) {
      for (const statement of statements) await statement.run();
      return [];
    },
  };

  const fakeR2 = {
    async get(key: string) {
      const bytes = files.get(key);
      if (!bytes) return null;
      return {
        size: bytes.byteLength,
        async arrayBuffer(): Promise<ArrayBuffer> {
          return Uint8Array.from(bytes).buffer as ArrayBuffer;
        },
      };
    },
    async put(key: string, value: ArrayBuffer | string) {
      files.set(key, typeof value === "string"
        ? new TextEncoder().encode(value)
        : new Uint8Array(value));
      return {};
    },
    async delete(key: string) {
      files.delete(key);
    },
  };

  const env = {
    DB: fakeDb,
    FILE_STORAGE: fakeR2,
    PROCESSING_QUEUE: { send: async () => {} },
    OPENAI_API_KEY: "fake-key-for-unit-test-only",
    OPENAI_MODEL: "test-model",
  } as unknown as Env;

  function addJob(id: string, status: JobStatus = "queued", withPdf = true) {
    const job = makeJob(id, status);
    jobs.set(id, job);
    if (withPdf) files.set(job.file_key, new TextEncoder().encode("%PDF-1.4\nFAKE TEST INPUT"));
    return job;
  }

  return { env, jobs, documents, files, addJob };
}

// 3) Fake OpenAI fetch. No internet and no API billing occurs during tests.
let llmStatus = 200;
let llmOutput: Segmentation = structuredClone(VALID_SEGMENTATION);
let llmRequests = 0;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  extractionCalls = 0;
  extractionError = null;
  llmStatus = 200;
  llmOutput = structuredClone(VALID_SEGMENTATION);
  llmRequests = 0;

  const fakeFetch = async () => {
    llmRequests++;
    if (llmStatus !== 200) {
      return new Response("Simulated LLM outage", { status: llmStatus });
    }
    return new Response(JSON.stringify({
      choices: [{
        finish_reason: "stop",
        message: { content: JSON.stringify(llmOutput) },
      }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  globalThis.fetch = fakeFetch as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeBatch(jobId: string) {
  let acks = 0;
  let retries = 0;
  const batch = {
    queue: "int3011e-processing",
    metadata: {},
    messages: [{
      id: "message-1",
      timestamp: new Date(),
      body: { jobId },
      attempts: 1,
      ack() { acks++; },
      retry() { retries++; },
    }],
    ackAll() {},
    retryAll() {},
  } as unknown as MessageBatch<ProcessingQueueMessage>;
  return { batch, counts: () => ({ acks, retries }) };
}

describe("PDF -> Legal JSON processing pipeline", () => {
  it("extracts, validates, persists, and completes a valid job", async () => {
    const state = createTestEnv();
    const job = state.addJob("job-success");

    await executeProcessingPipeline(state.env, job.id);

    expect(state.jobs.get(job.id)?.status).toBe("completed");
    expect(state.jobs.get(job.id)?.progress).toBe(100);
    expect(state.jobs.get(job.id)?.completed_at).not.toBeNull();
    expect(extractionCalls).toBe(1);
    expect(llmRequests).toBe(1);

    const saved = state.documents.get(job.id);
    expect(saved).toBeDefined();
    expect(saved?.document_title).toBe("LUẬT VÍ DỤ");
    expect(saved?.document.content).toContain("Căn cứ Hiến pháp");
    expect(saved?.document.articles[0].number).toBe("1");
    expect(saved?.document.articles[0].content).toBe("Nội dung nguyên văn của Điều 1.");
    expect(saved?.document.articles[0].source_locator.page_start).toBe(1);
    expect(saved?.document.source.pdf_sha256).toMatch(/^[0-9a-f]{64}$/);

    // Keep evidence snapshot and source text, delete ONLY the temporary upload.
    expect(state.files.has(`snapshots/${job.id}.pdf`)).toBe(true);
    expect(state.files.has(`snapshots/${job.id}.extracted.json`)).toBe(true);
    expect(state.files.has(job.file_key)).toBe(false);
  });

  it("skips an already completed job without calling extraction or LLM again", async () => {
    const state = createTestEnv();
    const original = state.addJob("job-completed", "completed");

    await executeProcessingPipeline(state.env, original.id);

    expect(state.jobs.get(original.id)).toEqual(original);
    expect(extractionCalls).toBe(0);
    expect(llmRequests).toBe(0);
  });

  it("rejects a nonexistent job explicitly", async () => {
    const state = createTestEnv();
    await expect(executeProcessingPipeline(state.env, "not-found"))
      .rejects.toBeInstanceOf(NeedsReviewError);
    expect(state.documents.size).toBe(0);
  });

  it("marks a missing source PDF needs_review, without persisting fake JSON", async () => {
    const state = createTestEnv();
    const job = state.addJob("missing-pdf", "queued", false);

    await executeProcessingPipeline(state.env, job.id);

    expect(state.jobs.get(job.id)?.status).toBe("needs_review");
    expect(state.jobs.get(job.id)?.error_message).toContain("PDF missing");
    expect(state.documents.size).toBe(0);
    expect(llmRequests).toBe(0);
  });

  it("rejects invented article numbers from the LLM", async () => {
    const state = createTestEnv();
    const job = state.addJob("invalid-segmentation");
    llmOutput.articles[0].number = "99";

    await executeProcessingPipeline(state.env, job.id);

    expect(state.jobs.get(job.id)?.status).toBe("needs_review");
    expect(state.jobs.get(job.id)?.error_message).toContain("heading does not match");
    expect(state.documents.size).toBe(0);
    expect(state.files.has(job.file_key)).toBe(true);
  });

  it("propagates temporary LLM errors so Queue can retry", async () => {
    const state = createTestEnv();
    const job = state.addJob("temporary-error");
    llmStatus = 503;

    await expect(executeProcessingPipeline(state.env, job.id))
      .rejects.toThrow("LLM HTTP 503");
    expect(state.jobs.get(job.id)?.status).toBe("failed");
    expect(state.documents.size).toBe(0);
    expect(state.files.has(job.file_key)).toBe(true);
  });

  it("marks an unreadable PDF needs_review and does not call the LLM", async () => {
    const state = createTestEnv();
    const job = state.addJob("needs-ocr");
    extractionError = new NeedsReviewError("OCR is required");

    await executeProcessingPipeline(state.env, job.id);

    expect(state.jobs.get(job.id)?.status).toBe("needs_review");
    expect(state.jobs.get(job.id)?.error_message).toContain("OCR is required");
    expect(llmRequests).toBe(0);
    expect(state.documents.size).toBe(0);
  });
});

describe("Queue consumer acknowledgment / retry", () => {
  it("ACKs a successful message", async () => {
    const state = createTestEnv();
    const job = state.addJob("queue-success");
    const message = makeBatch(job.id);

    await handleProcessingBatch(message.batch, state.env);

    expect(message.counts()).toEqual({ acks: 1, retries: 0 });
    expect(state.jobs.get(job.id)?.status).toBe("completed");
  });

  it("retries a message when LLM has a temporary server error", async () => {
    const state = createTestEnv();
    const job = state.addJob("queue-temporary-error");
    const message = makeBatch(job.id);
    llmStatus = 503;

    await handleProcessingBatch(message.batch, state.env);

    expect(message.counts()).toEqual({ acks: 0, retries: 1 });
    expect(state.jobs.get(job.id)?.status).toBe("failed");
  });

  it("ACKs a permanent needs_review condition (no infinite retry)", async () => {
    const state = createTestEnv();
    const job = state.addJob("queue-missing-pdf", "queued", false);
    const message = makeBatch(job.id);

    await handleProcessingBatch(message.batch, state.env);

    expect(message.counts()).toEqual({ acks: 1, retries: 0 });
    expect(state.jobs.get(job.id)?.status).toBe("needs_review");
  });

  it("ACKs an unknown job rather than retrying forever", async () => {
    const state = createTestEnv();
    const message = makeBatch("unknown-job");

    await handleProcessingBatch(message.batch, state.env);

    expect(message.counts()).toEqual({ acks: 1, retries: 0 });
    expect(state.documents.size).toBe(0);
  });
});
