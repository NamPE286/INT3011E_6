import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { DocumentMetadata } from "./document-metadata";
import type { DocumentRelationType, RelationAction, RelationCandidateStatus, RelationScope } from "./document-graph.types";

export type EvidenceField = "DOCUMENT_TITLE" | "PROVISION_TITLE" | "PROVISION_TEXT";

export type StoredRelationCandidate = {
    id: string;
    sourceDocumentId: string;
    sourceSnapshotId: string | null;
    sourceProvisionId: string | null;
    evidenceField: EvidenceField;
    contentRole: string | null;
    pageStart: number | null;
    pageEnd: number | null;
    startOffset: number;
    endOffset: number;
    quotedText: string;
    cue: string;
    rawTargetCitation: string;
    targetDocumentNumber: string | null;
    action: RelationAction;
    proposedRelationType: DocumentRelationType;
    scope: RelationScope;
    resolvedTargetDocumentId: string | null;
    status: RelationCandidateStatus;
    resolutionReason: string;
    method: string;
    extractorVersion: string;
};

export type EvidenceLevel = "SOURCE_METADATA" | "EXPLICIT_LEGAL_TEXT" | "STRUCTURED_DERIVATION" | "SEMANTIC_INFERENCE";

export type StoredDocumentRelation = {
    id: string;
    fromDocumentId: string;
    toDocumentId: string;
    relationType: DocumentRelationType;
    scope: RelationScope;
    verificationStatus: "ACCEPTED";
    evidenceLevel: EvidenceLevel;
    evidenceCandidateIds: string[];
    method: string;
};

type MetadataRow = {
    document_id: string;
    document_number: string | null;
    normalized_number: string | null;
    document_type: string | null;
    agency: string | null;
    issued_at: string | null;
    effective_from: string | null;
    effective_evidence: string | null;
    metadata_notes: string;
};

type CandidateRow = {
    id: string;
    source_document_id: string;
    source_snapshot_id: string | null;
    source_provision_id: string | null;
    evidence_field: EvidenceField;
    content_role: string | null;
    page_start: number | null;
    page_end: number | null;
    start_offset: number;
    end_offset: number;
    quoted_text: string;
    cue: string;
    raw_target_citation: string;
    target_document_number: string | null;
    action: RelationAction;
    proposed_relation_type: DocumentRelationType;
    scope: RelationScope;
    resolved_target_document_id: string | null;
    status: RelationCandidateStatus;
    resolution_reason: string;
    method: string;
    extractor_version: string;
};

type RelationRow = {
    id: string;
    from_document_id: string;
    to_document_id: string;
    relation_type: DocumentRelationType;
    scope: RelationScope;
    verification_status: "ACCEPTED";
    evidence_level: EvidenceLevel;
    evidence_candidate_ids: string;
    method: string;
};

export async function upsertDocumentMetadata(db: D1Database, metadata: DocumentMetadata): Promise<void> {
    await db
        .prepare(
            `INSERT INTO document_metadata (
                document_id, document_number, normalized_number, document_type, agency, issued_at,
                effective_from, effective_evidence, metadata_notes, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(document_id) DO UPDATE SET
                document_number = excluded.document_number,
                normalized_number = excluded.normalized_number,
                document_type = excluded.document_type,
                agency = excluded.agency,
                issued_at = excluded.issued_at,
                effective_from = excluded.effective_from,
                effective_evidence = excluded.effective_evidence,
                metadata_notes = excluded.metadata_notes,
                updated_at = excluded.updated_at`
        )
        .bind(
            metadata.documentId,
            metadata.documentNumber,
            metadata.normalizedNumber,
            metadata.documentType,
            metadata.agency,
            metadata.issuedAt,
            metadata.effectiveFrom,
            metadata.effectiveEvidence,
            JSON.stringify(metadata.metadataNotes),
            new Date().toISOString(),
        )
        .run();
}

export async function listDocumentMetadata(db: D1Database): Promise<DocumentMetadata[]> {
    const result = await db.prepare("SELECT * FROM document_metadata ORDER BY document_id").all<MetadataRow>();

    return result.results.map(toMetadata);
}

export async function getDocumentMetadata(db: D1Database, documentId: string): Promise<DocumentMetadata | null> {
    const row = await db.prepare("SELECT * FROM document_metadata WHERE document_id = ?").bind(documentId).first<MetadataRow>();

    return row ? toMetadata(row) : null;
}

/** Drops everything the graph stored for a document whose text is no longer accepted. */
export async function deleteDocumentGraph(db: D1Database, documentId: string): Promise<void> {
    await db.batch([
        db.prepare("DELETE FROM document_relation_candidates WHERE source_document_id = ?").bind(documentId),
        db.prepare("DELETE FROM document_metadata WHERE document_id = ?").bind(documentId),
    ]);
}

