import { describe, expect, it } from "bun:test";
import { analyzeLegalDocument } from "../src/modules/provisions/provision.analyzer";
import { flattenLegalDocument } from "../src/modules/provisions/provision.flattener";
import type { Provision } from "../src/modules/provisions/provision.types";

const DOCUMENT_ID = "d";

type NodeOptions = {
    title?: string | null;
    quality?: "GOOD" | "PARTIAL" | "UNREADABLE";
    clauses?: object[];
    points?: object[];
    sections?: object[];
    articles?: object[];
};

function node(number: string, content: string | null, options: NodeOptions = {}): object {
    return {
        number,
        title: options.title ?? null,
        content,
        source_locator: {
            page_start: 2,
            page_end: 3,
            regions: [],
            source_quote: content ? content.slice(0, 40) : null,
            method: "LLM",
            quality: options.quality ?? "GOOD",
        },
        clauses: options.clauses ?? [],
        points: options.points ?? [],
        sections: options.sections ?? [],
        articles: options.articles ?? [],
    };
}

function legalDocument(articles: object[], content: string | null = null): object {
    return { document_title: "NGHỊ ĐỊNH", content, parts: [], chapters: [], sections: [], articles };
}

function analyze(articles: object[], content: string | null = null): Provision[] {
    return analyzeLegalDocument(DOCUMENT_ID, legalDocument(articles, content));
}

function find(provisions: Provision[], localId: string): Provision {
    const provision = provisions.find((candidate) => candidate.id === `${DOCUMENT_ID}:${localId}`);

    if (!provision) {
        throw new Error(`Provision ${localId} not found in ${provisions.map((item) => item.id).join(", ")}`);
    }

    return provision;
}

