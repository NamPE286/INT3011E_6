import { describe, expect, it } from "bun:test";
import type { D1Database } from "@cloudflare/workers-types";
import { app } from "../src/app";
import { buildChangeGraph } from "../src/modules/changes/change.service";
import { buildDocumentGraph } from "../src/modules/documents/document-graph.service";
import { resolveIdentity, type ViolationIdentity } from "../src/modules/identity/identity.resolver";
import { getViolationDetail, resolveDocumentIdentities } from "../src/modules/identity/identity.service";
import { extractViolationRules } from "../src/modules/violations/violation.service";
import type { SemanticIr } from "../src/modules/violations/violation.types";
import { createTestD1Database } from "./d1-test-db";
import { AMENDING_DECREE, BASE_DECREE, storeLegalDocument, type FixtureDocument } from "./legal-fixtures";
import { createMockEnv, withEnv } from "./mocks";

const OPTIONS = { model: "test-model" };

const WITH_MOTORBIKES: FixtureDocument = {
    ...BASE_DECREE,
    articles: [
        ...BASE_DECREE.articles,
        {
            number: "6",
            title: "Xử phạt người điều khiển xe mô tô, xe gắn máy vi phạm quy tắc giao thông đường bộ",
            clauses: [
                {
                    number: "4",
                    content: "Phạt tiền từ 600.000 đồng đến 1.000.000 đồng đối với người điều khiển xe thực hiện một trong các hành vi vi phạm sau đây:",
                    points: [
                        { number: "e", content: "Không chấp hành hiệu lệnh của đèn tín hiệu giao thông;" },
                        { number: "i", content: "Chạy trong hầm đường bộ không sử dụng đèn chiếu sáng gần;" },
                    ],
                },
            ],
        },
    ],
};

async function importDocument(db: D1Database, fixture: FixtureDocument): Promise<void> {
    await storeLegalDocument(db, fixture);
    await buildDocumentGraph(db, fixture.id);
    await buildChangeGraph(db, fixture.id);
    await extractViolationRules(db, fixture.id, OPTIONS);
    await resolveDocumentIdentities(db, fixture.id, OPTIONS);
}

function ir(action: string, overrides: Partial<SemanticIr> = {}): SemanticIr {
    return {
        action: { label: action, vocabId: null, evidence: action },
        polarity: "OMISSION",
        subject: null,
        vehicles: [],
        target: null,
        location: null,
        conditions: [],
        exceptions: [],
        consequence: null,
        ...overrides,
    };
}

function violation(id: string, action: string, overrides: Partial<SemanticIr> = {}): ViolationIdentity {
    return {
        id,
        canonicalName: action,
        signatureKey: null,
        semanticIr: ir(action, overrides),
        normalizedAliases: [action.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").toLowerCase()],
    };
}

describe("resolveDocumentIdentities", () => {
    it("gives the same behaviour for cars and motorbikes one violation, and keeps other behaviours apart", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });

        await importDocument(db, WITH_MOTORBIKES);

        const carRule = `${BASE_DECREE.id}:dieu_5_khoan_5_diem_a#rule`;
        const bikeRule = `${BASE_DECREE.id}:dieu_6_khoan_4_diem_e#rule`;
        const result = await resolveDocumentIdentities(db, BASE_DECREE.id, OPTIONS);
        const byRule = new Map(result.decisions.map((decision) => [decision.violationRuleId, decision]));

        expect(byRule.get(carRule)?.decision).toBe("CREATE_NEW");
        expect(byRule.get(bikeRule)).toMatchObject({ decision: "MATCH_EXISTING", method: "ALIAS", trafficViolationId: byRule.get(carRule)?.trafficViolationId });
        expect(new Set(result.decisions.map((decision) => decision.trafficViolationId)).size).toBe(3);
        expect(result.counts.AMBIGUOUS).toBeUndefined();
    });

    it("links an amended rule to the violation of the provision it rewrites", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });

        await importDocument(db, BASE_DECREE);
        await importDocument(db, AMENDING_DECREE);

        const amending = await resolveDocumentIdentities(db, AMENDING_DECREE.id, OPTIONS);
        const [decision] = amending.decisions;
        const detail = await getViolationDetail(db, decision.trafficViolationId ?? "");

        expect(decision).toMatchObject({ decision: "MATCH_EXISTING", method: "AMENDED_PROVISION" });
        expect(detail?.rules.map((rule) => rule.sourceDocumentId).sort()).toEqual([BASE_DECREE.id, AMENDING_DECREE.id]);
        expect(detail?.aliases).toContain("Không chấp hành hiệu lệnh của đèn tín hiệu giao thông theo quy định tại Nghị định số 46/2016/NĐ-CP");
    });

    it("is stable when a document is resolved again", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });

        await importDocument(db, WITH_MOTORBIKES);

        const first = await resolveDocumentIdentities(db, BASE_DECREE.id, OPTIONS);
        const second = await resolveDocumentIdentities(db, BASE_DECREE.id, OPTIONS);

        expect(second.decisions.map((decision) => decision.trafficViolationId)).toEqual(first.decisions.map((decision) => decision.trafficViolationId));
    });

    it("asks the model only for ambiguous rules and trusts only answers naming a candidate", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });
        const variant: FixtureDocument = {
            ...WITH_MOTORBIKES,
            articles: [
                ...WITH_MOTORBIKES.articles,
                {
                    number: "7",
                    title: "Xử phạt người điều khiển xe máy chuyên dùng",
                    clauses: [
                        {
                            number: "3",
                            content: "Phạt tiền từ 1.000.000 đồng đến 2.000.000 đồng đối với người điều khiển xe thực hiện một trong các hành vi vi phạm sau đây:",
                            points: [{ number: "a", content: "Không chấp hành hiệu lệnh của đèn tín hiệu giao thông đường bộ;" }],
                        },
                    ],
                },
            ],
        };
        const calls: string[] = [];
        const fetcher = (async (_url: unknown, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body)) as { input: { content: string | { text: string }[] }[] };
            const payload = JSON.parse((body.input[1].content as { text: string }[])[0].text) as { candidates: { violation_id: string }[] };

            calls.push(payload.candidates.map((candidate) => candidate.violation_id).join(","));

            const answer = { verdict: "SAME", violation_id: payload.candidates[0].violation_id, reason: "Cùng hành vi vượt đèn đỏ." };

            return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }] });
        }) as unknown as typeof fetch;

        await storeLegalDocument(db, variant);
        await buildDocumentGraph(db, variant.id);
        await extractViolationRules(db, variant.id, OPTIONS);

        const result = await resolveDocumentIdentities(db, variant.id, { apiKey: "test-key", model: "test-model", fetcher });
        const special = result.decisions.find((decision) => decision.violationRuleId.includes("dieu_7"));
        const car = result.decisions.find((decision) => decision.violationRuleId.includes("dieu_5_khoan_5_diem_a"));

        expect(calls).toHaveLength(1);
        expect(special).toMatchObject({ decision: "MATCH_EXISTING", method: "LLM", trafficViolationId: car?.trafficViolationId });
        expect(special?.model).toContain("violation-identity-v1");
    });
});

