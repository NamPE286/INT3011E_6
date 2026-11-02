import type { GraphDocument, GraphDocumentRelation, GraphProvision, GraphProvisionRelation, RelationGraph } from "./api/graph";

export type GraphLevel = "ALL" | "DOCUMENT" | "PROVISION";

export type GraphFilters = {
    hiddenRelationTypes: ReadonlySet<string>;
    includeCandidates: boolean;
    level: GraphLevel;
    focusDocumentId: string | null;
    search: string;
};

export const DEFAULT_GRAPH_FILTERS: GraphFilters = {
    hiddenRelationTypes: new Set(),
    includeCandidates: true,
    level: "ALL",
    focusDocumentId: null,
    search: "",
};

export type VisibleGraph = {
    documents: GraphDocument[];
    provisions: GraphProvision[];
    documentRelations: GraphDocumentRelation[];
    provisionRelations: GraphProvisionRelation[];
};

type Edge = { fromDocumentId: string; toDocumentId: string };

/**
 * The part of the graph the filters keep. With a focus document or a search, only edges touching the
 * matched documents stay, and the documents on their other end are shown with them.
 */
export function filterGraph(graph: RelationGraph, filters: GraphFilters): VisibleGraph {
    const isShownType = (relationType: string) => !filters.hiddenRelationTypes.has(relationType);

    let documentRelations = filters.level === "PROVISION" ? [] : graph.documentRelations.filter((relation) => isShownType(relation.relationType));
    let provisionRelations =
        filters.level === "DOCUMENT"
            ? []
            : graph.provisionRelations.filter(
                  (relation) => isShownType(relation.relationType) && (filters.includeCandidates || relation.verificationStatus === "ACCEPTED"),
              );

    const seeds = seedDocumentIds(graph.documents, filters);
    let shownDocumentIds = new Set(graph.documents.map((document) => document.id));

    if (seeds !== null) {
        const touchesSeed = (edge: Edge) => seeds.has(edge.fromDocumentId) || seeds.has(edge.toDocumentId);

        documentRelations = documentRelations.filter(touchesSeed);
        provisionRelations = provisionRelations.filter(touchesSeed);
        shownDocumentIds = new Set(seeds);

        for (const edge of [...documentRelations, ...provisionRelations]) {
            shownDocumentIds.add(edge.fromDocumentId);
            shownDocumentIds.add(edge.toDocumentId);
        }
    }

    const endpointIds = new Set(provisionRelations.flatMap((relation) => [relation.fromProvisionId, relation.toProvisionId]));

    return {
        documents: graph.documents.filter((document) => shownDocumentIds.has(document.id)),
        provisions: graph.provisions.filter((provision) => endpointIds.has(provision.id)),
        documentRelations,
        provisionRelations,
    };
}

/** Null when neither a focus nor a search narrows the graph. */
function seedDocumentIds(documents: GraphDocument[], filters: GraphFilters): Set<string> | null {
    const search = foldDiacritics(filters.search.trim());

    if (!filters.focusDocumentId && !search) {
        return null;
    }

    const seeds = new Set<string>();

    if (filters.focusDocumentId) {
        seeds.add(filters.focusDocumentId);
    }

    if (search) {
        for (const document of documents) {
            const haystack = foldDiacritics(`${document.documentNumber ?? ""} ${document.title ?? ""}`);

            if (haystack.includes(search)) {
                seeds.add(document.id);
            }
        }
    }

    return seeds;
}

function foldDiacritics(text: string): string {
    return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}

/** Every relation type present, so the filter only offers types that would change something. */
export function relationTypesOf(graph: RelationGraph): string[] {
    const types = new Set([...graph.documentRelations, ...graph.provisionRelations].map((relation) => relation.relationType));

    return [...types].sort();
}

/** "Điểm b khoản 1 Điều 2", "Khoản 1 Điều 3", "Điều 3", as legal text cites a provision. */
export function provisionPathLabel(provision: Pick<GraphProvision, "level" | "articleNo" | "paragraphNo" | "pointNo">): string {
    const parts: string[] = [];

    if (provision.pointNo) {
        parts.push(`điểm ${provision.pointNo}`);
    }

    if (provision.paragraphNo) {
        parts.push(`khoản ${provision.paragraphNo}`);
    }

    if (provision.articleNo) {
        parts.push(`Điều ${provision.articleNo}`);
    }

    if (parts.length === 0) {
        return provision.level;
    }

    const label = parts.join(" ");

    return label.charAt(0).toUpperCase() + label.slice(1);
}

export type NodeBox = {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
};

export type LayoutEdge = {
    id: string;
    kind: "DOCUMENT" | "PROVISION";
    relationType: string;
    isCandidate: boolean;
    fromNodeId: string;
    toNodeId: string;
    path: string;
};

export type GraphLayout = {
    width: number;
    height: number;
    documents: NodeBox[];
    provisions: NodeBox[];
    edges: LayoutEdge[];
};

const MARGIN = 24;
const COLUMN_WIDTH = 220;
const COLUMN_GAP = 96;
const DOCUMENT_HEIGHT = 64;
const PROVISION_HEIGHT = 40;
const PROVISION_GAP = 12;
const PROVISION_TOP_GAP = 28;
const ARC_BASE_HEIGHT = 28;
const ARC_STEP = 14;
const SAME_COLUMN_BULGE = 56;

/**
 * Time-ordered columns: one per document (oldest left), its provisions stacked below it. Document edges
 * arc above the headers, provision edges curve between the provision boxes.
 */
