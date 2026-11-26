import { describe, expect, it } from "bun:test";
import { analyzeLocalDraft } from "./analyzer";
import { IncrementalLlmCache } from "./llm-incremental";
import type { LocalWorkspaceFile } from "./local-workspace";
import { parseDraftDocument } from "./parser";

describe("Term definition recognition & AM001 suppression", () => {
    it("recognizes 'nghiêm trọng' in Điều Giải thích từ ngữ without quotes and suppresses AM001", async () => {
        const draft = `Điều 1. Phạm vi điều chỉnh
Quy định xử lý hành vi vi phạm.

Điều 2. Giải thích từ ngữ
1. Nghiêm trọng là hành vi gây thiệt hại từ 100.000.000 đồng trở lên.

Điều 3. Xử lý vi phạm
Người thực hiện hành vi nghiêm trọng bị phạt tiền từ 5.000.000 đồng đến 10.000.000 đồng.`;

        const result = await analyzeLocalDraft(draft, []);
        const am001 = result.diagnostics.filter((d) => d.code === "AM001" && d.excerpt.toLowerCase().includes("nghiêm trọng"));

        expect(am001.length).toBe(0);
        expect(result.terms.some((t) => t.normalizedTerm === "nghiêm trọng" && t.status === "DEFINED_IN_DRAFT")).toBe(true);
        expect(result.termOccurrences?.some((o) => o.normalizedTerm === "nghiêm trọng" && o.line === 8)).toBe(true);
    });

    it("recognizes inline explicit definition outside Điều Giải thích từ ngữ", async () => {
        const draft = `Điều 1. Quy định chung
Trong Nghị định này, nghiêm trọng được hiểu là gây thiệt hại từ 50.000.000 đồng trở lên.

Điều 2. Chế tài
Hành vi nghiêm trọng bị phạt tiền từ 1.000.000 đồng đến 2.000.000 đồng.`;

        const parsed = parseDraftDocument(draft);
        expect(parsed.definedTerms.has("nghiêm trọng")).toBe(true);

        const result = await analyzeLocalDraft(draft, []);
        const am001 = result.diagnostics.filter((d) => d.code === "AM001" && d.excerpt.toLowerCase().includes("nghiêm trọng"));
        expect(am001.length).toBe(0);
    });

    it("suppresses AM001 when 'hậu quả nghiêm trọng' is defined as a compound term", async () => {
        const draft = `Điều 1. Giải thích từ ngữ
- Hậu quả nghiêm trọng: là thiệt hại về tài sản từ 200.000.000 đồng trở lên.

Điều 2. Xử phạt
1. Người gây hậu quả nghiêm trọng bị phạt tiền từ 10.000.000 đồng đến 20.000.000 đồng.
2. Hành vi gây ảnh hưởng nghiêm trọng bị nhắc nhở.`;

        const result = await analyzeLocalDraft(draft, []);
        const am001 = result.diagnostics.filter((d) => d.code === "AM001" && d.excerpt.toLowerCase().includes("nghiêm trọng"));

        expect(am001.length).toBe(1);
        expect(am001[0].range.startLine).toBe(6);
    });

    it("suppresses AM001 when 'nghiêm trọng' is defined in another workspace file", async () => {
        const baseLaw: LocalWorkspaceFile = {
            path: "luat-goc.txt",
            name: "luat-goc.txt",
            title: "Luật Gốc",
            documentNumber: "10/2025/QH15",
            documentType: "Luật",
            isLibrary: true,
            updatedAt: "2026-01-01T00:00:00Z",
            content: `Điều 2. Giải thích từ ngữ
1. "Nghiêm trọng" là mức độ vi phạm vượt quá 50% giới hạn cho phép.`,
        };
        const draft = `Điều 1. Chế tài
Hành vi nghiêm trọng bị phạt tiền từ 5.000.000 đồng đến 10.000.000 đồng.`;

        const result = await analyzeLocalDraft(draft, [baseLaw]);
        const am001 = result.diagnostics.filter((d) => d.code === "AM001" && d.excerpt.toLowerCase().includes("nghiêm trọng"));

        expect(am001.length).toBe(0);
        expect(result.terms.some((t) => t.normalizedTerm === "nghiêm trọng" && t.status === "DEFINED_IN_WORKSPACE")).toBe(true);
    });
});

describe("IncrementalLlmCache preservation during Tier 0 typing & Refresh clear", () => {
    it("preserves and re-anchors cached Neuro-Symbolic results when includeAi is false", async () => {
        const cache = new IncrementalLlmCache();
        const baseDraft = `Điều 1. Đối tượng áp dụng
Áp dụng cho cá nhân.

Điều 2. Xếp loại mức A
1. Đạt từ 80% trở lên được xếp loại hoàn thành tốt.`;

        const parsed = parseDraftDocument(baseDraft);
        const art2 = parsed.nodes.find((n) => n.level === "ARTICLE" && n.articleNo === "2")!;
        const slice = baseDraft.slice(art2.startOffset, art2.endOffset).trim();

        // Compute the same hash key used by groupArticlesForNeuroSymbolicAudit (note: Điều 1 + Điều 2 are in 1 group)
        const fullGroupText = baseDraft.slice(parsed.nodes[0].startOffset, art2.endOffset).trim();
        const { fnv1aHash } = await import("./llm-incremental");
        const hash = fnv1aHash(fullGroupText);

        cache.neuroSymbolicCache.set(`gemini-3.5-flash-lite::${hash}`, {
            partitions: [],
            semanticDefects: [
                {
                    kind: "PROCEDURAL_GAP",
                    severity: "warning",
                    title: "Thiếu thời hạn đánh giá",
                    message: "Chưa nêu thời hạn đánh giá xếp loại.",
                    suggestion: "Bổ sung thời hạn cụ thể.",
                    quote: "được xếp loại hoàn thành tốt.",
                    secondQuote: null,
                    startOffset: 0,
                    endOffset: 10,
                    line: 1,
                    provisionRef: "Khoản 1 Điều 2",
                },
            ],
        });

        const res = await analyzeLocalDraft(baseDraft, [], {
            includeAi: false,
            deepNeuroSymbolic: true,
            model: "gemini-3.5-flash-lite",
            incrementalCache: cache,
        });

        expect(res.diagnostics.some((d) => d.title === "Thiếu thời hạn đánh giá" && d.range.startLine === 5)).toBe(true);
        expect(res.aiStatus.used).toBe(true);

        cache.clear();
        const afterClear = await analyzeLocalDraft(baseDraft, [], {
            includeAi: false,
            deepNeuroSymbolic: true,
            model: "gemini-3.5-flash-lite",
            incrementalCache: cache,
        });
        expect(afterClear.diagnostics.some((d) => d.title === "Thiếu thời hạn đánh giá")).toBe(false);
        expect(slice.length).toBeGreaterThan(0);
    });
});
