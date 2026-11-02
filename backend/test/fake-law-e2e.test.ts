import { beforeAll, describe, expect, it } from "bun:test";
import { createMockEnv, type MockEnvironment } from "./mocks";
import { importFakeDecree, request } from "./fake-law";

/**
 * End to end on the fake decrees in data/fake-law: upload the PDFs, read them through the queue with the
 * OpenAI boundary faked, preprocess, then query documents, relations, rules as of a date and history.
 * Nghị định 02/2032 amends point a clause 2 Article 2, repeals point b clause 1 Article 2 and replaces
 * clause 1 Article 3 (fine 200.000–400.000 → 400.000–600.000) of Nghị định 01/2030, from 01/01/2033.
 */
type DocumentSummary = { id: string; documentNumber: string | null };

type Edge = { relationType: string; scope: string; verificationStatus: string; otherDocumentId: string };

type Fine = { min: number; max: number; subject: string | null };

type RulesAsOf = {
    lineages: { applicable: { rule: { sanction: { fine: Fine | null }; behaviorText: string } }[] }[];
};

function createEnv(): MockEnvironment {
    return createMockEnv({ OPENAI_API_KEY: "test-key", OPENAI_MODEL: "test-model" });
}

async function getJson<T>(env: MockEnvironment, path: string): Promise<T> {
    const response = await request(env, path);

    expect(response.status).toBe(200);

    return (await response.json()) as T;
}

async function findDocumentId(env: MockEnvironment, documentNumber: string): Promise<string> {
    const body = await getJson<{ documents: DocumentSummary[] }>(env, "/api/documents");
    const found = body.documents.find((document) => document.documentNumber === documentNumber);

    if (!found) {
        throw new Error(`Document ${documentNumber} was not imported`);
    }

    return found.id;
}

async function findViolationId(env: MockEnvironment, query: string): Promise<string | null> {
    const body = await getJson<{ violations: { id: string }[] }>(env, `/api/violations?q=${encodeURIComponent(query)}`);

    return body.violations[0]?.id ?? null;
}

async function applicableFines(env: MockEnvironment, violationQuery: string, asOf: string): Promise<Fine[]> {
    const violationId = await findViolationId(env, violationQuery);

    if (!violationId) {
        throw new Error(`No violation found for '${violationQuery}'`);
    }

    const body = await getJson<RulesAsOf>(env, `/api/violations/${encodeURIComponent(violationId)}/rules?as_of=${asOf}`);

    return body.lineages.flatMap((lineage) => lineage.applicable.map((entry) => entry.rule.sanction.fine).filter((fine) => fine !== null));
}

async function countRows(env: MockEnvironment, table: string): Promise<number> {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();

    return row?.count ?? 0;
}

