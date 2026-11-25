import { describe, expect, it } from "bun:test";
import type { ExecutionContext } from "@cloudflare/workers-types";
import worker from "../src/index";
import { runLogicAudit } from "../src/modules/analysis/logic-audit";
import { analyzeImpactScope } from "../src/modules/analysis/impact-scope";
import type { WorkspaceAnalysisSnapshot } from "../src/modules/analysis/analysis.types";
import { createTestD1Database } from "./d1-test-db";
import { createMockEnv } from "./mocks";

function buildBaseSnapshot(): WorkspaceAnalysisSnapshot {
    return {
        workspaceId: "ws-test",
        documents: [
            {
                id: "doc-100",
                title: "Nghị định xử phạt giao thông 2019",
                documentNumber: "100/2019/NĐ-CP",
                normalizedNumber: "100/2019/ND-CP",
                documentType: "Nghị định",
                agency: "Chính phủ",
                issuedAt: "2019-12-30",
                effectiveFrom: "2020-01-01",
                isManual: false,
            },
            {
                id: "doc-168",
                title: "Nghị định xử phạt giao thông 2024",
                documentNumber: "168/2024/NĐ-CP",
                normalizedNumber: "168/2024/ND-CP",
                documentType: "Nghị định",
                agency: "Chính phủ",
                issuedAt: "2024-12-26",
                effectiveFrom: "2025-01-01",
                isManual: false,
            },
            {
                id: "doc-tt73",
                title: "Thông tư hướng dẫn thi hành Nghị định 168/2024/NĐ-CP",
                documentNumber: "73/2024/TT-BCA",
                normalizedNumber: "73/2024/TT-BCA",
                documentType: "Thông tư",
                agency: "Bộ Công an",
                issuedAt: "2024-12-28",
                effectiveFrom: "2025-01-01",
                isManual: false,
            },
            {
                id: "doc-draft",
                title: "Dự thảo Nghị định sửa đổi mức xử phạt trên cao tốc",
                documentNumber: "Dự thảo 01/2026/NĐ-CP",
                normalizedNumber: "DU THAO 01/2026/ND-CP",
                documentType: "Dự thảo",
                agency: "Bộ Công an",
                issuedAt: "2026-06-01",
                effectiveFrom: "2026-10-01",
                isManual: true,
            },
        ],
        provisions: [
            {
                id: "doc-168:d6",
                documentId: "doc-168",
                parentId: null,
                ordinal: 1,
                level: "ARTICLE",
                number: "6",
                title: "Xử phạt người điều khiển xe ô tô",
                text: null,
                articleNo: "6",
                paragraphNo: null,
                pointNo: null,
            },
            {
                id: "doc-168:d6k7",
                documentId: "doc-168",
                parentId: "doc-168:d6",
                ordinal: 2,
                level: "CLAUSE",
                number: "7",
                title: null,
                text: "Phạt tiền từ 12.000.000 đồng đến 14.000.000 đồng và trừ 06 điểm giấy phép lái xe đối với hành vi dừng xe, đỗ xe trên đường cao tốc không đúng nơi quy định.",
                articleNo: "6",
                paragraphNo: "7",
                pointNo: null,
            },
            {
                id: "doc-draft:d1",
                documentId: "doc-draft",
                parentId: null,
                ordinal: 1,
                level: "ARTICLE",
                number: "1",
                title: "Điều chỉnh khung xử phạt trên đường cao tốc",
                text: null,
                articleNo: "1",
                paragraphNo: null,
                pointNo: null,
            },
            {
                id: "doc-draft:d1k1",
                documentId: "doc-draft",
                parentId: "doc-draft:d1",
                ordinal: 2,
                level: "CLAUSE",
                number: "1",
                title: null,
                text: "Phạt tiền từ 14.000.000 đồng đến 18.000.000 đồng và trừ 08 điểm giấy phép lái xe đối với hành vi dừng xe, đỗ xe trên đường cao tốc không đúng nơi quy định.",
                articleNo: "1",
                paragraphNo: "1",
                pointNo: null,
            },
        ],
        documentRelations: [
            {
                id: "dr-168-100",
                fromDocumentId: "doc-168",
                toDocumentId: "doc-100",
                relationType: "REPLACES",
                scope: "FULL",
                verificationStatus: "ACCEPTED",
                sourceMode: "AI",
                note: "Thay thế NĐ 100/2019",
            },
            {
                id: "dr-tt73-168",
                fromDocumentId: "doc-tt73",
                toDocumentId: "doc-168",
                relationType: "GUIDES",
                scope: "PARTIAL",
                verificationStatus: "ACCEPTED",
                sourceMode: "AI",
                note: "Hướng dẫn thi hành NĐ 168/2024",
            },
            {
                id: "dr-draft-168",
                fromDocumentId: "doc-draft",
                toDocumentId: "doc-168",
                relationType: "AMENDS",
                scope: "PARTIAL",
                verificationStatus: "ACCEPTED",
                sourceMode: "MANUAL",
                note: "Sửa đổi Điều 6 NĐ 168/2024",
            },
        ],
        provisionRelations: [
            {
                id: "pr-draft-168",
                fromDocumentId: "doc-draft",
                fromProvisionId: "doc-draft:d1k1",
                toDocumentId: "doc-168",
                toProvisionId: "doc-168:d6k7",
                relationType: "AMENDS",
                verificationStatus: "ACCEPTED",
                evidenceText: "Nâng khung phạt đỗ xe trái phép trên cao tốc",
                effectiveFrom: "2026-10-01",
                sourceMode: "MANUAL",
            },
        ],
        sanctionEdges: [
            {
                id: "sc-1",
                fromDocumentId: "doc-draft",
                toDocumentId: "doc-168",
                fromProvisionId: "doc-draft:d1k1",
                toProvisionId: "doc-168:d6k7",
                behaviorSummary: "Dừng xe, đỗ xe trái phép trên đường cao tốc",
                changeType: "SANCTION_INCREASE",
                oldPenaltyText: "12.000.000 – 14.000.000 đ",
                newPenaltyText: "14.000.000 – 18.000.000 đ",
                oldFineMin: 12000000,
                oldFineMax: 14000000,
                newFineMin: 14000000,
                newFineMax: 18000000,
                severityDeltaPercent: 29,
                note: "Tăng nặng khung phạt cao tốc",
                sourceMode: "MANUAL",
            },
        ],
    };
}

