import type { D1Database, Queue } from "@cloudflare/workers-types";
import type { ProcessingQueueMessage } from "../../types/env";
import { buildChangeGraph } from "../changes/change.service";
import { buildDocumentGraph } from "../documents/document-graph.service";
import { refreshHistory } from "../history/history.service";
import { resolveDocumentIdentities } from "../identity/identity.service";
import { analyzeStoredDocument } from "../provisions/provision.service";
import { extractViolationRules, listRuleDocuments } from "../violations/violation.service";

export type PreprocessingOptions = {
    apiKey?: string;
    model: string;
    fetcher?: typeof fetch;
};

/** Checklist order: each stage reads what the stages before it stored (docs/preprocessing.md). */
export const PREPROCESSING_STAGES = ["PROVISIONS", "DOCUMENT_GRAPH", "CHANGE_GRAPH", "VIOLATION_RULES", "IDENTITY", "HISTORY"] as const;

export type PreprocessingStage = (typeof PREPROCESSING_STAGES)[number];

export type StageStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED";

export type StageState = {
    stage: PreprocessingStage;
    status: StageStatus;
    error: string | null;
    updatedAt: string | null;
};

type StageResult = { status: "DONE" | "PENDING" } | { status: "FAILED"; error: string };

export function isPreprocessingStage(value: unknown): value is PreprocessingStage {
    return typeof value === "string" && (PREPROCESSING_STAGES as readonly string[]).includes(value);
}

/** Every stage of the checklist; a stage without a stored row has not run and is PENDING. */
export async function listPreprocessingStages(db: D1Database, jobId: string): Promise<StageState[]> {
    const rows = await db
        .prepare("SELECT stage, status, error, updated_at FROM preprocessing_stages WHERE job_id = ?")
        .bind(jobId)
        .all<{ stage: string; status: StageStatus; error: string | null; updated_at: string }>();
    const byStage = new Map(rows.results.map((row) => [row.stage, row]));

    return PREPROCESSING_STAGES.map((stage) => {
        const row = byStage.get(stage);

        return {
            stage,
            status: row?.status ?? "PENDING",
            error: row?.error ?? null,
            updatedAt: row?.updated_at ?? null,
        };
    });
}

/**
 * The stage a rerun starts from: the first one that is not done. Later stages read its output, so a
 * rerun continues through every stage after it.
 */
export function firstMissingStage(stages: StageState[]): PreprocessingStage | null {
    return stages.find((state) => state.status !== "DONE")?.stage ?? null;
}

export function nextStage(stage: PreprocessingStage): PreprocessingStage | null {
    return PREPROCESSING_STAGES[PREPROCESSING_STAGES.indexOf(stage) + 1] ?? null;
}

/**
 * Queues the checklist from its first missing stage. Each stage runs in its own queue invocation, so a
 * long document gets a fresh time budget per stage instead of losing the later stages to one timeout.
 */
export async function enqueueMissingStages(db: D1Database, queue: Queue<ProcessingQueueMessage>, jobId: string): Promise<PreprocessingStage | null> {
    const startStage = firstMissingStage(await listPreprocessingStages(db, jobId));

    if (startStage) {
        await queue.send({ jobId: jobId, stage: startStage });
    }

    return startStage;
}

/** Queue handler step: runs one stage, then queues the next unless there is nothing left to work on. */
export async function runQueuedStage(
    db: D1Database,
    queue: Queue<ProcessingQueueMessage>,
    jobId: string,
    stage: PreprocessingStage,
    options: PreprocessingOptions,
): Promise<void> {
    const result = await runPreprocessingStage(db, jobId, stage, options);
    const following = nextStage(stage);

    if (!following || result.status === "PENDING" || (stage === "PROVISIONS" && result.status === "FAILED")) {
        return;
    }

    await queue.send({ jobId: jobId, stage: following });
}

