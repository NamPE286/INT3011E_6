import { describe, expect, it } from "bun:test";
import type { D1Database } from "@cloudflare/workers-types";
import { app } from "../src/app";
import { buildChangeGraph } from "../src/modules/changes/change.service";
import { buildDocumentGraph } from "../src/modules/documents/document-graph.service";
import { getRulesAsOf, getViolationHistory, refreshHistory } from "../src/modules/history/history.service";
import { resolveDocumentIdentities } from "../src/modules/identity/identity.service";
import { extractViolationRules } from "../src/modules/violations/violation.service";
import { createTestD1Database } from "./d1-test-db";
import { AMENDING_DECREE, BASE_DECREE, storeLegalDocument, type FixtureDocument } from "./legal-fixtures";
import { createMockEnv, withEnv } from "./mocks";

const OPTIONS = { model: "test-model" };
const RED_LIGHT_CAR = `${BASE_DECREE.id}:dieu_5_khoan_5_diem_a#rule`;
const RED_LIGHT_CAR_AMENDED = `${AMENDING_DECREE.id}:dieu_2_khoan_10_diem_a#rule`;

const REPLACING_DECREE: FixtureDocument = {
    id: "nd-168-2024",
    title: "NGHỊ ĐỊNH Quy định xử phạt vi phạm hành chính về trật tự, an toàn giao thông trong lĩnh vực giao thông đường bộ",
    content: "CHÍNH PHỦ\nSố: 168/2024/NĐ-CP\nHà Nội, ngày 26 tháng 12 năm 2024",
    articles: [
        {
            number: "6",
            title: "Xử phạt người điều khiển xe ô tô vi phạm quy tắc giao thông đường bộ",
            clauses: [
                {
                    number: "9",
                    content: "Phạt tiền từ 18.000.000 đồng đến 20.000.000 đồng đối với người điều khiển xe thực hiện một trong các hành vi vi phạm sau đây:",
                    points: [{ number: "b", content: "Không chấp hành hiệu lệnh của đèn tín hiệu giao thông;" }],
                },
            ],
        },
        {
            number: "54",
            title: "Hiệu lực thi hành",
            clauses: [
                { number: "1", content: "Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2025." },
                { number: "2", content: "Nghị định số 100/2019/NĐ-CP ngày 30 tháng 12 năm 2019 của Chính phủ hết hiệu lực kể từ ngày Nghị định này có hiệu lực thi hành." },
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
    await refreshHistory(db);
}

async function violationOf(db: D1Database, ruleId: string): Promise<string> {
    const row = await db.prepare("SELECT traffic_violation_id FROM violation_rules WHERE id = ?").bind(ruleId).first<{ traffic_violation_id: string }>();

    return row?.traffic_violation_id ?? "";
}

async function applicableAt(db: D1Database, violationId: string, date: string): Promise<string[]> {
    const result = await getRulesAsOf(db, violationId, date);

    return result.lineages.flatMap((lineage) => lineage.applicable.map((entry) => entry.rule.id)).sort();
}

describe("rule history", () => {
    it("chains an amended rule after the rule it rewrites and answers as-of queries from the intervals", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });

        await importDocument(db, BASE_DECREE);
        await importDocument(db, AMENDING_DECREE);

        const violationId = await violationOf(db, RED_LIGHT_CAR);
        const history = await getViolationHistory(db, violationId);
        const [lineage] = history.lineages;

        expect(history.lineages).toHaveLength(1);
        expect(lineage.ruleIds).toEqual([RED_LIGHT_CAR, RED_LIGHT_CAR_AMENDED]);
        expect(lineage.rules[0].interval).toMatchObject({
            validFrom: "2020-01-01",
            validTo: "2022-01-01",
            endType: "AMENDED",
            successorRuleId: RED_LIGHT_CAR_AMENDED,
            endEvidence: { kind: "PROVISION_RELATION", relationType: "AMENDS", fromDocumentId: AMENDING_DECREE.id },
        });
        expect(lineage.rules.map((entry) => entry.status)).toEqual(["AMENDED", "CURRENT"]);
        expect(await applicableAt(db, violationId, "2021-06-01")).toEqual([RED_LIGHT_CAR]);
        expect(await applicableAt(db, violationId, "2022-06-01")).toEqual([RED_LIGHT_CAR_AMENDED]);
        expect(await applicableAt(db, violationId, "2019-06-01")).toEqual([]);
    });

    it("ends a repealed rule without a successor", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });

        await importDocument(db, BASE_DECREE);
        await importDocument(db, AMENDING_DECREE);

        const repealedRule = `${BASE_DECREE.id}:dieu_5_khoan_5_diem_b#rule`;
        const violationId = await violationOf(db, repealedRule);
        const history = await getViolationHistory(db, violationId);

        expect(history.lineages[0].rules[0]).toMatchObject({ status: "REPEALED", interval: { validTo: "2022-01-01", successorRuleId: null } });
        expect(await applicableAt(db, violationId, "2023-01-01")).toEqual([]);
    });

    it("keeps parallel rules for different vehicles in separate lineages", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });
        const withMotorbikes: FixtureDocument = {
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
                            points: [{ number: "e", content: "Không chấp hành hiệu lệnh của đèn tín hiệu giao thông;" }],
                        },
                    ],
                },
            ],
        };

        await importDocument(db, withMotorbikes);

        const violationId = await violationOf(db, RED_LIGHT_CAR);
        const result = await getRulesAsOf(db, violationId, "2021-01-01");

        expect(result.lineages).toHaveLength(2);
        expect(result.lineages.map((lineage) => lineage.applicable[0].rule.sanction.fine?.min).sort()).toEqual([3_000_000, 600_000]);
    });

    it("supersedes rules of a fully replaced decree by the replacing decree's rule of the same behaviour", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });

        await importDocument(db, BASE_DECREE);
        await importDocument(db, AMENDING_DECREE);
        await importDocument(db, REPLACING_DECREE);

        const violationId = await violationOf(db, RED_LIGHT_CAR);
        const history = await getViolationHistory(db, violationId);
        const replacing = `${REPLACING_DECREE.id}:dieu_6_khoan_9_diem_b#rule`;

        expect(history.lineages).toHaveLength(1);
        expect(history.lineages[0].ruleIds).toEqual([RED_LIGHT_CAR, RED_LIGHT_CAR_AMENDED, replacing]);
        expect(history.lineages[0].links.map((link) => link.link)).toEqual(["PROVISION_RELATION", "DOCUMENT_REPLACEMENT"]);
        expect(history.lineages[0].rules[1]).toMatchObject({ status: "SUPERSEDED", interval: { validTo: "2025-01-01", successorRuleId: replacing } });
        expect(await applicableAt(db, violationId, "2025-06-01")).toEqual([replacing]);
    });

    it("continues a lineage across a replacement even when the replacing decree lists fewer vehicles", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });
        const motorbikes = (document: FixtureDocument, article: string, title: string, clause: string, fine: string): FixtureDocument => ({
            ...document,
            articles: [
                ...document.articles,
                {
                    number: article,
                    title,
                    clauses: [{ number: clause, content: `Phạt tiền ${fine} đối với người điều khiển xe thực hiện một trong các hành vi vi phạm sau đây:`, points: [{ number: "e", content: "Không chấp hành hiệu lệnh của đèn tín hiệu giao thông;" }] }],
                },
            ],
        });

        await importDocument(db, motorbikes(BASE_DECREE, "6", "Xử phạt người điều khiển xe mô tô, xe gắn máy", "4", "từ 600.000 đồng đến 1.000.000 đồng"));
        await importDocument(db, motorbikes(REPLACING_DECREE, "7", "Xử phạt người điều khiển xe gắn máy", "7", "từ 4.000.000 đồng đến 6.000.000 đồng"));

        const history = await getViolationHistory(db, await violationOf(db, RED_LIGHT_CAR));

        expect(history.lineages.map((lineage) => lineage.ruleIds.length).sort()).toEqual([2, 2]);
        expect(history.lineages.every((lineage) => lineage.links.some((link) => link.link === "DOCUMENT_REPLACEMENT"))).toBe(true);
    });

    it("marks rules uncertain when the end date or the amending relation is not established", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });
        const undated: FixtureDocument = {
            ...AMENDING_DECREE,
            articles: AMENDING_DECREE.articles.map((article) =>
                article.number === "5" ? { ...article, clauses: [{ number: "1", content: "Nghị định này có hiệu lực thi hành kể từ ngày ký." }] } : article,
            ),
        };
        const conflicting: FixtureDocument = {
            id: "tt-01-2023",
            title: "THÔNG TƯ Hướng dẫn",
            content: "BỘ CÔNG AN\nSố: 01/2023/TT-BCA\nHà Nội, ngày 01 tháng 3 năm 2023",
            articles: [
                { number: "1", title: "Phạm vi", clauses: [{ number: "1", content: "Bãi bỏ một số điều của Thông tư số 100/2019/NĐ-CP." }] },
                { number: "2", title: "Hiệu lực thi hành", clauses: [{ number: "1", content: "Thông tư này có hiệu lực thi hành kể từ ngày 01 tháng 4 năm 2023." }] },
            ],
        };

        await importDocument(db, BASE_DECREE);
        await importDocument(db, undated);

        const violationId = await violationOf(db, RED_LIGHT_CAR);
        const undatedResult = await getRulesAsOf(db, violationId, "2021-01-01");

        expect(undatedResult.lineages[0].applicable).toHaveLength(0);
        expect(undatedResult.lineages[0].uncertain.map((entry) => entry.rule.id)).toContain(RED_LIGHT_CAR);
        expect(undatedResult.lineages[0].uncertain[0].reasonCodes).toContain("EFFECTIVE_DATE_UNKNOWN");

        const second = createTestD1Database({ seedSampleDocument: false });

        await importDocument(second, BASE_DECREE);
        await importDocument(second, conflicting);

        const secondViolation = await violationOf(second, RED_LIGHT_CAR);
        const before = await getRulesAsOf(second, secondViolation, "2023-01-01");
        const after = await getRulesAsOf(second, secondViolation, "2023-06-01");

        expect(before.lineages[0].applicable.map((entry) => entry.rule.id)).toEqual([RED_LIGHT_CAR]);
        expect(after.lineages[0].uncertain[0].reasons.join(" ")).toContain("CONFLICT");
        expect(after.lineages[0].uncertain[0].reasonCodes).toHaveLength(after.lineages[0].uncertain[0].reasons.length);
    });

    it("reports the corpus scope and the documents not imported yet", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });

        await importDocument(db, BASE_DECREE);

        const result = await getRulesAsOf(db, await violationOf(db, RED_LIGHT_CAR), "2021-01-01");

        expect(result.scope).toMatchObject({ documentCount: 1, frontier: ["46/2016/NĐ-CP"] });
        expect(result.scope.disclaimer).toContain("imported corpus");
    });
});

describe("history endpoints", () => {
    it("serves as-of rules and history, and validates the date", async () => {
        const env = createMockEnv();

        await importDocument(env.DB, BASE_DECREE);

        const violationId = encodeURIComponent(await violationOf(env.DB, RED_LIGHT_CAR));
        const asOf = await app.fetch(withEnv(new Request(`http://localhost/api/violations/${violationId}/rules?as_of=2021-01-01`), env));
        const history = await app.fetch(withEnv(new Request(`http://localhost/api/violations/${violationId}/history`), env));
        const invalid = await app.fetch(withEnv(new Request(`http://localhost/api/violations/${violationId}/rules?as_of=01/01/2021`), env));
        const missing = await app.fetch(withEnv(new Request("http://localhost/api/violations/missing/history"), env));

        expect(asOf.status).toBe(200);
        expect(history.status).toBe(200);
        expect(invalid.status).toBe(400);
        expect(missing.status).toBe(404);
    });
});
