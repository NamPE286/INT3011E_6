import type { D1Database } from "@cloudflare/workers-types";
import { analyzeLegalDocument } from "./provision.analyzer";
import { deleteProvisions, replaceProvisions } from "./provision.repository";
import type { ContentRole, Provision, ProvisionSource, ProvisionSummary, Relevance } from "./provision.types";

type LegalDocumentRecord = {
    id: string;
    json_content: string;
    review_status: string;
    pdf_sha256: string;
    extraction_model: string | null;
    prompt_version: string | null;
    schema_version: string | null;
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
        .prepare(`SELECT id, json_content, review_status, pdf_sha256, extraction_model, prompt_version, schema_version
             FROM legal_documents WHERE job_id = ?`)
        .bind(jobId)
        .first<LegalDocumentRecord>();

    if (!record) {
        return { outcome: "NOT_FOUND" };
    }

    // Provisions from an earlier accepted read must not outlive a re-extraction that now needs review.
    if (record.review_status !== "ACCEPTED") {
        await deleteProvisions(db, record.id);

        return { outcome: "REVIEW_REQUIRED" };
    }

    const legalDocument: unknown = JSON.parse(record.json_content);
    const provisions = analyzeLegalDocument(record.id, legalDocument);

    await replaceProvisions(db, record.id, provisions, readProvisionSource(record, legalDocument));

    return { outcome: "ANALYZED", documentId: record.id, summary: summarizeProvisions(provisions) };
}

function readProvisionSource(record: LegalDocumentRecord, legalDocument: unknown): ProvisionSource {
    const readMethod = record.extraction_model
        ? `LLM:${record.extraction_model};prompt=${record.prompt_version ?? "unknown"};schema=${record.schema_version ?? "unknown"}`
        : null;

    return {
        sourceSnapshotId: readSnapshotId(legalDocument),
        pdfSha256: record.pdf_sha256,
        readMethod,
    };
}

function readSnapshotId(legalDocument: unknown): string | null {
    if (typeof legalDocument !== "object" || legalDocument === null || !("source" in legalDocument)) {
        return null;
    }

    const source: unknown = legalDocument.source;

    if (typeof source !== "object" || source === null || !("snapshot_id" in source)) {
        return null;
    }

    return typeof source.snapshot_id === "string" ? source.snapshot_id : null;
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
