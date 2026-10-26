import { describe, expect, it } from "bun:test";
import type { D1Database } from "@cloudflare/workers-types";
import { app } from "../src/app";
import { buildChangeGraph } from "../src/modules/changes/change.service";
import { buildDocumentGraph } from "../src/modules/documents/document-graph.service";
import { diffRules } from "../src/modules/history/change-events";
import { getViolationChanges, getViolationHistory, refreshHistory } from "../src/modules/history/history.service";
import { resolveDocumentIdentities } from "../src/modules/identity/identity.service";
import type { StoredViolationRule } from "../src/modules/violations/violation.repository";
import { extractViolationRules } from "../src/modules/violations/violation.service";
import type { SemanticValue } from "../src/modules/violations/violation.types";
import { createTestD1Database } from "./d1-test-db";
import { AMENDING_DECREE, BASE_DECREE, storeLegalDocument, type FixtureDocument } from "./legal-fixtures";
import { createMockEnv, withEnv } from "./mocks";

const OPTIONS = { model: "test-model" };

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
                {
                    number: "15",
                    content: "Ngoài việc bị phạt tiền, người điều khiển xe thực hiện hành vi vi phạm còn bị trừ điểm giấy phép lái xe như sau:",
                    points: [{ number: "d", content: "Thực hiện hành vi quy định tại điểm b khoản 9 Điều này bị trừ điểm giấy phép lái xe 04 điểm." }],
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

function value(label: string, vocabId: string | null = null): SemanticValue {
    return { label, vocabId, evidence: label };
}

function rule(overrides: Partial<StoredViolationRule> = {}): StoredViolationRule {
    return {
        id: "r",
        sourceDocumentId: "d",
        provisionId: "d:dieu_1_khoan_1",
        governedDocumentId: "d",
        governedProvisionId: "d:dieu_1_khoan_1",
        sanctionProvisionId: "d:dieu_1_khoan_1",
        behaviorText: "Dừng xe trên đường cao tốc;",
        articleTitle: null,
        subjectScope: null,
        sanction: {
            fine: { min: 1_000_000, max: 2_000_000, subject: null },
            warningAllowed: false,
            currency: "VND",
            pointDeductionApplicability: "UNKNOWN",
            pointsDeducted: null,
            effects: [],
            remedialMeasures: [],
            evidenceProvisionIds: [],
        },
        semanticIr: {
            action: value("dừng xe", "ACT_DUNG_XE"),
            polarity: "ACT",
            subject: null,
            vehicles: [value("xe ô tô")],
            target: null,
            location: value("đường cao tốc"),
            conditions: [],
            exceptions: [],
            consequence: null,
        },
        semanticMethod: "LLM",
        extractionStatus: "EXTRACTED",
        uncertaintyReasons: [],
        effectiveFrom: "2020-01-01",
        evidenceLevel: "EXPLICIT_LEGAL_TEXT",
        extractionRunId: "run",
        trafficViolationId: "tv",
        ...overrides,
    };
}

describe("change events on the sample corpus", () => {
    it("describes amendment, repeal and replacement transitions with their evidence", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });

        await importDocument(db, BASE_DECREE);
        await importDocument(db, AMENDING_DECREE);
        await importDocument(db, REPLACING_DECREE);

        const redLight = await getViolationHistory(db, await violationOf(db, `${BASE_DECREE.id}:dieu_5_khoan_5_diem_a#rule`));
        const [amendment, replacement] = redLight.lineages[0].changeEvents;

        expect(amendment).toMatchObject({
            changeTypes: ["UNKNOWN"],
            effectiveAt: "2022-01-01",
            evidence: { kind: "PROVISION_RELATION", relationType: "AMENDS", fromDocumentId: AMENDING_DECREE.id },
        });
        expect(amendment.notes[0]).toContain("semantic equivalence could not be established");
        expect(replacement.changeTypes).toEqual(["REPLACED", "SANCTION_INCREASE", "POINT_DEDUCTION_APPLICABILITY_CHANGED", "LICENSE_SUSPENSION_CHANGED"]);
        expect(replacement).toMatchObject({ effectiveAt: "2025-01-01", evidence: { kind: "DOCUMENT_RELATION", relationType: "FULLY_REPEALS" } });
        expect(replacement.details.find((detail) => detail.field === "fine")).toMatchObject({
            before: { min: 3_000_000, max: 5_000_000 },
            after: { min: 18_000_000, max: 20_000_000 },
        });

        const repealed = await getViolationChanges(db, await violationOf(db, `${BASE_DECREE.id}:dieu_5_khoan_5_diem_b#rule`));

        expect(repealed.changeEvents.map((event) => event.changeTypes)).toEqual([["REPEALED", "VIOLATION_REMOVED"]]);
    });
});

