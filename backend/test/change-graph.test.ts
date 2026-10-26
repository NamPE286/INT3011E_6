import { describe, expect, it } from "bun:test";
import type { D1Database } from "@cloudflare/workers-types";
import { app } from "../src/app";
import { extractChangeInstructions, readOperation } from "../src/modules/changes/change.extractor";
import { resolveInstruction } from "../src/modules/changes/change.resolver";
import { buildChangeGraph, getDocumentChanges, getProvisionRelations } from "../src/modules/changes/change.service";
import type { ChangeInstructionDraft } from "../src/modules/changes/change.types";
import { buildDocumentGraph, getDocumentRelations } from "../src/modules/documents/document-graph.service";
import { analyzeLegalDocument } from "../src/modules/provisions/provision.analyzer";
import type { StoredProvision } from "../src/modules/provisions/provision.repository";
import { createTestD1Database } from "./d1-test-db";
import { AMENDING_DECREE, BASE_DECREE, storeLegalDocument, type FixtureDocument } from "./legal-fixtures";
import { createMockEnv, withEnv } from "./mocks";

async function importDocument(db: D1Database, fixture: FixtureDocument): Promise<void> {
    await storeLegalDocument(db, fixture);
    await buildDocumentGraph(db, fixture.id);
    await buildChangeGraph(db, fixture.id);
}

function provisionsOf(documentId: string, articles: object[]): StoredProvision[] {
    return analyzeLegalDocument(documentId, { content: null, articles }).map((provision) => ({
        ...provision,
        sourceSnapshotId: documentId,
        pdfSha256: null,
        readMethod: null,
        roleMethod: "RULE",
        roleVersion: "test",
    }));
}

function article(number: string, title: string | null, clauses: object[]): object {
    return { number, title, content: null, clauses };
}

function clause(number: string, content: string, points: object[] = []): object {
    return { number, title: null, content, points };
}

describe("buildChangeGraph", () => {
    it("links amendment and repeal instructions to the provisions they change", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });

        await importDocument(db, BASE_DECREE);
        await importDocument(db, AMENDING_DECREE);

        const changes = await getDocumentChanges(db, AMENDING_DECREE.id);
        const amend = changes.instructions.find((instruction) => instruction.sourceProvisionId === `${AMENDING_DECREE.id}:dieu_2_khoan_10`);
        const repeal = changes.instructions.find((instruction) => instruction.sourceProvisionId === `${AMENDING_DECREE.id}:dieu_2_khoan_11`);

        expect(amend).toMatchObject({
            operation: "AMEND",
            targetDocumentId: BASE_DECREE.id,
            targetDocumentNumber: "100/2019/NĐ-CP",
            resolutionStatus: "RESOLVED",
            effectiveFrom: "2022-01-01",
            newTextProvisionIds: [`${AMENDING_DECREE.id}:dieu_2_khoan_10_diem_a`],
        });
        expect(amend?.relations).toEqual([
            expect.objectContaining({
                relationType: "AMENDS",
                toProvisionId: `${BASE_DECREE.id}:dieu_5_khoan_5_diem_a`,
                verificationStatus: "ACCEPTED",
                evidenceLevel: "EXPLICIT_LEGAL_TEXT",
            }),
        ]);
        expect(repeal?.relations[0]).toMatchObject({ relationType: "REPEALS", toProvisionId: `${BASE_DECREE.id}:dieu_5_khoan_5_diem_b` });
    });

    it("resolves an amendment imported before the document it amends", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });

        await importDocument(db, AMENDING_DECREE);

        const before = await getDocumentChanges(db, AMENDING_DECREE.id);

        expect(before.instructions.every((instruction) => instruction.resolutionStatus === "UNRESOLVED")).toBe(true);

        await importDocument(db, BASE_DECREE);

        const incoming = await getProvisionRelations(db, `${BASE_DECREE.id}:dieu_5_khoan_5_diem_a`);

        expect(incoming.incoming).toHaveLength(1);
        expect(incoming.incoming[0].instruction?.rawText).toBe("Sửa đổi, bổ sung điểm a khoản 5 Điều 5 như sau:");
    });

    it("summarizes accepted provision relations as partial document relations", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });

        await importDocument(db, BASE_DECREE);
        await importDocument(db, AMENDING_DECREE);

        const view = await getDocumentRelations(db, BASE_DECREE.id);
        const derived = view.incoming.filter((edge) => edge.method === "PROVISION_RELATION").map((edge) => edge.relationType).sort();

        expect(derived).toEqual(["AMENDS", "PARTIALLY_REPEALS"]);
        expect(view.incoming.find((edge) => edge.relationType === "AMENDS")?.provisionEvidence).toHaveLength(1);
    });

    it("keeps an address missing from the stored target unresolved", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });
        const amending: FixtureDocument = {
            ...AMENDING_DECREE,
            articles: [
                {
                    number: "2",
                    title: "Sửa đổi, bổ sung một số điều của Nghị định số 100/2019/NĐ-CP",
                    clauses: [{ number: "1", content: "Bãi bỏ khoản 9 Điều 5." }],
                },
            ],
        };

        await importDocument(db, BASE_DECREE);
        await importDocument(db, amending);

        const [instruction] = (await getDocumentChanges(db, amending.id)).instructions;

        expect(instruction).toMatchObject({ resolutionStatus: "UNRESOLVED", relations: [] });
        expect(instruction.resolutionReason).toContain("khoản 9 Điều 5");
    });
});

