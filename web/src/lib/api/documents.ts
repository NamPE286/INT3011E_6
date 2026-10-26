import { isRecord, readNumber, readRows, readString, readStringList } from "./read";

export type DocumentListItem = {
    id: string;
    title: string | null;
    documentNumber: string | null;
    documentType: string | null;
    agency: string | null;
    issuedAt: string | null;
};

export type DocumentSearch = {
    documents: DocumentListItem[];
    disclaimer: string;
};

export type DocumentMetadata = {
    documentNumber: string | null;
    documentType: string | null;
    agency: string | null;
    issuedAt: string | null;
    effectiveFrom: string | null;
};

export type Provision = {
    id: string;
    parentId: string | null;
    ordinal: number;
    level: string;
    number: string;
    title: string | null;
    text: string | null;
    pageStart: number | null;
    contentRole: string;
    containerProvisionId: string | null;
};

export const AMENDMENT_TYPES = ["AMENDS", "SUPPLEMENTS", "REPLACES", "REPEALS", "CORRECTS"] as const;

export type AmendmentType = (typeof AMENDMENT_TYPES)[number];

export type Amendment = {
    relationId: string;
    toProvisionId: string | null;
    relationType: AmendmentType;
    verificationStatus: "ACCEPTED" | "CANDIDATE";
    fromDocumentId: string;
    fromDocumentNumber: string | null;
    fromDocumentTitle: string | null;
    fromProvisionId: string;
    effectiveFrom: string | null;
    evidenceText: string;
};

export type DocumentView = {
    id: string;
    title: string | null;
    metadata: DocumentMetadata | null;
    provisions: Provision[];
    amendments: Amendment[];
    disclaimer: string;
};

export type ProvisionNode = {
    provision: Provision;
    children: ProvisionNode[];
};

export type RelationEvidence = {
    id: string;
    sourceProvisionId: string | null;
    quotedText: string;
    cue: string;
};

/** A verified (ACCEPTED) document-level relation. Unverified candidates are a separate type on purpose. */
export type RelationEdge = {
    id: string;
    direction: "OUTGOING" | "INCOMING";
    otherDocumentId: string;
    relationType: string;
    scope: string;
    evidence: RelationEvidence[];
};

/** An extracted reference that has not been verified as a legal relation. */
export type RelationCandidate = {
    id: string;
    rawTargetCitation: string;
    targetDocumentNumber: string | null;
    proposedRelationType: string;
    scope: string;
    status: string;
    resolutionReason: string;
    quotedText: string;
    sourceProvisionId: string | null;
};

export type DocumentRelations = {
    outgoing: RelationEdge[];
    incoming: RelationEdge[];
    candidates: RelationCandidate[];
    statusCounts: Record<string, number>;
    frontier: string[];
    disclaimer: string;
};

export function parseDocumentSearch(value: unknown): DocumentSearch | null {
    if (!isRecord(value) || !Array.isArray(value.documents)) {
        return null;
    }

    return {
        documents: readRows(value, "documents", parseListItem),
        disclaimer: readString(value, "disclaimer") ?? "",
    };
}

export function parseDocumentView(value: unknown): DocumentView | null {
    if (!isRecord(value) || !isRecord(value.document)) {
        return null;
    }

    const id = readString(value.document, "id");

    if (!id) {
        return null;
    }

    return {
        id,
        title: readString(value.document, "title"),
        metadata: isRecord(value.metadata) ? parseMetadata(value.metadata) : null,
        provisions: readRows(value, "provisions", parseProvision),
        amendments: readRows(value, "amendments", parseAmendment),
        disclaimer: readString(value, "disclaimer") ?? "",
    };
}

export function parseDocumentRelations(value: unknown): DocumentRelations | null {
    if (!isRecord(value) || !Array.isArray(value.outgoing) || !Array.isArray(value.incoming)) {
        return null;
    }

    const coverage = isRecord(value.coverage) ? value.coverage : {};

    return {
        outgoing: readRows(value, "outgoing", parseEdge),
        incoming: readRows(value, "incoming", parseEdge),
        candidates: readRows(value, "candidates", parseCandidate),
        statusCounts: readCounts(coverage.statusCounts),
        frontier: readStringList(coverage, "frontier"),
        disclaimer: readString(value, "disclaimer") ?? "",
    };
}

/** Nests provisions under their parent in reading order; a provision whose parent is missing stays visible at the top. */
export function buildProvisionTree(provisions: Provision[]): ProvisionNode[] {
    const ordered = [...provisions].sort((left, right) => left.ordinal - right.ordinal);
    const nodes = new Map(ordered.map((provision) => [provision.id, { provision, children: [] as ProvisionNode[] }]));
    const roots: ProvisionNode[] = [];

    for (const provision of ordered) {
        const node = nodes.get(provision.id);
        const parent = provision.parentId ? nodes.get(provision.parentId) : undefined;

        if (!node) {
            continue;
        }

        if (parent) {
            parent.children.push(node);
        } else {
            roots.push(node);
        }
    }

    return roots;
}