describe("flattenLegalDocument", () => {
    it("assigns stable ids, parents, reading order and locator numbers", () => {
        const section = node("1", null, {
            title: "VI PHẠM QUY TẮC",
            articles: [
                node("6", null, {
                    title: "Xử phạt người điều khiển xe",
                    clauses: [node("1", "Khoản một:", { points: [node("a", "Điểm a;"), node("đ", "Điểm đ.")] })],
                }),
            ],
        });
        const chapter = { ...node("II", null, { title: "HÀNH VI" }), sections: [section], articles: [] };
        const drafts = flattenLegalDocument(DOCUMENT_ID, { content: null, parts: [], chapters: [chapter], sections: [], articles: [] });

        expect(drafts.map((draft) => draft.id)).toEqual([
            "d:chuong_ii",
            "d:chuong_ii_muc_1",
            "d:dieu_6",
            "d:dieu_6_khoan_1",
            "d:dieu_6_khoan_1_diem_a",
            "d:dieu_6_khoan_1_diem_đ",
        ]);
        expect(drafts.map((draft) => draft.ordinal)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(drafts[3].parentId).toBe("d:dieu_6");
        expect(drafts[5]).toMatchObject({ articleNo: "6", paragraphNo: "1", pointNo: "đ", pageStart: 2, pageEnd: 3 });
    });

    it("tolerates stored JSON without source locators and ignores malformed nodes", () => {
        const drafts = flattenLegalDocument(DOCUMENT_ID, {
            content: null,
            articles: [{ number: "3", title: "Giải thích từ ngữ", content: "Điều 3.", clauses: [null, "x", { number: "1", content: "Nội dung" }] }],
        });

        expect(drafts.map((draft) => draft.id)).toEqual(["d:dieu_3", "d:dieu_3_khoan_1"]);
        expect(drafts[1].pageStart).toBeNull();
        expect(drafts[1].readQuality).toBeNull();
    });

    it("returns nothing for input that is not a legal document object", () => {
        expect(flattenLegalDocument(DOCUMENT_ID, null)).toEqual([]);
        expect(flattenLegalDocument(DOCUMENT_ID, "text")).toEqual([]);
    });

    it("suffixes duplicate ids and flags them", () => {
        const provisions = analyze([node("5", null, { title: "A" }), node("5", null, { title: "B" })]);

        expect(provisions.map((provision) => provision.id)).toEqual(["d:dieu_5", "d:dieu_5_dup2"]);
        expect(provisions[1].flags).toContain("DUPLICATE_ID");
    });
});

describe("analyzeLegalDocument preamble", () => {
    it("turns each 'Căn cứ' line into a legal-basis provision before the body", () => {
        const provisions = analyze(
            [node("1", null, { title: "Phạm vi" })],
            "CHÍNH PHỦ\nCăn cứ Luật Tổ chức Chính phủ ngày 19 tháng 6 năm 2015;\nCăn cứ Luật Trật tự, an toàn giao thông đường bộ ngày 27 tháng 6 năm 2024;\nChính phủ ban hành Nghị định.",
        );

        expect(provisions.map((provision) => provision.id).slice(0, 3)).toEqual(["d:can_cu_1", "d:can_cu_2", "d:dieu_1"]);
        expect(find(provisions, "can_cu_1")).toMatchObject({ level: "PREAMBLE", contentRole: "PREAMBLE_BASIS", relevance: "REFERENCE" });
    });
});

describe("analyzeLegalDocument sanction content", () => {
    const article = node("6", null, {
        title: "Xử phạt người điều khiển xe ô tô vi phạm quy tắc giao thông đường bộ",
        clauses: [
            node("1", "Phạt tiền từ 400.000 đồng đến 600.000 đồng đối với người điều khiển xe thực hiện một trong các hành vi vi phạm sau đây:", {
                points: [node("a", "Không chấp hành hiệu lệnh của đèn tín hiệu giao thông;"), node("b", "Không có tín hiệu báo rẽ khi chuyển hướng.")],
            }),
            node("2", "Ngoài việc bị phạt tiền, người điều khiển xe còn bị áp dụng hình thức xử phạt bổ sung sau đây:", {
                points: [node("a", "Tước quyền sử dụng Giấy phép lái xe từ 01 tháng đến 03 tháng;"), node("b", "Buộc tháo dỡ thiết bị không đúng quy định.")],
            }),
            node("3", "Việc xử lý thực hiện theo quy định tại khoản 1 Điều 5 của Nghị định này."),
            node("4", "Người điều khiển xe phải chấp hành pháp luật."),
        ],
    });

    it("marks fine clauses as sanction rules and the behaviours they list as violation rules", () => {
        const provisions = analyze([article]);

        expect(find(provisions, "dieu_6").relevance).toBe("SANCTION_RULE");
        expect(find(provisions, "dieu_6_khoan_1")).toMatchObject({ contentRole: "ORDINARY_TEXT", relevance: "SANCTION_RULE" });
        expect(find(provisions, "dieu_6_khoan_1_diem_a").relevance).toBe("VIOLATION_RULE");
        expect(find(provisions, "dieu_6_khoan_1_diem_b").relevance).toBe("VIOLATION_RULE");
    });

    it("recognises additional sanctions and remedial measures", () => {
        const provisions = analyze([article]);

        expect(find(provisions, "dieu_6_khoan_2").relevance).toBe("SANCTION_RULE");
        expect(find(provisions, "dieu_6_khoan_2_diem_a").relevance).toBe("SANCTION_RULE");
        expect(find(provisions, "dieu_6_khoan_2_diem_b").relevance).toBe("SANCTION_RULE");
    });

    it("separates plain references from irrelevant text", () => {
        const provisions = analyze([article]);

        expect(find(provisions, "dieu_6_khoan_3").relevance).toBe("REFERENCE");
        expect(find(provisions, "dieu_6_khoan_4").relevance).toBe("IRRELEVANT");
    });

    it("does not treat a bare list of sanction forms as a sanction rule", () => {
        const provisions = analyze([node("4", null, { title: "Hình thức xử phạt", clauses: [node("1", "Hình thức xử phạt chính gồm: cảnh cáo; phạt tiền.")] })]);

        expect(find(provisions, "dieu_4_khoan_1").relevance).toBe("IRRELEVANT");
        expect(find(provisions, "dieu_4").relevance).toBe("IRRELEVANT");
    });
});

describe("analyzeLegalDocument amendment documents", () => {
    const amendingArticle = node("1", null, {
        title: "Sửa đổi, bổ sung một số điều của Nghị định số 100/2019/NĐ-CP",
        clauses: [
            node("1", "Sửa đổi khoản 2 Điều 7 như sau:\n“2. Phạt tiền từ 600.000 đồng đến 800.000 đồng đối với người điều khiển xe mô tô thực hiện một trong các hành vi vi phạm sau đây:", {
                points: [
                    node("a", "Không đội mũ bảo hiểm;"),
                    node("b", "Chở quá số người quy định, trừ trường hợp quy định tại khoản 3 Điều 5 Nghị định này.”"),
                ],
            }),
            node("2", "Thay cụm từ “Bộ Giao thông vận tải” bằng cụm từ “Bộ Xây dựng” tại khoản 3 và khoản 4 Điều 9."),
            node("3", "Bãi bỏ điểm c khoản 5 Điều 7."),
        ],
    });

    it("labels the article heading as a title reference, not an instruction", () => {
        const heading = find(analyze([amendingArticle]), "dieu_1");

        expect(heading).toMatchObject({ contentRole: "TITLE_REFERENCE", relevance: "REFERENCE" });
    });

    it("labels instruction clauses and keeps their quoted text out of the instruction", () => {
        const provisions = analyze([amendingArticle]);
        const amend = find(provisions, "dieu_1_khoan_1");
        const substitute = find(provisions, "dieu_1_khoan_2");
        const repeal = find(provisions, "dieu_1_khoan_3");

        expect(amend).toMatchObject({ contentRole: "OPERATIVE_INSTRUCTION", relevance: "AMENDMENT_INSTRUCTION" });
        expect(amend.flags).toContain("HAS_QUOTED_TEXT");
        expect(substitute).toMatchObject({ contentRole: "OPERATIVE_INSTRUCTION", relevance: "AMENDMENT_INSTRUCTION" });
        expect(substitute.quotedSegments).toEqual(["Bộ Giao thông vận tải", "Bộ Xây dựng"]);
        expect(repeal).toMatchObject({ contentRole: "OPERATIVE_INSTRUCTION", relevance: "REPEAL_INSTRUCTION" });
        expect(repeal.quotedSegments).toEqual([]);
    });

    it("treats children inside an open quote as new text of the instruction that opened it", () => {
        const provisions = analyze([amendingArticle]);
        const pointA = find(provisions, "dieu_1_khoan_1_diem_a");
        const pointB = find(provisions, "dieu_1_khoan_1_diem_b");

        expect(pointA).toMatchObject({
            contentRole: "QUOTED_NEW_TEXT",
            relevance: "VIOLATION_RULE",
            containerProvisionId: "d:dieu_1_khoan_1",
        });
        expect(pointB.contentRole).toBe("QUOTED_NEW_TEXT");
        expect(find(provisions, "dieu_1_khoan_2").containerProvisionId).toBeNull();
    });

    it("leaves quoted wording without a sanction uncertain until its target is known", () => {
        const provisions = analyze([
            node("1", null, {
                title: "Sửa đổi Nghị định",
                clauses: [node("1", "Sửa đổi điểm a khoản 5 Điều 5 như sau:", { points: [node("a", "“a) Không chấp hành hiệu lệnh của đèn tín hiệu giao thông;”")] })],
            }),
        ]);

        expect(find(provisions, "dieu_1_khoan_1_diem_a")).toMatchObject({ contentRole: "QUOTED_NEW_TEXT", relevance: "UNCERTAIN" });
    });

    it("recognises a node that starts with an opening quote as quoted new text", () => {
        const provisions = analyze([
            node("1", null, {
                title: "Sửa đổi Nghị định",
                clauses: [
                    node("1", "Sửa đổi khoản 2 Điều 7 như sau:", {
                        points: [node("a", "“Phạt tiền từ 600.000 đồng đến 800.000 đồng đối với hành vi sau:”")],
                    }),
                ],
            }),
        ]);

        expect(find(provisions, "dieu_1_khoan_1_diem_a")).toMatchObject({
            contentRole: "QUOTED_NEW_TEXT",
            relevance: "SANCTION_RULE",
            containerProvisionId: "d:dieu_1_khoan_1",
        });
    });

    it("recognises the passive form used by laws", () => {
        const provisions = analyze([node("1", null, { clauses: [node("1", "Khoản 3 Điều 5 được sửa đổi, bổ sung như sau:")] })]);

        expect(find(provisions, "dieu_1_khoan_1")).toMatchObject({ contentRole: "OPERATIVE_INSTRUCTION", relevance: "AMENDMENT_INSTRUCTION" });
    });

    it("keeps descriptions of earlier amendments as history, not as instructions", () => {
        const provisions = analyze([
            node("1", null, {
                clauses: [
                    node("1", "Nghị định số 100/2019/NĐ-CP đã được sửa đổi, bổ sung bởi Nghị định số 123/2021/NĐ-CP."),
                    node("2", "Khoản 3 Điều 5 đã được sửa đổi theo Nghị định số 123/2021/NĐ-CP."),
                ],
            }),
        ]);

        expect(find(provisions, "dieu_1_khoan_1")).toMatchObject({ contentRole: "HISTORICAL_DESCRIPTION", relevance: "REFERENCE" });
        expect(find(provisions, "dieu_1_khoan_2")).toMatchObject({ contentRole: "HISTORICAL_DESCRIPTION", relevance: "REFERENCE" });
    });

    it("does not read a citation inside quoted text as an instruction", () => {
        const provisions = analyze([
            node("1", null, {
                clauses: [node("1", "Quy định chung như sau: “Bãi bỏ khoản 3 Điều 5 là sai”.")],
            }),
        ]);

        expect(find(provisions, "dieu_1_khoan_1").contentRole).toBe("ORDINARY_TEXT");
    });
});

describe("analyzeLegalDocument effect and transition rules", () => {
    it("labels effective dates, replacement and expiry", () => {
        const provisions = analyze([
            node("3", null, {
                title: "Hiệu lực thi hành",
                clauses: [
                    node("1", "Nghị định này có hiệu lực thi hành từ ngày 01 tháng 01 năm 2027."),
                    node("2", "Nghị định này thay thế Nghị định số 46/2016/NĐ-CP."),
                    node("3", "Nghị định số 171/2013/NĐ-CP hết hiệu lực kể từ ngày Nghị định này có hiệu lực."),
                ],
            }),
        ]);

        expect(find(provisions, "dieu_3_khoan_1")).toMatchObject({ contentRole: "OPERATIVE_INSTRUCTION", relevance: "REFERENCE" });
        expect(find(provisions, "dieu_3_khoan_2")).toMatchObject({ contentRole: "OPERATIVE_INSTRUCTION", relevance: "AMENDMENT_INSTRUCTION" });
        expect(find(provisions, "dieu_3_khoan_3")).toMatchObject({ contentRole: "OPERATIVE_INSTRUCTION", relevance: "REPEAL_INSTRUCTION" });
    });

    it("keeps transitional rules uncertain so the timeline step can interpret them", () => {
        const provisions = analyze([
            node("2", "Hành vi vi phạm xảy ra trước ngày Nghị định này có hiệu lực thì áp dụng quy định tại thời điểm thực hiện hành vi.", {
                title: "Quy định chuyển tiếp",
            }),
        ]);

        expect(find(provisions, "dieu_2")).toMatchObject({ contentRole: "OPERATIVE_INSTRUCTION", relevance: "UNCERTAIN" });
    });
});

describe("analyzeLegalDocument data quality", () => {
    it("marks unreadable nodes uncertain and flags partial reads", () => {
        const provisions = analyze([
            node("1", null, {
                title: "A",
                clauses: [
                    node("1", "Phạt tiền từ 400.000 đồng đến 600.000 đồng.", { quality: "UNREADABLE" }),
                    node("2", "Phạt tiền từ 400.000 đồng đến 600.000 đồng.", { quality: "PARTIAL" }),
                ],
            }),
        ]);

        expect(find(provisions, "dieu_1_khoan_1")).toMatchObject({ relevance: "UNCERTAIN" });
        expect(find(provisions, "dieu_1_khoan_1").flags).toContain("UNREADABLE");
        expect(find(provisions, "dieu_1_khoan_2")).toMatchObject({ relevance: "SANCTION_RULE" });
        expect(find(provisions, "dieu_1_khoan_2").flags).toContain("LOW_READ_QUALITY");
    });

    it("stops an unclosed quote at the next article and flags it", () => {
        const provisions = analyze([
            node("1", null, { clauses: [node("1", "Sửa đổi khoản 2 Điều 7 như sau:\n“2. Phạt tiền từ 600.000 đồng đến 800.000 đồng.")] }),
            node("2", null, { clauses: [node("1", "Người điều khiển xe phải chấp hành pháp luật.")] }),
        ]);

        expect(find(provisions, "dieu_2").flags).toContain("UNBALANCED_QUOTE");
        expect(find(provisions, "dieu_2_khoan_1").contentRole).toBe("ORDINARY_TEXT");
    });

    it("flags quoted text that no instruction introduced", () => {
        const provisions = analyze([node("1", null, { clauses: [node("1", "“Nội dung trích dẫn không có lệnh sửa đổi”")] })]);

        expect(find(provisions, "dieu_1_khoan_1")).toMatchObject({ contentRole: "QUOTED_NEW_TEXT", containerProvisionId: null });
        expect(find(provisions, "dieu_1_khoan_1").flags).toContain("QUOTE_WITHOUT_INSTRUCTION");
    });
});
describe("analyzeLegalDocument reading order", () => {
    it("keeps a chapter-level Điều ahead of the Mục that follows it", () => {
        const chapter = node("I", null, {
            title: "QUY ĐỊNH CHUNG",
            articles: [node("1", "Phạm vi điều chỉnh.")],
            sections: [node("1", null, { articles: [node("2", "Đối tượng áp dụng.")] })],
        });
        const provisions = analyzeLegalDocument(DOCUMENT_ID, { ...legalDocument([]), chapters: [chapter] });

        expect(provisions.map((provision) => provision.id)).toEqual([
            `${DOCUMENT_ID}:chuong_i`,
            `${DOCUMENT_ID}:dieu_1`,
            `${DOCUMENT_ID}:chuong_i_muc_1`,
            `${DOCUMENT_ID}:dieu_2`,
        ]);
        expect(provisions.map((provision) => provision.ordinal)).toEqual([0, 1, 2, 3]);
    });

    it("keeps a Điều that follows a Mục after that Mục", () => {
        const chapter = node("II", null, {
            sections: [node("1", null, { articles: [node("3", "Nội dung ba.")] })],
            articles: [node("4", "Nội dung bốn.")],
        });
        const provisions = analyzeLegalDocument(DOCUMENT_ID, { ...legalDocument([]), chapters: [chapter] });

        expect(provisions.map((provision) => provision.id)).toEqual([
            `${DOCUMENT_ID}:chuong_ii`,
            `${DOCUMENT_ID}:chuong_ii_muc_1`,
            `${DOCUMENT_ID}:dieu_3`,
            `${DOCUMENT_ID}:dieu_4`,
        ]);
    });
});

describe("analyzeLegalDocument ordinary verbs", () => {
    it("does not read everyday sentences that start with a legal verb as instructions", () => {
        const provisions = analyze([
            node("5", null, {
                title: "Hồ sơ",
                clauses: [
                    node("1", "Bổ sung hồ sơ trong thời hạn 05 ngày làm việc kể từ ngày nhận thông báo."),
                    node("2", "Thay thế thiết bị hỏng bằng thiết bị cùng loại."),
                ],
            }),
        ]);

        expect(find(provisions, "dieu_5_khoan_1")).toMatchObject({ contentRole: "ORDINARY_TEXT", relevance: "IRRELEVANT" });
        expect(find(provisions, "dieu_5_khoan_2")).toMatchObject({ contentRole: "ORDINARY_TEXT", relevance: "IRRELEVANT" });
    });

    it("still reads real instructions that name a legal target", () => {
        const provisions = analyze([
            node("1", null, {
                title: "Sửa đổi, bổ sung một số điều của Nghị định số 100/2019/NĐ-CP",
                clauses: [
                    node("1", "Sửa đổi, bổ sung điểm a khoản 2 Điều 6 như sau:"),
                    node("2", "Bổ sung một số điều của Nghị định số 46/2016/NĐ-CP."),
                    node("3", "Bãi bỏ các quy định sau đây:"),
                    node("4", "Thay thế Phụ lục I của Nghị định này."),
                ],
            }),
        ]);

        expect(find(provisions, "dieu_1").contentRole).toBe("TITLE_REFERENCE");
        expect(find(provisions, "dieu_1_khoan_1").relevance).toBe("AMENDMENT_INSTRUCTION");
        expect(find(provisions, "dieu_1_khoan_2").relevance).toBe("AMENDMENT_INSTRUCTION");
        expect(find(provisions, "dieu_1_khoan_3").relevance).toBe("REPEAL_INSTRUCTION");
        expect(find(provisions, "dieu_1_khoan_4").relevance).toBe("AMENDMENT_INSTRUCTION");
    });
});

describe("analyzeLegalDocument remedial measures", () => {
    it("recognises 'buộc' when it follows a heading colon, a semicolon or 'bị'", () => {
        const provisions = analyze([
            node("6", null, {
                title: "Xử phạt người điều khiển xe",
                clauses: [
                    node("1", "Biện pháp khắc phục hậu quả: Buộc tháo dỡ thiết bị lắp thêm."),
                    node("2", "Người vi phạm bị phạt cảnh cáo; buộc nộp lại giấy tờ đã sử dụng."),
                    node("3", "Ngoài việc bị xử phạt, người vi phạm còn bị buộc khôi phục tình trạng ban đầu."),
                ],
            }),
        ]);

        expect(find(provisions, "dieu_6_khoan_1").relevance).toBe("SANCTION_RULE");
        expect(find(provisions, "dieu_6_khoan_2").relevance).toBe("SANCTION_RULE");
        expect(find(provisions, "dieu_6_khoan_3").relevance).toBe("SANCTION_RULE");
    });

    it("does not treat the unrelated word 'buộc' inside a sentence as a sanction", () => {
        const provisions = analyze([node("7", null, { clauses: [node("1", "Cơ quan có thẩm quyền không bắt buộc phải thông báo trước.")] })]);

        expect(find(provisions, "dieu_7_khoan_1").relevance).toBe("IRRELEVANT");
    });
});