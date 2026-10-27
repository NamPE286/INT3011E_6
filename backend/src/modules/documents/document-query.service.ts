import type { D1Database } from "@cloudflare/workers-types";
import { listProvisionRelationsTo } from "../changes/change.repository";
import type { ProvisionRelationType, RelationVerification } from "../changes/change.types";
import { listProvisions } from "../provisions/provision.repository";
import type { ContentRole, ProvisionLevel, Relevance } from "../provisions/provision.types";
import { getDocumentMetadata } from "./document-graph.repository";
import type { DocumentMetadata } from "./document-metadata";
import { DocumentRepository } from "./document.repository";
import { DocumentService } from "./document.service";

const SEARCH_DISCLAIMER =
    "Kết quả chỉ gồm văn bản đã nhập vào hệ thống. Không tìm thấy không chứng minh văn bản không tồn tại trong hệ thống pháp luật Việt Nam.";
const VIEW_DISCLAIMER =
    "Các phần bị sửa đổi, thay thế hoặc bãi bỏ chỉ được đánh dấu khi có văn bản tác động đã nhập vào hệ thống. Phần không được đánh dấu chưa chắc đã còn nguyên hiệu lực.";
const DEFAULT_LIST_LIMIT = 20;

export type DocumentSearchInput = {
    query: string;
    documentType: string | null;
    agency: string | null;
    limit: number;
};

export type DocumentListItem = {
    id: string;
    title: string | null;
    documentNumber: string | null;
    documentType: string | null;
    agency: string | null;
    issuedAt: string | null;
    matchScore: number | null;
    matchReasons: string[];
};

export type DocumentSearchResult = {
    query: string;
    documents: DocumentListItem[];
    disclaimer: string;
};

export type DocumentViewProvision = {
    id: string;
    parentId: string | null;
    ordinal: number;
    level: ProvisionLevel;
    number: string;
    title: string | null;
    text: string | null;
    pageStart: number | null;
    pageEnd: number | null;
    contentRole: ContentRole;
    relevance: Relevance;
    containerProvisionId: string | null;
};

export type ProvisionAmendment = {
    relationId: string;
    toProvisionId: string | null;
    relationType: ProvisionRelationType;
    verificationStatus: RelationVerification;
    fromDocumentId: string;
    fromDocumentNumber: string | null;
    fromDocumentTitle: string | null;
    fromProvisionId: string;
    effectiveFrom: string | null;
    evidenceText: string;
};

export type DocumentView = {
    document: {
        id: string;
        jobId: string;
        title: string | null;
        pageCount: number | null;
        createdAt: string;
    };
    metadata: DocumentMetadata | null;
    provisions: DocumentViewProvision[];
    amendments: ProvisionAmendment[];
    disclaimer: string;
};

type ListedRow = {
    id: string;
    document_title: string | null;
    document_number: string | null;
    document_type: string | null;
    agency: string | null;
    issued_at: string | null;
};

type DocumentRow = {
    id: string;
    job_id: string;
    document_title: string | null;
    page_count: number | null;
    created_at: string;
};

/** FR-14: searches accepted documents by number, title, keyword, type or agency without any model call. */
export async function searchDocuments(db: D1Database, input: DocumentSearchInput): Promise<DocumentSearchResult> {
    const query = input.query.trim();

    if (query.length === 0) {
        return { query, documents: await listRecentDocuments(db, input), disclaimer: SEARCH_DISCLAIMER };
    }

    const service = new DocumentService(new DocumentRepository(db), { acceptedOnly: true });
    const response = await service.searchLegalDocuments({
        query,
        document_type: input.documentType,
        agency: input.agency,
        limit: input.limit,
    });

    return {
        query,
        documents: response.candidates.map((candidate) => ({
            id: candidate.source_provenance.document_id,
            title: candidate.title,
            documentNumber: candidate.document_number,
            documentType: candidate.document_type,
            agency: candidate.agency,
            issuedAt: candidate.issued_at,
            matchScore: candidate.match_score,
            matchReasons: candidate.match_reasons,
        })),
        disclaimer: SEARCH_DISCLAIMER,
    };
}

