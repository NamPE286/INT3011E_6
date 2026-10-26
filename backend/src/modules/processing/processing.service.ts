import type { PDFDocument } from "pdf-lib";
import type { Env } from "../../types/env";
import { getJobById, updateJobStage } from "./job.repository";
import { assembleLegalDocument } from "./legal-assembler";
import {
    DEFAULT_OPENAI_MODEL,
    InvalidTranscriptionError,
    PROMPT_VERSION,
    transcribeChunk,
} from "./legal-llm.service";
import { saveLegalDocument } from "./legal-persistence";
import { analyzeAfterExtraction } from "../provisions/provision.service";
import { buildGraphAfterExtraction } from "../documents/document-graph.service";
import { buildChangesAfterExtraction } from "../changes/change.service";
import { LEGAL_SCHEMA_VERSION, NeedsReviewError, type ChunkTranscription } from "./legal-types";
import {
    extractPageRange,
    InvalidPdfError,
    loadPdf,
    planPageRanges,
    sha256Hex,
    type PageRange,
} from "./pdf-document";

const DEFAULT_PAGES_PER_CHUNK = 3;
const CHUNK_CONCURRENCY = 4;
const TRANSCRIPTION_ATTEMPTS = 2;
const EXTRACTION_PROGRESS_START = 10;
const EXTRACTION_PROGRESS_END = 90;

export type PipelineOptions = {
    fetcher?: typeof fetch;
};

type RunContext = {
    env: Env;
    jobId: string;
    pdf: PDFDocument;
    model: string;
    runPrefix: string;
    fetcher?: typeof fetch;
};

/**
 * PDF snapshot → LLM page transcription (checkpointed per page range in R2) → deterministic
 * assembly/validation → D1. Transient failures are rethrown so the queue retries and resumes.
 */
export async function executeProcessingPipeline(env: Env, jobId: string, options: PipelineOptions = {}): Promise<void> {
    const job = await getJobById(env.DB, jobId);

    if (!job) {
        throw new NeedsReviewError(`Job ${jobId} does not exist in D1`);
    }

    if (job.status === "completed" || job.status === "needs_review") {
        return;
    }

    try {
        await updateJobStage(env.DB, jobId, {
            status: "processing",
            step: "preparing",
            progress: 5,
            errorMessage: null,
        });

        const snapshot = await env.FILE_STORAGE.get(job.file_key);

        if (!snapshot) {
            throw new NeedsReviewError(`PDF snapshot is missing in R2: ${job.file_key}`);
        }

        const pdfBytes = await snapshot.arrayBuffer();
        const pdfSha256 = await sha256Hex(pdfBytes);
        const pdf = await loadPdfForReview(pdfBytes);
        const pageCount = pdf.getPageCount();
        const model = env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
        const runPrefix = `runs/${jobId}/${pdfSha256.slice(0, 16)}-${model}-${PROMPT_VERSION}-${LEGAL_SCHEMA_VERSION}`;

        await updateJobStage(env.DB, jobId, { step: "extracting", progress: EXTRACTION_PROGRESS_START });

        const ranges = planPageRanges(pageCount, readPagesPerChunk(env));
        const chunks = await transcribeAllRanges({ env, jobId, pdf, model, runPrefix, fetcher: options.fetcher }, ranges);

        await updateJobStage(env.DB, jobId, { step: "analyzing", progress: EXTRACTION_PROGRESS_END });

        const { document, issues } = assembleLegalDocument(chunks, {
            snapshotId: jobId,
            pdfSha256,
            pageCount,
        });

        await updateJobStage(env.DB, jobId, { step: "finalizing", progress: 95 });

        const artifactKey = `${runPrefix}/validated.json`;
        await env.FILE_STORAGE.put(artifactKey, JSON.stringify({ document, issues }), {
            httpMetadata: { contentType: "application/json" },
        });

        const reviewStatus = await saveLegalDocument(env.DB, {
            jobId,
            snapshotKey: job.file_key,
            artifactKey,
            document,
            issues,
            pageCount,
            model,
            promptVersion: PROMPT_VERSION,
        });

        await analyzeAfterExtraction(env.DB, jobId);
        await buildGraphAfterExtraction(env.DB, jobId);
        await buildChangesAfterExtraction(env.DB, jobId);

        console.log(JSON.stringify({
            level: "info",
            module: "processing",
            jobId,
            pageCount,
            model,
            reviewStatus,
            issueCount: issues.length,
        }));
    } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : "Unknown PDF processing error";
        const needsReview = error instanceof NeedsReviewError;

        console.error(`[Processing] ${needsReview ? "Needs review" : "Will retry"}: ${jobId}`, detail);
        await updateJobStage(env.DB, jobId, {
            status: needsReview ? "needs_review" : "failed",
            step: needsReview ? "needs_review" : undefined,
            errorMessage: detail.slice(0, 1000),
        });

        throw error;
    }
}

