import { describe, expect, test } from "bun:test";
import { parseRelationGraph } from "./graph";

describe("parseRelationGraph", () => {
    test("reads documents, provisions and both edge kinds", () => {
        const parsed = parseRelationGraph({
            documents: [{ id: "A", title: "T", documentNumber: "01/2030/NĐ-CP", documentType: null, issuedAt: "2030-11-15", effectiveFrom: null }],
            provisions: [{ id: "A:p", documentId: "A", level: "POINT", articleNo: "2", paragraphNo: "1", pointNo: "b", title: null, textPreview: "x" }],
            documentRelations: [{ id: "e", fromDocumentId: "B", toDocumentId: "A", relationType: "AMENDS", scope: "PARTIAL", verificationStatus: "ACCEPTED" }],
            provisionRelations: [
                {
                    id: "r",
                    fromDocumentId: "B",
                    fromProvisionId: "B:p",
                    toDocumentId: "A",
                    toProvisionId: null,
                    relationType: "REPEALS",
                    verificationStatus: "CANDIDATE",
                    evidenceText: "Bãi bỏ",
                    effectiveFrom: null,
                },
            ],
            truncated: true,
            disclaimer: "d",
        });

        expect(parsed?.documents).toHaveLength(1);
        expect(parsed?.provisions[0]).toMatchObject({ pointNo: "b" });
        expect(parsed?.documentRelations).toEqual([{ id: "e", fromDocumentId: "B", toDocumentId: "A", relationType: "AMENDS", scope: "PARTIAL" }]);
        expect(parsed?.provisionRelations[0]).toMatchObject({ toProvisionId: null, verificationStatus: "CANDIDATE" });
        expect(parsed?.truncated).toBe(true);
    });

    test("never reads an unverified document edge as a relation, and skips malformed rows", () => {
        const parsed = parseRelationGraph({
            documents: [{ id: "A" }, { title: "no id" }],
            documentRelations: [{ id: "e", fromDocumentId: "B", toDocumentId: "A", relationType: "AMENDS", verificationStatus: "CANDIDATE" }],
            provisionRelations: [{ id: "r", fromDocumentId: "B", fromProvisionId: "B:p", toDocumentId: "A", relationType: "AMENDS", verificationStatus: "MAYBE" }],
        });

        expect(parsed?.documents.map((document) => document.id)).toEqual(["A"]);
        expect(parsed?.documentRelations).toEqual([]);
        expect(parsed?.provisionRelations).toEqual([]);
        expect(parsed?.truncated).toBe(false);
    });

    test("rejects a body without documents", () => {
        expect(parseRelationGraph({ message: "Database service unavailable" })).toBeNull();
    });
});
