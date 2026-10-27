import { describe, expect, test } from "bun:test";
import { RELATION_LABELS, documentTitleOf, provisionHref, provisionLabel, relationLabel } from "./labels";

const BACKEND_RELATION_TYPES = [
    "AMENDS",
    "SUPPLEMENTS",
    "AMENDS_OR_SUPPLEMENTS",
    "PARTIALLY_REPLACES",
    "FULLY_REPLACES",
    "PARTIALLY_REPEALS",
    "FULLY_REPEALS",
    "CORRECTS",
    "REFERENCES",
    "LEGAL_BASIS",
    "GUIDES",
    "DETAILS",
    "EXPLAINS",
    "SUSPENDS",
    "EXTENDS_EFFECT",
    "RESUMES_EFFECT",
    "CONTINUES_APPLICATION",
    "CONSOLIDATES",
    "UNKNOWN",
];

describe("relation labels", () => {
    test("label every relation type the backend can produce in both directions", () => {
        for (const type of BACKEND_RELATION_TYPES) {
            expect(RELATION_LABELS[type]?.outgoing.length).toBeGreaterThan(0);
            expect(RELATION_LABELS[type]?.incoming.length).toBeGreaterThan(0);
        }
    });

    test("reads the direction from this document's point of view", () => {
        expect(relationLabel("AMENDS", "OUTGOING")).toBe("Sửa đổi");
        expect(relationLabel("AMENDS", "INCOMING")).toBe("Bị sửa đổi bởi");
    });

    test("does not fail on a type it does not know", () => {
        expect(relationLabel("SOMETHING_NEW", "INCOMING")).toBe(RELATION_LABELS.UNKNOWN.incoming);
    });
});

describe("provisionLabel", () => {
    test("writes each level the way Vietnamese legal text does", () => {
        expect(provisionLabel({ level: "ARTICLE", number: "5" })).toBe("Điều 5");
        expect(provisionLabel({ level: "CHAPTER", number: "II" })).toBe("Chương II");
        expect(provisionLabel({ level: "CLAUSE", number: "5" })).toBe("5.");
        expect(provisionLabel({ level: "POINT", number: "a" })).toBe("a)");
        expect(provisionLabel({ level: "PREAMBLE", number: "" })).toBe("Căn cứ");
    });
});

describe("provisionHref", () => {
    test("points at the provision inside its document with an encoded id", () => {
        expect(provisionHref("nd-100-2019", "nd-100-2019:dieu_5_khoan_5_diem_a")).toBe("/documents/nd-100-2019#nd-100-2019%3Adieu_5_khoan_5_diem_a");
    });
});

describe("documentTitleOf", () => {
    test("prefers the number, then the title, then the id", () => {
        expect(documentTitleOf({ id: "d", documentNumber: "100/2019/NĐ-CP", title: "T" })).toBe("100/2019/NĐ-CP");
        expect(documentTitleOf({ id: "d", documentNumber: null, title: "T" })).toBe("T");
        expect(documentTitleOf({ id: "d", documentNumber: null, title: null })).toBe("d");
    });
});