describe("extractChangeInstructions", () => {
    it("reads operations from the instruction wording", () => {
        expect(readOperation("Thay cụm từ “ ” bằng cụm từ “ ” tại khoản 2 Điều 3")).toBe("SUBSTITUTE_TEXT");
        expect(readOperation("Bãi bỏ điểm b khoản 5 Điều 5")).toBe("REPEAL");
        expect(readOperation("Sửa đổi, bổ sung Điều 6 như sau")).toBe("AMEND");
        expect(readOperation("Bổ sung điểm c vào khoản 4 Điều 7")).toBe("SUPPLEMENT");
        expect(readOperation("Thay thế Điều 8 như sau")).toBe("REPLACE");
    });

    it("takes the article of a nested instruction from the instruction that encloses it", () => {
        const provisions = provisionsOf("amend", [
            article("1", "Sửa đổi, bổ sung một số điều của Nghị định số 100/2019/NĐ-CP", [
                clause("1", "Sửa đổi, bổ sung một số khoản của Điều 5 như sau:", [
                    { number: "a", title: null, content: "Sửa đổi khoản 2 như sau:" },
                ]),
            ]),
        ]);

        const drafts = extractChangeInstructions("amend", null, provisions);
        const nested = drafts.find((draft) => draft.sourceProvisionId === "amend:dieu_1_khoan_1_diem_a");

        expect(nested).toMatchObject({ targetLocators: [{ article: "5", clause: "2", point: null }], targetDocumentNumber: "100/2019/NĐ-CP" });
    });

    it("reads insertions and exceptions", () => {
        const provisions = provisionsOf("amend", [
            article("1", "Sửa đổi, bổ sung một số điều của Nghị định số 100/2019/NĐ-CP", [
                clause("1", "Bổ sung điểm e vào khoản 5 Điều 5 như sau:"),
                clause("2", "Bãi bỏ khoản 3 Điều 6, trừ trường hợp xe ưu tiên."),
            ]),
        ]);

        const [insertion, repeal] = extractChangeInstructions("amend", null, provisions);

        expect(insertion).toMatchObject({ operation: "SUPPLEMENT", targetLocators: [{ article: "5", clause: "5", point: "e" }] });
        expect(repeal.exceptions).toEqual(["trừ trường hợp xe ưu tiên"]);
    });

    it("recognizes an instruction on the document itself", () => {
        const provisions = provisionsOf("self", [article("10", null, [clause("1", "Bãi bỏ khoản 3 Điều 5 của Nghị định này.")])]);

        expect(extractChangeInstructions("self", null, provisions)[0]).toMatchObject({ targetIsSelf: true, targetDocumentNumber: null });
    });
});

describe("resolveInstruction", () => {
    const insertion: ChangeInstructionDraft = {
        id: "amend:dieu_1_khoan_1#change",
        sourceDocumentId: "amend",
        sourceProvisionId: "amend:dieu_1_khoan_1",
        sourceSnapshotId: null,
        operation: "SUPPLEMENT",
        rawText: "Bổ sung điểm e vào khoản 5 Điều 5 như sau:",
        rawTargetCitation: "Bổ sung điểm e vào khoản 5 Điều 5",
        targetDocumentCitation: "Nghị định số 100/2019/NĐ-CP",
        targetDocumentNumber: "100/2019/NĐ-CP",
        targetIsSelf: false,
        targetScope: "PROVISIONS",
        targetLocators: [{ article: "5", clause: "5", point: "e" }],
        newTextProvisionIds: [],
        quotedSegments: [],
        exceptions: [],
    };
    const document = { status: "RESOLVED" as const, targetDocumentId: "base", verification: "ACCEPTED" as const, reason: "ok" };

    it("links a new point to the clause it is inserted into", () => {
        const { relations } = resolveInstruction(insertion, document, new Set(["base:dieu_5_khoan_5"]), "2022-01-01");

        expect(relations[0]).toMatchObject({
            relationType: "SUPPLEMENTS",
            toProvisionId: "base:dieu_5_khoan_5",
            insertionLocator: { article: "5", clause: "5", point: "e" },
        });
    });

    it("does not link an instruction whose target document is unresolved", () => {
        const unresolved = { status: "UNRESOLVED" as const, targetDocumentId: null, verification: null, reason: "outside corpus" };
        const result = resolveInstruction(insertion, unresolved, new Set(), null);

        expect(result.relations).toHaveLength(0);
        expect(result.instruction.resolutionStatus).toBe("UNRESOLVED");
    });
});

describe("change endpoints", () => {
    it("lists a document's change instructions and a provision's relations", async () => {
        const env = createMockEnv();

        await importDocument(env.DB, BASE_DECREE);
        await importDocument(env.DB, AMENDING_DECREE);

        const changes = await app.fetch(withEnv(new Request(`http://localhost/api/documents/${AMENDING_DECREE.id}/changes`), env));
        const provisionId = encodeURIComponent(`${BASE_DECREE.id}:dieu_5_khoan_5_diem_b`);
        const relations = await app.fetch(withEnv(new Request(`http://localhost/api/provisions/${provisionId}/relations`), env));
        const relationBody = (await relations.json()) as { incoming: { relationType: string }[] };

        expect(changes.status).toBe(200);
        expect(relations.status).toBe(200);
        expect(relationBody.incoming[0].relationType).toBe("REPEALS");
    });

    it("returns 404 for unknown documents and provisions", async () => {
        const env = createMockEnv();
        const changes = await app.fetch(withEnv(new Request("http://localhost/api/documents/missing/changes"), env));
        const relations = await app.fetch(withEnv(new Request("http://localhost/api/provisions/missing/relations"), env));

        expect(changes.status).toBe(404);
        expect(relations.status).toBe(404);
    });
});
