import { describe, expect, test } from "bun:test";
import {
    amendmentsByProvision,
    buildProvisionTree,
    parseDocumentRelations,
    parseDocumentSearch,
    parseDocumentView,
    type ProvisionNode,
} from "./documents";

function provision(id: string, ordinal: number, parentId: string | null, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id,
        parentId,
        ordinal,
        level: "ARTICLE",
        number: String(ordinal),
        title: null,
        text: `text ${id}`,
        pageStart: 1,
        pageEnd: 1,
        contentRole: "ORDINARY_TEXT",
        relevance: "IRRELEVANT",
        containerProvisionId: null,
        ...overrides,
    };
}

describe("parseDocumentSearch", () => {
    test("reads documents and skips a malformed row", () => {
        const parsed = parseDocumentSearch({
            query: "100",
            disclaimer: "d",
            documents: [{ id: "a", title: "T", documentNumber: "100/2019/NĐ-CP", documentType: "Nghị định", agency: null, issuedAt: "2019-12-30" }, { title: "no id" }, "junk"],
        });

        expect(parsed?.documents).toEqual([
            { id: "a", title: "T", documentNumber: "100/2019/NĐ-CP", documentType: "Nghị định", agency: null, issuedAt: "2019-12-30" },
        ]);
    });

    test("rejects a response without a documents list", () => {
        expect(parseDocumentSearch({ query: "x" })).toBeNull();
        expect(parseDocumentSearch(null)).toBeNull();
    });
});

describe("parseDocumentView", () => {
    test("reads metadata, provisions and amendments", () => {
        const view = parseDocumentView({
            document: { id: "d1", title: "Nghị định" },
            metadata: { documentNumber: "100/2019/NĐ-CP", documentType: "Nghị định", agency: "Chính phủ", issuedAt: "2019-12-30", effectiveFrom: "2020-01-01" },
            provisions: [provision("p1", 1, null)],
            amendments: [
                {
                    relationId: "r1",
                    toProvisionId: "p1",
                    relationType: "AMENDS",
                    verificationStatus: "ACCEPTED",
                    fromDocumentId: "d2",
                    fromDocumentNumber: "123/2021/NĐ-CP",
                    fromDocumentTitle: null,
                    fromProvisionId: "q1",
                    effectiveFrom: "2022-01-01",
                    evidenceText: "Sửa đổi điểm a",
                },
            ],
            disclaimer: "x",
        });

        expect(view?.id).toBe("d1");
        expect(view?.metadata?.effectiveFrom).toBe("2020-01-01");
        expect(view?.provisions).toHaveLength(1);
        expect(view?.amendments[0]).toMatchObject({ relationType: "AMENDS", verificationStatus: "ACCEPTED", fromDocumentNumber: "123/2021/NĐ-CP" });
    });

    test("drops an amendment whose type or status is unknown instead of guessing", () => {
        const view = parseDocumentView({
            document: { id: "d1", title: null },
            metadata: null,
            provisions: [],
            amendments: [{ relationId: "r1", toProvisionId: "p1", relationType: "WEIRD", verificationStatus: "ACCEPTED", fromDocumentId: "d2", fromProvisionId: "q", evidenceText: "x" }],
            disclaimer: "",
        });

        expect(view?.amendments).toEqual([]);
    });

    test("rejects a response without a document", () => {
        expect(parseDocumentView({ provisions: [] })).toBeNull();
    });
});

describe("buildProvisionTree", () => {
    function ids(nodes: ProvisionNode[]): unknown {
        return nodes.map((node) => [node.provision.id, ids(node.children)]);
    }

    test("nests provisions under their parent in reading order", () => {
        const view = parseDocumentView({
            document: { id: "d", title: null },
            metadata: null,
            provisions: [
                provision("a1", 1, null),
                provision("a1k2", 3, "a1", { level: "CLAUSE" }),
                provision("a1k1", 2, "a1", { level: "CLAUSE" }),
                provision("a2", 4, null),
            ],
            amendments: [],
            disclaimer: "",
        });

        expect(ids(buildProvisionTree(view?.provisions ?? []))).toEqual([
            ["a1", [["a1k1", []], ["a1k2", []]]],
            ["a2", []],
        ]);
    });

    test("keeps a provision whose parent is missing at the top level instead of losing it", () => {
        const view = parseDocumentView({
            document: { id: "d", title: null },
            metadata: null,
            provisions: [provision("orphan", 1, "gone")],
            amendments: [],
            disclaimer: "",
        });

        expect(ids(buildProvisionTree(view?.provisions ?? []))).toEqual([["orphan", []]]);
    });
});