export function amendmentsByProvision(amendments: Amendment[]): Map<string, Amendment[]> {
    const grouped = new Map<string, Amendment[]>();

    for (const amendment of amendments) {
        if (amendment.toProvisionId === null) {
            continue;
        }

        grouped.set(amendment.toProvisionId, [...(grouped.get(amendment.toProvisionId) ?? []), amendment]);
    }

    return grouped;
}

function parseListItem(row: Record<string, unknown>): DocumentListItem | null {
    const id = readString(row, "id");

    if (!id) {
        return null;
    }

    return {
        id,
        title: readString(row, "title"),
        documentNumber: readString(row, "documentNumber"),
        documentType: readString(row, "documentType"),
        agency: readString(row, "agency"),
        issuedAt: readString(row, "issuedAt"),
    };
}

function parseMetadata(row: Record<string, unknown>): DocumentMetadata {
    return {
        documentNumber: readString(row, "documentNumber"),
        documentType: readString(row, "documentType"),
        agency: readString(row, "agency"),
        issuedAt: readString(row, "issuedAt"),
        effectiveFrom: readString(row, "effectiveFrom"),
    };
}

function parseProvision(row: Record<string, unknown>): Provision | null {
    const id = readString(row, "id");
    const ordinal = readNumber(row, "ordinal");
    const level = readString(row, "level");
    const number = readString(row, "number");

    if (!id || ordinal === null || !level || number === null) {
        return null;
    }

    return {
        id,
        parentId: readString(row, "parentId"),
        ordinal,
        level,
        number,
        title: readString(row, "title"),
        text: readString(row, "text"),
        pageStart: readNumber(row, "pageStart"),
        contentRole: readString(row, "contentRole") ?? "ORDINARY_TEXT",
        containerProvisionId: readString(row, "containerProvisionId"),
    };
}

function isAmendmentType(value: string | null): value is AmendmentType {
    return AMENDMENT_TYPES.some((type) => type === value);
}

function parseAmendment(row: Record<string, unknown>): Amendment | null {
    const relationId = readString(row, "relationId");
    const relationType = readString(row, "relationType");
    const status = readString(row, "verificationStatus");
    const fromDocumentId = readString(row, "fromDocumentId");
    const fromProvisionId = readString(row, "fromProvisionId");

    if (!relationId || !isAmendmentType(relationType) || (status !== "ACCEPTED" && status !== "CANDIDATE") || !fromDocumentId || !fromProvisionId) {
        return null;
    }

    return {
        relationId,
        toProvisionId: readString(row, "toProvisionId"),
        relationType,
        verificationStatus: status,
        fromDocumentId,
        fromDocumentNumber: readString(row, "fromDocumentNumber"),
        fromDocumentTitle: readString(row, "fromDocumentTitle"),
        fromProvisionId,
        effectiveFrom: readString(row, "effectiveFrom"),
        evidenceText: readString(row, "evidenceText") ?? "",
    };
}

function parseEdge(row: Record<string, unknown>): RelationEdge | null {
    const id = readString(row, "id");
    const direction = readString(row, "direction");
    const otherDocumentId = readString(row, "otherDocumentId");
    const relationType = readString(row, "relationType");

    if (!id || (direction !== "OUTGOING" && direction !== "INCOMING") || !otherDocumentId || !relationType) {
        return null;
    }

    return {
        id,
        direction,
        otherDocumentId,
        relationType,
        scope: readString(row, "scope") ?? "UNKNOWN",
        evidence: readRows(row, "evidence", parseEvidence),
    };
}

function parseEvidence(row: Record<string, unknown>): RelationEvidence | null {
    const id = readString(row, "id");
    const quotedText = readString(row, "quotedText");

    if (!id || quotedText === null) {
        return null;
    }

    return { id, sourceProvisionId: readString(row, "sourceProvisionId"), quotedText, cue: readString(row, "cue") ?? "" };
}

function parseCandidate(row: Record<string, unknown>): RelationCandidate | null {
    const id = readString(row, "id");
    const status = readString(row, "status");

    if (!id || !status) {
        return null;
    }

    return {
        id,
        rawTargetCitation: readString(row, "rawTargetCitation") ?? "",
        targetDocumentNumber: readString(row, "targetDocumentNumber"),
        proposedRelationType: readString(row, "proposedRelationType") ?? "UNKNOWN",
        scope: readString(row, "scope") ?? "UNKNOWN",
        status,
        resolutionReason: readString(row, "resolutionReason") ?? "",
        quotedText: readString(row, "quotedText") ?? "",
        sourceProvisionId: readString(row, "sourceProvisionId"),
    };
}

function readCounts(value: unknown): Record<string, number> {
    if (!isRecord(value)) {
        return {};
    }

    const counts: Record<string, number> = {};

    for (const [key, count] of Object.entries(value)) {
        if (typeof count === "number" && Number.isFinite(count)) {
            counts[key] = count;
        }
    }

    return counts;
}
