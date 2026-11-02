import { isRecord, readRows, readString } from "./read";

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

/** An accepted document-level edge; the backend never returns unverified candidates here. */
export type GraphDocumentRelation = {
    id: string;
    fromDocumentId: string;
    toDocumentId: string;
    relationType: string;
    scope: string;
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
};

export type RelationGraph = {
    documents: GraphDocument[];
    provisions: GraphProvision[];
    documentRelations: GraphDocumentRelation[];
    provisionRelations: GraphProvisionRelation[];
    truncated: boolean;
    disclaimer: string;
};

export function parseRelationGraph(value: unknown): RelationGraph | null {
    if (!isRecord(value) || !Array.isArray(value.documents)) {
        return null;
    }

    return {
        documents: readRows(value, "documents", parseDocument),
        provisions: readRows(value, "provisions", parseProvision),
        documentRelations: readRows(value, "documentRelations", parseDocumentRelation),
        provisionRelations: readRows(value, "provisionRelations", parseProvisionRelation),
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

    return { id, fromDocumentId, toDocumentId, relationType, scope: readString(row, "scope") ?? "UNKNOWN" };
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
    };
}