/** A newly read document starts its checklist over, since everything derived from the old read is stale. */
export async function resetPreprocessingStages(db: D1Database, jobId: string): Promise<void> {
    await db.prepare("DELETE FROM preprocessing_stages WHERE job_id = ?").bind(jobId).run();
}

/**
 * Runs every stage in order in this invocation (tests, the eval script). A failed stage is recorded and
 * the later stages still run, except when the provisions could not be read: nothing else has input then.
 */
export async function runPreprocessing(db: D1Database, jobId: string, options: PreprocessingOptions): Promise<void> {
    for (const stage of PREPROCESSING_STAGES) {
        const result = await runPreprocessingStage(db, jobId, stage, options);

        if (stage === "PROVISIONS" && result.status === "FAILED") {
            return;
        }
    }
}

/** Runs one stage and records its outcome in the checklist. Errors never escape: the document stays published. */
export async function runPreprocessingStage(
    db: D1Database,
    jobId: string,
    stage: PreprocessingStage,
    options: PreprocessingOptions,
): Promise<StageResult> {
    await recordStage(db, jobId, stage, { status: "RUNNING", error: null });

    let result: StageResult;

    try {
        result = await executeStage(db, jobId, stage, options);
    } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : "Unknown preprocessing error";

        result = { status: "FAILED", error: detail.slice(0, 1000) };
    }

    await recordStage(db, jobId, stage, { status: result.status, error: result.status === "FAILED" ? result.error : null });
    console.log(JSON.stringify({ level: result.status === "FAILED" ? "error" : "info", module: "preprocessing", jobId, stage, ...result }));

    return result;
}

async function executeStage(db: D1Database, jobId: string, stage: PreprocessingStage, options: PreprocessingOptions): Promise<StageResult> {
    const record = await db.prepare("SELECT id FROM legal_documents WHERE job_id = ?").bind(jobId).first<{ id: string }>();

    if (!record) {
        return { status: "FAILED", error: "Legal document not found" };
    }

    const documentId = record.id;

    switch (stage) {
        case "PROVISIONS":
            return fromOutcome((await analyzeStoredDocument(db, jobId)).outcome);
        case "DOCUMENT_GRAPH":
            return fromOutcome((await buildDocumentGraph(db, documentId)).outcome);
        case "CHANGE_GRAPH":
            return fromOutcome((await buildChangeGraph(db, documentId)).outcome);
        case "VIOLATION_RULES":
            return extractRulesOfDependents(db, documentId, options);
        case "IDENTITY":
            for (const id of await listRuleDocuments(db, documentId)) {
                await resolveDocumentIdentities(db, id, options);
            }

            return { status: "DONE" };
        case "HISTORY":
            await refreshHistory(db);

            return { status: "DONE" };
    }
}

/** The document's own rules and those of amendments imported before it (their rewritten rules land here). */
async function extractRulesOfDependents(db: D1Database, documentId: string, options: PreprocessingOptions): Promise<StageResult> {
    const [ownId, ...amenderIds] = await listRuleDocuments(db, documentId);
    const own = await extractViolationRules(db, ownId, options);

    for (const id of amenderIds) {
        await extractViolationRules(db, id, options);
    }

    return fromOutcome(own.outcome);
}

function fromOutcome(outcome: string): StageResult {
    if (outcome === "NOT_FOUND") {
        return { status: "FAILED", error: "Legal document not found" };
    }

    if (outcome === "REVIEW_REQUIRED") {
        return { status: "PENDING" };
    }

    return { status: "DONE" };
}

async function recordStage(
    db: D1Database,
    jobId: string,
    stage: PreprocessingStage,
    state: { status: StageStatus; error: string | null },
): Promise<void> {
    await db
        .prepare(
            `INSERT INTO preprocessing_stages (job_id, stage, status, error, updated_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(job_id, stage) DO UPDATE SET status = excluded.status, error = excluded.error, updated_at = excluded.updated_at`
        )
        .bind(jobId, stage, state.status, state.error, new Date().toISOString())
        .run();
}