describe("amendmentsByProvision", () => {
    test("groups amendments by the provision they touch and ignores document-level insertions", () => {
        const grouped = amendmentsByProvision([
            { relationId: "1", toProvisionId: "p1", relationType: "AMENDS", verificationStatus: "ACCEPTED", fromDocumentId: "d2", fromDocumentNumber: null, fromDocumentTitle: null, fromProvisionId: "q1", effectiveFrom: null, evidenceText: "" },
            { relationId: "2", toProvisionId: "p1", relationType: "REPEALS", verificationStatus: "CANDIDATE", fromDocumentId: "d3", fromDocumentNumber: null, fromDocumentTitle: null, fromProvisionId: "q2", effectiveFrom: null, evidenceText: "" },
            { relationId: "3", toProvisionId: null, relationType: "SUPPLEMENTS", verificationStatus: "ACCEPTED", fromDocumentId: "d2", fromDocumentNumber: null, fromDocumentTitle: null, fromProvisionId: "q3", effectiveFrom: null, evidenceText: "" },
        ]);

        expect(grouped.get("p1")?.map((item) => item.relationId)).toEqual(["1", "2"]);
        expect(grouped.size).toBe(1);
    });
});

describe("parseDocumentRelations", () => {
    const edge = {
        id: "e1",
        fromDocumentId: "d2",
        toDocumentId: "d1",
        relationType: "AMENDS",
        scope: "PARTIAL",
        direction: "INCOMING",
        otherDocumentId: "d2",
        evidence: [{ id: "c1", sourceProvisionId: "p9", quotedText: "sửa đổi", cue: "sửa đổi", status: "ACCEPTED" }],
        provisionEvidence: [],
    };

    test("keeps verified edges and unverified candidates apart", () => {
        const relations = parseDocumentRelations({
            documentId: "d1",
            metadata: null,
            outgoing: [],
            incoming: [edge],
            candidates: [
                { id: "c2", sourceDocumentId: "d1", rawTargetCitation: "Nghị định số 46/2016/NĐ-CP", targetDocumentNumber: "46/2016/NĐ-CP", proposedRelationType: "REFERENCES", scope: "UNKNOWN", status: "UNRESOLVED", resolutionReason: "Chưa có trong corpus", quotedText: "theo Nghị định số 46/2016/NĐ-CP" },
            ],
            coverage: { statusCounts: { ACCEPTED: 1, UNRESOLVED: 1 }, frontier: ["46/2016/NĐ-CP"] },
            disclaimer: "Not exhaustive",
        });

        expect(relations?.incoming).toHaveLength(1);
        expect(relations?.incoming[0]).toMatchObject({ relationType: "AMENDS", scope: "PARTIAL", otherDocumentId: "d2" });
        expect(relations?.incoming[0].evidence[0].quotedText).toBe("sửa đổi");
        expect(relations?.candidates).toHaveLength(1);
        expect(relations?.candidates[0]).toMatchObject({ status: "UNRESOLVED", targetDocumentNumber: "46/2016/NĐ-CP" });
        expect(relations?.frontier).toEqual(["46/2016/NĐ-CP"]);
    });

    test("never presents a candidate as a verified edge", () => {
        const relations = parseDocumentRelations({
            documentId: "d1",
            outgoing: [],
            incoming: [],
            candidates: [{ id: "c", sourceDocumentId: "d1", rawTargetCitation: "x", targetDocumentNumber: null, proposedRelationType: "AMENDS", scope: "FULL", status: "ACCEPTED", resolutionReason: "", quotedText: "q" }],
            coverage: { statusCounts: {}, frontier: [] },
            disclaimer: "",
        });

        expect(relations?.incoming).toEqual([]);
        expect(relations?.outgoing).toEqual([]);
    });

    test("rejects a response without edge lists", () => {
        expect(parseDocumentRelations({ documentId: "d1" })).toBeNull();
    });
});