describe("fake decrees end to end", () => {
    const env = createEnv();
    const jobIds: string[] = [];

    beforeAll(async () => {
        jobIds.push(await importFakeDecree(env, "nd-01-2030"));
        jobIds.push(await importFakeDecree(env, "nd-02-2032"));
    });

    it("reads both PDFs and completes every preprocessing stage", async () => {
        for (const jobId of jobIds) {
            const job = await getJson<{ status: string }>(env, `/api/jobs/${jobId}`);
            const checklist = await getJson<{ stages: { status: string }[] }>(env, `/api/jobs/${jobId}/preprocessing`);

            expect(job.status).toBe("completed");
            expect(checklist.stages.every((stage) => stage.status === "DONE")).toBe(true);
        }
    });

    it("reads number, issue date and effective date of each decree", async () => {
        const amendmentId = await findDocumentId(env, "02/2032/NĐ-CP");
        const relations = await getJson<{ metadata: { issuedAt: string; effectiveFrom: string } }>(env, `/api/documents/${amendmentId}/relations`);

        expect(relations.metadata.issuedAt).toBe("2032-12-10");
        expect(relations.metadata.effectiveFrom).toBe("2033-01-01");
    });

    it("builds accepted amend and repeal edges from the amendment to the base decree, seen from both sides", async () => {
        const baseId = await findDocumentId(env, "01/2030/NĐ-CP");
        const amendmentId = await findDocumentId(env, "02/2032/NĐ-CP");
        const outgoing = await getJson<{ outgoing: Edge[] }>(env, `/api/documents/${amendmentId}/relations`);
        const incoming = await getJson<{ incoming: Edge[] }>(env, `/api/documents/${baseId}/relations`);
        const outgoingTypes = outgoing.outgoing.filter((edge) => edge.otherDocumentId === baseId).map((edge) => edge.relationType);

        expect(outgoingTypes).toEqual(expect.arrayContaining(["AMENDS", "PARTIALLY_REPEALS"]));
        expect(outgoing.outgoing.every((edge) => edge.verificationStatus === "ACCEPTED")).toBe(true);
        expect(incoming.incoming.map((edge) => edge.relationType).sort()).toEqual(outgoingTypes.sort());
    });

    it("links each change instruction to the provision it affects", async () => {
        const baseId = await findDocumentId(env, "01/2030/NĐ-CP");
        const body = await getJson<{ incoming: { relationType: string }[] }>(
            env,
            `/api/provisions/${encodeURIComponent(`${baseId}:dieu_2_khoan_1_diem_b`)}/relations`,
        );

        expect(body.incoming.map((relation) => relation.relationType)).toEqual(["REPEALS"]);
    });

    it("keeps the old fine before the amendment takes effect and the new fine after", async () => {
        expect(await applicableFines(env, "mũ bảo hiểm", "2032-06-01")).toEqual([{ min: 200000, max: 400000, subject: null }]);
        expect(await applicableFines(env, "mũ bảo hiểm", "2033-06-01")).toEqual([{ min: 400000, max: 600000, subject: null }]);
    });

    it("stops applying a repealed point once the repeal takes effect", async () => {
        expect(await applicableFines(env, "đèn chiếu sáng", "2032-06-01")).toHaveLength(1);
        expect(await applicableFines(env, "đèn chiếu sáng", "2033-06-01")).toEqual([]);
    });

    it("keeps the amended and the original wording of one behaviour in one lineage", async () => {
        const violationId = await findViolationId(env, "đèn tín hiệu");
        const history = await getJson<{ lineages: { ruleIds: string[] }[] }>(env, `/api/violations/${encodeURIComponent(violationId!)}/history`);

        expect(history.lineages).toHaveLength(1);
        expect(history.lineages[0].ruleIds).toHaveLength(2);
    });

    it("finds the same result in either import order", async () => {
        const reversed = createEnv();

        await importFakeDecree(reversed, "nd-02-2032");
        await importFakeDecree(reversed, "nd-01-2030");

        expect(await applicableFines(reversed, "mũ bảo hiểm", "2033-06-01")).toEqual([{ min: 400000, max: 600000, subject: null }]);
        expect(await countRows(reversed, "provision_relations")).toBe(await countRows(env, "provision_relations"));
    });

    // Regressions for the defects this suite found (docs/srs-coverage.md, D1–D4).
    it("ranks the decree whose number is searched above decrees that only cite it", async () => {
        const body = await getJson<{ documents: DocumentSummary[] }>(env, `/api/documents?q=${encodeURIComponent("01/2030")}`);

        expect(body.documents[0].documentNumber).toBe("01/2030/NĐ-CP");
    });

    it("does not keep closing quote marks of amended wording in the behaviour text", async () => {
        const violationId = await findViolationId(env, "đèn tín hiệu");
        const body = await getJson<{ aliases: string[] }>(env, `/api/violations/${encodeURIComponent(violationId!)}`);

        expect(body.aliases.some((alias) => alias.includes("”"))).toBe(false);
    });

    it("finds a behaviour by words that are not one contiguous alias (FR-16.1 full text)", async () => {
        expect(await findViolationId(env, "đỗ xe ngoài đô thị")).not.toBeNull();
    });

    it("matches whole words only, so a word that merely starts like another finds nothing", async () => {
        expect(await findViolationId(env, "xem")).toBeNull();
    });

    it("does not duplicate entities or lose relations when the same PDF is uploaded again (AC 25)", async () => {
        const again = createEnv();

        await importFakeDecree(again, "nd-01-2030");
        await importFakeDecree(again, "nd-02-2032");
        const relationsBefore = await countRows(again, "provision_relations");
        await importFakeDecree(again, "nd-01-2030");

        expect(await countRows(again, "legal_documents")).toBe(2);
        expect(await countRows(again, "provision_relations")).toBe(relationsBefore);
    });
});
