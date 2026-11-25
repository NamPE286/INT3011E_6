import { invalidResponse } from "./http";
import { isRecord, readNumber, readRows, readString, readStringList } from "./read";

export type AuditSeverity = "ERROR" | "WARNING" | "INFO";
export type AuditCategory = "STRUCTURE" | "TEMPORAL" | "REFERENCE" | "SANCTION_CONFLICT" | "DRAFTING_TECHNIQUE";
export type ReadinessStatus = "PASS" | "WARNING" | "FAIL";
export type ImpactRiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type LogicAuditFinding = {
    id: string;
    code: string;
    category: AuditCategory;
    severity: AuditSeverity;
    title: string;
    message: string;
    provisionId: string | null;
    relatedDocumentId: string | null;
    relatedProvisionId: string | null;
    evidence: string | null;
    suggestion: string;
};

export type LogicAuditReport = {
    workspaceId: string;
    documentId: string;
    documentNumber: string | null;
    documentTitle: string | null;
    checkedAt: string;
    summary: {
        status: ReadinessStatus;
        score: number;
        total: number;
        errorCount: number;
        warningCount: number;
        infoCount: number;
        checkedRules: number;
    };
    findings: LogicAuditFinding[];
    disclaimer: string;
};

export type DirectImpactedDocument = {
    documentId: string;
    documentNumber: string | null;
    title: string | null;
    documentType: string | null;
    relationType: string;
    scope: string;
    sourceMode: "AI" | "MANUAL";
    note: string | null;
    affectedProvisionCount: number;
};

export type IndirectImpactedDocument = {
    documentId: string;
    documentNumber: string | null;
    title: string | null;
    documentType: string | null;
    depth: number;
    viaDocumentId: string;
    viaRelationType: string;
    impactPath: string[];
    reason: string;
};

export type ImpactedProvisionItem = {
    relationId: string;
    fromProvisionId: string;
    fromProvisionLabel: string;
    toDocumentId: string;
    toDocumentLabel: string;
    toProvisionId: string | null;
    toProvisionLabel: string | null;
    relationType: string;
    evidenceText: string;
    effectiveFrom: string | null;
    sourceMode: "AI" | "MANUAL";
};

export type ImpactSanctionShift = {
    id: string;
    fromDocumentId: string;
    toDocumentId: string;
    fromProvisionId: string | null;
    toProvisionId: string | null;
    behaviorSummary: string;
    changeType: string;
    oldPenaltyText: string | null;
    newPenaltyText: string | null;
    severityDeltaPercent: number | null;
    note: string | null;
    sourceMode: "AI" | "MANUAL";
};

export type UnresolvedCitationItem = {
    citation: string;
    provisionId: string;
    provisionLabel: string;
};

export type SynchronizationItem = {
    priority: "HIGH" | "MEDIUM" | "LOW";
    targetDocumentId: string | null;
    targetLabel: string;
    action: string;
    reason: string;
};

export type ImpactScopeReport = {
    workspaceId: string;
    documentId: string;
    documentNumber: string | null;
    documentTitle: string | null;
    effectiveFrom: string | null;
    analyzedAt: string;
    maxDepth: number;
    summary: {
        riskLevel: ImpactRiskLevel;
        directDocumentCount: number;
        indirectDocumentCount: number;
        affectedProvisionCount: number;
        sanctionShiftCount: number;
        escalatedCount: number;
        reducedCount: number;
        addedOrRepealedCount: number;
        unresolvedCitationCount: number;
    };
    directImpacts: DirectImpactedDocument[];
    indirectImpacts: IndirectImpactedDocument[];
    affectedProvisions: ImpactedProvisionItem[];
    sanctionShifts: ImpactSanctionShift[];
    affectedSubjects: string[];
    unresolvedFrontier: UnresolvedCitationItem[];
    synchronizationChecklist: SynchronizationItem[];
    disclaimer: string;
};

export type WorkspaceDocumentAuditItem = {
    documentId: string;
    documentNumber: string | null;
    title: string | null;
    documentType: string | null;
    isManual: boolean;
    auditStatus: ReadinessStatus;
    score: number;
    errorCount: number;
    warningCount: number;
    infoCount: number;
    riskLevel: ImpactRiskLevel;
    directDocumentCount: number;
    indirectDocumentCount: number;
    sanctionShiftCount: number;
};

