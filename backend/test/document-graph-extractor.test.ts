import { describe, expect, test } from "bun:test";
import { extractDocumentNumber, extractDocumentRelationCandidates } from "../src/modules/documents/document-graph.extractor";
import type { DocumentRelationCandidate } from "../src/modules/documents/document-graph.types";

function extract(text: string): DocumentRelationCandidate[] {
    return extractDocumentRelationCandidates({ source_document_id: "doc-source", text }).candidates;
}

describe("extractDocumentRelationCandidates", () => {
    test("detects an amendment candidate and retains the source quote", () => {
        const text = "Nghị định số 12/2024/NĐ-CP sửa đổi, bổ sung một số điều của Nghị định số 100/2019/NĐ-CP.";

        const candidates = extract(text);

        expect(candidates).toHaveLength(1);

        const [candidate] = candidates;

        expect(candidate).toMatchObject({
            source_document_id: "doc-source",
            target_document_number: "100/2019/NĐ-CP",
            action: "AMEND_OR_SUPPLEMENT",
            relation_type: "AMENDS_OR_SUPPLEMENTS",
            status: "UNRESOLVED",
        });
        expect(text.slice(candidate.evidence.start, candidate.evidence.end)).toBe(candidate.evidence.quote);
    });

    test("targets the referenced law of a preamble legal-basis line", () => {
        const candidates = extract("Căn cứ Luật Trật tự, an toàn giao thông đường bộ số 36/2024/QH15;");

        expect(candidates).toHaveLength(1);
        expect(candidates[0]).toMatchObject({ relation_type: "LEGAL_BASIS", target_document_number: "36/2024/QH15" });
    });

    test("splits a legal-basis line that names two instruments", () => {
        const candidates = extract("Căn cứ Luật Xử lý vi phạm hành chính ngày 20 tháng 6 năm 2012 và Luật Giao thông đường bộ ngày 13 tháng 11 năm 2008;");

        expect(candidates.map((candidate) => candidate.target_reference_raw)).toEqual([
            "Luật Xử lý vi phạm hành chính ngày 20 tháng 6 năm 2012",
            "Luật Giao thông đường bộ ngày 13 tháng 11 năm 2008",
        ]);
    });

    test("does not read 'căn cứ' in the middle of a sentence as a legal basis", () => {
        const candidates = extract("Biên bản là căn cứ để xử phạt theo Nghị định số 100/2019/NĐ-CP.");

        expect(candidates).toHaveLength(0);
    });

    test("does not create a relation candidate without a supported cue", () => {
        expect(extract("Văn bản này có nhắc đến Nghị định số 100/2019/NĐ-CP.")).toHaveLength(0);
    });

    test("distinguishes full and partial repeal by the wording between cue and target", () => {
        const full = extract("Bãi bỏ Nghị định số 46/2016/NĐ-CP.");
        const partial = extract("Bãi bỏ khoản 3 Điều 5 của Nghị định số 100/2019/NĐ-CP.");

        expect(full[0]).toMatchObject({ relation_type: "FULLY_REPEALS", scope: "FULL" });
        expect(partial[0]).toMatchObject({ relation_type: "PARTIALLY_REPEALS", scope: "PARTIAL" });
    });

    test("reads an expiry clause with the affected document before the cue", () => {
        const candidates = extract("Nghị định số 46/2016/NĐ-CP hết hiệu lực kể từ ngày Nghị định này có hiệu lực thi hành.");

        expect(candidates).toHaveLength(1);
        expect(candidates[0]).toMatchObject({ action: "REPEAL", relation_type: "FULLY_REPEALS", target_document_number: "46/2016/NĐ-CP" });
    });

    test("keeps references to the current document out of the document graph", () => {
        expect(extract("Bãi bỏ Điều 5 của Nghị định này.")).toHaveLength(0);
    });

    test("ignores passive descriptions of someone else's amendment", () => {
        const candidates = extract("Điều 5 đã được sửa đổi bởi Nghị định số 123/2021/NĐ-CP.");

        expect(candidates).toHaveLength(0);
    });

    test("returns empty result for empty input", () => {
        const result = extractDocumentRelationCandidates({ source_document_id: "doc-source", text: "" });

        expect(result.candidates).toHaveLength(0);
        expect(result.statistics.candidate_count).toBe(0);
    });
});

describe("extractDocumentNumber", () => {
    test("keeps a number that ends with a Vietnamese letter", () => {
        expect(extractDocumentNumber("Quyết định số 15/2024/QĐ")).toBe("15/2024/QĐ");
    });

    test("reads short historical numbers without a year", () => {
        expect(extractDocumentNumber("Nghị định 36/CP")).toBe("36/CP");
    });
});