describe("runLogicAudit (Soát logic luật)", () => {
    it("passes cleanly for a structurally, temporally, and legally consistent draft", () => {
        const snapshot = buildBaseSnapshot();
        const report = runLogicAudit(snapshot, "doc-draft");

        expect(report).not.toBeNull();
        expect(report?.summary.status).toBe("PASS");
        expect(report?.summary.errorCount).toBe(0);
        expect(report?.summary.warningCount).toBe(0);
        expect(report?.summary.score).toBe(100);
    });

    it("detects structural defects: duplicate numbers, numbering gaps, invalid hierarchy, and empty provisions", () => {
        const snapshot = buildBaseSnapshot();
        snapshot.provisions.push(
            {
                id: "doc-draft:d1-dup",
                documentId: "doc-draft",
                parentId: null,
                ordinal: 3,
                level: "ARTICLE",
                number: "1",
                title: "Điều trùng số",
                text: null,
                articleNo: "1",
                paragraphNo: null,
                pointNo: null,
            },
            {
                id: "doc-draft:d3",
                documentId: "doc-draft",
                parentId: null,
                ordinal: 4,
                level: "ARTICLE",
                number: "3",
                title: "Điều bị nhảy cóc (thiếu Điều 2)",
                text: null,
                articleNo: "3",
                paragraphNo: null,
                pointNo: null,
            },
            {
                id: "doc-draft:d3-pt",
                documentId: "doc-draft",
                parentId: "doc-draft:d3",
                ordinal: 5,
                level: "POINT",
                number: "a",
                title: null,
                text: "Điểm gắn trực tiếp dưới Điều không qua Khoản.",
                articleNo: "3",
                paragraphNo: null,
                pointNo: "a",
            },
        );

        const report = runLogicAudit(snapshot, "doc-draft");
        const codes = new Set(report?.findings.map((finding) => finding.code));

        expect(codes.has("STRUCT_DUPLICATE_NUMBER")).toBe(true);
        expect(codes.has("STRUCT_NUMBERING_GAP")).toBe(true);
        expect(codes.has("STRUCT_INVALID_HIERARCHY")).toBe(true);
        expect(codes.has("STRUCT_EMPTY_PROVISION")).toBe(true);
        expect(report?.summary.status).toBe("FAIL");
    });

    it("detects temporal and lifecycle defects: effective before issued, amending repealed doc, self-relation, and cycles", () => {
        const snapshot = buildBaseSnapshot();
        const draft = snapshot.documents.find((doc) => doc.id === "doc-draft");

        if (draft) {
            draft.issuedAt = "2026-10-01";
            draft.effectiveFrom = "2026-05-01";
        }

        // Amend doc-100 which was ALREADY replaced in full by doc-168!
        snapshot.documentRelations.push(
            {
                id: "dr-draft-100",
                fromDocumentId: "doc-draft",
                toDocumentId: "doc-100",
                relationType: "AMENDS",
                scope: "PARTIAL",
                verificationStatus: "ACCEPTED",
                sourceMode: "MANUAL",
                note: "Sửa văn bản đã bị thay thế toàn bộ",
            },
            {
                id: "dr-self",
                fromDocumentId: "doc-draft",
                toDocumentId: "doc-draft",
                relationType: "AMENDS",
                scope: "PARTIAL",
                verificationStatus: "ACCEPTED",
                sourceMode: "MANUAL",
                note: null,
            },
            {
                id: "dr-cycle",
                fromDocumentId: "doc-168",
                toDocumentId: "doc-draft",
                relationType: "AMENDS",
                scope: "PARTIAL",
                verificationStatus: "ACCEPTED",
                sourceMode: "MANUAL",
                note: "Tạo vòng lặp sửa đổi",
            },
        );

        const report = runLogicAudit(snapshot, "doc-draft");
        const codes = new Set(report?.findings.map((finding) => finding.code));

        expect(codes.has("TEMP_EFFECTIVE_BEFORE_ISSUED")).toBe(true);
        expect(codes.has("TEMP_AMEND_REPEALED_TARGET")).toBe(true);
        expect(codes.has("TEMP_SELF_RELATION")).toBe(true);
        expect(codes.has("TEMP_RELATION_CYCLE")).toBe(true);
    });

    it("detects broken internal citations, unresolved external document citations, and unlinked amendment clauses", () => {
        const snapshot = buildBaseSnapshot();
        snapshot.documentRelations = snapshot.documentRelations.filter((rel) => rel.fromDocumentId !== "doc-draft");
        snapshot.provisionRelations = [];
        snapshot.provisions.push({
            id: "doc-draft:d1k2",
            documentId: "doc-draft",
            parentId: "doc-draft:d1",
            ordinal: 3,
            level: "CLAUSE",
            number: "2",
            title: null,
            text: "Sửa đổi quy định tại Điều 99 và khoản 5 Điều này theo tinh thần Nghị định số 88/2025/NĐ-CP.",
            articleNo: "1",
            paragraphNo: "2",
            pointNo: null,
        });

        const report = runLogicAudit(snapshot, "doc-draft");
        const codes = new Set(report?.findings.map((finding) => finding.code));

        expect(codes.has("REF_BROKEN_INTERNAL_CITATION")).toBe(true);
        expect(codes.has("REF_UNRESOLVED_EXTERNAL_DOCUMENT")).toBe(true);
        expect(codes.has("REF_UNLINKED_AMENDMENT_CLAUSE")).toBe(true);
    });

    it("detects sanction logic errors: inverted fine range, invalid point deduction (> 12), and implicit norm conflict", () => {
        const snapshot = buildBaseSnapshot();
        // Remove explicit link to doc-168 so overlapping sanction becomes an implicit conflict
        snapshot.documentRelations = snapshot.documentRelations.filter((rel) => rel.fromDocumentId !== "doc-draft");
        snapshot.provisionRelations = [];
        snapshot.provisions.push({
            id: "doc-draft:d1k2",
            documentId: "doc-draft",
            parentId: "doc-draft:d1",
            ordinal: 3,
            level: "CLAUSE",
            number: "2",
            title: null,
            text: "Phạt tiền từ 20.000.000 đồng đến 10.000.000 đồng và trừ 15 điểm giấy phép lái xe đối với hành vi đi ngược chiều.",
            articleNo: "1",
            paragraphNo: "2",
            pointNo: null,
        });

        const report = runLogicAudit(snapshot, "doc-draft");
        const codes = new Set(report?.findings.map((finding) => finding.code));

        expect(codes.has("SANC_INVERTED_FINE_RANGE")).toBe(true);
        expect(codes.has("SANC_INVALID_POINT_DEDUCTION")).toBe(true);
        expect(codes.has("SANC_IMPLICIT_NORM_CONFLICT")).toBe(true);
    });
});

