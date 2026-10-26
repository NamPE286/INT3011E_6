import type { D1Database } from "@cloudflare/workers-types";
import { analyzeLegalDocument } from "./provision.analyzer";
import { replaceProvisions } from "./provision.repository";
import type { ContentRole, Provision, ProvisionSummary, Relevance } from "./provision.types";

type LegalDocumentRecord = {
    id: string;
    json_content: string;
    review_status: string;
};

export type AnalysisOutcome =
    | { outcome: "ANALYZED"; documentId: string; summary: ProvisionSummary }
    | { outcome: "NOT_FOUND" }
    | { outcome: "REVIEW_REQUIRED" };

export async function findDocumentIdByJobId(db: D1Database, jobId: string): Promise<string | null> {
    const record = await db
        .prepare("SELECT id FROM legal_documents WHERE job_id = ?")
        .bind(jobId)
        .first<{ id: string }>();

    return record?.id ?? null;
}

/**
 * Reads the validated legal JSON of a job, assigns structure roles and stores the provisions.
 * Documents that are still waiting for review are refused: their text is not verified yet.
 */
export async function analyzeStoredDocument(db: D1Database, jobId: string): Promise<AnalysisOutcome> {
    const record = await db
        .prepare("SELECT id, json_content, review_status FROM legal_documents WHERE job_id = ?")
        .bind(jobId)
        .first<LegalDocumentRecord>();

    if (!record) {
        return { outcome: "NOT_FOUND" };
    }

    if (record.review_status !== "ACCEPTED") {
        return { outcome: "REVIEW_REQUIRED" };
    }

    const legalDocument: unknown = JSON.parse(record.json_content);
    const provisions = analyzeLegalDocument(record.id, legalDocument);

    await replaceProvisions(db, record.id, provisions);

    return { outcome: "ANALYZED", documentId: record.id, summary: summarizeProvisions(provisions) };
}

/**
 * Pipeline hook. The document is already saved when this runs, so a failure here is logged and can be
 * repaired by calling the analyze endpoint again; it must not turn a finished job into a failed one.
 */
export async function analyzeAfterExtraction(db: D1Database, jobId: string): Promise<void> {
    try {
        const result = await analyzeStoredDocument(db, jobId);

        console.log(JSON.stringify({
            level: "info",
            module: "provisions",
            jobId,
            outcome: result.outcome,
            total: result.outcome === "ANALYZED" ? result.summary.total : 0,
        }));
    } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : "Unknown provision analysis error";

        console.error(`[Provisions] Analysis failed for ${jobId}`, detail);
    }
}

export function summarizeProvisions(provisions: Provision[]): ProvisionSummary {
    const byContentRole: Partial<Record<ContentRole, number>> = {};
    const byRelevance: Partial<Record<Relevance, number>> = {};
    let flagged = 0;

    for (const provision of provisions) {
        byContentRole[provision.contentRole] = (byContentRole[provision.contentRole] ?? 0) + 1;
        byRelevance[provision.relevance] = (byRelevance[provision.relevance] ?? 0) + 1;

        if (provision.flags.length > 0) {
            flagged++;
        }
    }

    return { total: provisions.length, byContentRole, byRelevance, flagged };
}
