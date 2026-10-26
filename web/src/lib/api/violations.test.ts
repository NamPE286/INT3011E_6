import { describe, expect, test } from "bun:test";
import { CHANGE_TYPE_LABELS, RULE_STATUS_LABELS, parseViolationHistory, parseViolationRulesAsOf, parseViolationSearch } from "./violations";

function ruleAtDate(id: string, status: string, overrides: { rule?: Record<string, unknown>; interval?: Record<string, unknown>; reasonCodes?: string[] } = {}): Record<string, unknown> {
    return {
        rule: {
            id,
            behaviorText: "Không chấp hành hiệu lệnh của đèn tín hiệu giao thông;",
            subjectScope: null,
            articleTitle: "Xử phạt người điều khiển xe ô tô",
            provisionId: `${id}-prov`,
            sourceDocumentId: "nd-100-2019",
            sanctionProvisionId: `${id}-fine`,
            extractionStatus: "EXTRACTED",
            uncertaintyReasons: [],
            sanction: {
                fine: { min: 3000000, max: 5000000, subject: null },
                warningAllowed: false,
                pointDeductionApplicability: "UNKNOWN",
                pointsDeducted: null,
                effects: [{ effectType: "LICENSE_SUSPENSION", rawText: "tước quyền sử dụng Giấy phép lái xe từ 01 tháng đến 03 tháng" }],
                remedialMeasures: [{ text: "Buộc tháo dỡ", sourceProvisionId: "x" }],
            },
            semanticIr: { vehicles: [{ label: "ô tô" }], conditions: [{ label: "trên đường cao tốc" }], exceptions: [] },
            ...overrides.rule,
        },
        interval: { validFrom: "2020-01-01", validTo: null, endType: null, warnings: [], ...overrides.interval },
        status,
        reasons: [],
        reasonCodes: overrides.reasonCodes ?? [],
    };
}

describe("parseViolationSearch", () => {
    test("reads violation summaries and skips rows without an id", () => {
        const parsed = parseViolationSearch({
            query: "đèn",
            violations: [{ id: "tv:1", canonicalName: "Không chấp hành hiệu lệnh của đèn tín hiệu", signatureKey: null, aliases: ["vượt đèn đỏ"] }, { canonicalName: "no id" }],
        });

        expect(parsed).toEqual([{ id: "tv:1", canonicalName: "Không chấp hành hiệu lệnh của đèn tín hiệu", aliases: ["vượt đèn đỏ"] }]);
    });

    test("rejects a response without a violations list", () => {
        expect(parseViolationSearch({})).toBeNull();
    });
});

describe("parseViolationRulesAsOf", () => {
    const response = {
        violationId: "tv:1",
        asOf: "2021-06-01",
        lineages: [
            {
                lineageId: "l1",
                contextIr: { vehicles: ["ô tô"], subject: null, subjectScope: null },
                applicable: [ruleAtDate("r1", "CURRENT")],
                uncertain: [ruleAtDate("r2", "UNCERTAIN", { rule: { uncertaintyReasons: ["NO_FINE"] }, reasonCodes: ["UNVERIFIED_RELATION"] })],
            },
        ],
        scope: { documentCount: 2, lastImportedAt: "2026-10-26T00:00:00.000Z", frontier: ["46/2016/NĐ-CP"], disclaimer: "English text from the server" },
    };

    test("reads the rule card with fine, effects and source provision", () => {
        const parsed = parseViolationRulesAsOf(response);
        const [lineage] = parsed?.lineages ?? [];

        expect(parsed?.asOf).toBe("2021-06-01");
        expect(lineage.vehicles).toEqual(["ô tô"]);
        expect(lineage.applicable[0]).toMatchObject({
            ruleId: "r1",
            status: "CURRENT",
            fine: { min: 3000000, max: 5000000 },
            effects: ["tước quyền sử dụng Giấy phép lái xe từ 01 tháng đến 03 tháng"],
            remedialMeasures: ["Buộc tháo dỡ"],
            vehicles: ["ô tô"],
            conditions: ["trên đường cao tốc"],
            provisionId: "r1-prov",
            sourceDocumentId: "nd-100-2019",
            validFrom: "2020-01-01",
            validTo: null,
        });
    });

    test("keeps uncertain rules apart from applicable rules and explains why", () => {
        const [lineage] = parseViolationRulesAsOf(response)?.lineages ?? [];

        expect(lineage.applicable.map((rule) => rule.ruleId)).toEqual(["r1"]);
        expect(lineage.uncertain.map((rule) => rule.ruleId)).toEqual(["r2"]);
        expect(lineage.uncertain[0].reasons).toEqual([
            "Chưa đọc được mức phạt từ văn bản",
            "Có văn bản tác động chưa được xác minh có thể ảnh hưởng tới quy định",
        ]);
    });

    test("carries the corpus scope and its frontier", () => {
        expect(parseViolationRulesAsOf(response)?.scope).toEqual({
            documentCount: 2,
            lastImportedAt: "2026-10-26T00:00:00.000Z",
            frontier: ["46/2016/NĐ-CP"],
        });
    });

    test("drops a rule with an unknown status rather than showing it as in force", () => {
        const parsed = parseViolationRulesAsOf({ ...response, lineages: [{ ...response.lineages[0], applicable: [ruleAtDate("r9", "MAYBE")], uncertain: [] }] });

        expect(parsed?.lineages[0].applicable).toEqual([]);
    });

    test("rejects a response without lineages", () => {
        expect(parseViolationRulesAsOf({ asOf: "2021-06-01" })).toBeNull();
    });
});

