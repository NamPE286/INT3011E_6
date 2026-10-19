import { describe, expect, it } from "bun:test";
import { assembleLegalDocument } from "../src/modules/processing/legal-assembler";
import { classifyMarker, InvalidTranscriptionError, parseTranscription } from "../src/modules/processing/legal-llm.service";
import { NeedsReviewError, type ChunkTranscription, type TranscribedBlock } from "../src/modules/processing/legal-types";
import { block, goodPages } from "./openai-fake";

const SOURCE = { snapshotId: "snapshot-1", pdfSha256: "b".repeat(64), pageCount: 1 };

const CLOSING = block("closing", { text: "TM. CHÍNH PHỦ" });

function chunk(blocks: TranscribedBlock[], pageCount = 1): ChunkTranscription {
    return { page_start: 1, page_end: pageCount, pages: goodPages(pageCount), blocks: [...blocks, CLOSING], error: null };
}

function issueCodes(blocks: TranscribedBlock[]): string[] {
    return assembleLegalDocument([chunk(blocks)], SOURCE).issues.map((issue) => issue.code);
}

describe("assembleLegalDocument", () => {
    it("keeps articles at the root when the document has no chapters", () => {
        const { document, issues } = assembleLegalDocument([chunk([
            block("title", { text: "LUẬT VÍ DỤ" }),
            block("article", { number: "1", title: "Phạm vi" }),
            block("text", { text: "Luật này quy định về ví dụ." }),
        ])], SOURCE);

        expect(issues).toEqual([]);
        expect(document.chapters).toEqual([]);
        expect(document.articles[0].content).toBe("Luật này quy định về ví dụ.");
        expect(document.articles[0].clauses).toEqual([]);
    });

    it("nests sections under chapters and continues article numbering across chapters", () => {
        const { document, issues } = assembleLegalDocument([chunk([
            block("title", { text: "NGHỊ ĐỊNH" }),
            block("chapter", { number: "I", title: "QUY ĐỊNH CHUNG" }),
            block("article", { number: "1", title: "A" }),
            block("chapter", { number: "II", title: "HÀNH VI VI PHẠM" }),
            block("section", { number: "1", title: "VI PHẠM QUY TẮC" }),
            block("article", { number: "2", title: "B" }),
            block("section", { number: "2", title: "VI PHẠM KHÁC" }),
            block("article", { number: "3", title: "C" }),
            block("chapter", { number: "IV", title: "THẨM QUYỀN" }),
        ])], SOURCE);

        expect(document.chapters.map((chapter) => chapter.number)).toEqual(["I", "II", "IV"]);
        expect(document.chapters[1].sections.map((section) => section.articles[0].number)).toEqual(["2", "3"]);
        expect(issues.map((issue) => issue.message)).toEqual(["chapter IV follows 2; expected 3"]);
    });

    it("accepts the Vietnamese point sequence including đ and flags skipped letters", () => {
        const points = ["a", "b", "c", "d", "đ", "e", "h"].map((number) => block("point", { number, text: `Điểm ${number}` }));
        const codes = issueCodes([
            block("title", { text: "NGHỊ ĐỊNH" }),
            block("article", { number: "1", title: "A" }),
            block("clause", { number: "1", text: "Khoản" }),
            ...points,
        ]);

        expect(codes).toEqual(["NUMBERING_GAP"]);
    });

    it("keeps a clause without an article as text and reports it", () => {
        const { document, issues } = assembleLegalDocument([chunk([
            block("title", { text: "NGHỊ ĐỊNH" }),
            block("chapter", { number: "I", title: "CHUNG" }),
            block("clause", { number: "1", text: "Khoản lạc chỗ." }),
            block("article", { number: "1", title: "A" }),
        ])], SOURCE);

        expect(issues.map((issue) => issue.code)).toEqual(["ORPHAN_NODE"]);
        expect(document.chapters[0].content).toBe("1. Khoản lạc chỗ.");
    });

    it("accepts inserted articles such as 12a", () => {
        const codes = issueCodes([
            block("title", { text: "LUẬT" }),
            block("article", { number: "1", title: "A" }),
            block("article", { number: "1a", title: "B" }),
            block("article", { number: "2", title: "C" }),
        ]);

        expect(codes).toEqual([]);
    });

    it("reports missing titles and pages that were not transcribed", () => {
        const result = assembleLegalDocument([{
            page_start: 1,
            page_end: 2,
            pages: [{ page: 1, quality: "PARTIAL", note: "mờ" }],
            blocks: [block("article", { number: "1", title: "A" })],
            error: null,
        }], { ...SOURCE, pageCount: 2 });

        expect(result.issues.map((issue) => issue.code)).toEqual([
            "PAGE_PARTIAL",
            "PAGE_NOT_REPORTED",
            "TITLE_MISSING",
            "CLOSING_MISSING",
        ]);
        expect(result.document.document_title).toBeNull();
    });

    it("repairs point l) misread as clause 1. and a repeated d) that must be đ)", () => {
        const { document, issues } = assembleLegalDocument([chunk([
            block("title", { text: "NGHỊ ĐỊNH" }),
            block("article", { number: "1", title: "A" }),
            block("clause", { number: "1", text: "Khoản 1" }),
            ...["a", "b", "c", "d", "d", "e", "g", "h", "i", "k"].map((number) => block("point", { number, text: number })),
            block("clause", { number: "1", text: "Không sử dụng đèn chiếu sáng" }),
            block("clause", { number: "2", text: "Khoản 2" }),
        ])], SOURCE);

        const points = document.articles[0].clauses[0].points;
        expect(points.map((point) => point.number).join("")).toBe("abcdđeghikl");
        expect(points[10].content).toBe("Không sử dụng đèn chiếu sáng");
        expect(issues.map((issue) => [issue.severity, issue.code])).toEqual([
            ["WARNING", "MARKER_REPAIRED"],
            ["WARNING", "MARKER_REPAIRED"],
        ]);
    });

    it("uses the line after a bare chapter or section heading as its title", () => {
        const { document } = assembleLegalDocument([chunk([
            block("title", { text: "NGHỊ ĐỊNH" }),
            block("chapter", { number: "I" }),
            block("text", { text: "NHỮNG QUY ĐỊNH CHUNG" }),
            block("article", { number: "1", title: "A" }),
        ])], SOURCE);

        expect(document.chapters[0].title).toBe("NHỮNG QUY ĐỊNH CHUNG");
        expect(document.chapters[0].content).toBeNull();
    });

    it("merges page continuations and distrusts continuation flags on new provisions", () => {
        const first = chunk([
            block("title", { text: "NGHỊ ĐỊNH" }),
            block("article", { number: "1", title: "A" }),
            block("clause", { number: "1", text: "Phạt tiền đối với" }),
            block("point", { number: "a", text: "Dừng xe nơi có biển cấm," }),
        ]);
        first.blocks.pop();
        const second: ChunkTranscription = {
            page_start: 2,
            page_end: 2,
            pages: [{ page: 2, quality: "GOOD", note: null }],
            blocks: [
                block("clause", { number: "2", text: "không chèn bánh;", continues_previous: true, page: 2 }),
                block("text", { text: "b) Đỗ xe trên cầu;", continues_previous: true, page: 2 }),
                CLOSING,
            ],
            error: null,
        };

        const { document, issues } = assembleLegalDocument([first, second], { ...SOURCE, pageCount: 2 });
        const points = document.articles[0].clauses[0].points;

        expect(document.articles[0].clauses).toHaveLength(1);
        expect(points.map((point) => point.content)).toEqual(["Dừng xe nơi có biển cấm, không chèn bánh;", "Đỗ xe trên cầu;"]);
        expect(points[0].source_locator.page_end).toBe(2);
        expect(issues.map((issue) => issue.code)).toEqual(["MARKER_DROPPED"]);
    });

    it("flags a PDF that ends without a signature block", () => {
        const result = assembleLegalDocument([{
            page_start: 1,
            page_end: 1,
            pages: goodPages(1),
            blocks: [block("title", { text: "NGHỊ ĐỊNH" }), block("article", { number: "1", title: "A" })],
            error: null,
        }], SOURCE);

        expect(result.issues.map((issue) => issue.code)).toEqual(["CLOSING_MISSING"]);
    });

    it("rejects output without any legal structure", () => {
        expect(() => assembleLegalDocument([chunk([block("text", { text: "Trang trắng" })])], SOURCE)).toThrow(NeedsReviewError);
    });
});

