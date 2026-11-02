import { describe, expect, test } from "bun:test";
import type { RelationGraph } from "./api/graph";
import { DEFAULT_GRAPH_FILTERS, filterGraph, layoutGraph, provisionPathLabel, relationTypesOf, type GraphFilters } from "./graph-view";

/** Base decree A (2030), amendment B (2032) acting on A, unrelated decree C (2031). */
const GRAPH: RelationGraph = {
    documents: [
        { id: "A", title: "Quy định xử phạt", documentNumber: "01/2030/NĐ-CP", documentType: "Nghị định", issuedAt: "2030-11-15", effectiveFrom: null },
        { id: "C", title: "Văn bản khác", documentNumber: "05/2031/TT-BCA", documentType: "Thông tư", issuedAt: "2031-01-01", effectiveFrom: null },
        { id: "B", title: "Sửa đổi 01/2030", documentNumber: "02/2032/NĐ-CP", documentType: "Nghị định", issuedAt: "2032-12-10", effectiveFrom: null },
    ],
    provisions: [
        { id: "A:2.1.b", documentId: "A", level: "POINT", articleNo: "2", paragraphNo: "1", pointNo: "b", title: null, textPreview: "đèn chiếu sáng" },
        { id: "A:3.1", documentId: "A", level: "CLAUSE", articleNo: "3", paragraphNo: "1", pointNo: null, title: null, textPreview: "mũ bảo hiểm" },
        { id: "B:1.2", documentId: "B", level: "CLAUSE", articleNo: "1", paragraphNo: "2", pointNo: null, title: null, textPreview: "Bãi bỏ" },
        { id: "B:1.3", documentId: "B", level: "CLAUSE", articleNo: "1", paragraphNo: "3", pointNo: null, title: null, textPreview: "Sửa đổi" },
    ],
    documentRelations: [
        { id: "B-A-AMENDS", fromDocumentId: "B", toDocumentId: "A", relationType: "AMENDS", scope: "PARTIAL" },
        { id: "B-A-REPEALS", fromDocumentId: "B", toDocumentId: "A", relationType: "PARTIALLY_REPEALS", scope: "PARTIAL" },
    ],
    provisionRelations: [
        {
            id: "repeal",
            fromDocumentId: "B",
            fromProvisionId: "B:1.2",
            toDocumentId: "A",
            toProvisionId: "A:2.1.b",
            relationType: "REPEALS",
            verificationStatus: "ACCEPTED",
            evidenceText: "Bãi bỏ điểm b khoản 1 Điều 2.",
            effectiveFrom: "2033-01-01",
        },
        {
            id: "amend",
            fromDocumentId: "B",
            fromProvisionId: "B:1.3",
            toDocumentId: "A",
            toProvisionId: "A:3.1",
            relationType: "AMENDS",
            verificationStatus: "CANDIDATE",
            evidenceText: "Sửa đổi khoản 1 Điều 3",
            effectiveFrom: null,
        },
    ],
    truncated: false,
    disclaimer: "",
};

function filters(overrides: Partial<GraphFilters>): GraphFilters {
    return { ...DEFAULT_GRAPH_FILTERS, ...overrides };
}

