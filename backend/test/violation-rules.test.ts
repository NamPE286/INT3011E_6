import { describe, expect, it } from "bun:test";
import type { D1Database } from "@cloudflare/workers-types";
import { app } from "../src/app";
import { buildChangeGraph } from "../src/modules/changes/change.service";
import { buildDocumentGraph } from "../src/modules/documents/document-graph.service";
import { extractViolationRules, getViolationRules } from "../src/modules/violations/violation.service";
import { createTestD1Database } from "./d1-test-db";
import { AMENDING_DECREE, BASE_DECREE, storeLegalDocument, type FixtureDocument } from "./legal-fixtures";
import { createMockEnv, withEnv } from "./mocks";

const NO_MODEL = { model: "test-model" };

async function importDocument(db: D1Database, fixture: FixtureDocument): Promise<void> {
    await storeLegalDocument(db, fixture);
    await buildDocumentGraph(db, fixture.id);
    await buildChangeGraph(db, fixture.id);
}

/** Fake Responses API for the semantic step: answers each rule id with `reply(ruleId, ruleText)`. */
function fakeSemanticModel(reply: (ruleId: string, ruleText: string) => Record<string, unknown>) {
    const calls: string[] = [];
    const fetcher = (async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { input: { content: string | { text: string }[] }[] };
        const userContent = body.input[1].content as { text: string }[];
        const payload = JSON.parse(userContent[0].text) as { rules: { rule_id: string; rule_text: string }[] };

        calls.push(...payload.rules.map((rule) => rule.rule_id));

        const items = payload.rules.map((rule) => ({
            rule_id: rule.rule_id,
            is_violation: true,
            action: null,
            polarity: "OMISSION",
            subject: null,
            vehicles: [],
            target: null,
            location: null,
            conditions: [],
            exceptions: [],
            consequence: null,
            uncertainty: null,
            ...reply(rule.rule_id, rule.rule_text),
        }));

        return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ items }) }] }] });
    }) as unknown as typeof fetch;

    return { fetcher, calls };
}

