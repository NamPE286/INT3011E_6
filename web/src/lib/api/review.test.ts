import { describe, expect, test } from "bun:test";
import { parseDocumentActions, parseJobDocument } from "./review";

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

const fullBody = {
    jobId: "job-2",
    reviewStatus: "ACCEPTED",
    issues: [],
    extraction: {},
    document: {
        document_title: "Nghị định 100",
        content: "Căn cứ Luật…",
        source: { snapshot_id: "snap-1", pdf_sha256: "abc", part_index: 0 },
        parts: [],
        sections: [],
        articles: [],
        chapters: [
            {
                number: "I",
                title: "Quy định chung",
                content: null,
                source_locator: { page_start: 1, page_end: 2, quality: "GOOD", source_quote: "Chương I" },
                sections: [],
                articles: [
                    {
                        number: "1",
                        title: "Phạm vi",
                        content: "Nghị định này quy định…",
                        source_locator: { page_start: 1, page_end: 1, quality: "PARTIAL", source_quote: null },
                        clauses: [
                            {
                                number: "1",
                                title: null,
                                content: "Khoản một",
                                source_locator: { page_start: 1, page_end: 1, quality: "GOOD" },
                                points: [{ number: "a", title: null, content: "Điểm a", source_locator: { page_start: 1, page_end: 1, quality: "GOOD" } }],
                                quoted: [{ kind: "article", number: "20", title: "Mới", content: "Nội dung trích", source_locator: { page_start: 1, page_end: 1, quality: "GOOD" }, children: [] }],
                            },
                        ],
                    },
                ],
            },
        ],
    },
};

describe("parseJobDocument full content", () => {
    test("keeps the document's own fields, the whole tree with locators and the raw JSON", () => {
        const parsed = parseJobDocument(fullBody);

        expect(parsed?.content).toBe("Căn cứ Luật…");
        expect(parsed?.source).toEqual({ snapshotId: "snap-1", pdfSha256: "abc", partIndex: 0 });
        expect(parsed?.raw).toBe(fullBody.document);

        const chapter = parsed?.nodes[0];

        expect(chapter).toMatchObject({ kind: "chapter", number: "I", title: "Quy định chung", pageStart: 1, pageEnd: 2, quality: "GOOD", sourceQuote: "Chương I" });

        const article = chapter?.children[0];

        expect(article).toMatchObject({ kind: "article", number: "1", content: "Nghị định này quy định…", quality: "PARTIAL" });

        const clause = article?.children[0];

        expect(clause?.kind).toBe("clause");
        expect(clause?.children.map((child) => [child.kind, child.number])).toEqual([["point", "a"]]);
        expect(clause?.quoted.map((quoted) => [quoted.kind, quoted.number, quoted.content])).toEqual([["article", "20", "Nội dung trích"]]);
    });
});

describe("parseJobDocument", () => {
    test("reads the review status, issues, extraction facts and the node tree", () => {
        const parsed = parseJobDocument(body);

        expect(parsed?.reviewStatus).toBe("REVIEW_REQUIRED");
        expect(parsed?.title).toBe("Nghị định 100");
        expect(parsed?.pageCount).toBe(12);
        expect(parsed?.model).toBe("gpt-5.4");
        expect(parsed?.issues).toEqual([
            { severity: "ERROR", code: "NUMBERING_GAP", message: "Thiếu Điều 3", page: 2 },
            { severity: "WARNING", code: "NOTE", message: "Đã sửa số", page: null },
        ]);
        expect(parsed?.nodes.map((node) => [node.kind, node.number])).toEqual([["chapter", "I"], ["article", "5"]]);
        expect(parsed?.nodes[0]?.children.map((node) => node.number)).toEqual(["1", "2"]);
        expect(parsed?.nodes[0]?.children[1]).toMatchObject({ title: "Tiêu đề 2", pageStart: 3, quality: "PARTIAL" });
        expect(parsed?.nodes[0]?.children[1]?.children).toHaveLength(0);
    });

    test("rejects a response without a known review status", () => {
        expect(parseJobDocument({ ...body, reviewStatus: "WHATEVER" })).toBeNull();
        expect(parseJobDocument(null)).toBeNull();
    });
});

describe("parseDocumentActions", () => {
    const rule = (id: string, action: unknown): Record<string, unknown> => ({
        id,
        provisionId: `p-${id}`,
        behaviorText: `Hành vi ${id}`,
        semanticIr: { action },
    });

    test("pairs each rule with its action vocabulary", () => {
        const actions = parseDocumentActions({
            rules: [
                rule("r1", { label: "vượt đèn đỏ", vocabId: "ACTION_001", evidence: "không chấp hành" }),
                rule("r2", { label: "đi ngược chiều", vocabId: null, evidence: null }),
                rule("r3", null),
            ],
        });

        expect(actions).toEqual([
            { ruleId: "r1", behaviorText: "Hành vi r1", actionLabel: "vượt đèn đỏ", vocabId: "ACTION_001" },
            { ruleId: "r2", behaviorText: "Hành vi r2", actionLabel: "đi ngược chiều", vocabId: null },
            { ruleId: "r3", behaviorText: "Hành vi r3", actionLabel: null, vocabId: null },
        ]);
    });

    test("rejects a body without a rules list", () => {
        expect(parseDocumentActions({ documentId: "d" })).toBeNull();
    });
});
