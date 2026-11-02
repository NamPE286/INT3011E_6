import { beforeAll, describe, expect, it } from "bun:test";
import { createMockEnv } from "./mocks";
import { importFakeDecree, request } from "./fake-law";

type GraphBody = {
    documents: { id: string; documentNumber: string | null; issuedAt: string | null; effectiveFrom: string | null }[];
    provisions: { id: string; documentId: string; level: string; articleNo: string | null; paragraphNo: string | null; pointNo: string | null }[];
    documentRelations: { fromDocumentId: string; toDocumentId: string; relationType: string; verificationStatus: string }[];
    provisionRelations: {
        fromProvisionId: string;
        toProvisionId: string | null;
        toDocumentId: string;
        relationType: string;
        verificationStatus: string;
        evidenceText: string;
        effectiveFrom: string | null;
    }[];
    truncated: boolean;
    disclaimer: string;
};

describe("GET /api/graph", () => {
    const env = createMockEnv({ OPENAI_API_KEY: "test-key", OPENAI_MODEL: "test-model" });
    let graph: GraphBody;
    let baseId: string;
    let amendmentId: string;

    beforeAll(async () => {
        await importFakeDecree(env, "nd-01-2030");
        await importFakeDecree(env, "nd-02-2032");

        const response = await request(env, "/api/graph");

        graph = (await response.json()) as GraphBody;
        baseId = graph.documents.find((document) => document.documentNumber === "01/2030/NĐ-CP")!.id;
        amendmentId = graph.documents.find((document) => document.documentNumber === "02/2032/NĐ-CP")!.id;
    });

    it("lists every imported document oldest first, with its dates", () => {
        expect(graph.documents.map((document) => document.documentNumber)).toEqual(["01/2030/NĐ-CP", "02/2032/NĐ-CP"]);
        expect(graph.documents[1]).toMatchObject({ issuedAt: "2032-12-10", effectiveFrom: "2033-01-01" });
        expect(graph.truncated).toBe(false);
        expect(graph.disclaimer.length).toBeGreaterThan(0);
    });

    it("returns the accepted document edges between imported documents", () => {
        const types = graph.documentRelations
            .filter((relation) => relation.fromDocumentId === amendmentId && relation.toDocumentId === baseId)
            .map((relation) => relation.relationType);

        expect(types).toEqual(expect.arrayContaining(["AMENDS", "PARTIALLY_REPEALS"]));
        expect(graph.documentRelations.every((relation) => relation.verificationStatus === "ACCEPTED")).toBe(true);
    });

    it("returns each provision edge with its evidence and effective date", () => {
        const repeal = graph.provisionRelations.find((relation) => relation.relationType === "REPEALS");

        expect(graph.provisionRelations).toHaveLength(3);
        expect(repeal).toMatchObject({
            fromProvisionId: `${amendmentId}:dieu_1_khoan_2`,
            toProvisionId: `${baseId}:dieu_2_khoan_1_diem_b`,
            toDocumentId: baseId,
            verificationStatus: "ACCEPTED",
            evidenceText: "Bãi bỏ điểm b khoản 1 Điều 2.",
            effectiveFrom: "2033-01-01",
        });
    });

    it("returns exactly the provisions at either end of a provision edge, with their locator", () => {
        const endpointIds = new Set(
            graph.provisionRelations.flatMap((relation) => [relation.fromProvisionId, relation.toProvisionId]).filter((id) => id !== null),
        );
        const repealed = graph.provisions.find((provision) => provision.id === `${baseId}:dieu_2_khoan_1_diem_b`);

        expect(new Set(graph.provisions.map((provision) => provision.id))).toEqual(endpointIds);
        expect(repealed).toMatchObject({ documentId: baseId, level: "POINT", articleNo: "2", paragraphNo: "1", pointNo: "b" });
    });

    it("answers with an empty graph when nothing is imported", async () => {
        const response = await request(createMockEnv(), "/api/graph");
        const body = (await response.json()) as GraphBody;

        expect(response.status).toBe(200);
        expect(body.documents).toEqual([]);
        expect(body.provisionRelations).toEqual([]);
    });
});
