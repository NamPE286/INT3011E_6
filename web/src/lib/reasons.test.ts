import { describe, expect, test } from "bun:test";
import { describeReason } from "./reasons";

describe("describeReason", () => {
    test("explains known codes in Vietnamese", () => {
        expect(describeReason("NO_FINE")).toBe("Chưa đọc được mức phạt từ văn bản");
        expect(describeReason("EFFECTIVE_DATE_UNKNOWN")).toContain("ngày có hiệu lực");
    });

    test("does not show raw model text or unknown codes", () => {
        expect(describeReason("MODEL: the text is odd")).toContain("không chắc chắn");
        expect(describeReason("SOMETHING_NEW")).toBe("Cần kiểm tra thủ công");
    });
});
