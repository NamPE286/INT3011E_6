export type AuditSeverity = "ERROR" | "WARNING" | "INFO";

export type AuditCategory =
    | "STRUCTURE"
    | "TEMPORAL"
    | "REFERENCE"
    | "SANCTION_CONFLICT"
    | "DRAFTING_TECHNIQUE";

export type LogicAuditCode =
    | "STRUCT_DUPLICATE_NUMBER"
    | "STRUCT_NUMBERING_GAP"
    | "STRUCT_INVALID_HIERARCHY"
    | "STRUCT_EMPTY_PROVISION"
    | "TEMP_EFFECTIVE_BEFORE_ISSUED"
    | "TEMP_AMEND_BEFORE_TARGET_EFFECTIVE"
    | "TEMP_SELF_RELATION"
    | "TEMP_RELATION_CYCLE"
    | "TEMP_AMEND_REPEALED_TARGET"
    | "REF_BROKEN_INTERNAL_CITATION"
    | "REF_UNRESOLVED_EXTERNAL_DOCUMENT"
    | "REF_UNLINKED_AMENDMENT_CLAUSE"
    | "SANC_INVERTED_FINE_RANGE"
    | "SANC_INVALID_POINT_DEDUCTION"
    | "SANC_IMPLICIT_NORM_CONFLICT"
    | "DRAFT_MISSING_EFFECTIVE_DATE";

export type ReadinessStatus = "PASS" | "WARNING" | "FAIL";

export type ImpactRiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type AnalysisDocument = {
    id: string;
    title: string | null;
    documentNumber: string | null;
    normalizedNumber: string | null;
    documentType: string | null;
    agency: string | null;
    issuedAt: string | null;
    effectiveFrom: string | null;
    isManual: boolean;
};

export type AnalysisProvision = {
    id: string;
    documentId: string;
    parentId: string | null;
    ordinal: number;
    level: string;
    number: string;
    title: string | null;
    text: string | null;
    articleNo: string | null;
    paragraphNo: string | null;
    pointNo: string | null;
};

export type AnalysisDocumentRelation = {
    id: string;
    fromDocumentId: string;
    toDocumentId: string;
    relationType: string;
    scope: string;
    verificationStatus: string;
    sourceMode: "AI" | "MANUAL";
    note: string | null;
};

export type AnalysisProvisionRelation = {
    id: string;
    fromDocumentId: string;
    fromProvisionId: string;
    toDocumentId: string;
    toProvisionId: string | null;
    relationType: string;
    verificationStatus: string;
    evidenceText: string;
    effectiveFrom: string | null;
    sourceMode: "AI" | "MANUAL";
};

export type AnalysisSanctionEdge = {
    id: string;
    fromDocumentId: string;
    toDocumentId: string;
    fromProvisionId: string | null;
    toProvisionId: string | null;
    behaviorSummary: string;
    changeType: string;
    oldPenaltyText: string | null;
    newPenaltyText: string | null;
    oldFineMin: number | null;
    oldFineMax: number | null;
    newFineMin: number | null;
    newFineMax: number | null;
    severityDeltaPercent: number | null;
    note: string | null;
    sourceMode: "AI" | "MANUAL";
};

export type WorkspaceAnalysisSnapshot = {
    workspaceId: string;
    documents: AnalysisDocument[];
    provisions: AnalysisProvision[];
    documentRelations: AnalysisDocumentRelation[];
    provisionRelations: AnalysisProvisionRelation[];
    sanctionEdges: AnalysisSanctionEdge[];
};

export type LogicAuditFinding = {
    id: string;
    code: LogicAuditCode;
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

export type LogicAuditSummary = {
    status: ReadinessStatus;
    score: number;
    total: number;
    errorCount: number;
    warningCount: number;
    infoCount: number;
    checkedRules: number;
};

export type LogicAuditReport = {
    workspaceId: string;
    documentId: string;
    documentNumber: string | null;
    documentTitle: string | null;
    checkedAt: string;
    summary: LogicAuditSummary;
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

export type ImpactScopeSummary = {
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

export type ImpactScopeReport = {
    workspaceId: string;
    documentId: string;
    documentNumber: string | null;
    documentTitle: string | null;
    effectiveFrom: string | null;
    analyzedAt: string;
    maxDepth: number;
    summary: ImpactScopeSummary;
    directImpacts: DirectImpactedDocument[];
    indirectImpacts: IndirectImpactedDocument[];
    affectedProvisions: ImpactedProvisionItem[];
    sanctionShifts: AnalysisSanctionEdge[];
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
