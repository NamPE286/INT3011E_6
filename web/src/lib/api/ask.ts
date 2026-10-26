import { isRecord, readNumber, readRows, readString, readStringList } from "./read";
import { parseCorpusScope, type CorpusScope } from "./violations";

export const ANSWER_STATUSES = ["ANSWERED", "AMBIGUOUS", "UNCERTAIN", "NO_ANSWER"] as const;

export type AnswerStatus = (typeof ANSWER_STATUSES)[number];

export type AnswerClaim = {
    text: string;
    evidenceIds: string[];
};

export type AnswerEvidence = {
    id: string;
    violationId: string;
    violationName: string;
    ruleId: string;
    status: string;
    behaviorText: string;
    fine: { min: number; max: number } | null;
    validFrom: string | null;
    validTo: string | null;
    source: {
        documentId: string;
        documentNumber: string | null;
        provisionId: string;
    };
};

export type AskAnswer = {
    question: string;
    asOf: string;
    status: AnswerStatus;
    clarification: string | null;
    claims: AnswerClaim[];
    evidence: AnswerEvidence[];
    scope: CorpusScope;
    provenance: {
        method: "RULE_ONLY" | "LLM";
        model: string | null;
        droppedClaims: number;
        fallbackReason: string | null;
    };
};

export function parseAskAnswer(value: unknown): AskAnswer | null {
    if (!isRecord(value)) {
        return null;
    }

    const status = readString(value, "status");
    const question = readString(value, "question");
    const asOf = readString(value, "asOf");

    if (!isAnswerStatus(status) || question === null || !asOf || !Array.isArray(value.claims) || !Array.isArray(value.evidence)) {
        return null;
    }

    const evidence = readRows(value, "evidence", parseEvidence);
    const knownIds = new Set(evidence.map((item) => item.id));
    const provenance = isRecord(value.provenance) ? value.provenance : {};

    return {
        question,
        asOf,
        status,
        clarification: readString(value, "clarification"),
        claims: readRows(value, "claims", parseClaim).filter((claim) => claim.evidenceIds.length > 0 && claim.evidenceIds.every((id) => knownIds.has(id))),
        evidence,
        scope: parseCorpusScope(value.scope),
        provenance: {
            method: provenance.method === "LLM" ? "LLM" : "RULE_ONLY",
            model: readString(provenance, "model"),
            droppedClaims: readNumber(provenance, "droppedClaims") ?? 0,
            fallbackReason: readString(provenance, "fallbackReason"),
        },
    };
}

function isAnswerStatus(value: string | null): value is AnswerStatus {
    return ANSWER_STATUSES.some((status) => status === value);
}

function parseClaim(row: Record<string, unknown>): AnswerClaim | null {
    const text = readString(row, "text");

    return text ? { text, evidenceIds: readStringList(row, "evidenceIds") } : null;
}

function parseEvidence(row: Record<string, unknown>): AnswerEvidence | null {
    const id = readString(row, "id");
    const ruleId = readString(row, "ruleId");
    const source = isRecord(row.source) ? row.source : {};
    const documentId = readString(source, "documentId");
    const provisionId = readString(source, "provisionId");

    if (!id || !ruleId || !documentId || !provisionId) {
        return null;
    }

    const fine = isRecord(row.fine) ? row.fine : null;
    const min = fine ? readNumber(fine, "min") : null;
    const max = fine ? readNumber(fine, "max") : null;

    return {
        id,
        violationId: readString(row, "violationId") ?? "",
        violationName: readString(row, "violationName") ?? "",
        ruleId,
        status: readString(row, "status") ?? "UNCERTAIN",
        behaviorText: readString(row, "behaviorText") ?? "",
        fine: min !== null && max !== null ? { min, max } : null,
        validFrom: readString(row, "validFrom"),
        validTo: readString(row, "validTo"),
        source: { documentId, documentNumber: readString(source, "documentNumber"), provisionId },
    };
}