describe("diffRules", () => {
    it("does not call an identical rule a change", () => {
        expect(diffRules(rule(), rule()).changeTypes).toEqual(["NO_SEMANTIC_CHANGE"]);
    });

    it("treats a reworded rule with the same canonical action and fields as no semantic change", () => {
        const result = diffRules(rule(), rule({ behaviorText: "Dừng phương tiện trên đường cao tốc;" }));

        expect(result.changeTypes).toEqual(["NO_SEMANTIC_CHANGE"]);
        expect(result.notes[0]).toContain("Wording changed");
    });

    it("reads condition, scope and sanction changes from structured fields", () => {
        const before = rule();
        const after = rule({
            semanticIr: { ...before.semanticIr, conditions: [value("gây tai nạn giao thông")], vehicles: [value("xe ô tô"), value("xe máy chuyên dùng")], location: value("làn khẩn cấp") },
            sanction: { ...before.sanction, fine: { min: 800_000, max: 1_000_000, subject: null }, pointDeductionApplicability: "APPLIES", pointsDeducted: 6 },
        });

        expect(diffRules(before, after).changeTypes.sort()).toEqual([
            "CONDITION_ADDED",
            "LOCATION_SCOPE_CHANGED",
            "POINT_DEDUCTION_APPLICABILITY_CHANGED",
            "SANCTION_DECREASE",
            "VEHICLE_SCOPE_CHANGED",
        ]);
    });

    it("separates a mixed fine change and a changed point deduction", () => {
        const before = rule({ sanction: { ...rule().sanction, pointDeductionApplicability: "APPLIES", pointsDeducted: 2 } });
        const after = rule({ sanction: { ...before.sanction, fine: { min: 500_000, max: 3_000_000, subject: null }, pointsDeducted: 4 } });

        expect(diffRules(before, after).changeTypes.sort()).toEqual(["POINT_DEDUCTION_CHANGED", "SANCTION_CHANGED"]);
    });

    it("reports UNKNOWN when only the wording changed and equivalence cannot be shown", () => {
        const before = rule({ semanticMethod: "RULE", semanticIr: { ...rule().semanticIr, action: value("dừng xe trên đường cao tốc") } });
        const after = rule({ semanticMethod: "RULE", behaviorText: "Dừng xe, đỗ xe trên đường cao tốc;", semanticIr: { ...rule().semanticIr, action: value("dừng xe, đỗ xe trên đường cao tốc") } });

        expect(diffRules(before, after).changeTypes).toEqual(["UNKNOWN"]);
    });
});

describe("change endpoints", () => {
    it("lists change events of a violation", async () => {
        const env = createMockEnv();

        await importDocument(env.DB, BASE_DECREE);
        await importDocument(env.DB, AMENDING_DECREE);

        const violationId = encodeURIComponent(await violationOf(env.DB, `${BASE_DECREE.id}:dieu_5_khoan_5_diem_a#rule`));
        const response = await app.fetch(withEnv(new Request(`http://localhost/api/violations/${violationId}/changes`), env));
        const body = (await response.json()) as { changeEvents: unknown[] };

        expect(response.status).toBe(200);
        expect(body.changeEvents).toHaveLength(1);
    });
});
