import { describe, expect, it } from "bun:test";
import { parseAnalysisResult, parseDraftListResponse } from "./ide";

describe("ide api parsers", () => {
    it("parses draft list response safely", () => {
        const parsed = parseDraftListResponse({
            drafts: [],
            templates: [
                {
                    id: "tpl-1",
                    title: "Dự thảo 1",
                    documentNumber: "01/2026/NĐ-CP",
                    documentType: "Nghị định",
                    agency: "Chính phủ",
                    sourceDocumentId: null,
                    isTemplate: true,
                    updatedAt: "2026-11-25T00:00:00.000Z",
                    errorCount: 2,
                    warningCount: 3,
                    infoCount: 1,
                },
            ],
        });

        expect(parsed?.templates.length).toBe(1);
        expect(parsed?.templates[0].errorCount).toBe(2);
    });

    it("rejects malformed analysis payloads", () => {
        expect(parseAnalysisResult({ diagnostics: [] })).toBeNull();
    });
});