export type WorkspaceAuditOverview = {
    workspaceId: string;
    checkedAt: string;
    totalDocuments: number;
    totalErrors: number;
    totalWarnings: number;
    highRiskDocuments: number;
    documents: WorkspaceDocumentAuditItem[];
};

const VALID_SEVERITIES = new Set<AuditSeverity>(["ERROR", "WARNING", "INFO"]);
const VALID_CATEGORIES = new Set<AuditCategory>(["STRUCTURE", "TEMPORAL", "REFERENCE", "SANCTION_CONFLICT", "DRAFTING_TECHNIQUE"]);
const VALID_READINESS = new Set<ReadinessStatus>(["PASS", "WARNING", "FAIL"]);
const VALID_RISK = new Set<ImpactRiskLevel>(["LOW", "MEDIUM", "HIGH"]);

export function parseLogicAuditReport(body: unknown): LogicAuditReport {
    if (!isRecord(body)) {
        throw invalidResponse();
    }

    const documentId = readString(body, "documentId");
    const summaryRaw = body.summary;

    if (!documentId || !isRecord(summaryRaw)) {
        throw invalidResponse();
    }

    const statusRaw = readString(summaryRaw, "status");

    if (!statusRaw || !VALID_READINESS.has(statusRaw as ReadinessStatus)) {
        throw invalidResponse();
    }

    return {
        workspaceId: readString(body, "workspaceId") ?? "default",
        documentId,
        documentNumber: readString(body, "documentNumber"),
        documentTitle: readString(body, "documentTitle"),
        checkedAt: readString(body, "checkedAt") ?? "",
        summary: {
            status: statusRaw as ReadinessStatus,
            score: readNumber(summaryRaw, "score") ?? 0,
            total: readNumber(summaryRaw, "total") ?? 0,
            errorCount: readNumber(summaryRaw, "errorCount") ?? 0,
            warningCount: readNumber(summaryRaw, "warningCount") ?? 0,
            infoCount: readNumber(summaryRaw, "infoCount") ?? 0,
            checkedRules: readNumber(summaryRaw, "checkedRules") ?? 0,
        },
        findings: readRows(body, "findings", parseFindingRow),
        disclaimer: readString(body, "disclaimer") ?? "",
    };
}

function parseFindingRow(row: Record<string, unknown>): LogicAuditFinding | null {
    const id = readString(row, "id");
    const code = readString(row, "code");
    const categoryRaw = readString(row, "category");
    const severityRaw = readString(row, "severity");
    const title = readString(row, "title");
    const message = readString(row, "message");
    const suggestion = readString(row, "suggestion");

    if (
        !id ||
        !code ||
        !title ||
        !message ||
        !suggestion ||
        !categoryRaw ||
        !VALID_CATEGORIES.has(categoryRaw as AuditCategory) ||
        !severityRaw ||
        !VALID_SEVERITIES.has(severityRaw as AuditSeverity)
    ) {
        return null;
    }

    return {
        id,
        code,
        category: categoryRaw as AuditCategory,
        severity: severityRaw as AuditSeverity,
        title,
        message,
        provisionId: readString(row, "provisionId"),
        relatedDocumentId: readString(row, "relatedDocumentId"),
        relatedProvisionId: readString(row, "relatedProvisionId"),
        evidence: readString(row, "evidence"),
        suggestion,
    };
}