describe("parseTranscription", () => {
    it("rejects block pages outside the chunk", () => {
        const output = JSON.stringify({ pages: goodPages(1), blocks: [block("text", { text: "x", page: 2 })] });

        expect(() => parseTranscription(output, 1)).toThrow(InvalidTranscriptionError);
    });

    it("rejects unknown block kinds", () => {
        const output = JSON.stringify({ pages: goodPages(1), blocks: [{ ...block("text"), kind: "paragraph" }] });

        expect(() => parseTranscription(output, 1)).toThrow(InvalidTranscriptionError);
    });

    it("normalises blank strings to null", () => {
        const output = JSON.stringify({ pages: goodPages(1), blocks: [block("article", { number: " 5 ", title: "  " })] });
        const parsed = parseTranscription(output, 1);

        expect(parsed.blocks[0].number).toBe("5");
        expect(parsed.blocks[0].title).toBeNull();
    });
});

describe("classifyMarker", () => {
    it("derives the hierarchy level from the printed numbering, not the model label", () => {
        expect(classifyMarker("Điều 6.")).toEqual({ kind: "article", number: "6" });
        expect(classifyMarker("Điều 12a.")).toEqual({ kind: "article", number: "12a" });
        expect(classifyMarker("Chương II")).toEqual({ kind: "chapter", number: "II" });
        expect(classifyMarker("Mục 3")).toEqual({ kind: "section", number: "3" });
        expect(classifyMarker("Phần thứ tư")).toEqual({ kind: "part", number: "thứ tư" });
        expect(classifyMarker("10.")).toEqual({ kind: "clause", number: "10" });
        expect(classifyMarker("đ)")).toEqual({ kind: "point", number: "đ" });
        expect(classifyMarker("Điều này")).toBeNull();
    });

    it("treats a bare section line labelled as text as a heading", () => {
        const output = JSON.stringify({
            pages: goodPages(1),
            blocks: [block("text", { text: "Mục 2" }), block("text", { text: "Mục 2 quy định về thủ tục." })],
        });
        const parsed = parseTranscription(output, 1);

        expect(parsed.blocks.map((item) => [item.kind, item.number])).toEqual([["section", "2"], ["text", null]]);
    });

    it("overrides a mislabelled heading from the LLM", () => {
        const output = JSON.stringify({
            pages: goodPages(1),
            blocks: [
                { ...block("chapter"), marker: "Điều 6.", title: "Xử phạt người điều khiển xe mô tô" },
                { ...block("clause"), marker: "h)", text: "Điểm h" },
            ],
        });
        const parsed = parseTranscription(output, 1);

        expect(parsed.blocks.map((item) => [item.kind, item.number])).toEqual([["article", "6"], ["point", "h"]]);
    });
});
