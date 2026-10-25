/**
 * Types for the evidence-backed legal-document graph MVP.
 *
 * These are extraction candidates, not legally verified relationships.
 * A candidate must be resolved and reviewed before it is materialized as a
 * canonical relation in the legal knowledge graph.
 */

export const DOCUMENT_RELATION_TYPES = [
    "LEGAL_BASIS",
    "REFERENCES",
    "GUIDES",
    "AMENDS_OR_SUPPLEMENTS",
    "REPLACES",
    "REPEALS",
    "SUSPENDS_EXECUTION",
    "UNKNOWN",
] as const;

export type DocumentRelationType = (typeof DOCUMENT_RELATION_TYPES)[number];

export type RelationCandidateStatus =
    | "CANDIDATE"
    | "UNRESOLVED"
    | "AMBIGUOUS"
    | "ACCEPTED"
    | "REJECTED";

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
    relation_type: DocumentRelationType;
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