export function parseImpactScopeReport(body: unknown): ImpactScopeReport {
    if (!isRecord(body)) {
        throw invalidResponse();
    }

    const documentId = readString(body, "documentId");
    const summaryRaw = body.summary;

    if (!documentId || !isRecord(summaryRaw)) {
        throw invalidResponse();
    }

    const riskRaw = readString(summaryRaw, "riskLevel");

    if (!riskRaw || !VALID_RISK.has(riskRaw as ImpactRiskLevel)) {
        throw invalidResponse();
    }

    return {
        workspaceId: readString(body, "workspaceId") ?? "default",
        documentId,
        documentNumber: readString(body, "documentNumber"),
        documentTitle: readString(body, "documentTitle"),
        effectiveFrom: readString(body, "effectiveFrom"),
        analyzedAt: readString(body, "analyzedAt") ?? "",
        maxDepth: readNumber(body, "maxDepth") ?? 3,
        summary: {
            riskLevel: riskRaw as ImpactRiskLevel,
            directDocumentCount: readNumber(summaryRaw, "directDocumentCount") ?? 0,
            indirectDocumentCount: readNumber(summaryRaw, "indirectDocumentCount") ?? 0,
            affectedProvisionCount: readNumber(summaryRaw, "affectedProvisionCount") ?? 0,
            sanctionShiftCount: readNumber(summaryRaw, "sanctionShiftCount") ?? 0,
            escalatedCount: readNumber(summaryRaw, "escalatedCount") ?? 0,
            reducedCount: readNumber(summaryRaw, "reducedCount") ?? 0,
            addedOrRepealedCount: readNumber(summaryRaw, "addedOrRepealedCount") ?? 0,
            unresolvedCitationCount: readNumber(summaryRaw, "unresolvedCitationCount") ?? 0,
        },
        directImpacts: readRows(body, "directImpacts", parseDirectImpactRow),
        indirectImpacts: readRows(body, "indirectImpacts", parseIndirectImpactRow),
        affectedProvisions: readRows(body, "affectedProvisions", parseImpactedProvisionRow),
        sanctionShifts: readRows(body, "sanctionShifts", parseSanctionShiftRow),
        affectedSubjects: readStringList(body, "affectedSubjects"),
        unresolvedFrontier: readRows(body, "unresolvedFrontier", parseFrontierRow),
        synchronizationChecklist: readRows(body, "synchronizationChecklist", parseSyncRow),
        disclaimer: readString(body, "disclaimer") ?? "",
    };
}

function parseDirectImpactRow(row: Record<string, unknown>): DirectImpactedDocument | null {
    const documentId = readString(row, "documentId");
    const relationType = readString(row, "relationType");

    if (!documentId || !relationType) {
        return null;
    }

    return {
        documentId,
        documentNumber: readString(row, "documentNumber"),
        title: readString(row, "title"),
        documentType: readString(row, "documentType"),
        relationType,
        scope: readString(row, "scope") ?? "PARTIAL",
        sourceMode: readString(row, "sourceMode") === "MANUAL" ? "MANUAL" : "AI",
        note: readString(row, "note"),
        affectedProvisionCount: readNumber(row, "affectedProvisionCount") ?? 0,
    };
}

function parseIndirectImpactRow(row: Record<string, unknown>): IndirectImpactedDocument | null {
    const documentId = readString(row, "documentId");
    const viaDocumentId = readString(row, "viaDocumentId");
    const viaRelationType = readString(row, "viaRelationType");
    const reason = readString(row, "reason");

    if (!documentId || !viaDocumentId || !viaRelationType || !reason) {
        return null;
    }

    return {
        documentId,
        documentNumber: readString(row, "documentNumber"),
        title: readString(row, "title"),
        documentType: readString(row, "documentType"),
        depth: readNumber(row, "depth") ?? 2,
        viaDocumentId,
        viaRelationType,
        impactPath: readStringList(row, "impactPath"),
        reason,
    };
}

function parseImpactedProvisionRow(row: Record<string, unknown>): ImpactedProvisionItem | null {
    const relationId = readString(row, "relationId");
    const fromProvisionId = readString(row, "fromProvisionId");
    const fromProvisionLabel = readString(row, "fromProvisionLabel");
    const toDocumentId = readString(row, "toDocumentId");
    const toDocumentLabel = readString(row, "toDocumentLabel");
    const relationType = readString(row, "relationType");

    if (!relationId || !fromProvisionId || !fromProvisionLabel || !toDocumentId || !toDocumentLabel || !relationType) {
        return null;
    }

    return {
        relationId,
        fromProvisionId,
        fromProvisionLabel,
        toDocumentId,
        toDocumentLabel,
        toProvisionId: readString(row, "toProvisionId"),
        toProvisionLabel: readString(row, "toProvisionLabel"),
        relationType,
        evidenceText: readString(row, "evidenceText") ?? "",
        effectiveFrom: readString(row, "effectiveFrom"),
        sourceMode: readString(row, "sourceMode") === "MANUAL" ? "MANUAL" : "AI",
    };
}

