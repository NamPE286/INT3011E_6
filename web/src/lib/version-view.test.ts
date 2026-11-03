import { describe, expect, test } from "bun:test";
import type { RuleCard } from "./api/violations";
import { activeVersionDate, nextVersionDate, versionDates, versionStateAt } from "./version-view";

function rule(validFrom: string | null, validTo: string | null, endType: string | null = null): Pick<RuleCard, "validFrom" | "validTo" | "endType"> {
    return { validFrom, validTo, endType };
}

const HELMET = [rule("2031-01-01", "2033-01-01", "AMENDED"), rule("2033-01-01", null)];

describe("versionDates", () => {
    test("lists each date a version starts, once and in order, across lineages", () => {
        expect(versionDates([{ rules: [HELMET[1], HELMET[0]] }, { rules: [rule("2031-01-01", null), rule(null, null)] }])).toEqual([
            "2031-01-01",
            "2033-01-01",
        ]);
    });
});

describe("versionStateAt", () => {
    test("says whether a version applies on the date being viewed", () => {
        expect(versionStateAt(HELMET[0], "2032-06-01")).toEqual({ kind: "IN_FORCE" });
        expect(versionStateAt(HELMET[0], "2030-06-01")).toEqual({ kind: "NOT_YET" });
        expect(versionStateAt(HELMET[0], "2033-01-01")).toEqual({ kind: "ENDED", endType: "AMENDED" });
        expect(versionStateAt(HELMET[1], "2040-01-01")).toEqual({ kind: "IN_FORCE" });
    });

    test("does not guess for a version whose start date was not read", () => {
        expect(versionStateAt(rule(null, null), "2032-06-01")).toEqual({ kind: "UNKNOWN" });
    });
});

describe("nextVersionDate", () => {
    test("points to the next version after the date, else to the latest one", () => {
        const dates = ["2031-01-01", "2033-01-01"];

        expect(nextVersionDate(dates, "2026-11-02")).toBe("2031-01-01");
        expect(nextVersionDate(dates, "2032-01-01")).toBe("2033-01-01");
        expect(nextVersionDate(dates, "2040-01-01")).toBe("2033-01-01");
        expect(nextVersionDate([], "2040-01-01")).toBeNull();
    });
});

describe("activeVersionDate", () => {
    test("is the start of the latest version that began on or before the date", () => {
        const dates = ["2031-01-01", "2033-01-01"];

        expect(activeVersionDate(dates, "2033-06-01")).toBe("2033-01-01");
        expect(activeVersionDate(dates, "2033-01-01")).toBe("2033-01-01");
        expect(activeVersionDate(dates, "2032-12-31")).toBe("2031-01-01");
        expect(activeVersionDate(dates, "2026-11-02")).toBeNull();
    });
});
