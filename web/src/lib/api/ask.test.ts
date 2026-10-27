import { describe, expect, test } from "bun:test";
import { parseAskAnswer } from "./ask";

function answer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        question: "Vượt đèn đỏ phạt bao nhiêu?",
        asOf: "2021-06-01",
        status: "ANSWERED",
        clarification: null,
        claims: [{ text: "Phạt từ 3.000.000 đồng đến 5.000.000 đồng.", evidenceIds: ["E1"] }],
        evidence: [
            {
                id: "E1",
                violationId: "tv:1",
                violationName: "Không chấp hành hiệu lệnh của đèn tín hiệu giao thông",
                ruleId: "r1",
                status: "CURRENT",
                behaviorText: "Không chấp hành hiệu lệnh của đèn tín hiệu giao thông;",
                fine: { min: 3000000, max: 5000000 },
                validFrom: "2020-01-01",
                validTo: null,
                source: { documentId: "nd-100-2019", documentNumber: "100/2019/NĐ-CP", documentTitle: null, provisionId: "nd-100-2019:dieu_5_khoan_5_diem_a" },
            },
        ],
        scope: { documentCount: 2, lastImportedAt: null, frontier: [], disclaimer: "d" },
        provenance: { method: "RULE_ONLY", model: null, promptVersion: null, retrievedViolationIds: ["tv:1"], droppedClaims: 0, fallbackReason: null },
        ...overrides,
    };
}

describe("parseAskAnswer", () => {
    test("reads the answer with claims that resolve to their evidence", () => {
        const parsed = parseAskAnswer(answer());

        expect(parsed?.status).toBe("ANSWERED");
        expect(parsed?.claims).toEqual([{ text: "Phạt từ 3.000.000 đồng đến 5.000.000 đồng.", evidenceIds: ["E1"] }]);
        expect(parsed?.evidence[0]).toMatchObject({
            id: "E1",
            fine: { min: 3000000, max: 5000000 },
            source: { documentId: "nd-100-2019", documentNumber: "100/2019/NĐ-CP", provisionId: "nd-100-2019:dieu_5_khoan_5_diem_a" },
        });
        expect(parsed?.provenance.method).toBe("RULE_ONLY");
    });

    test("never shows a legal claim whose citation does not resolve to evidence", () => {
        const parsed = parseAskAnswer(answer({ claims: [{ text: "Có nguồn", evidenceIds: ["E1"] }, { text: "Không có nguồn", evidenceIds: ["E7"] }, { text: "Trống", evidenceIds: [] }] }));

        expect(parsed?.claims.map((claim) => claim.text)).toEqual(["Có nguồn"]);
    });

    test("rejects an unknown status instead of presenting it as an answer", () => {
        expect(parseAskAnswer(answer({ status: "CONFIDENT" }))).toBeNull();
    });

    test("keeps the clarification for an ambiguous question", () => {
        const parsed = parseAskAnswer(answer({ status: "AMBIGUOUS", clarification: "Hãy nêu rõ phương tiện" }));

        expect(parsed?.clarification).toBe("Hãy nêu rõ phương tiện");
    });

    test("rejects a response that is not an answer", () => {
        expect(parseAskAnswer(null)).toBeNull();
        expect(parseAskAnswer({ status: "ANSWERED" })).toBeNull();
    });
});
