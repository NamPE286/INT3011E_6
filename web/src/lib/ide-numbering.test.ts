import { describe, expect, it } from "bun:test";
import {
    autoShiftOnManualPrefix,
    shiftAfterLineInsert,
    shiftSubsequentArticles,
    shiftSubsequentClauses,
    shiftSubsequentPoints,
} from "./ide-numbering";

describe("ide-numbering (auto-renumbering Điều, Khoản, Điểm)", () => {
    it("shifts subsequent Điều across Chương when inserting Điều 2 before existing Điều 2, 3", () => {
        const doc = [
            "Điều 1. Phạm vi",
            "1. Quy định chung.",
            "",
            "Điều 2. ",
            "",
            "Chương II. CHẾ TÀI",
            "",
            "Điều 2. Hành vi",
            "1. Phạt tiền.",
            "",
            "Điều 3. Hiệu lực",
            "1. Có hiệu lực.",
        ].join("\n");

        const shifted = shiftSubsequentArticles(doc, 3, 2, 1);

        expect(shifted).toContain("Điều 3. Hành vi");
        expect(shifted).toContain("Điều 4. Hiệu lực");
    });

    it("does not over-shift Điều 3 when filling an existing gap (Điều 1 -> Điều 2 -> Điều 3)", () => {
        const doc = [
            "Điều 1. Phạm vi",
            "Điều 2. Bổ sung",
            "Điều 3. Hiệu lực",
        ].join("\n");

        const shifted = shiftSubsequentArticles(doc, 1, 2, 1);

        expect(shifted).toBe(doc);
    });

    it("shifts subsequent Khoản within the same Article and stops at next Điều", () => {
        const doc = [
            "Điều 1. Xử phạt",
            "1. Khoản một.",
            "2. Khoản mới.",
            "2. Khoản hai cũ.",
            "3. Khoản ba cũ.",
            "",
            "Điều 2. Hiệu lực",
            "1. Có hiệu lực.",
            "2. Tổ chức thực hiện.",
        ].join("\n");

        const shifted = shiftSubsequentClauses(doc, 2, 2, 1);

        expect(shifted).toContain("3. Khoản hai cũ.");
        expect(shifted).toContain("4. Khoản ba cũ.");
        expect(shifted).toContain("Điều 2. Hiệu lực\n1. Có hiệu lực.\n2. Tổ chức thực hiện.");
    });

    it("pulls subsequent Khoản back down when delta is -1", () => {
        const doc = [
            "Điều 1. Xử phạt",
            "1. Khoản một.",
            "",
            "3. Khoản hai.",
            "4. Khoản ba.",
        ].join("\n");

        const shifted = shiftSubsequentClauses(doc, 2, 2, -1);

        expect(shifted).toContain("2. Khoản hai.");
        expect(shifted).toContain("3. Khoản ba.");
    });

    it("shifts subsequent Điểm using Vietnamese alphabet (d -> đ -> e) and stops at next Khoản", () => {
        const doc = [
            "Điều 1. Hành vi",
            "1. Nghiêm cấm:",
            "c) Hành vi C;",
            "d) Hành vi mới;",
            "d) Hành vi D cũ;",
            "đ) Hành vi Đ cũ;",
            "2. Khoản tiếp theo.",
            "a) Điểm a khoản 2.",
        ].join("\n");

        const shifted = shiftSubsequentPoints(doc, 3, "d", 1);

        expect(shifted).toContain("đ) Hành vi D cũ;");
        expect(shifted).toContain("e) Hành vi Đ cũ;");
        expect(shifted).toContain("a) Điểm a khoản 2.");
    });

    it("autoShiftOnManualPrefix shifts when user completes 'Điều 2. ', '2. ', or 'b) '", () => {
        const prev = "Điều 1. A\nĐiều 2.\nĐiều 2. B";
        const next = "Điều 1. A\nĐiều 2. \nĐiều 2. B";
        const cursor = "Điều 1. A\nĐiều 2. ".length;

        const shifted = autoShiftOnManualPrefix(prev, next, cursor);

        expect(shifted).toBe("Điều 1. A\nĐiều 2. \nĐiều 3. B");

        const quotedPrev = "Điều 1. Sửa đổi\n“Điều 2.”\nĐiều 2. B";
        const quotedNext = "Điều 1. Sửa đổi\n“Điều 2. ”\nĐiều 2. B";
        expect(autoShiftOnManualPrefix(quotedPrev, quotedNext, "Điều 1. Sửa đổi\n“Điều 2. ".length)).toBe(quotedNext);
    });

    it("shiftAfterLineInsert dispatches based on line prefix", () => {
        const doc = "Điều 1. Test\n1. A\n2. \n2. B";
        expect(shiftAfterLineInsert(doc, 2)).toBe("Điều 1. Test\n1. A\n2. \n3. B");
    });
});
