import { describe, expect, it } from "bun:test";
import { buildSplitDiffRows, computeLineDiff, findMatches, replaceAllMatches } from "./ide-scm";

describe("ide-scm find/replace and LCS line diff", () => {
    it("finds and replaces matches respecting case sensitivity", () => {
        const text = "Điều 1. Phạt tiền\nĐiều 2. Phạt tiền";
        const matches = findMatches(text, "phạt tiền", { caseSensitive: false, wholeWord: false });

        expect(matches.length).toBe(2);
        expect(matches[0].line).toBe(1);

        const replaced = replaceAllMatches(text, "Phạt tiền", "Xử phạt", { caseSensitive: true, wholeWord: true });

        expect(replaced.count).toBe(2);
        expect(replaced.content).toBe("Điều 1. Xử phạt\nĐiều 2. Xử phạt");
    });

    it("computes accurate LCS line diff when inserting a line at the top", () => {
        const base = "Điều 1. Phạm vi\n1. Quy định chung\n2. Đối tượng";
        const current = `Căn cứ Luật 36/2024/QH15;\n${base}`;
        const diff = computeLineDiff(base, current);

        expect(diff.added).toBe(1);
        expect(diff.removed).toBe(0);
        expect(diff.hunks.length).toBe(1);
        expect(diff.rows.length).toBe(4);
        expect(diff.rows[0].type).toBe("add");

        const split = buildSplitDiffRows(diff.rows);

        expect(split.length).toBe(4);
        expect(split[0].left).toBeNull();
        expect(split[0].right?.type).toBe("add");
    });
});
