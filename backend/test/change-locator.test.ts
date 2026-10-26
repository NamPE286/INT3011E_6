import { describe, expect, it } from "bun:test";
import { formatLocator, locatorToProvisionId, parseLocators } from "../src/modules/changes/change.locator";

function parse(text: string, context = null as Parameters<typeof parseLocators>[1]): string[] {
    return parseLocators(text, context).map(formatLocator);
}

describe("parseLocators", () => {
    it("binds a point to its clause and article", () => {
        expect(parse("Sửa đổi, bổ sung điểm a khoản 5 Điều 5 như sau:")).toEqual(["điểm a khoản 5 Điều 5"]);
    });

    it("reads lists of points and clauses", () => {
        expect(parse("Bãi bỏ điểm a, điểm b khoản 5 và khoản 7 Điều 5.")).toEqual([
            "điểm a khoản 5 Điều 5",
            "điểm b khoản 5 Điều 5",
            "khoản 7 Điều 5",
        ]);
        expect(parse("Bãi bỏ các điểm a, b và c khoản 2 Điều 7.")).toEqual([
            "điểm a khoản 2 Điều 7",
            "điểm b khoản 2 Điều 7",
            "điểm c khoản 2 Điều 7",
        ]);
    });

    it("expands ranges", () => {
        expect(parse("Bãi bỏ từ khoản 1 đến khoản 3 Điều 6.")).toEqual(["khoản 1 Điều 6", "khoản 2 Điều 6", "khoản 3 Điều 6"]);
        expect(parse("Bãi bỏ từ điểm c đến điểm đ khoản 1 Điều 6.")).toEqual(["điểm c khoản 1 Điều 6", "điểm d khoản 1 Điều 6", "điểm đ khoản 1 Điều 6"]);
    });

    it("reads whole articles", () => {
        expect(parse("Bãi bỏ Điều 8 và Điều 9.")).toEqual(["Điều 8", "Điều 9"]);
    });

    it("takes the article or clause from the enclosing instruction when the text omits it", () => {
        expect(parse("Sửa đổi khoản 2 như sau:", { article: "5", clause: null, point: null })).toEqual(["khoản 2 Điều 5"]);
        expect(parse("Sửa đổi điểm b như sau:", { article: "5", clause: "4", point: null })).toEqual(["điểm b khoản 4 Điều 5"]);
        expect(parse("Sửa đổi khoản 2 như sau:")).toEqual([]);
    });
});

describe("locatorToProvisionId", () => {
    it("uses the flattener id scheme", () => {
        expect(locatorToProvisionId("doc", { article: "5", clause: "5", point: "đ" })).toBe("doc:dieu_5_khoan_5_diem_đ");
        expect(locatorToProvisionId("doc", { article: "6a", clause: null, point: null })).toBe("doc:dieu_6a");
    });
});
