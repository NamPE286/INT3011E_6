export type IdentityType = "CORPUS_DOCUMENT" | "JOB_SNAPSHOT" | "EXTRACTED_RECORD";

export type SearchDocumentStatus = "OK" | "EMPTY" | "AMBIGUOUS";

export interface SourceProvenance {
    document_id: string;
    job_id: string;
    pdf_sha256: string;
    created_at: string;
}

export interface ContentAvailability {
    has_json_content: boolean;
    has_pdf_snapshot: boolean;
    snapshot_r2_key: string | null;
    artifact_r2_key: string | null;
}

export interface DocumentCandidate {
    candidate_id: string;
    identity_type: IdentityType;
    canonical_document_id: string | null;
    document_number: string | null;
    title: string | null;
    document_type: string | null;
    agency: string | null;
    issued_at: string | null;
    source_provenance: SourceProvenance;
    availability: ContentAvailability;
    match_score: number;
    match_reasons: string[];
    metadata_notes?: string;
}

export interface SearchLegalDocumentsInput {
    query: string;
    document_number?: string | null;
    document_type?: string | null;
    agency?: string | null;
    issued_from?: string | null;
    issued_to?: string | null;
    limit?: number | null;
}

export interface SearchLegalDocumentsResponse {
    status: SearchDocumentStatus;
    query: string;
    total_candidates: number;
    candidates: DocumentCandidate[];
    disclaimer: string;
    execution_ms?: number;
}

export interface LegalDocumentRecord {
    id: string;
    job_id: string;
    document_title: string | null;
    json_content: string;
    snapshot_r2_key: string;
    artifact_r2_key: string;
    pdf_sha256: string;
    created_at: string;
}
