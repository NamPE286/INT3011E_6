import type { D1Database } from "@cloudflare/workers-types";
import { DEFAULT_WORKSPACE_ID } from "../workspaces/workspace.service";

/** Bounds of one graph response; the MVP corpus is far smaller, `truncated` says when a bound was hit. */
const MAX_DOCUMENTS = 500;
const MAX_PROVISION_RELATIONS = 2000;
const PROVISION_TEXT_PREVIEW = 240;
/** D1 allows at most 100 bound parameters per statement. */
const PROVISION_ID_BATCH = 90;

export type GraphSourceMode = "AI" | "MANUAL";

export type GraphDocument = {
    id: string;
    title: string | null;
    documentNumber: string | null;
    documentType: string | null;
    issuedAt: string | null;
    effectiveFrom: string | null;
    isManual: boolean;
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
    sourceMode: GraphSourceMode;
    note: string | null;
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
    sourceMode: GraphSourceMode;
};

export type GraphSanctionChangeEdge = {
    id: string;
    fromDocumentId: string;
    toDocumentId: string;
    fromProvisionId: string | null;
    toProvisionId: string | null;
    behaviorSummary: string;
    changeType: string;
    changeTypes: string[];
    oldPenaltyText: string | null;
    newPenaltyText: string | null;
    oldFineMin: number | null;
    oldFineMax: number | null;
    newFineMin: number | null;
    newFineMax: number | null;
    severityDeltaPercent: number | null;
    note: string | null;
    sourceMode: GraphSourceMode;
};

export type RelationGraph = {
    workspaceId: string;
    documents: GraphDocument[];
    provisions: GraphProvision[];
    documentRelations: GraphDocumentRelation[];
    provisionRelations: GraphProvisionRelation[];
    sanctionChangeEdges: GraphSanctionChangeEdge[];
    truncated: boolean;
    disclaimer: string;
};

const DISCLAIMER =
    "Đồ thị gồm các văn bản trong không gian làm việc hiện tại (từ AI trích xuất và soạn thảo thủ công). Không có cạnh không chứng minh rằng không có quan hệ pháp lý.";

type DocumentRow = {
    id: string;
    document_title: string | null;
    document_number: string | null;
    document_type: string | null;
    issued_at: string | null;
    effective_from: string | null;
    extraction_model: string | null;
};

type DocumentRelationRow = {
    id: string;
    from_document_id: string;
    to_document_id: string;
    relation_type: string;
    scope: string;
    verification_status: string;
    evidence_level: string;
    source_mode: string | null;
    note: string | null;
};