export function layoutGraph(visible: VisibleGraph): GraphLayout {
    const documents = [...visible.documents].sort(compareIssued);
    const arcHeights = documentArcHeights(visible.documentRelations);
    const topSpace = Math.max(0, ...arcHeights.values()) + MARGIN;
    const documentBoxes = documents.map((document, index) => ({
        id: document.id,
        x: MARGIN + index * (COLUMN_WIDTH + COLUMN_GAP),
        y: topSpace,
        width: COLUMN_WIDTH,
        height: DOCUMENT_HEIGHT,
    }));
    const documentBoxById = new Map(documentBoxes.map((box) => [box.id, box]));
    const provisionBoxes = stackProvisions(visible.provisions, documentBoxById);
    const provisionBoxById = new Map(provisionBoxes.map((box) => [box.id, box]));

    const edges: LayoutEdge[] = [];

    for (const relation of visible.documentRelations) {
        const from = documentBoxById.get(relation.fromDocumentId);
        const to = documentBoxById.get(relation.toDocumentId);

        if (!from || !to) {
            continue;
        }

        edges.push({
            id: relation.id,
            kind: "DOCUMENT",
            relationType: relation.relationType,
            isCandidate: false,
            fromNodeId: from.id,
            toNodeId: to.id,
            path: arcPath(from, to, arcHeights.get(relation.id) ?? ARC_BASE_HEIGHT),
        });
    }

    for (const relation of visible.provisionRelations) {
        const from = provisionBoxById.get(relation.fromProvisionId);
        const to = (relation.toProvisionId ? provisionBoxById.get(relation.toProvisionId) : undefined) ?? documentBoxById.get(relation.toDocumentId);

        if (!from || !to) {
            continue;
        }

        edges.push({
            id: relation.id,
            kind: "PROVISION",
            relationType: relation.relationType,
            isCandidate: relation.verificationStatus === "CANDIDATE",
            fromNodeId: from.id,
            toNodeId: to.id,
            path: curvePath(from, to),
        });
    }

    const allBoxes = [...documentBoxes, ...provisionBoxes];

    return {
        width: Math.max(0, ...allBoxes.map((box) => box.x + box.width)) + MARGIN,
        height: Math.max(0, ...allBoxes.map((box) => box.y + box.height)) + MARGIN,
        documents: documentBoxes,
        provisions: provisionBoxes,
        edges,
    };
}

function compareIssued(left: GraphDocument, right: GraphDocument): number {
    if (left.issuedAt === right.issuedAt) {
        return 0;
    }

    if (left.issuedAt === null) {
        return 1;
    }

    if (right.issuedAt === null) {
        return -1;
    }

    return left.issuedAt < right.issuedAt ? -1 : 1;
}

/** Edges between the same two documents get taller arcs so parallel edges do not overlap. */
function documentArcHeights(relations: GraphDocumentRelation[]): Map<string, number> {
    const seenPerPair = new Map<string, number>();
    const heights = new Map<string, number>();

    for (const relation of relations) {
        const pair = [relation.fromDocumentId, relation.toDocumentId].sort().join("|");
        const index = seenPerPair.get(pair) ?? 0;

        seenPerPair.set(pair, index + 1);
        heights.set(relation.id, ARC_BASE_HEIGHT + index * ARC_STEP);
    }

    return heights;
}

function stackProvisions(provisions: GraphProvision[], documentBoxById: Map<string, NodeBox>): NodeBox[] {
    const rowsPerDocument = new Map<string, number>();
    const boxes: NodeBox[] = [];

    for (const provision of provisions) {
        const column = documentBoxById.get(provision.documentId);

        if (!column) {
            continue;
        }

        const row = rowsPerDocument.get(provision.documentId) ?? 0;

        rowsPerDocument.set(provision.documentId, row + 1);
        boxes.push({
            id: provision.id,
            x: column.x,
            y: column.y + column.height + PROVISION_TOP_GAP + row * (PROVISION_HEIGHT + PROVISION_GAP),
            width: COLUMN_WIDTH,
            height: PROVISION_HEIGHT,
        });
    }

    return boxes;
}

function arcPath(from: NodeBox, to: NodeBox, height: number): string {
    const startX = from.x + from.width / 2;
    const endX = to.x + to.width / 2;
    const y = from.y;

    if (from.id === to.id) {
        return `M ${startX - 24} ${y} C ${startX - 24} ${y - height}, ${startX + 24} ${y - height}, ${startX + 24} ${y}`;
    }

    // A quadratic curve peaks at half its control height, hence the doubling.
    return `M ${startX} ${y} Q ${(startX + endX) / 2} ${y - height * 2} ${endX} ${y}`;
}

function curvePath(from: NodeBox, to: NodeBox): string {
    const fromMiddle = from.y + from.height / 2;
    const toMiddle = to.y + to.height / 2;

    if (from.x === to.x) {
        const x = from.x + from.width;

        return `M ${x} ${fromMiddle} C ${x + SAME_COLUMN_BULGE} ${fromMiddle}, ${x + SAME_COLUMN_BULGE} ${toMiddle}, ${x} ${toMiddle}`;
    }

    const goesLeft = to.x < from.x;
    const startX = goesLeft ? from.x : from.x + from.width;
    const endX = goesLeft ? to.x + to.width : to.x;
    const bend = (endX - startX) / 2;

    return `M ${startX} ${fromMiddle} C ${startX + bend} ${fromMiddle}, ${endX - bend} ${toMiddle}, ${endX} ${toMiddle}`;
}
