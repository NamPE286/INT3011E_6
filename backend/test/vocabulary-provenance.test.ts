import { describe, expect, it } from "bun:test";
import { verifyProvisionInLegalDocuments } from "../src/modules/vocabulary/vocabulary.provenance";

const NESTED_DOCUMENT = {
    id: "nd100",
    document_title: "NGHỊ ĐỊNH Quy định xử phạt vi phạm hành chính",
    json_content: JSON.stringify({
        articles: [],
        parts: [],
        sections: [],
        chapters: [{
            number: "II",
            articles: [],
            sections: [{
                number: "1",
                articles: [{
                    number: "6",
                    title: "Xử phạt người điều khiển xe mô tô",
                    content: null,
                    clauses: [{
                        number: "1",
                        content: "Phạt tiền từ 100.000 đồng đến 200.000 đồng đối với người điều khiển xe thực hiện một trong các hành vi vi phạm sau đây:",
                        points: [{ number: "đ", content: "Chuyển hướng không nhường đường cho: Các xe đi ngược chiều;" }],
                    }],
                }],
            }],
        }],
    }),
};

describe("verifyProvisionInLegalDocuments", () => {
    it("finds articles nested in chapter → section (Nghị định 100 layout)", () => {
        const result = verifyProvisionInLegalDocuments(
            [NESTED_DOCUMENT],
            "dieu_6_khoan_1_diem_d",
            "Chuyển hướng không nhường đường cho: Các xe đi ngược chiều",
        );

        expect(result).toEqual({ verified: true, matchedDocumentId: "nd100" });
    });

    it("accepts a vehicle named only in the article title as evidence for one of its points", () => {
        const result = verifyProvisionInLegalDocuments([NESTED_DOCUMENT], "nd100:dieu_6_khoan_1_diem_d", "xe mô tô");

        expect(result.verified).toBe(true);
    });

    it("rejects evidence that is not in the referenced point", () => {
        const result = verifyProvisionInLegalDocuments([NESTED_DOCUMENT], "nd100:dieu_6_khoan_1_diem_d", "Điều khiển xe chạy quá tốc độ quy định");

        expect(result.verified).toBe(false);
        expect(result.reason).toContain("does not match");
    });

    it("rejects references without an article", () => {
        const result = verifyProvisionInLegalDocuments([NESTED_DOCUMENT], "khoan_1", "Phạt tiền từ 100.000 đồng");

        expect(result.verified).toBe(false);
        expect(result.reason).toContain("does not name an article");
    });
});