describe("analyzeImpactScope (Phân tích phạm vi tác động)", () => {
    it("computes direct impacts, transitive multi-hop cascading impacts, sanction shifts, and sync checklist", () => {
        const snapshot = buildBaseSnapshot();
        snapshot.provisions.push({
            id: "doc-draft:d1k2",
            documentId: "doc-draft",
            parentId: "doc-draft:d1",
            ordinal: 3,
            level: "CLAUSE",
            number: "2",
            title: null,
            text: "Áp dụng đồng thời với quy định tại Thông tư số 99/2025/TT-BGTVT đối với người điều khiển xe ô tô.",
            articleNo: "1",
            paragraphNo: "2",
            pointNo: null,
        });

        const impact = analyzeImpactScope(snapshot, "doc-draft");

        expect(impact).not.toBeNull();
        expect(impact?.summary.directDocumentCount).toBe(1);
        expect(impact?.directImpacts[0]?.documentId).toBe("doc-168");
        expect(impact?.summary.indirectDocumentCount).toBe(1);
        expect(impact?.indirectImpacts[0]?.documentId).toBe("doc-tt73");
        expect(impact?.indirectImpacts[0]?.depth).toBe(2);
        expect(impact?.summary.affectedProvisionCount).toBe(1);
        expect(impact?.summary.sanctionShiftCount).toBe(1);
        expect(impact?.summary.escalatedCount).toBe(1);
        expect(impact?.summary.unresolvedCitationCount).toBe(1);
        expect(impact?.unresolvedFrontier[0]?.citation).toContain("99/2025/TT-BGTVT");
        expect(impact?.affectedSubjects.length).toBeGreaterThan(0);
        expect(impact?.synchronizationChecklist.length).toBeGreaterThan(0);
    });
});

