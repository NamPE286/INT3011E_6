import type { D1Database } from "@cloudflare/workers-types";
import { getRelationGraph } from "../graph/graph.service";
import { DEFAULT_WORKSPACE_ID } from "../workspaces/workspace.service";
import { analyzeImpactScope } from "./impact-scope";
import { runLogicAudit } from "./logic-audit";
import type {
    AnalysisDocument,
    AnalysisProvision,
    ImpactScopeReport,
    LogicAuditReport,
    WorkspaceAnalysisSnapshot,
    WorkspaceAuditOverview,
    WorkspaceDocumentAuditItem,
} from "./analysis.types";

type DocumentRow = {
    id: string;
    document_title: string | null;
    document_number: string | null;
    normalized_number: string | null;
    document_type: string | null;
    agency: string | null;
    issued_at: string | null;
    effective_from: string | null;
    extraction_model: string | null;
};

type ProvisionRow = {
    id: string;
    document_id: string;
    parent_id: string | null;
    ordinal: number;
    level: string;
    number: string;
    title: string | null;
    text: string | null;
    article_no: string | null;
    paragraph_no: string | null;
    point_no: string | null;
};

const DOC_BATCH_SIZE = 80;

export async function loadWorkspaceAnalysisSnapshot(
    db: D1Database,
    workspaceId: string = DEFAULT_WORKSPACE_ID,
): Promise<WorkspaceAnalysisSnapshot> {
    const [docRows, graph] = await Promise.all([
        db
            .prepare(
                `SELECT d.id, d.document_title, d.extraction_model,
                        m.document_number, m.normalized_number, m.document_type,
                        m.agency, m.issued_at, m.effective_from
                 FROM legal_documents d
                 LEFT JOIN document_metadata m ON m.document_id = d.id
                 WHERE d.review_status = 'ACCEPTED' AND d.workspace_id = ?
                 ORDER BY m.issued_at IS NULL, m.issued_at, d.created_at, d.id`,
            )
            .bind(workspaceId)
            .all<DocumentRow>(),
        getRelationGraph(db, workspaceId),
    ]);

    const documents: AnalysisDocument[] = docRows.results.map((row) => ({
        id: row.id,
        title: row.document_title,
        documentNumber: row.document_number,
        normalizedNumber: row.normalized_number,
        documentType: row.document_type,
        agency: row.agency,
        issuedAt: row.issued_at,
        effectiveFrom: row.effective_from,
        isManual: row.extraction_model === "MANUAL",
    }));

    const documentIds = documents.map((doc) => doc.id);
    const provisions = await loadWorkspaceProvisions(db, documentIds);

    return {
        workspaceId,
        documents,
        provisions,
        documentRelations: graph.documentRelations.map((rel) => ({
            id: rel.id,
            fromDocumentId: rel.fromDocumentId,
            toDocumentId: rel.toDocumentId,
            relationType: rel.relationType,
            scope: rel.scope,
            verificationStatus: rel.verificationStatus,
            sourceMode: rel.sourceMode,
            note: rel.note,
        })),
        provisionRelations: graph.provisionRelations.map((rel) => ({
            id: rel.id,
            fromDocumentId: rel.fromDocumentId,
            fromProvisionId: rel.fromProvisionId,
            toDocumentId: rel.toDocumentId,
            toProvisionId: rel.toProvisionId,
            relationType: rel.relationType,
            verificationStatus: rel.verificationStatus,
            evidenceText: rel.evidenceText,
            effectiveFrom: rel.effectiveFrom,
            sourceMode: rel.sourceMode,
        })),
        sanctionEdges: graph.sanctionChangeEdges.map((edge) => ({
            id: edge.id,
            fromDocumentId: edge.fromDocumentId,
            toDocumentId: edge.toDocumentId,
            fromProvisionId: edge.fromProvisionId,
            toProvisionId: edge.toProvisionId,
            behaviorSummary: edge.behaviorSummary,
            changeType: edge.changeType,
            oldPenaltyText: edge.oldPenaltyText,
            newPenaltyText: edge.newPenaltyText,
            oldFineMin: edge.oldFineMin,
            oldFineMax: edge.oldFineMax,
            newFineMin: edge.newFineMin,
            newFineMax: edge.newFineMax,
            severityDeltaPercent: edge.severityDeltaPercent,
            note: edge.note,
            sourceMode: edge.sourceMode,
        })),
    };
}

