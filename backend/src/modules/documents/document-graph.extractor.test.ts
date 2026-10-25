import { describe, expect, test } from "bun:test";
import { extractDocumentRelationCandidates } from "./document-graph.extractor";

describe("extractDocumentRelationCandidates", () => {
    test("detects an amendment candidate and retains the source quote", () => {
        const text =
            "Nghị định số 12/2024/NĐ-CP sửa đổi, bổ sung một số điều của Nghị định số 100/2019/NĐ-CP.";

        const result = extractDocumentRelationCandidates({
            source_document_id: "doc-12-2024",
            text,
        });

        const candidate = result.candidates.find(
            (item) => item.relation_type === "AMENDS_OR_SUPPLEMENTS",
        );

        expect(candidate).toBeDefined();
        expect(candidate?.source_document_id).toBe("doc-12-2024");
        expect(candidate?.target_document_number).toBe("12/2024/NĐ-CP");
        expect(candidate?.status).toBe("UNRESOLVED");
        expect(text.slice(candidate!.evidence.start, candidate!.evidence.end)).toBe(
            candidate?.evidence.quote,
        );
    });

    test("detects legal-basis candidates", () => {
        const text = "Căn cứ Luật Trật tự, an toàn giao thông đường bộ số 36/2024/QH15.";
        const result = extractDocumentRelationCandidates({
            source_document_id: "doc-test",
            text,
        });

        expect(result.candidates.some((item) => item.relation_type === "LEGAL_BASIS")).toBe(true);
    });

    test("does not create a relation candidate without a supported cue", () => {
        const result = extractDocumentRelationCandidates({
            source_document_id: "doc-test",
            text: "Văn bản này có nhắc đến Nghị định số 100/2019/NĐ-CP.",
        });

        expect(result.candidates).toHaveLength(0);
    });

    test("returns empty result for empty input", () => {
        const result = extractDocumentRelationCandidates({
            source_document_id: "doc-test",
            text: "",
        });

        expect(result.candidates).toHaveLength(0);
        expect(result.statistics.candidate_count).toBe(0);
    });
});