/** FR-15: the provisions of one accepted document and the verified or candidate amendments that touch them. */
export async function getDocumentView(db: D1Database, documentId: string): Promise<DocumentView | null> {
    const row = await db
        .prepare("SELECT id, job_id, document_title, page_count, created_at FROM legal_documents WHERE id = ? AND review_status = 'ACCEPTED'")
        .bind(documentId)
        .first<DocumentRow>();

    if (!row) {
        return null;
    }

    const [metadata, provisions, amendments] = await Promise.all([
        getDocumentMetadata(db, documentId),
        listProvisions(db, documentId),
        listAmendments(db, documentId),
    ]);

    return {
        document: { id: row.id, jobId: row.job_id, title: row.document_title, pageCount: row.page_count, createdAt: row.created_at },
        metadata,
        provisions: provisions.map((provision) => ({
            id: provision.id,
            parentId: provision.parentId,
            ordinal: provision.ordinal,
            level: provision.level,
            number: provision.number,
            title: provision.title,
            text: provision.text,
            pageStart: provision.pageStart,
            pageEnd: provision.pageEnd,
            contentRole: provision.contentRole,
            relevance: provision.relevance,
            containerProvisionId: provision.containerProvisionId,
        })),
        amendments,
        disclaimer: VIEW_DISCLAIMER,
    };
}

async function listRecentDocuments(db: D1Database, input: DocumentSearchInput): Promise<DocumentListItem[]> {
    const result = await db
        .prepare(
            `SELECT d.id, d.document_title, m.document_number, m.document_type, m.agency, m.issued_at
             FROM legal_documents d LEFT JOIN document_metadata m ON m.document_id = d.id
             WHERE d.review_status = 'ACCEPTED'
             ORDER BY m.issued_at DESC, d.created_at DESC
             LIMIT ?`
        )
        .bind(input.limit || DEFAULT_LIST_LIMIT)
        .all<ListedRow>();

    return result.results
        .filter((row) => matchesFilter(row.document_type, input.documentType) && matchesFilter(row.agency, input.agency))
        .map((row) => ({
            id: row.id,
            title: row.document_title,
            documentNumber: row.document_number,
            documentType: row.document_type,
            agency: row.agency,
            issuedAt: row.issued_at,
            matchScore: null,
            matchReasons: [],
        }));
}

function matchesFilter(value: string | null, filter: string | null): boolean {
    if (!filter) {
        return true;
    }

    return (value ?? "").toLowerCase().includes(filter.trim().toLowerCase());
}

async function listAmendments(db: D1Database, documentId: string): Promise<ProvisionAmendment[]> {
    const relations = await listProvisionRelationsTo(db, documentId);
    const sources = new Map<string, { number: string | null; title: string | null }>();

    for (const sourceDocumentId of new Set(relations.map((relation) => relation.fromDocumentId))) {
        const [metadata, row] = await Promise.all([
            getDocumentMetadata(db, sourceDocumentId),
            db.prepare("SELECT document_title FROM legal_documents WHERE id = ?").bind(sourceDocumentId).first<{ document_title: string | null }>(),
        ]);

        sources.set(sourceDocumentId, { number: metadata?.documentNumber ?? null, title: row?.document_title ?? null });
    }

    return relations.map((relation) => ({
        relationId: relation.id,
        toProvisionId: relation.toProvisionId,
        relationType: relation.relationType,
        verificationStatus: relation.verificationStatus,
        fromDocumentId: relation.fromDocumentId,
        fromDocumentNumber: sources.get(relation.fromDocumentId)?.number ?? null,
        fromDocumentTitle: sources.get(relation.fromDocumentId)?.title ?? null,
        fromProvisionId: relation.fromProvisionId,
        effectiveFrom: relation.effectiveFrom,
        evidenceText: relation.evidenceText,
    }));
}