describe("extractViolationRules — deterministic structure and sanctions", () => {
    it("creates one rule per behaviour point with the clause fine and the cited additional sanction", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });

        await importDocument(db, BASE_DECREE);

        const result = await extractViolationRules(db, BASE_DECREE.id, NO_MODEL);
        const { rules, runs } = await getViolationRules(db, BASE_DECREE.id);
        const redLight = rules.find((rule) => rule.provisionId === `${BASE_DECREE.id}:dieu_5_khoan_5_diem_a`);

        expect(result.outcome).toBe("EXTRACTED");
        expect(rules.map((rule) => rule.provisionId).sort()).toEqual([
            `${BASE_DECREE.id}:dieu_5_khoan_5_diem_a`,
            `${BASE_DECREE.id}:dieu_5_khoan_5_diem_b`,
        ]);
        expect(redLight).toMatchObject({
            governedProvisionId: `${BASE_DECREE.id}:dieu_5_khoan_5_diem_a`,
            sanctionProvisionId: `${BASE_DECREE.id}:dieu_5_khoan_5`,
            behaviorText: "Không chấp hành hiệu lệnh của đèn tín hiệu giao thông;",
            extractionStatus: "EXTRACTED",
            effectiveFrom: "2020-01-01",
            semanticMethod: "RULE",
        });
        expect(redLight?.sanction).toMatchObject({
            fine: { min: 3_000_000, max: 5_000_000 },
            pointDeductionApplicability: "UNKNOWN",
            pointsDeducted: null,
            effects: [expect.objectContaining({ effectType: "LICENSE_SUSPENSION", durationMin: 1, durationMax: 3, sourceProvisionId: `${BASE_DECREE.id}:dieu_5_khoan_11_diem_a` })],
        });
        expect(redLight?.semanticIr.vehicles.map((vehicle) => vehicle.label)).toEqual(["xe ô tô"]);
        expect(redLight?.semanticIr.polarity).toBe("OMISSION");
        expect(runs[0]).toMatchObject({ status: "SKIPPED", method: "RULE", ruleCount: 2 });
    });

    it("places a rewritten point at the address it amends and inherits what the amendment left unchanged", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });

        await importDocument(db, BASE_DECREE);
        await importDocument(db, AMENDING_DECREE);
        await extractViolationRules(db, AMENDING_DECREE.id, NO_MODEL);

        const { rules } = await getViolationRules(db, AMENDING_DECREE.id);

        expect(rules).toHaveLength(1);
        expect(rules[0]).toMatchObject({
            provisionId: `${AMENDING_DECREE.id}:dieu_2_khoan_10_diem_a`,
            governedDocumentId: BASE_DECREE.id,
            governedProvisionId: `${BASE_DECREE.id}:dieu_5_khoan_5_diem_a`,
            sanctionProvisionId: `${BASE_DECREE.id}:dieu_5_khoan_5`,
            behaviorText: "Không chấp hành hiệu lệnh của đèn tín hiệu giao thông theo quy định tại Nghị định số 46/2016/NĐ-CP;",
            effectiveFrom: "2022-01-01",
        });
        expect(rules[0].sanction.fine).toMatchObject({ min: 3_000_000, max: 5_000_000 });
        expect(rules[0].sanction.effects.map((effect) => effect.effectType)).toEqual(["LICENSE_SUSPENSION"]);

        const quoted = await db.prepare("SELECT relevance FROM provisions WHERE id = ?").bind(`${AMENDING_DECREE.id}:dieu_2_khoan_10_diem_a`).first<{ relevance: string }>();

        expect(quoted?.relevance).toBe("VIOLATION_RULE");
    });

    it("splits a clause that fines individuals and organizations differently, and reads point deduction", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });
        const decree: FixtureDocument = {
            id: "nd-168-2024",
            title: "NGHỊ ĐỊNH Quy định xử phạt vi phạm hành chính về trật tự, an toàn giao thông trong lĩnh vực giao thông đường bộ",
            content: "CHÍNH PHỦ\nSố: 168/2024/NĐ-CP\nHà Nội, ngày 26 tháng 12 năm 2024",
            articles: [
                {
                    number: "32",
                    title: "Xử phạt chủ phương tiện vi phạm quy định liên quan đến giao thông đường bộ",
                    clauses: [
                        { number: "1", content: "Phạt tiền từ 2.000.000 đồng đến 4.000.000 đồng đối với cá nhân, từ 4.000.000 đồng đến 8.000.000 đồng đối với tổ chức là chủ xe ô tô giao xe cho người không đủ điều kiện điều khiển xe tham gia giao thông." },
                    ],
                },
                {
                    number: "7",
                    title: "Xử phạt người điều khiển xe mô tô, xe gắn máy vi phạm quy tắc giao thông đường bộ",
                    clauses: [
                        {
                            number: "7",
                            content: "Phạt tiền từ 4.000.000 đồng đến 6.000.000 đồng đối với người điều khiển xe thực hiện một trong các hành vi vi phạm sau đây:",
                            points: [{ number: "c", content: "Không chấp hành hiệu lệnh của đèn tín hiệu giao thông;" }],
                        },
                        {
                            number: "13",
                            content: "Ngoài việc bị phạt tiền, người điều khiển xe thực hiện hành vi vi phạm còn bị trừ điểm giấy phép lái xe như sau:",
                            points: [{ number: "b", content: "Thực hiện hành vi quy định tại điểm c khoản 7 Điều này bị trừ điểm giấy phép lái xe 04 điểm." }],
                        },
                    ],
                },
            ],
        };

        await importDocument(db, decree);
        await extractViolationRules(db, decree.id, NO_MODEL);

        const { rules } = await getViolationRules(db, decree.id);
        const owners = rules.filter((rule) => rule.provisionId === `${decree.id}:dieu_32_khoan_1`);
        const redLight = rules.find((rule) => rule.provisionId === `${decree.id}:dieu_7_khoan_7_diem_c`);

        expect(owners.map((rule) => [rule.subjectScope, rule.sanction.fine?.min]).sort()).toEqual([
            ["INDIVIDUAL", 2_000_000],
            ["ORGANIZATION", 4_000_000],
        ]);
        expect(redLight?.sanction).toMatchObject({ pointDeductionApplicability: "APPLIES", pointsDeducted: 4 });
        expect(redLight?.semanticIr.vehicles.map((vehicle) => vehicle.label)).toEqual(["xe mô tô", "xe gắn máy"]);
    });

    it("drops rules of a document that now needs review", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });

        await importDocument(db, BASE_DECREE);
        await extractViolationRules(db, BASE_DECREE.id, NO_MODEL);
        await db.prepare("UPDATE legal_documents SET review_status = 'REVIEW_REQUIRED' WHERE id = ?").bind(BASE_DECREE.id).run();

        expect((await extractViolationRules(db, BASE_DECREE.id, NO_MODEL)).outcome).toBe("REVIEW_REQUIRED");
        expect((await getViolationRules(db, BASE_DECREE.id)).rules).toHaveLength(0);
    });
});