function parseSanctionShiftRow(row: Record<string, unknown>): ImpactSanctionShift | null {
    const id = readString(row, "id");
    const fromDocumentId = readString(row, "fromDocumentId");
    const toDocumentId = readString(row, "toDocumentId");
    const behaviorSummary = readString(row, "behaviorSummary");
    const changeType = readString(row, "changeType");

    if (!id || !fromDocumentId || !toDocumentId || !behaviorSummary || !changeType) {
        return null;
    }

    return {
        id,
        fromDocumentId,
        toDocumentId,
        fromProvisionId: readString(row, "fromProvisionId"),
        toProvisionId: readString(row, "toProvisionId"),
        behaviorSummary,
        changeType,
        oldPenaltyText: readString(row, "oldPenaltyText"),
        newPenaltyText: readString(row, "newPenaltyText"),
        severityDeltaPercent: readNumber(row, "severityDeltaPercent"),
        note: readString(row, "note"),
        sourceMode: readString(row, "sourceMode") === "MANUAL" ? "MANUAL" : "AI",
    };
}

function parseFrontierRow(row: Record<string, unknown>): UnresolvedCitationItem | null {
    const citation = readString(row, "citation");
    const provisionId = readString(row, "provisionId");
    const provisionLabel = readString(row, "provisionLabel");

    if (!citation || !provisionId || !provisionLabel) {
        return null;
    }

    return { citation, provisionId, provisionLabel };
}

function parseSyncRow(row: Record<string, unknown>): SynchronizationItem | null {
    const priorityRaw = readString(row, "priority");
    const targetLabel = readString(row, "targetLabel");
    const action = readString(row, "action");
    const reason = readString(row, "reason");

    if (!targetLabel || !action || !reason || (priorityRaw !== "HIGH" && priorityRaw !== "MEDIUM" && priorityRaw !== "LOW")) {
        return null;
    }

    return {
        priority: priorityRaw,
        targetDocumentId: readString(row, "targetDocumentId"),
        targetLabel,
        action,
        reason,
    };
}

export function parseWorkspaceAuditOverview(body: unknown): WorkspaceAuditOverview {
    if (!isRecord(body) || !Array.isArray(body.documents)) {
        throw invalidResponse();
    }

    return {
        workspaceId: readString(body, "workspaceId") ?? "default",
        checkedAt: readString(body, "checkedAt") ?? "",
        totalDocuments: readNumber(body, "totalDocuments") ?? 0,
        totalErrors: readNumber(body, "totalErrors") ?? 0,
        totalWarnings: readNumber(body, "totalWarnings") ?? 0,
        highRiskDocuments: readNumber(body, "highRiskDocuments") ?? 0,
        documents: readRows(body, "documents", parseWorkspaceDocItem),
    };
}

function parseWorkspaceDocItem(row: Record<string, unknown>): WorkspaceDocumentAuditItem | null {
    const documentId = readString(row, "documentId");
    const statusRaw = readString(row, "auditStatus");
    const riskRaw = readString(row, "riskLevel");

    if (
        !documentId ||
        !statusRaw ||
        !VALID_READINESS.has(statusRaw as ReadinessStatus) ||
        !riskRaw ||
        !VALID_RISK.has(riskRaw as ImpactRiskLevel)
    ) {
        return null;
    }

    return {
        documentId,
        documentNumber: readString(row, "documentNumber"),
        title: readString(row, "title"),
        documentType: readString(row, "documentType"),
        isManual: row.isManual === true,
        auditStatus: statusRaw as ReadinessStatus,
        score: readNumber(row, "score") ?? 0,
        errorCount: readNumber(row, "errorCount") ?? 0,
        warningCount: readNumber(row, "warningCount") ?? 0,
        infoCount: readNumber(row, "infoCount") ?? 0,
        riskLevel: riskRaw as ImpactRiskLevel,
        directDocumentCount: readNumber(row, "directDocumentCount") ?? 0,
        indirectDocumentCount: readNumber(row, "indirectDocumentCount") ?? 0,
        sanctionShiftCount: readNumber(row, "sanctionShiftCount") ?? 0,
    };
}
