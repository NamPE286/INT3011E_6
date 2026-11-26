import { describe, expect, it } from "bun:test";
import type { DiagnosticSeverity, LegalDiagnostic } from "./api/ide";
import { applyQuickFix, buildLineDecorations, cursorPosition, findDiagnosticAtOffset, offsetForLine } from "./ide-editor";

function makeDiagnostic(
    id: string,
    startOffset: number,
    endOffset: number,
    severity: DiagnosticSeverity = "error",
): LegalDiagnostic {
    return {
        id,
        code: "LG001",
        category: "LOGIC",
        severity,
        title: "Test",
        message: "Test",
        exploitScenario: "Test",
        suggestion: "Test",
        excerpt: "test",
        provisionRef: "Điều 1",
        range: { startLine: 1, endLine: 1, startCol: 1, endCol: 5, startOffset, endOffset },
        source: "STATIC",
        quickFix: null,
        corpusLink: null,
    };
}

describe("ide-editor helpers", () => {
    it("splits lines and attaches non-overlapping diagnostic segments", () => {
        const content = "Điều 1. Test\nPhạt từ 6 đến 4 đồng";
        const diag = makeDiagnostic("d1", 21, 30);
        const lines = buildLineDecorations(content, [diag], "d1");

        expect(lines.length).toBe(2);
        expect(lines[0].gutterSeverity).toBeNull();
        expect(lines[1].gutterSeverity).toBe("error");
        expect(lines[1].segments.some((seg) => seg.isSelected && seg.text === "6 đến 4 đ")).toBe(true);
    });

    it("applies quickFix and computes cursor position & line offset", () => {
        const updated = applyQuickFix("a b c", { label: "fix", replacement: "B", startOffset: 2, endOffset: 3 });

        expect(updated).toBe("a B c");
        expect(cursorPosition("abc\ndef", 5)).toEqual({ line: 2, col: 2 });
        expect(offsetForLine("abc\ndef\nghi", 3)).toBe(8);
    });

    it("finds diagnostic at cursor offset, preferring tightest span and highest severity", () => {
        expect(findDiagnosticAtOffset([], 5)).toBeNull();

        const outer = makeDiagnostic("outer", 10, 40, "error");
        const innerWarn = makeDiagnostic("inner-warn", 15, 25, "warning");
        const innerError = makeDiagnostic("inner-err", 15, 25, "error");
        const info = makeDiagnostic("info", 50, 60, "info");

        expect(findDiagnosticAtOffset([outer, info], 5)).toBeNull();
        expect(findDiagnosticAtOffset([outer, info], 10)?.id).toBe("outer");
        expect(findDiagnosticAtOffset([outer, info], 40)?.id).toBe("outer");
        expect(findDiagnosticAtOffset([outer, innerWarn], 20)?.id).toBe("inner-warn");
        expect(findDiagnosticAtOffset([outer, innerWarn, innerError], 20)?.id).toBe("inner-err");
    });
});
