import { describe, expect, it } from "bun:test";
import { matchAndScoreDocument } from "../src/modules/documents/document.matcher";
import type { LegalDocumentRecord } from "../src/modules/documents/document.types";

function record(id: string, title: string, numberLine: string): LegalDocumentRecord {
    return {
        id,
        document_title: title,
        json_content: JSON.stringify({ document_title: title, content: `CHÍNH PHỦ\n${numberLine}` }),
    } as LegalDocumentRecord;
}

const BASE = record("base", "NGHỊ ĐỊNH Quy định xử phạt vi phạm hành chính", "Số: 01/2030/NĐ-CP");
const AMENDMENT = record("amendment", "NGHỊ ĐỊNH Sửa đổi, bổ sung một số điều của Nghị định số 01/2030/NĐ-CP", "Số: 02/2032/NĐ-CP");

describe("matchAndScoreDocument by document number", () => {
    it("credits a number match to the document that has the number, also for a shortened number", () => {
        const base = matchAndScoreDocument(BASE, { query: "01/2030" });
        const amendment = matchAndScoreDocument(AMENDMENT, { query: "01/2030" });

        expect(base?.match_reasons.some((reason) => reason.startsWith("Khớp số hiệu"))).toBe(true);
        expect(amendment?.match_reasons.some((reason) => reason.startsWith("Khớp số hiệu"))).toBe(false);
        expect(base!.match_score).toBeGreaterThan(amendment!.match_score);
    });

    it("does not read a different year as the same number", () => {
        const candidate = matchAndScoreDocument(BASE, { query: "01/2031" });

        expect(candidate?.match_reasons.some((reason) => reason.startsWith("Khớp số hiệu")) ?? false).toBe(false);
    });

    it("still matches the full number", () => {
        const candidate = matchAndScoreDocument(BASE, { query: "Nghị định 01/2030/NĐ-CP" });

        expect(candidate?.match_reasons).toContain("Khớp số hiệu trong truy vấn: '01/2030/NĐ-CP'");
    });
});