describe("extractViolationRules — vocabulary-guided semantic step", () => {
    it("keeps verified values, rejects unquoted evidence and registers new vocabulary through add_vocab", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });
        const model = fakeSemanticModel((ruleId) => ({
            action: { label: ruleId.includes("diem_a") ? "không chấp hành hiệu lệnh của đèn tín hiệu giao thông" : "không chấp hành hiệu lệnh của người điều khiển giao thông", vocab_id: null, evidence: "Không chấp hành hiệu lệnh" },
            vehicles: [{ label: "xe ô tô", vocab_id: "VEH_MADE_UP", evidence: "xe ô tô" }],
            location: { label: "đường cao tốc", vocab_id: null, evidence: "trên đường cao tốc" },
        }));

        await importDocument(db, BASE_DECREE);

        const result = await extractViolationRules(db, BASE_DECREE.id, { apiKey: "test-key", model: "test-model", fetcher: model.fetcher });
        const { rules } = await getViolationRules(db, BASE_DECREE.id);
        const redLight = rules.find((rule) => rule.provisionId.endsWith("diem_a"));

        if (result.outcome !== "EXTRACTED") {
            throw new Error("expected extraction");
        }

        expect(model.calls.sort()).toEqual(rules.map((rule) => rule.id).sort());
        expect(result.run).toMatchObject({ status: "COMPLETED", method: "RULE+LLM", promptVersion: "violation-ir-v2", vocabularyVersionBefore: 1 });
        expect(result.run.vocabIdsCreated.length).toBeGreaterThan(0);
        expect(result.run.rejectedValues.some((reason) => reason.includes("VEH_MADE_UP"))).toBe(true);
        expect(result.run.rejectedValues.some((reason) => reason.includes("trên đường cao tốc"))).toBe(true);
        expect(redLight?.semanticMethod).toBe("LLM");
        expect(redLight?.semanticIr.location).toBeNull();
        expect(redLight?.semanticIr.action?.vocabId).toStartWith("ACT_");
        expect(redLight?.semanticIr.vehicles[0].vocabId).toStartWith("VEH_");
    });

    it("keeps the deterministic signature and records the failure when the model call fails", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });
        const failing = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;

        await importDocument(db, BASE_DECREE);

        const result = await extractViolationRules(db, BASE_DECREE.id, { apiKey: "test-key", model: "test-model", fetcher: failing });
        const { rules } = await getViolationRules(db, BASE_DECREE.id);

        expect(result.outcome === "EXTRACTED" && result.run.status).toBe("FAILED");
        expect(rules.every((rule) => rule.semanticMethod === "RULE")).toBe(true);
    });
});

describe("violation rule endpoints", () => {
    it("extracts and lists the rules of a document", async () => {
        const env = createMockEnv();

        await importDocument(env.DB, BASE_DECREE);

        const extract = await app.fetch(withEnv(new Request(`http://localhost/api/documents/${BASE_DECREE.id}/violation-rules/extract`, { method: "POST" }), env));
        const list = await app.fetch(withEnv(new Request(`http://localhost/api/documents/${BASE_DECREE.id}/violation-rules`), env));
        const body = (await list.json()) as { rules: unknown[] };

        expect(extract.status).toBe(200);
        expect(body.rules).toHaveLength(2);
    });

    it("returns 404 for an unknown document", async () => {
        const env = createMockEnv();
        const response = await app.fetch(withEnv(new Request("http://localhost/api/documents/missing/violation-rules"), env));

        expect(response.status).toBe(404);
    });
});