describe("Analysis HTTP API (Workspace-scoped /audit, /impact, /workspace/audit-summary)", () => {
    it("serves logic audit, impact scope, and workspace summary scoped to the authenticated user workspace", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });
        const env = createMockEnv({ DB: db });

        const signUpRes = await worker.fetch(
            new Request("http://localhost:8787/api/auth/sign-up/email", {
                method: "POST",
                headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
                body: JSON.stringify({ email: "auditor@gov.vn", password: "password123", name: "Chuyên viên Pháp chế" }),
            }),
            env,
            {} as ExecutionContext,
        );
        expect(signUpRes.status).toBe(200);
        const cookie = (signUpRes.headers.get("set-cookie") ?? "")
            .split(",")
            .map((part) => part.split(";")[0]?.trim())
            .filter(Boolean)
            .join("; ");

        // Auto-provisioned sample workspace
        const wsListRes = await worker.fetch(
            new Request("http://localhost:8787/api/workspaces", { headers: { Cookie: cookie } }),
            env,
            {} as ExecutionContext,
        );
        expect(wsListRes.status).toBe(200);
        const wsList = (await wsListRes.json()) as { workspaces: { id: string }[] };
        const wsId = wsList.workspaces[0]?.id;
        expect(wsId).toBeDefined();

        // Workspace audit overview
        const summaryRes = await worker.fetch(
            new Request("http://localhost:8787/api/workspace/audit-summary", {
                headers: { Cookie: cookie, "X-Workspace-Id": wsId! },
            }),
            env,
            {} as ExecutionContext,
        );
        expect(summaryRes.status).toBe(200);
        const summary = (await summaryRes.json()) as {
            totalDocuments: number;
            documents: { documentId: string; documentNumber: string | null }[];
        };
        expect(summary.totalDocuments).toBeGreaterThanOrEqual(4);

        const draftDoc = summary.documents.find((item) => item.documentNumber?.includes("Dự thảo"));
        expect(draftDoc).toBeDefined();

        // Document logic audit endpoint
        const auditRes = await worker.fetch(
            new Request(`http://localhost:8787/api/documents/${encodeURIComponent(draftDoc!.documentId)}/audit`, {
                headers: { Cookie: cookie, "X-Workspace-Id": wsId! },
            }),
            env,
            {} as ExecutionContext,
        );
        expect(auditRes.status).toBe(200);
        const audit = (await auditRes.json()) as { documentId: string; summary: { checkedRules: number } };
        expect(audit.documentId).toBe(draftDoc!.documentId);
        expect(audit.summary.checkedRules).toBeGreaterThan(0);

        // Document impact scope endpoint
        const impactRes = await worker.fetch(
            new Request(`http://localhost:8787/api/documents/${encodeURIComponent(draftDoc!.documentId)}/impact`, {
                headers: { Cookie: cookie, "X-Workspace-Id": wsId! },
            }),
            env,
            {} as ExecutionContext,
        );
        expect(impactRes.status).toBe(200);
        const impact = (await impactRes.json()) as {
            documentId: string;
            summary: { directDocumentCount: number; indirectDocumentCount: number };
        };
        expect(impact.documentId).toBe(draftDoc!.documentId);
        expect(impact.summary.directDocumentCount).toBeGreaterThanOrEqual(1);
        expect(impact.summary.indirectDocumentCount).toBeGreaterThanOrEqual(1);
    });
});