export async function replaceRelationCandidates(
    db: D1Database,
    documentId: string,
    candidates: StoredRelationCandidate[],
): Promise<void> {
    const createdAt = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
        db.prepare("DELETE FROM document_relation_candidates WHERE source_document_id = ?").bind(documentId),
    ];

    for (const candidate of candidates) {
        statements.push(
            db.prepare(
                `INSERT INTO document_relation_candidates (
                    id, source_document_id, source_snapshot_id, source_provision_id, evidence_field, content_role,
                    page_start, page_end, start_offset, end_offset, quoted_text, cue, raw_target_citation,
                    target_document_number, action, proposed_relation_type, scope, resolved_target_document_id,
                    status, resolution_reason, method, extractor_version, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                candidate.id,
                candidate.sourceDocumentId,
                candidate.sourceSnapshotId,
                candidate.sourceProvisionId,
                candidate.evidenceField,
                candidate.contentRole,
                candidate.pageStart,
                candidate.pageEnd,
                candidate.startOffset,
                candidate.endOffset,
                candidate.quotedText,
                candidate.cue,
                candidate.rawTargetCitation,
                candidate.targetDocumentNumber,
                candidate.action,
                candidate.proposedRelationType,
                candidate.scope,
                candidate.resolvedTargetDocumentId,
                candidate.status,
                candidate.resolutionReason,
                candidate.method,
                candidate.extractorVersion,
                createdAt,
            ),
        );
    }

    await db.batch(statements);
}

export async function listAllRelationCandidates(db: D1Database): Promise<StoredRelationCandidate[]> {
    const result = await db
        .prepare("SELECT * FROM document_relation_candidates ORDER BY source_document_id, start_offset")
        .all<CandidateRow>();

    return result.results.map(toCandidate);
}

export async function listRelationCandidatesFrom(db: D1Database, documentId: string): Promise<StoredRelationCandidate[]> {
    const result = await db
        .prepare("SELECT * FROM document_relation_candidates WHERE source_document_id = ? ORDER BY source_provision_id, start_offset")
        .bind(documentId)
        .all<CandidateRow>();

    return result.results.map(toCandidate);
}

export async function listRelationCandidatesByIds(db: D1Database, ids: string[]): Promise<StoredRelationCandidate[]> {
    if (ids.length === 0) {
        return [];
    }

    const result = await db
        .prepare("SELECT * FROM document_relation_candidates WHERE id IN (SELECT value FROM json_each(?))")
        .bind(JSON.stringify(ids))
        .all<CandidateRow>();

    return result.results.map(toCandidate);
}

export async function updateCandidateResolutions(db: D1Database, candidates: StoredRelationCandidate[]): Promise<void> {
    if (candidates.length === 0) {
        return;
    }

    await db.batch(
        candidates.map((candidate) =>
            db
                .prepare(
                    `UPDATE document_relation_candidates
                     SET status = ?, resolved_target_document_id = ?, resolution_reason = ?
                     WHERE id = ?`
                )
                .bind(candidate.status, candidate.resolvedTargetDocumentId, candidate.resolutionReason, candidate.id),
        ),
    );
}

/** Rewrites the accepted-edge table in one batch; the graph is always derived from its evidence. */
export async function replaceDocumentRelations(db: D1Database, relations: StoredDocumentRelation[]): Promise<void> {
    const updatedAt = new Date().toISOString();
    const statements: D1PreparedStatement[] = [db.prepare("DELETE FROM document_relations")];

    for (const relation of relations) {
        statements.push(
            db.prepare(
                `INSERT INTO document_relations (
                    id, from_document_id, to_document_id, relation_type, scope, verification_status,
                    evidence_level, evidence_candidate_ids, method, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                relation.id,
                relation.fromDocumentId,
                relation.toDocumentId,
                relation.relationType,
                relation.scope,
                relation.verificationStatus,
                relation.evidenceLevel,
                JSON.stringify(relation.evidenceCandidateIds),
                relation.method,
                updatedAt,
            ),
        );
    }

    await db.batch(statements);
}

export async function listDocumentRelationsTouching(db: D1Database, documentId: string): Promise<StoredDocumentRelation[]> {
    const result = await db
        .prepare("SELECT * FROM document_relations WHERE from_document_id = ? OR to_document_id = ? ORDER BY relation_type, id")
        .bind(documentId, documentId)
        .all<RelationRow>();

    return result.results.map(toRelation);
}

export async function listAllDocumentRelations(db: D1Database): Promise<StoredDocumentRelation[]> {
    const result = await db.prepare("SELECT * FROM document_relations ORDER BY id").all<RelationRow>();

    return result.results.map(toRelation);
}

function toMetadata(row: MetadataRow): DocumentMetadata {
    return {
        documentId: row.document_id,
        documentNumber: row.document_number,
        normalizedNumber: row.normalized_number,
        documentType: row.document_type,
        agency: row.agency,
        issuedAt: row.issued_at,
        effectiveFrom: row.effective_from,
        effectiveEvidence: row.effective_evidence,
        metadataNotes: JSON.parse(row.metadata_notes),
    };
}

function toCandidate(row: CandidateRow): StoredRelationCandidate {
    return {
        id: row.id,
        sourceDocumentId: row.source_document_id,
        sourceSnapshotId: row.source_snapshot_id,
        sourceProvisionId: row.source_provision_id,
        evidenceField: row.evidence_field,
        contentRole: row.content_role,
        pageStart: row.page_start,
        pageEnd: row.page_end,
        startOffset: row.start_offset,
        endOffset: row.end_offset,
        quotedText: row.quoted_text,
        cue: row.cue,
        rawTargetCitation: row.raw_target_citation,
        targetDocumentNumber: row.target_document_number,
        action: row.action,
        proposedRelationType: row.proposed_relation_type,
        scope: row.scope,
        resolvedTargetDocumentId: row.resolved_target_document_id,
        status: row.status,
        resolutionReason: row.resolution_reason,
        method: row.method,
        extractorVersion: row.extractor_version,
    };
}

function toRelation(row: RelationRow): StoredDocumentRelation {
    return {
        id: row.id,
        fromDocumentId: row.from_document_id,
        toDocumentId: row.to_document_id,
        relationType: row.relation_type,
        scope: row.scope,
        verificationStatus: row.verification_status,
        evidenceLevel: row.evidence_level,
        evidenceCandidateIds: JSON.parse(row.evidence_candidate_ids),
        method: row.method,
    };
}
