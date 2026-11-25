import { describe, expect, it } from "bun:test";
import { parseImpactScopeReport, parseLogicAuditReport, parseWorkspaceAuditOverview } from "./analysis";

describe("analysis boundary parsers", () => {
    it("parses a valid LogicAuditReport and skips malformed findings", () => {
        const parsed = parseLogicAuditReport({
            workspaceId: "ws-1",
            documentId: "doc-draft",
            documentNumber: "Dự thảo 01/2026",
            documentTitle: "Dự thảo",
            checkedAt: "2026-11-25T00:00:00Z",
            summary: {
                status: "FAIL",
                score: 80,
                total: 1,
                errorCount: 1,
                warningCount: 0,
                infoCount: 0,
                checkedRules: 16,
            },
            findings: [
                {
                    id: "f1",
                    code: "TEMP_EFFECTIVE_BEFORE_ISSUED",
                    category: "TEMPORAL",
                    severity: "ERROR",
                    title: "Ngày hiệu lực sai",
                    message: "Hiệu lực sớm hơn ban hành",
                    provisionId: null,
                    relatedDocumentId: null,
                    relatedProvisionId: null,
                    evidence: "2026-01-01 < 2026-06-01",
                    suggestion: "Sửa lại ngày hiệu lực",
                },
                {
                    id: "bad-finding",
                    code: "UNKNOWN",
                    category: "INVALID_CAT",
                    severity: "ERROR",
                    title: "Malformed",
                    message: "Drop me",
                    suggestion: "Drop",
                },
            ],
            disclaimer: "Disclaimer",
        });

        expect(parsed.summary.status).toBe("FAIL");
        expect(parsed.findings).toHaveLength(1);
        expect(parsed.findings[0]?.code).toBe("TEMP_EFFECTIVE_BEFORE_ISSUED");
    });

    it("parses a valid ImpactScopeReport including direct, indirect, frontier, and sync checklist", () => {
        const parsed = parseImpactScopeReport({
            workspaceId: "ws-1",
            documentId: "doc-draft",
            documentNumber: "Dự thảo 01/2026",
            documentTitle: "Dự thảo",
            effectiveFrom: "2026-10-01",
            analyzedAt: "2026-11-25T00:00:00Z",
            maxDepth: 3,
            summary: {
                riskLevel: "MEDIUM",
                directDocumentCount: 1,
                indirectDocumentCount: 1,
                affectedProvisionCount: 1,
                sanctionShiftCount: 1,
                escalatedCount: 1,
                reducedCount: 0,
                addedOrRepealedCount: 0,
                unresolvedCitationCount: 0,
            },
            directImpacts: [
                {
                    documentId: "doc-168",
                    documentNumber: "168/2024/NĐ-CP",
                    title: "NĐ 168",
                    documentType: "Nghị định",
                    relationType: "AMENDS",
                    scope: "PARTIAL",
                    sourceMode: "MANUAL",
                    note: "Sửa đổi Điều 6",
                    affectedProvisionCount: 1,
                },
            ],
            indirectImpacts: [
                {
                    documentId: "doc-tt73",
                    documentNumber: "73/2024/TT-BCA",
                    title: "TT 73",
                    documentType: "Thông tư",
                    depth: 2,
                    viaDocumentId: "doc-168",
                    viaRelationType: "GUIDES",
                    impactPath: ["Dự thảo 01/2026", "168/2024/NĐ-CP", "73/2024/TT-BCA"],
                    reason: "Hướng dẫn NĐ 168",
                },
            ],
            affectedProvisions: [],
            sanctionShifts: [],
            affectedSubjects: ["Người điều khiển xe ô tô"],
            unresolvedFrontier: [],
            synchronizationChecklist: [
                {
                    priority: "HIGH",
                    targetDocumentId: "doc-tt73",
                    targetLabel: "73/2024/TT-BCA",
                    action: "Sửa đồng bộ Thông tư 73",
                    reason: "Hướng dẫn NĐ 168",
                },
            ],
            disclaimer: "Disclaimer",
        });

        expect(parsed.summary.riskLevel).toBe("MEDIUM");
        expect(parsed.directImpacts).toHaveLength(1);
        expect(parsed.indirectImpacts[0]?.depth).toBe(2);
        expect(parsed.synchronizationChecklist[0]?.priority).toBe("HIGH");
    });

    it("rejects malformed workspace audit overview responses", () => {
        expect(() => parseWorkspaceAuditOverview({ workspaceId: "ws-1" })).toThrow();
    });
});