async function loadWorkspaceProvisions(db: D1Database, documentIds: string[]): Promise<AnalysisProvision[]> {
    const provisions: AnalysisProvision[] = [];

    for (let start = 0; start < documentIds.length; start += DOC_BATCH_SIZE) {
        const batch = documentIds.slice(start, start + DOC_BATCH_SIZE);
        const placeholders = batch.map(() => "?").join(", ");
        const result = await db
            .prepare(
                `SELECT id, document_id, parent_id, ordinal, level, number, title, text,
                        article_no, paragraph_no, point_no
                 FROM provisions
                 WHERE document_id IN (${placeholders})
                 ORDER BY document_id, ordinal`,
            )
            .bind(...batch)
            .all<ProvisionRow>();

        for (const row of result.results) {
            provisions.push({
                id: row.id,
                documentId: row.document_id,
                parentId: row.parent_id,
                ordinal: row.ordinal,
                level: row.level,
                number: row.number,
                title: row.title,
                text: row.text,
                articleNo: row.article_no,
                paragraphNo: row.paragraph_no,
                pointNo: row.point_no,
            });
        }
    }

    return provisions;
}

export async function auditWorkspaceDocument(
    db: D1Database,
    workspaceId: string,
    documentId: string,
): Promise<LogicAuditReport | null> {
    const snapshot = await loadWorkspaceAnalysisSnapshot(db, workspaceId);

    return runLogicAudit(snapshot, documentId);
}

export async function analyzeWorkspaceDocumentImpact(
    db: D1Database,
    workspaceId: string,
    documentId: string,
    maxDepth?: number,
): Promise<ImpactScopeReport | null> {
    const snapshot = await loadWorkspaceAnalysisSnapshot(db, workspaceId);

    return analyzeImpactScope(snapshot, documentId, maxDepth);
}

export async function getWorkspaceAuditOverview(
    db: D1Database,
    workspaceId: string,
): Promise<WorkspaceAuditOverview> {
    const snapshot = await loadWorkspaceAnalysisSnapshot(db, workspaceId);
    const items: WorkspaceDocumentAuditItem[] = [];
    let totalErrors = 0;
    let totalWarnings = 0;
    let highRiskDocuments = 0;

    for (const doc of snapshot.documents) {
        const audit = runLogicAudit(snapshot, doc.id);
        const impact = analyzeImpactScope(snapshot, doc.id);

        if (!audit || !impact) {
            continue;
        }

        totalErrors += audit.summary.errorCount;
        totalWarnings += audit.summary.warningCount;

        if (impact.summary.riskLevel === "HIGH") {
            highRiskDocuments += 1;
        }

        items.push({
            documentId: doc.id,
            documentNumber: doc.documentNumber,
            title: doc.title,
            documentType: doc.documentType,
            isManual: doc.isManual,
            auditStatus: audit.summary.status,
            score: audit.summary.score,
            errorCount: audit.summary.errorCount,
            warningCount: audit.summary.warningCount,
            infoCount: audit.summary.infoCount,
            riskLevel: impact.summary.riskLevel,
            directDocumentCount: impact.summary.directDocumentCount,
            indirectDocumentCount: impact.summary.indirectDocumentCount,
            sanctionShiftCount: impact.summary.sanctionShiftCount,
        });
    }

    return {
        workspaceId,
        checkedAt: new Date().toISOString(),
        totalDocuments: items.length,
        totalErrors,
        totalWarnings,
        highRiskDocuments,
        documents: items,
    };
}