describe("parseViolationHistory", () => {
    test("reads each lineage with its rules, links and semantic change events", () => {
        const parsed = parseViolationHistory({
            violationId: "tv:1",
            lineages: [
                {
                    id: "l1",
                    contextIr: { vehicles: [], subject: null, subjectScope: null },
                    ruleIds: ["r1", "r2"],
                    links: [{ fromRuleId: "r1", toRuleId: "r2", link: "PROVISION_RELATION", evidenceId: "pr1" }],
                    rules: [ruleAtDate("r1", "AMENDED", { interval: { validTo: "2022-01-01", endType: "AMENDED" } }), ruleAtDate("r2", "CURRENT", { interval: { validFrom: "2022-01-01" } })],
                    changeEvents: [
                        {
                            id: "ce1",
                            oldRuleId: "r1",
                            newRuleId: "r2",
                            changeTypes: ["SANCTION_INCREASE"],
                            details: [{ field: "fine", before: { min: 3000000 }, after: { min: 4000000 } }],
                            effectiveAt: "2022-01-01",
                            notes: ["English note"],
                            evidence: { kind: "PROVISION_RELATION", relationId: "pr1", relationType: "AMENDS", fromDocumentId: "nd-123-2021", effectiveFrom: "2022-01-01" },
                        },
                    ],
                },
            ],
            scope: { documentCount: 2, lastImportedAt: null, frontier: [], disclaimer: "d" },
        });
        const [lineage] = parsed?.lineages ?? [];

        expect(lineage.rules.map((rule) => [rule.ruleId, rule.status, rule.endType])).toEqual([
            ["r1", "AMENDED", "AMENDED"],
            ["r2", "CURRENT", null],
        ]);
        expect(lineage.changeEvents[0]).toMatchObject({ oldRuleId: "r1", newRuleId: "r2", changeTypes: ["SANCTION_INCREASE"], effectiveAt: "2022-01-01", evidenceDocumentId: "nd-123-2021" });
        expect(lineage.changeEvents[0].details[0].field).toBe("fine");
    });

    test("ignores change types the client does not know instead of failing the page", () => {
        const parsed = parseViolationHistory({
            violationId: "tv:1",
            lineages: [{ id: "l1", contextIr: { vehicles: [], subject: null }, rules: [], changeEvents: [{ id: "ce", oldRuleId: null, newRuleId: "r", changeTypes: ["VIOLATION_ADDED", "FUTURE_TYPE"], details: [], effectiveAt: null, notes: [] }] }],
            scope: { documentCount: 0, lastImportedAt: null, frontier: [], disclaimer: "" },
        });

        expect(parsed?.lineages[0].changeEvents[0].changeTypes).toEqual(["VIOLATION_ADDED"]);
    });
});

describe("labels", () => {
    test("label every rule status and the change types the backend produces", () => {
        expect(Object.keys(RULE_STATUS_LABELS).sort()).toEqual(["AMENDED", "CURRENT", "NOT_YET_EFFECTIVE", "REPEALED", "SUPERSEDED", "UNCERTAIN"]);
        expect(CHANGE_TYPE_LABELS.SANCTION_INCREASE).toBeDefined();
        expect(CHANGE_TYPE_LABELS.UNKNOWN).toBeDefined();
    });
});
