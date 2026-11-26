import { describe, expect, it } from "bun:test";
import { applyQuickFix } from "../ide-editor";
import { generateAiFixForDiagnostic, selectFixTargetWindow } from "./llm-fix";
import type { LegalDiagnostic } from "./types";

function makeDiag(overrides: Partial<LegalDiagnostic>): LegalDiagnostic {
    return {
        id: "diag-1",
        code: "LP003",
        category: "LOOPHOLE",
        severity: "error",
        title: "Khoảng trống định lượng",
        message: "Thiếu khoảng 10-15 km/h",
        exploitScenario: "Lọt khung phạt",
        suggestion: "Điều chỉnh cận dưới",
        excerpt: "từ 15 km/h đến 20 km/h",
        provisionRef: "Khoản 2 Điều 2",
        range: { startLine: 4, startCol: 1, endLine: 4, endCol: 40, startOffset: 60, endOffset: 100 },
        source: "STATIC",
        quickFix: null,
        corpusLink: null,
        ...overrides,
    };
}

describe("llm-fix (Sửa bằng AI cho mọi lỗi)", () => {
    it("selects exact line window for standard diagnostics and basis block for LG010", () => {
        const doc = [
            "Dự thảo Nghị định",
            "Căn cứ Nghị định 168/2024/NĐ-CP;",
            "Căn cứ Luật 36/2024/QH15;",
            "Điều 1. Tốc độ",
            "1. Phạt tiền từ 15 km/h đến 20 km/h.",
        ].join("\n");

        const lg010Win = selectFixTargetWindow(doc, makeDiag({
            code: "LG010",
            range: { startLine: 3, startCol: 1, endLine: 3, endCol: 25, startOffset: 52, endOffset: 77 },
        }));

        expect(lg010Win.startLine).toBe(2);
        expect(lg010Win.endLine).toBe(3);
        expect(lg010Win.targetBlock).toBe("Căn cứ Nghị định 168/2024/NĐ-CP;\nCăn cứ Luật 36/2024/QH15;");

        const lineWin = selectFixTargetWindow(doc, makeDiag({
            code: "LP003",
            range: { startLine: 5, startCol: 1, endLine: 5, endCol: 30, startOffset: 92, endOffset: 120 },
        }));

        expect(lineWin.startLine).toBe(5);
        expect(lineWin.targetBlock).toBe("1. Phạt tiền từ 15 km/h đến 20 km/h.");
    });

    it("calls Gemini Interactions API, strips fences, and returns applicable QuickFix + usage", async () => {
        const doc = [
            "Dự thảo Nghị định",
            "",
            "Điều 1. Tốc độ",
            "1. Phạt tiền từ 800.000 đồng đến 1.000.000 đồng đối với xe chạy quá tốc độ từ 05 km/h đến 10 km/h.",
            "2. Phạt tiền từ 2.000.000 đồng đến 4.000.000 đồng đối với xe chạy quá tốc độ từ 15 km/h đến 20 km/h.",
        ].join("\n");

        let capturedKey = "";
        const fakeFetch = (async (_url: string, init?: RequestInit) => {
            const headers = init?.headers as Record<string, string>;
            capturedKey = headers["x-goog-api-key"] ?? "";

            return new Response(
                JSON.stringify({
                    output_text: JSON.stringify({
                        replacement: "```\n2. Phạt tiền từ 2.000.000 đồng đến 4.000.000 đồng đối với xe chạy quá tốc độ trên 10 km/h đến 20 km/h.\n```",
                        explanation: "Khép kín khoảng trống 10-15 km/h.",
                    }),
                    usage: {
                        total_input_tokens: 120,
                        total_output_tokens: 45,
                        total_tokens: 165,
                    },
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            );
        }) as unknown as typeof fetch;

        const result = await generateAiFixForDiagnostic({
            content: doc,
            diagnostic: makeDiag({
                range: { startLine: 5, startCol: 1, endLine: 5, endCol: 50, startOffset: 135, endOffset: 185 },
            }),
            apiKey: "sk-test-key",
            fetcher: fakeFetch,
        });

        expect(capturedKey).toBe("sk-test-key");
        expect(result.usage.totalTokens).toBe(165);
        expect(result.explanation).toBe("Khép kín khoảng trống 10-15 km/h.");

        const updated = applyQuickFix(doc, result.fix);

        expect(updated).toContain("trên 10 km/h đến 20 km/h.");
        expect(updated).not.toContain("```");
    });

    it("throws when AI returns identical text", async () => {
        const doc = "Điều 1. Test\n1. Nội dung.";
        const fakeFetch = (async () => {
            return new Response(
                JSON.stringify({
                    output_text: JSON.stringify({
                        replacement: "1. Nội dung.",
                        explanation: "Không đổi",
                    }),
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            );
        }) as unknown as typeof fetch;

        await expect(
            generateAiFixForDiagnostic({
                content: doc,
                diagnostic: makeDiag({
                    range: { startLine: 2, startCol: 1, endLine: 2, endCol: 10, startOffset: 13, endOffset: 23 },
                }),
                apiKey: "sk-test-key",
                fetcher: fakeFetch,
            }),
        ).rejects.toThrow();
    });
});
