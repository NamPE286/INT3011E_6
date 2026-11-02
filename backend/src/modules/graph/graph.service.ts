import type { D1Database } from "@cloudflare/workers-types";
import { listAllProvisionRelations } from "../changes/change.repository";
import { listAllDocumentRelations } from "../documents/document-graph.repository";

/** Bounds of one graph response; the MVP corpus is far smaller, `truncated` says when a bound was hit. */
const MAX_DOCUMENTS = 500;
const MAX_PROVISION_RELATIONS = 2000;
const PROVISION_TEXT_PREVIEW = 240;
/** D1 allows at most 100 bound parameters per statement. */
const PROVISION_ID_BATCH = 90;

export type GraphDocument = {
    id: string;
    title: string | null;
    documentNumber: string | null;
    documentType: string | null;
    issuedAt: string | null;
    effectiveFrom: string | null;
};

export type GraphProvision = {
    id: string;
    documentId: string;
    level: string;
    articleNo: string | null;
    paragraphNo: string | null;
    pointNo: string | null;
    title: string | null;
    textPreview: string | null;
};

export type GraphDocumentRelation = {
    id: string;
    fromDocumentId: string;
    toDocumentId: string;
    relationType: string;
    scope: string;
    verificationStatus: string;
    evidenceLevel: string;
};

export type GraphProvisionRelation = {
    id: string;
    fromDocumentId: string;
    fromProvisionId: string;
    toDocumentId: string;
    toProvisionId: string | null;
    relationType: string;
    verificationStatus: string;
    evidenceText: string;
    effectiveFrom: string | null;
};

export type RelationGraph = {
    documents: GraphDocument[];
    provisions: GraphProvision[];
    documentRelations: GraphDocumentRelation[];
    provisionRelations: GraphProvisionRelation[];
    truncated: boolean;
    disclaimer: string;
};

const DISCLAIMER =
    "Đồ thị chỉ gồm văn bản đã nhập và quan hệ hệ thống tự xây từ toàn văn. Không có cạnh không chứng minh rằng không có quan hệ pháp lý.";

type DocumentRow = {
    id: string;
    document_title: string | null;
    document_number: string | null;
    document_type: string | null;
    issued_at: string | null;
    effective_from: string | null;
};

type ProvisionRow = {
    id: string;
    document_id: string;
    level: string;
    article_no: string | null;
    paragraph_no: string | null;
    point_no: string | null;
    title: string | null;
    text: string | null;
};

/** The corpus-wide relation graph: documents, their accepted edges, provision edges and the provisions they touch. */
export async function getRelationGraph(db: D1Database): Promise<RelationGraph> {
    const fetchedDocuments = await listGraphDocuments(db);
    const documents = fetchedDocuments.slice(0, MAX_DOCUMENTS);
    const documentIds = new Set(documents.map((document) => document.id));

    const documentRelations = (await listAllDocumentRelations(db))
        .filter((relation) => documentIds.has(relation.fromDocumentId) && documentIds.has(relation.toDocumentId))
        .map(
            (relation): GraphDocumentRelation => ({
                id: relation.id,
                fromDocumentId: relation.fromDocumentId,
                toDocumentId: relation.toDocumentId,
                relationType: relation.relationType,
                scope: relation.scope,
                verificationStatus: relation.verificationStatus,
                evidenceLevel: relation.evidenceLevel,
            }),
        );

    const touchingCorpus = (await listAllProvisionRelations(db)).filter(
        (relation) => documentIds.has(relation.fromDocumentId) && documentIds.has(relation.toDocumentId),
    );
    const provisionRelations = touchingCorpus.slice(0, MAX_PROVISION_RELATIONS).map(
        (relation): GraphProvisionRelation => ({
            id: relation.id,
            fromDocumentId: relation.fromDocumentId,
            fromProvisionId: relation.fromProvisionId,
            toDocumentId: relation.toDocumentId,
            toProvisionId: relation.toProvisionId,
            relationType: relation.relationType,
            verificationStatus: relation.verificationStatus,
            evidenceText: relation.evidenceText,
            effectiveFrom: relation.effectiveFrom,
        }),
    );

    const endpointIds = provisionRelations.flatMap((relation) => [relation.fromProvisionId, relation.toProvisionId]);
    const provisions = await listGraphProvisions(db, [...new Set(endpointIds.filter((id) => id !== null))]);

    return {
        documents,
        provisions,
        documentRelations,
        provisionRelations,
        truncated: fetchedDocuments.length > MAX_DOCUMENTS || touchingCorpus.length > MAX_PROVISION_RELATIONS,
        disclaimer: DISCLAIMER,
    };
}

/** One row more than the bound, so the caller can tell a full page from a truncated one. */
async function listGraphDocuments(db: D1Database): Promise<GraphDocument[]> {
    const result = await db
        .prepare(
            `SELECT d.id, d.document_title, m.document_number, m.document_type, m.issued_at, m.effective_from
            FROM legal_documents d
            LEFT JOIN document_metadata m ON m.document_id = d.id
            WHERE d.review_status = 'ACCEPTED'
            ORDER BY m.issued_at IS NULL, m.issued_at, d.created_at, d.id
            LIMIT ?`,
        )
        .bind(MAX_DOCUMENTS + 1)
        .all<DocumentRow>();

    return result.results.map((row) => ({
        id: row.id,
        title: row.document_title,
        documentNumber: row.document_number,
        documentType: row.document_type,
        issuedAt: row.issued_at,
        effectiveFrom: row.effective_from,
    }));
}

async function listGraphProvisions(db: D1Database, provisionIds: string[]): Promise<GraphProvision[]> {
    const provisions: GraphProvision[] = [];

    for (let start = 0; start < provisionIds.length; start += PROVISION_ID_BATCH) {
        const batch = provisionIds.slice(start, start + PROVISION_ID_BATCH);
        const placeholders = batch.map(() => "?").join(", ");
        const result = await db
            .prepare(
                `SELECT id, document_id, level, article_no, paragraph_no, point_no, title, text
                FROM provisions WHERE id IN (${placeholders}) ORDER BY document_id, ordinal`,
            )
            .bind(...batch)
            .all<ProvisionRow>();

        provisions.push(...result.results.map(toGraphProvision));
    }

    return provisions;
}

function toGraphProvision(row: ProvisionRow): GraphProvision {
    return {
        id: row.id,
        documentId: row.document_id,
        level: row.level,
        articleNo: row.article_no,
        paragraphNo: row.paragraph_no,
        pointNo: row.point_no,
        title: row.title,
        textPreview: row.text ? row.text.slice(0, PROVISION_TEXT_PREVIEW) : null,
    };
}
