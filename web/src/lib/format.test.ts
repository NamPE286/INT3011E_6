import { describe, expect, test } from "bun:test";
import { formatDate, formatFineRange, formatMoney, formatPeriod, todayIso } from "./format";

describe("format", () => {
    test("groups thousands with dots", () => {
        expect(formatMoney(3000000)).toBe("3.000.000 đồng");
        expect(formatMoney(800)).toBe("800 đồng");
    });

    test("shows a fine range, a fixed fine, and a missing fine honestly", () => {
        expect(formatFineRange({ min: 3000000, max: 5000000 })).toBe("3.000.000 đồng – 5.000.000 đồng");
        expect(formatFineRange({ min: 200000, max: 200000 })).toBe("200.000 đồng");
        expect(formatFineRange(null)).toBe("Chưa đọc được mức phạt");
    });

    test("formats ISO dates and leaves other text unchanged", () => {
        expect(formatDate("2022-01-01")).toBe("01/01/2022");
        expect(formatDate("2022-01-01T10:00:00.000Z")).toBe("01/01/2022");
        expect(formatDate("sớm nhất")).toBe("sớm nhất");
        expect(formatDate(null)).toBe("Chưa rõ");
    });

    test("states when a rule has no known end date", () => {
        expect(formatPeriod("2020-01-01", null)).toContain("chưa có ngày kết thúc");
        expect(formatPeriod("2020-01-01", "2022-01-01")).toBe("Từ 01/01/2020 đến 01/01/2022");
        expect(formatPeriod(null, null)).toContain("chưa rõ");
    });

    test("uses the UTC calendar day as today", () => {
        expect(todayIso(new Date("2026-10-26T23:30:00.000Z"))).toBe("2026-10-26");
    });
});