type ProvisionRelationRow = {
    id: string;
    from_document_id: string;
    from_provision_id: string;
    to_document_id: string;
    to_provision_id: string | null;
    relation_type: string;
    verification_status: string;
    evidence_text: string;
    effective_from: string | null;
    source_mode: string | null;
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

type ManualSanctionRow = {
    id: string;
    from_document_id: string;
    to_document_id: string;
    from_provision_id: string | null;
    to_provision_id: string | null;
    behavior_summary: string;
    change_type: string;
    old_penalty_text: string | null;
    new_penalty_text: string | null;
    old_fine_min: number | null;
    old_fine_max: number | null;
    new_fine_min: number | null;
    new_fine_max: number | null;
    note: string | null;
    source_mode: string | null;
};

type AiChangeEventRow = {
    id: string;
    change_types: string;
    notes: string;
    canonical_name: string | null;
    old_doc_id: string | null;
    old_prov_id: string | null;
    old_behavior: string | null;
    old_fine_min: number | null;
    old_fine_max: number | null;
    old_points: number | null;
    new_doc_id: string | null;
    new_prov_id: string | null;
    new_behavior: string | null;
    new_fine_min: number | null;
    new_fine_max: number | null;
    new_points: number | null;
};

const SANCTION_PRIORITY = [
    "SANCTION_INCREASE",
    "SANCTION_DECREASE",
    "POINT_DEDUCTION_CHANGED",
    "POINT_DEDUCTION_APPLICABILITY_CHANGED",
    "LICENSE_SUSPENSION_CHANGED",
    "VEHICLE_CONFISCATION_CHANGED",
    "REPEALED",
    "SANCTION_CHANGED",
    "VIOLATION_ADDED",
    "ADDITIONAL_SANCTION_CHANGED",
];

/** The workspace-scoped relation graph: documents, legal-influence edges (mode 2), and sanction-change edges (mode 1). */
export async function getRelationGraph(db: D1Database, workspaceId: string = DEFAULT_WORKSPACE_ID): Promise<RelationGraph> {
    const fetchedDocuments = await listGraphDocuments(db, workspaceId);
    const documents = fetchedDocuments.slice(0, MAX_DOCUMENTS);
    const documentIds = new Set(documents.map((document) => document.id));

    const [rawDocRelations, rawProvRelations, storedSanctionEdges, aiSanctionEdges] = await Promise.all([
        listWorkspaceDocumentRelations(db, workspaceId),
        listWorkspaceProvisionRelations(db, workspaceId),
        listStoredSanctionEdges(db, workspaceId),
        listAiSanctionChangeEdges(db, documentIds),
    ]);

    const documentRelations = rawDocRelations
        .filter((relation) => documentIds.has(relation.fromDocumentId) && documentIds.has(relation.toDocumentId));

    const touchingCorpus = rawProvRelations.filter(
        (relation) => documentIds.has(relation.fromDocumentId) && documentIds.has(relation.toDocumentId),
    );
    const provisionRelations = touchingCorpus.slice(0, MAX_PROVISION_RELATIONS);

    const sanctionChangeEdges = [...aiSanctionEdges, ...storedSanctionEdges].filter(
        (edge) => documentIds.has(edge.fromDocumentId) && documentIds.has(edge.toDocumentId),
    );

    const endpointIds = provisionRelations.flatMap((relation) => [relation.fromProvisionId, relation.toProvisionId]);
    const provisions = await listGraphProvisions(db, [...new Set(endpointIds.filter((id): id is string => id !== null))]);

    return {
        workspaceId,
        documents,
        provisions,
        documentRelations,
        provisionRelations,
        sanctionChangeEdges,
        truncated: fetchedDocuments.length > MAX_DOCUMENTS || touchingCorpus.length > MAX_PROVISION_RELATIONS,
        disclaimer: DISCLAIMER,
    };
}

async function listGraphDocuments(db: D1Database, workspaceId: string): Promise<GraphDocument[]> {
    const result = await db
        .prepare(
            `SELECT d.id, d.document_title, d.extraction_model, m.document_number, m.document_type, m.issued_at, m.effective_from
            FROM legal_documents d
            LEFT JOIN document_metadata m ON m.document_id = d.id
            WHERE d.review_status = 'ACCEPTED' AND d.workspace_id = ?
            ORDER BY m.issued_at IS NULL, m.issued_at, d.created_at, d.id
            LIMIT ?`,
        )
        .bind(workspaceId, MAX_DOCUMENTS + 1)
        .all<DocumentRow>();

    return result.results.map((row) => ({
        id: row.id,
        title: row.document_title,
        documentNumber: row.document_number,
        documentType: row.document_type,
        issuedAt: row.issued_at,
        effectiveFrom: row.effective_from,
        isManual: row.extraction_model === "MANUAL",
    }));
}

async function listWorkspaceDocumentRelations(db: D1Database, workspaceId: string): Promise<GraphDocumentRelation[]> {
    const result = await db
        .prepare(
            `SELECT id, from_document_id, to_document_id, relation_type, scope, verification_status, evidence_level, source_mode, note
            FROM document_relations
            WHERE verification_status = 'ACCEPTED' AND workspace_id = ?
            ORDER BY updated_at DESC, id`,
        )
        .bind(workspaceId)
        .all<DocumentRelationRow>();

    return result.results.map((row) => ({
        id: row.id,
        fromDocumentId: row.from_document_id,
        toDocumentId: row.to_document_id,
        relationType: row.relation_type,
        scope: row.scope,
        verificationStatus: row.verification_status,
        evidenceLevel: row.evidence_level,
        sourceMode: row.source_mode === "MANUAL" ? "MANUAL" : "AI",
        note: row.note,
    }));
}

async function listWorkspaceProvisionRelations(db: D1Database, workspaceId: string): Promise<GraphProvisionRelation[]> {
    const result = await db
        .prepare(
            `SELECT id, from_document_id, from_provision_id, to_document_id, to_provision_id,
                    relation_type, verification_status, evidence_text, effective_from, source_mode
            FROM provision_relations
            WHERE workspace_id = ?
            ORDER BY created_at DESC, id`,
        )
        .bind(workspaceId)
        .all<ProvisionRelationRow>();

    return result.results.map((row) => ({
        id: row.id,
        fromDocumentId: row.from_document_id,
        fromProvisionId: row.from_provision_id,
        toDocumentId: row.to_document_id,
        toProvisionId: row.to_provision_id,
        relationType: row.relation_type,
        verificationStatus: row.verification_status,
        evidenceText: row.evidence_text,
        effectiveFrom: row.effective_from,
        sourceMode: row.source_mode === "MANUAL" ? "MANUAL" : "AI",
    }));
}

async function listStoredSanctionEdges(db: D1Database, workspaceId: string): Promise<GraphSanctionChangeEdge[]> {
    const result = await db
        .prepare(
            `SELECT id, from_document_id, to_document_id, from_provision_id, to_provision_id,
                    behavior_summary, change_type, old_penalty_text, new_penalty_text,
                    old_fine_min, old_fine_max, new_fine_min, new_fine_max, note, source_mode
            FROM sanction_change_edges
            WHERE workspace_id = ?
            ORDER BY created_at DESC, id`,
        )
        .bind(workspaceId)
        .all<ManualSanctionRow>();

    return result.results.map((row) => ({
        id: row.id,
        fromDocumentId: row.from_document_id,
        toDocumentId: row.to_document_id,
        fromProvisionId: row.from_provision_id,
        toProvisionId: row.to_provision_id,
        behaviorSummary: row.behavior_summary,
        changeType: row.change_type,
        changeTypes: [row.change_type],
        oldPenaltyText: row.old_penalty_text,
        newPenaltyText: row.new_penalty_text,
        oldFineMin: row.old_fine_min,
        oldFineMax: row.old_fine_max,
        newFineMin: row.new_fine_min,
        newFineMax: row.new_fine_max,
        severityDeltaPercent: computeDeltaPercent(row.old_fine_max, row.new_fine_max),
        note: row.note,
        sourceMode: row.source_mode === "MANUAL" ? "MANUAL" : "AI",
    }));
}

async function listAiSanctionChangeEdges(db: D1Database, documentIds: Set<string>): Promise<GraphSanctionChangeEdge[]> {
    if (documentIds.size === 0) {
        return [];
    }

    const result = await db
        .prepare(
            `SELECT
                ce.id,
                ce.change_types,
                ce.notes,
                tv.canonical_name,
                old_r.source_document_id AS old_doc_id,
                old_r.provision_id AS old_prov_id,
                old_r.behavior_text AS old_behavior,
                old_s.fine_min AS old_fine_min,
                old_s.fine_max AS old_fine_max,
                old_s.points_deducted AS old_points,
                new_r.source_document_id AS new_doc_id,
                new_r.provision_id AS new_prov_id,
                new_r.behavior_text AS new_behavior,
                new_s.fine_min AS new_fine_min,
                new_s.fine_max AS new_fine_max,
                new_s.points_deducted AS new_points
            FROM change_events ce
            LEFT JOIN traffic_violations tv ON tv.id = ce.traffic_violation_id
            LEFT JOIN violation_rules old_r ON old_r.id = ce.old_rule_id
            LEFT JOIN sanctions old_s ON old_s.violation_rule_id = old_r.id
            LEFT JOIN violation_rules new_r ON new_r.id = ce.new_rule_id
            LEFT JOIN sanctions new_s ON new_s.violation_rule_id = new_r.id`,
        )
        .all<AiChangeEventRow>();

    const edges: GraphSanctionChangeEdge[] = [];

    for (const row of result.results) {
        if (!row.old_doc_id || !row.new_doc_id) {
            continue;
        }

        if (!documentIds.has(row.old_doc_id) || !documentIds.has(row.new_doc_id)) {
            continue;
        }

        const parsedTypes = safeParseStringArray(row.change_types);
        const primaryType = pickPrimarySanctionChange(parsedTypes);

        if (!primaryType) {
            continue;
        }

        const notes = safeParseStringArray(row.notes);

        edges.push({
            id: `ai-sc:${row.id}`,
            fromDocumentId: row.new_doc_id,
            toDocumentId: row.old_doc_id,
            fromProvisionId: row.new_prov_id,
            toProvisionId: row.old_prov_id,
            behaviorSummary: row.canonical_name ?? row.new_behavior ?? row.old_behavior ?? "Hành vi vi phạm",
            changeType: primaryType,
            changeTypes: parsedTypes,
            oldPenaltyText: formatPenaltySummary(row.old_fine_min, row.old_fine_max, row.old_points),
            newPenaltyText: formatPenaltySummary(row.new_fine_min, row.new_fine_max, row.new_points),
            oldFineMin: row.old_fine_min,
            oldFineMax: row.old_fine_max,
            newFineMin: row.new_fine_min,
            newFineMax: row.new_fine_max,
            severityDeltaPercent: computeDeltaPercent(row.old_fine_max, row.new_fine_max),
            note: notes.length > 0 ? notes.join(" ") : null,
            sourceMode: "AI",
        });
    }

    return edges;
}

function pickPrimarySanctionChange(types: string[]): string | null {
    for (const priority of SANCTION_PRIORITY) {
        if (types.includes(priority)) {
            return priority;
        }
    }

    return null;
}

function computeDeltaPercent(oldMax: number | null, newMax: number | null): number | null {
    if (oldMax === null || newMax === null || oldMax <= 0) {
        return null;
    }

    return Math.round(((newMax - oldMax) / oldMax) * 100);
}

function formatPenaltySummary(min: number | null, max: number | null, points: number | null): string | null {
    const parts: string[] = [];

    if (min !== null && max !== null) {
        parts.push(`${min.toLocaleString("vi-VN")} – ${max.toLocaleString("vi-VN")} đ`);
    }

    if (points !== null && points > 0) {
        parts.push(`trừ ${points} điểm GPLX`);
    }

    if (parts.length === 0) {
        return null;
    }

    return parts.join(" + ");
}

function safeParseStringArray(raw: string | null): string[] {
    if (!raw) {
        return [];
    }

    try {
        const parsed: unknown = JSON.parse(raw);

        if (Array.isArray(parsed)) {
            return parsed.filter((item): item is string => typeof item === "string");
        }
    } catch {
        // Ignore malformed JSON.
    }

    return [];
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
