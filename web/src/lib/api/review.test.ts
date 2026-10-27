import { describe, expect, test } from "bun:test";
import { parseJobDocument } from "./review";

function locator(quality: string, pageStart = 1): Record<string, unknown> {
    return { page_start: pageStart, page_end: pageStart, quality };
}

function article(number: string, quality = "GOOD", pageStart = 1): Record<string, unknown> {
    return { number, title: `Tiêu đề ${number}`, content: null, source_locator: locator(quality, pageStart), clauses: [{}, {}] };
}

const body = {
    jobId: "job-1",
    reviewStatus: "REVIEW_REQUIRED",
    issues: [
        { severity: "ERROR", code: "NUMBERING_GAP", message: "Thiếu Điều 3", page: 2 },
        { severity: "WARNING", code: "NOTE", message: "Đã sửa số", page: null },
        { severity: "INFO", code: "X", message: "bỏ", page: null },
    ],
    extraction: { model: "gpt-5.4", pageCount: 12 },
    document: {
        document_title: "Nghị định 100",
        parts: [],
        chapters: [{ number: "I", articles: [article("1"), article("2", "PARTIAL", 3)], sections: [] }],
        sections: [],
        articles: [article("5")],
    },
};

describe("parseJobDocument", () => {
    test("reads the review status, issues, extraction facts and every article in reading structure", () => {
        const parsed = parseJobDocument(body);

        expect(parsed?.reviewStatus).toBe("REVIEW_REQUIRED");
        expect(parsed?.title).toBe("Nghị định 100");
        expect(parsed?.pageCount).toBe(12);
        expect(parsed?.model).toBe("gpt-5.4");
        expect(parsed?.issues).toEqual([
            { severity: "ERROR", code: "NUMBERING_GAP", message: "Thiếu Điều 3", page: 2 },
            { severity: "WARNING", code: "NOTE", message: "Đã sửa số", page: null },
        ]);
        expect(parsed?.articles.map((entry) => entry.number)).toEqual(["1", "2", "5"]);
        expect(parsed?.articles[1]).toEqual({ number: "2", title: "Tiêu đề 2", clauseCount: 2, pageStart: 3, quality: "PARTIAL" });
    });

    test("rejects a response without a known review status", () => {
        expect(parseJobDocument({ ...body, reviewStatus: "WHATEVER" })).toBeNull();
        expect(parseJobDocument(null)).toBeNull();
    });
});
