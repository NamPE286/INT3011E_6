import { isRecord, readNumber, readRows, readString } from "./read";

export type GraphSourceMode = "AI" | "MANUAL";

export type GraphDocument = {
    id: string;
    title: string | null;
    documentNumber: string | null;
    documentType: string | null;
    issuedAt: string | null;
    effectiveFrom: string | null;
    isManual?: boolean;
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

/** An accepted document-level edge; the backend never returns unverified candidates here. */
export type GraphDocumentRelation = {
    id: string;
    fromDocumentId: string;
    toDocumentId: string;
    relationType: string;
    scope: string;
    sourceMode?: GraphSourceMode;
    note?: string | null;
};

export type ProvisionVerification = "ACCEPTED" | "CANDIDATE";

export type GraphProvisionRelation = {
    id: string;
    fromDocumentId: string;
    fromProvisionId: string;
    toDocumentId: string;
    /** Null when the change targets the document as a whole (an inserted Điều with no enclosing unit). */
    toProvisionId: string | null;
    relationType: string;
    verificationStatus: ProvisionVerification;
    evidenceText: string;
    effectiveFrom: string | null;
    sourceMode?: GraphSourceMode;
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
    workspaceId?: string;
    documents: GraphDocument[];
    provisions: GraphProvision[];
    documentRelations: GraphDocumentRelation[];
    provisionRelations: GraphProvisionRelation[];
    sanctionChangeEdges?: GraphSanctionChangeEdge[];
    truncated: boolean;
    disclaimer: string;
};

export function parseRelationGraph(value: unknown): RelationGraph | null {
    if (!isRecord(value) || !Array.isArray(value.documents)) {
        return null;
    }

    return {
        workspaceId: readString(value, "workspaceId") ?? undefined,
        documents: readRows(value, "documents", parseDocument),
        provisions: readRows(value, "provisions", parseProvision),
        documentRelations: readRows(value, "documentRelations", parseDocumentRelation),
        provisionRelations: readRows(value, "provisionRelations", parseProvisionRelation),
        sanctionChangeEdges: readRows(value, "sanctionChangeEdges", parseSanctionChangeEdge),
        truncated: value.truncated === true,
        disclaimer: readString(value, "disclaimer") ?? "",
    };
}

function parseDocument(row: Record<string, unknown>): GraphDocument | null {
    const id = readString(row, "id");

    if (!id) {
        return null;
    }

    return {
        id,
        title: readString(row, "title"),
        documentNumber: readString(row, "documentNumber"),
        documentType: readString(row, "documentType"),
        issuedAt: readString(row, "issuedAt"),
        effectiveFrom: readString(row, "effectiveFrom"),
        isManual: row.isManual === true,
    };
}

function parseProvision(row: Record<string, unknown>): GraphProvision | null {
    const id = readString(row, "id");
    const documentId = readString(row, "documentId");
    const level = readString(row, "level");

    if (!id || !documentId || !level) {
        return null;
    }

    return {
        id,
        documentId,
        level,
        articleNo: readString(row, "articleNo"),
        paragraphNo: readString(row, "paragraphNo"),
        pointNo: readString(row, "pointNo"),
        title: readString(row, "title"),
        textPreview: readString(row, "textPreview"),
    };
}

function parseDocumentRelation(row: Record<string, unknown>): GraphDocumentRelation | null {
    const id = readString(row, "id");
    const fromDocumentId = readString(row, "fromDocumentId");
    const toDocumentId = readString(row, "toDocumentId");
    const relationType = readString(row, "relationType");

    if (!id || !fromDocumentId || !toDocumentId || !relationType || readString(row, "verificationStatus") !== "ACCEPTED") {
        return null;
    }

    return {
        id,
        fromDocumentId,
        toDocumentId,
        relationType,
        scope: readString(row, "scope") ?? "UNKNOWN",
        sourceMode: readString(row, "sourceMode") === "MANUAL" ? "MANUAL" : "AI",
        note: readString(row, "note"),
    };
}

function parseProvisionRelation(row: Record<string, unknown>): GraphProvisionRelation | null {
    const id = readString(row, "id");
    const fromDocumentId = readString(row, "fromDocumentId");
    const fromProvisionId = readString(row, "fromProvisionId");
    const toDocumentId = readString(row, "toDocumentId");
    const relationType = readString(row, "relationType");
    const verificationStatus = readString(row, "verificationStatus");

    if (!id || !fromDocumentId || !fromProvisionId || !toDocumentId || !relationType) {
        return null;
    }

    if (verificationStatus !== "ACCEPTED" && verificationStatus !== "CANDIDATE") {
        return null;
    }

    return {
        id,
        fromDocumentId,
        fromProvisionId,
        toDocumentId,
        toProvisionId: readString(row, "toProvisionId"),
        relationType,
        verificationStatus,
        evidenceText: readString(row, "evidenceText") ?? "",
        effectiveFrom: readString(row, "effectiveFrom"),
        sourceMode: readString(row, "sourceMode") === "MANUAL" ? "MANUAL" : "AI",
    };
}

function parseSanctionChangeEdge(row: Record<string, unknown>): GraphSanctionChangeEdge | null {
    const id = readString(row, "id");
    const fromDocumentId = readString(row, "fromDocumentId");
    const toDocumentId = readString(row, "toDocumentId");
    const behaviorSummary = readString(row, "behaviorSummary");
    const changeType = readString(row, "changeType");

    if (!id || !fromDocumentId || !toDocumentId || !behaviorSummary || !changeType) {
        return null;
    }

    const changeTypes = Array.isArray(row.changeTypes)
        ? row.changeTypes.filter((item): item is string => typeof item === "string")
        : [changeType];

    return {
        id,
        fromDocumentId,
        toDocumentId,
        fromProvisionId: readString(row, "fromProvisionId"),
        toProvisionId: readString(row, "toProvisionId"),
        behaviorSummary,
        changeType,
        changeTypes,
        oldPenaltyText: readString(row, "oldPenaltyText"),
        newPenaltyText: readString(row, "newPenaltyText"),
        oldFineMin: readNumber(row, "oldFineMin"),
        oldFineMax: readNumber(row, "oldFineMax"),
        newFineMin: readNumber(row, "newFineMin"),
        newFineMax: readNumber(row, "newFineMax"),
        severityDeltaPercent: readNumber(row, "severityDeltaPercent"),
        note: readString(row, "note"),
        sourceMode: readString(row, "sourceMode") === "MANUAL" ? "MANUAL" : "AI",
    };
}