async function loadPdfForReview(pdfBytes: ArrayBuffer): Promise<PDFDocument> {
    try {
        return await loadPdf(pdfBytes);
    } catch (error: unknown) {
        if (error instanceof InvalidPdfError) {
            throw new NeedsReviewError(error.message);
        }

        throw error;
    }
}

function readPagesPerChunk(env: Env): number {
    const configured = Number(env.PDF_CHUNK_PAGES);

    if (Number.isInteger(configured) && configured >= 1 && configured <= 20) {
        return configured;
    }

    return DEFAULT_PAGES_PER_CHUNK;
}

async function transcribeAllRanges(context: RunContext, ranges: PageRange[]): Promise<ChunkTranscription[]> {
    const results: ChunkTranscription[] = [];
    const failures: unknown[] = [];
    let nextIndex = 0;
    let finished = 0;

    async function worker(): Promise<void> {
        while (nextIndex < ranges.length && failures.length === 0) {
            const index = nextIndex;
            nextIndex++;

            try {
                results[index] = await loadOrTranscribeRange(context, ranges[index]);
            } catch (error: unknown) {
                failures.push(error);

                return;
            }

            finished++;
            const progress = EXTRACTION_PROGRESS_START
                + ((EXTRACTION_PROGRESS_END - EXTRACTION_PROGRESS_START) * finished) / ranges.length;
            await updateJobStage(context.env.DB, context.jobId, { progress });
        }
    }

    const workerCount = Math.min(CHUNK_CONCURRENCY, ranges.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    if (failures.length > 0) {
        throw failures[0];
    }

    return results;
}

async function loadOrTranscribeRange(context: RunContext, range: PageRange): Promise<ChunkTranscription> {
    const checkpointKey = `${context.runPrefix}/chunks/${range.pageStart}-${range.pageEnd}.json`;
    const checkpoint = await context.env.FILE_STORAGE.get(checkpointKey);

    if (checkpoint) {
        const stored: unknown = JSON.parse(await checkpoint.text());

        if (isChunkTranscription(stored)) {
            return stored;
        }
    }

    const transcription = await transcribeWithRetry(context, range);
    await context.env.FILE_STORAGE.put(checkpointKey, JSON.stringify(transcription), {
        httpMetadata: { contentType: "application/json" },
    });

    return transcription;
}

/** Malformed model output is retried once; if it persists, the range is recorded as unreadable instead of looping forever. */
async function transcribeWithRetry(context: RunContext, range: PageRange): Promise<ChunkTranscription> {
    const chunkPdf = await extractPageRange(context.pdf, range);
    let lastError = "";

    for (let attempt = 1; attempt <= TRANSCRIPTION_ATTEMPTS; attempt++) {
        try {
            return await transcribeChunk({
                chunkPdf,
                pageStart: range.pageStart,
                pageEnd: range.pageEnd,
                apiKey: context.env.OPENAI_API_KEY ?? "",
                model: context.model,
                fetcher: context.fetcher,
            });
        } catch (error: unknown) {
            if (!(error instanceof InvalidTranscriptionError)) {
                throw error;
            }

            lastError = error.message;
        }
    }

    const unreadablePages = [];

    for (let page = range.pageStart; page <= range.pageEnd; page++) {
        unreadablePages.push({ page, quality: "UNREADABLE" as const, note: lastError });
    }

    return {
        page_start: range.pageStart,
        page_end: range.pageEnd,
        pages: unreadablePages,
        blocks: [],
        error: lastError,
    };
}

function isChunkTranscription(value: unknown): value is ChunkTranscription {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    return "page_start" in value
        && typeof value.page_start === "number"
        && "pages" in value
        && Array.isArray(value.pages)
        && "blocks" in value
        && Array.isArray(value.blocks);
}
