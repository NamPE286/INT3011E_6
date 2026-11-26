import { describe, expect, it } from "bun:test";
import type { DraftNode, WorkspaceContext } from "./api/ide";
import { applyCompletion, computeCompletions, computeEnterAutofill, computeInlineAutofill, nextVietnamesePointLetter } from "./ide-intellisense";

const SAMPLE_OUTLINE: DraftNode[] = [
    {
        id: "n1",
        parentId: null,
        level: "ARTICLE",
        number: "1",
        title: "Phạm vi điều chỉnh",
        text: "Điều 1. Phạm vi điều chỉnh",
        refLabel: "Điều 1",
        startLine: 1,
        endLine: 3,
        startOffset: 0,
        endOffset: 50,
        diagnosticCounts: { error: 0, warning: 0, info: 0 },
    },
];

const POPULATED_WORKSPACE: WorkspaceContext = {
    corpusDocumentCount: 1,
    savedDraftCount: 1,
    bases: [
        {
            id: "b1",
            label: "Nghị định 01/2030/NĐ-CP",
            documentNumber: "01/2030/NĐ-CP",
            documentType: "Nghị định",
            sourceKind: "CORPUS",
            sourceLabel: "Kho: 01/2030/NĐ-CP",
            insertText: "Căn cứ Nghị định số 01/2030/NĐ-CP;",
            documentation: "Nghị định trong workspace.",
        },
    ],
    articlePatterns: [
        {
            id: "a1",
            label: "Giải thích từ ngữ",
            detail: "Kho: 01/2030/NĐ-CP",
            insertBody: "1. “xe tự hành” là phương tiện tự động.",
            sourceKind: "CORPUS",
            sourceLabel: "01/2030/NĐ-CP",
            documentation: "Từ workspace.",
        },
    ],
    clausePatterns: [],
    pointPatterns: [],
    provisions: [],
    definedTerms: [],
};

describe("ide-intellisense (strictly workspace-only)", () => {
    it("returns zero outside laws when workspace is empty for 'Căn cứ '", () => {
        const content = "Căn cứ ";
        const state = computeCompletions({
            content,
            cursorOffset: content.length,
            outline: [],
            workspaceContext: {
                corpusDocumentCount: 0,
                savedDraftCount: 0,
                bases: [],
                articlePatterns: [],
                clausePatterns: [],
                pointPatterns: [],
                provisions: [],
                definedTerms: [],
            },
        });

        expect(state).not.toBeNull();
        expect(state?.items.length).toBe(0);
        expect(state?.emptyMessage).toBeDefined();
    });

    it("suggests workspace bases when workspace has documents", () => {
        const content = "Căn cứ 01/2030";
        const state = computeCompletions({
            content,
            cursorOffset: content.length,
            outline: [],
            workspaceContext: POPULATED_WORKSPACE,
        });

        expect(state?.items.length).toBe(1);
        expect(state?.items[0].insertText).toBe("Căn cứ Nghị định số 01/2030/NĐ-CP;");
    });

    it("suggests workspace article templates when typing 'Điều 7: ' and replaces cleanly", () => {
        const content = "Điều 7: ";
        const state = computeCompletions({
            content,
            cursorOffset: content.length,
            outline: SAMPLE_OUTLINE,
            workspaceContext: POPULATED_WORKSPACE,
        });

        expect(state).not.toBeNull();
        expect(state?.items[0].label).toBe("Điều 7. Giải thích từ ngữ");

        const accepted = applyCompletion(content, state!, state!.items[0]);

        expect(accepted.content.startsWith("Điều 7. Giải thích từ ngữ")).toBe(true);
    });

    it("computes Vietnamese point sequence d) -> đ) and converts dash bullets", () => {
        const content = "Điều 1. Test\n1. Phạt tiền:\na) Lỗi 1\nb) Lỗi 2\nc) Lỗi 3\nd) Lỗi 4\n- ";
        expect(nextVietnamesePointLetter(content, content.length)).toBe("đ");

        const state = computeCompletions({
            content,
            cursorOffset: content.length,
            outline: SAMPLE_OUTLINE,
            workspaceContext: null,
        });

        expect(state?.items[0].insertText).toBe("đ) ");
    });
});

describe("Smart Context-Aware Autofill (Điều / Khoản / Điểm)", () => {
    it("suggests 'Điều 1. ' on an empty line outside any Article, and 'Điều 2. ' after a blank line ending Điều 1", () => {
        const empty = "";
        expect(computeInlineAutofill(empty, 0, [])?.insertText).toBe("Điều 1. ");

        const afterArt1 = "Điều 1. Phạm vi điều chỉnh\n1. Quy định chung.\n\n";
        expect(computeInlineAutofill(afterArt1, afterArt1.length, SAMPLE_OUTLINE)?.insertText).toBe("Điều 2. ");
    });

    it("suggests '1. ', 'a) ', 'đ) ', and promotes to '2. ' after a blank line following a Điểm", () => {
        const afterHeader = "Điều 1. Phạm vi điều chỉnh\n";
        expect(computeInlineAutofill(afterHeader, afterHeader.length, SAMPLE_OUTLINE)?.insertText).toBe("1. ");

        const afterColon = "Điều 1. Hành vi\n1. Nghiêm cấm:\n";
        expect(computeInlineAutofill(afterColon, afterColon.length, SAMPLE_OUTLINE)?.insertText).toBe("a) ");

        const afterPointD = "Điều 1. Hành vi\n1. Nghiêm cấm:\na) Một\nb) Hai\nc) Ba\nd) Bốn\n";
        expect(computeInlineAutofill(afterPointD, afterPointD.length, SAMPLE_OUTLINE)?.insertText).toBe("đ) ");

        const blankAfterPoint = "Điều 1. Hành vi\n1. Nghiêm cấm:\na) Một\n\n";
        expect(computeInlineAutofill(blankAfterPoint, blankAfterPoint.length, SAMPLE_OUTLINE)?.insertText).toBe("2. ");
    });

    it("handles Enter key autofill for Điều, Khoản, Điểm, empty exit, and returns null mid-line", () => {
        const artLine = "Điều 1. Quy định chung";
        const r1 = computeEnterAutofill(artLine, artLine.length);
        expect(r1?.content).toBe("Điều 1. Quy định chung\n1. ");

        const clauseColon = "Điều 1. Hành vi\n1. Các hành vi bị cấm:";
        const r2 = computeEnterAutofill(clauseColon, clauseColon.length);
        expect(r2?.content).toBe("Điều 1. Hành vi\n1. Các hành vi bị cấm:\na) ");

        const pointD = "Điều 1. Hành vi\n1. Cấm:\nd) Chạy quá tốc độ";
        const r3 = computeEnterAutofill(pointD, pointD.length);
        expect(r3?.content).toBe("Điều 1. Hành vi\n1. Cấm:\nd) Chạy quá tốc độ\nđ) ");

        const emptyPoint = "Điều 1. Hành vi\n1. Cấm:\na) Một\nb) ";
        const r4 = computeEnterAutofill(emptyPoint, emptyPoint.length);
        expect(r4?.content).toBe("Điều 1. Hành vi\n1. Cấm:\na) Một\n2. ");

        const emptyClause = "Điều 1. Hành vi\n1. Cấm\n2. ";
        const r5 = computeEnterAutofill(emptyClause, emptyClause.length);
        expect(r5?.content).toBe("Điều 1. Hành vi\n1. Cấm\n");

        const midLine = "Điều 1. Quy định chung";
        expect(computeEnterAutofill(midLine, 10)).toBeNull();
    });
});