describe("filterGraph", () => {
    test("shows every document and edge by default", () => {
        const visible = filterGraph(GRAPH, DEFAULT_GRAPH_FILTERS);

        expect(visible.documents.map((document) => document.id)).toEqual(["A", "C", "B"]);
        expect(visible.documentRelations).toHaveLength(2);
        expect(visible.provisionRelations.map((relation) => relation.id)).toEqual(["repeal", "amend"]);
        expect(visible.provisions.map((provision) => provision.id)).toEqual(["A:2.1.b", "A:3.1", "B:1.2", "B:1.3"]);
    });

    test("keeps only the chosen relation types, and only provisions that still have an edge", () => {
        const visible = filterGraph(GRAPH, filters({ hiddenRelationTypes: new Set(["AMENDS"]) }));

        expect(visible.documentRelations.map((relation) => relation.relationType)).toEqual(["PARTIALLY_REPEALS"]);
        expect(visible.provisionRelations.map((relation) => relation.id)).toEqual(["repeal"]);
        expect(visible.provisions.map((provision) => provision.id)).toEqual(["A:2.1.b", "B:1.2"]);
    });

    test("hides candidate provision edges when only verified edges are wanted", () => {
        const visible = filterGraph(GRAPH, filters({ includeCandidates: false }));

        expect(visible.provisionRelations.map((relation) => relation.id)).toEqual(["repeal"]);
    });

    test("shows document edges only at document level", () => {
        const visible = filterGraph(GRAPH, filters({ level: "DOCUMENT" }));

        expect(visible.provisionRelations).toEqual([]);
        expect(visible.provisions).toEqual([]);
        expect(visible.documentRelations).toHaveLength(2);
    });

    test("shows provision edges only at provision level", () => {
        const visible = filterGraph(GRAPH, filters({ level: "PROVISION" }));

        expect(visible.documentRelations).toEqual([]);
        expect(visible.provisionRelations).toHaveLength(2);
    });

    test("narrows to the focused document and the documents it is directly related to", () => {
        const visible = filterGraph(GRAPH, filters({ focusDocumentId: "A" }));

        expect(visible.documents.map((document) => document.id)).toEqual(["A", "B"]);
    });

    test("keeps a focused document without relations on screen", () => {
        const visible = filterGraph(GRAPH, filters({ focusDocumentId: "C" }));

        expect(visible.documents.map((document) => document.id)).toEqual(["C"]);
        expect(visible.documentRelations).toEqual([]);
        expect(visible.provisionRelations).toEqual([]);
    });

    test("searches number and title without diacritics and shows the matches with their neighbours", () => {
        const visible = filterGraph(GRAPH, filters({ search: "sua doi" }));

        expect(visible.documents.map((document) => document.id)).toEqual(["A", "B"]);
    });

    test("shows nothing when the search matches no document", () => {
        const visible = filterGraph(GRAPH, filters({ search: "không có" }));

        expect(visible.documents).toEqual([]);
        expect(visible.provisionRelations).toEqual([]);
    });
});

describe("relationTypesOf", () => {
    test("lists each relation type once, document and provision types together", () => {
        expect(relationTypesOf(GRAPH)).toEqual(["AMENDS", "PARTIALLY_REPEALS", "REPEALS"]);
    });
});

describe("provisionPathLabel", () => {
    test("names a point, a clause and an article the way legal text cites them", () => {
        const [point, clause] = GRAPH.provisions;

        expect(provisionPathLabel(point)).toBe("Điểm b khoản 1 Điều 2");
        expect(provisionPathLabel(clause)).toBe("Khoản 1 Điều 3");
        expect(provisionPathLabel({ ...clause, level: "ARTICLE", paragraphNo: null })).toBe("Điều 3");
    });
});

describe("layoutGraph", () => {
    test("places documents in columns in time order and provisions under their document", () => {
        const layout = layoutGraph(filterGraph(GRAPH, DEFAULT_GRAPH_FILTERS));
        const columnOf = new Map(layout.documents.map((box) => [box.id, box.x]));
        const repealed = layout.provisions.find((box) => box.id === "A:2.1.b")!;
        const documentA = layout.documents.find((box) => box.id === "A")!;

        expect(columnOf.get("A")! < columnOf.get("C")!).toBe(true);
        expect(columnOf.get("C")! < columnOf.get("B")!).toBe(true);
        expect(repealed.x).toBe(documentA.x);
        expect(repealed.y).toBeGreaterThan(documentA.y + documentA.height);
    });

    test("draws one path per visible edge and sizes the canvas to hold every box", () => {
        const layout = layoutGraph(filterGraph(GRAPH, DEFAULT_GRAPH_FILTERS));
        const boxes = [...layout.documents, ...layout.provisions];

        expect(layout.edges).toHaveLength(4);
        expect(layout.edges.every((edge) => edge.path.startsWith("M"))).toBe(true);
        expect(boxes.every((box) => box.x + box.width <= layout.width && box.y + box.height <= layout.height)).toBe(true);
    });

    test("points an edge without a target provision at the target document", () => {
        const graph = { ...GRAPH, provisionRelations: [{ ...GRAPH.provisionRelations[0], toProvisionId: null }] };
        const layout = layoutGraph(filterGraph(graph, filters({ level: "PROVISION" })));

        expect(layout.edges).toHaveLength(1);
        expect(layout.edges[0].toNodeId).toBe("A");
    });
});
