/**
 * Types for the evidence-backed legal-document graph (SRS §4.3, FR-03).
 *
 * These are extraction candidates, not legally verified relationships.
 * A candidate must be resolved before it is materialized as an accepted relation.
 */

/** Relation taxonomy from SRS §4.3. Impact edges point from the acting document to the affected one. */
export const DOCUMENT_RELATION_TYPES = [
    "AMENDS",
    "SUPPLEMENTS",
    "AMENDS_OR_SUPPLEMENTS",
    "PARTIALLY_REPLACES",
    "FULLY_REPLACES",
    "PARTIALLY_REPEALS",
    "FULLY_REPEALS",
    "CORRECTS",
    "REFERENCES",
    "LEGAL_BASIS",
    "GUIDES",
    "DETAILS",
    "EXPLAINS",
    "SUSPENDS",
    "EXTENDS_EFFECT",
    "RESUMES_EFFECT",
    "CONTINUES_APPLICATION",
    "CONSOLIDATES",
    "UNKNOWN",
] as const;

export type DocumentRelationType = (typeof DOCUMENT_RELATION_TYPES)[number];

/** Legal action named by the cue, before scope decides the final relation type. */
export type RelationAction =
    | "AMEND"
    | "SUPPLEMENT"
    | "AMEND_OR_SUPPLEMENT"
    | "REPLACE"
    | "REPEAL"
    | "CORRECT"
    | "SUSPEND"
    | "GUIDE"
    | "DETAIL"
    | "LEGAL_BASIS";

/** Whether the action covers the whole target document; UNKNOWN when the wording does not say. */
export type RelationScope = "FULL" | "PARTIAL" | "UNKNOWN";

export const RELATION_CANDIDATE_STATUSES = [
    "CANDIDATE",
    "UNRESOLVED",
    "AMBIGUOUS",
    "CONFLICT",
    "ACCEPTED",
    "REJECTED",
] as const;

export type RelationCandidateStatus = (typeof RELATION_CANDIDATE_STATUSES)[number];

export interface RelationEvidence {
    /** Offsets are JavaScript UTF-16 string offsets into the exact input text. */
    start: number;
    end: number;
    quote: string;
    cue: string;
}

export interface DocumentRelationCandidate {
    /** Deterministic identifier for a single extraction run; not a canonical edge ID. */
    candidate_id: string;
    source_document_id: string;
    target_reference_raw: string;
    target_document_number: string | null;
    action: RelationAction;
    relation_type: DocumentRelationType;
    scope: RelationScope;
    status: RelationCandidateStatus;
    evidence: RelationEvidence;
    resolution_reason: string;
}

export interface ExtractDocumentRelationsInput {
    source_document_id: string;
    text: string;
}

export interface ExtractDocumentRelationsResult {
    source_document_id: string;
    candidates: DocumentRelationCandidate[];
    statistics: {
        sentences_scanned: number;
        candidate_count: number;
        unresolved_count: number;
    };
}
