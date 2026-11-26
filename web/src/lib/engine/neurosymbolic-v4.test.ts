import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeLocalDraft } from "./analyzer";
import { compileDraftToLean } from "./lean-compiler";
import { anchorNeuroSymbolicOutput } from "./llm-neurosymbolic";
import { buildLocalWorkspaceContext } from "./local-workspace";
import { parseDraftDocument } from "./parser";

describe("Neuro-Symbolic Pipeline v4", () => {
    test("Tier 0 LG017 catches orphaned sub-provision when siblings are cited >=2 times", async () => {
        const doc = `NGHỊ ĐỊNH SỐ 01/2026/NĐ-CP
Điều 3. Tiêu chuẩn chung
5. Tiêu chuẩn riêng:
a) Tiêu chuẩn đối với lãnh đạo.
b) Tiêu chuẩn đối với chuyên viên.
Điều 4. Xếp loại A
1. Đáp ứng điểm a khoản 5 Điều 3 Nghị định này.
Điều 5. Xếp loại B
1. Đáp ứng điểm a khoản 5 Điều 3 Nghị định này.`;
        const res = await analyzeLocalDraft(doc, [], { includeAi: false });

        expect(res.lean.tokenStats.actualAiTokens).toBe(0);
        expect(res.diagnostics.some((d) => d.code === "LG017" && (d.provisionRef?.includes("Điểm b Khoản 5 Điều 3") ?? false))).toBe(true);
    });

    test("Tier 0 LG004 catches clause -> parent article self-reference", async () => {
        const doc = `NGHỊ ĐỊNH SỐ 01/2026/NĐ-CP
Điều 10. Xử lý vi phạm
1. Quy định chung.
2. Việc xử lý thực hiện theo quy định tại Điều 10 của Nghị định này.`;
        const res = await analyzeLocalDraft(doc, [], { includeAi: false });

        expect(res.diagnostics.some((d) => d.code === "LG004")).toBe(true);
    });

    test("Lean 4 formal verifier proves cross-article dead zones, lower coverage voids, and boundary gaps", () => {
        const doc = `NGHỊ ĐỊNH MẪU
Điều 6. Hoàn thành nhiệm vụ
2. Không quá 20% tiêu chí chưa bảo đảm chất lượng.
3. Hoàn thành trên 70% các chỉ tiêu, nhiệm vụ.
4. Có ít nhất 70% đơn vị trực thuộc hoàn thành nhiệm vụ.
Điều 7. Không hoàn thành nhiệm vụ
2. Có trên 50% tiêu chí chưa bảo đảm chất lượng.
3. Hoàn thành dưới 50% các chỉ tiêu, nhiệm vụ.`;
        const draft = parseDraftDocument(doc);
        const ws = buildLocalWorkspaceContext([]);
        const compiled = compileDraftToLean({
            draft,
            fineRanges: [],
            thresholds: [],
            references: [],
            terms: [],
            diagnostics: [],
            workspaceContext: ws,
            extractedPartitions: [
                {
                    domainKey: "tieu_chi_nv",
                    tierLabel: "Điều 6 K2",
                    unit: "%",
                    min: 0,
                    max: 20,
                    minInclusive: true,
                    maxInclusive: true,
                    quote: "Không quá 20% tiêu chí",
                    startOffset: 0,
                    endOffset: 20,
                    line: 3,
                    provisionRef: "Khoản 2 Điều 6",
                },
                {
                    domainKey: "tieu_chi_nv",
                    tierLabel: "Điều 7 K2",
                    unit: "%",
                    min: 50,
                    max: 100,
                    minInclusive: false,
                    maxInclusive: true,
                    quote: "trên 50% tiêu chí",
                    startOffset: 0,
                    endOffset: 20,
                    line: 7,
                    provisionRef: "Khoản 2 Điều 7",
                },
                {
                    domainKey: "chi_tieu_dv",
                    tierLabel: "Điều 7 K3",
                    unit: "%",
                    min: 0,
                    max: 50,
                    minInclusive: true,
                    maxInclusive: false,
                    quote: "dưới 50% các chỉ tiêu",
                    startOffset: 0,
                    endOffset: 20,
                    line: 8,
                    provisionRef: "Khoản 3 Điều 7",
                },
                {
                    domainKey: "chi_tieu_dv",
                    tierLabel: "Điều 6 K3",
                    unit: "%",
                    min: 70,
                    max: 100,
                    minInclusive: false,
                    maxInclusive: true,
                    quote: "trên 70% các chỉ tiêu",
                    startOffset: 0,
                    endOffset: 20,
                    line: 4,
                    provisionRef: "Khoản 3 Điều 6",
                },
                {
                    domainKey: "don_vi_truc_thuoc",
                    tierLabel: "Điều 6 K4",
                    unit: "%",
                    min: 70,
                    max: 100,
                    minInclusive: true,
                    maxInclusive: true,
                    quote: "ít nhất 70% đơn vị trực thuộc",
                    startOffset: 0,
                    endOffset: 20,
                    line: 5,
                    provisionRef: "Khoản 4 Điều 6",
                },
            ],
        });

        expect(compiled.report.refutedCount).toBe(3);
        expect(compiled.derivedDiagnostics.filter((d) => d.code === "LP003").length).toBe(3);
    });

    test("Anti-Hallucination Gate rejects fabricated quotes and external-law hallucinations", () => {
        const draft = parseDraftDocument("NGHỊ ĐỊNH\nĐiều 16. Thẩm quyền\n3. Thực hiện theo Điều 43 Luật Viên chức.");
        const anchored = anchorNeuroSymbolicOutput(draft, {
            partitions: [
                {
                    domainKey: "fake",
                    tierLabel: "Fake",
                    unit: "%",
                    min: 0,
                    max: 10,
                    minInclusive: true,
                    maxInclusive: true,
                    quote: "chuỗi không hề tồn tại trong văn bản",
                },
            ],
            semanticDefects: [
                {
                    kind: "INTERNAL_CONTRADICTION",
                    severity: "error",
                    title: "Dẫn chiếu sai",
                    message: "Điều 43 Luật Viên chức không có khoản 3.",
                    suggestion: "Sửa lại.",
                    quote: "Thực hiện theo Điều 43 Luật Viên chức.",
                    secondQuote: null,
                },
            ],
        });

        expect(anchored.partitions.length).toBe(0);
        expect(anchored.semanticDefects.length).toBe(0);
    });
});