describe("resolveIdentity", () => {
    it("never merges on wording alone when the location differs", () => {
        const existing = violation("tv:1", "dừng xe", { location: { label: "trên đường cao tốc", vocabId: null, evidence: "trên đường cao tốc" } });
        const decision = resolveIdentity(
            { ruleId: "r", behaviorText: "Dừng xe;", semanticIr: ir("dừng xe", { location: { label: "trên cầu", vocabId: null, evidence: "trên cầu" } }), amendedProvisionViolationId: null },
            [existing],
        );

        expect(decision.decision).toBe("CREATE_NEW");
    });

    it("matches by canonical vocabulary signature even when the wording differs", () => {
        const existing: ViolationIdentity = { ...violation("tv:1", "vượt đèn đỏ"), signatureKey: "ACT_RED|OMISSION|||" };
        const rule = ir("không chấp hành hiệu lệnh của đèn tín hiệu giao thông");

        rule.action = { label: "không chấp hành hiệu lệnh của đèn tín hiệu giao thông", vocabId: "ACT_RED", evidence: "Không chấp hành" };

        const decision = resolveIdentity({ ruleId: "r", behaviorText: "Không chấp hành hiệu lệnh của đèn tín hiệu giao thông;", semanticIr: rule, amendedProvisionViolationId: null }, [existing]);

        expect(decision).toMatchObject({ decision: "MATCH_EXISTING", method: "STRUCTURED", trafficViolationId: "tv:1" });
    });

    it("leaves an amendment that rewrote the behaviour completely ambiguous", () => {
        const existing = violation("tv:1", "không chấp hành hiệu lệnh của đèn tín hiệu giao thông");
        const decision = resolveIdentity(
            { ruleId: "r", behaviorText: "Chở theo quá số người quy định;", semanticIr: ir("chở theo quá số người quy định"), amendedProvisionViolationId: "tv:1" },
            [existing],
        );

        expect(decision.decision).toBe("AMBIGUOUS");
    });
});

describe("violation endpoints", () => {
    it("searches violations by alias without accents and returns their rules", async () => {
        const env = createMockEnv();

        await importDocument(env.DB, WITH_MOTORBIKES);

        const search = await app.fetch(withEnv(new Request("http://localhost/api/violations?q=den%20tin%20hieu"), env));
        const searchBody = (await search.json()) as { violations: { id: string }[] };
        const detail = await app.fetch(withEnv(new Request(`http://localhost/api/violations/${encodeURIComponent(searchBody.violations[0].id)}`), env));
        const detailBody = (await detail.json()) as { rules: unknown[] };

        expect(searchBody.violations).toHaveLength(1);
        expect(detailBody.rules).toHaveLength(2);
    });

    it("returns 404 for an unknown violation", async () => {
        const env = createMockEnv();
        const response = await app.fetch(withEnv(new Request("http://localhost/api/violations/missing"), env));

        expect(response.status).toBe(404);
    });
});
