import { describe, expect, it } from "bun:test";
import { assembleLegalDocument } from "../src/modules/processing/legal-assembler";
import type { ChunkTranscription, TranscribedBlock } from "../src/modules/processing/legal-types";
import { block, goodPages } from "./openai-fake";

const SOURCE = { snapshotId: "snapshot-1", pdfSha256: "b".repeat(64), pageCount: 1 };

function assemble(blocks: TranscribedBlock[]) {
    const chunk: ChunkTranscription = {
        page_start: 1,
        page_end: 1,
        pages: goodPages(1),
        blocks: [block("title", { text: "NGHỊ ĐỊNH" }), ...blocks, block("closing", { text: "TM. CHÍNH PHỦ" })],
        error: null,
    };

    return assembleLegalDocument([chunk], SOURCE);
}

const AMENDING_ARTICLE = block("article", { number: "1", title: "Sửa đổi, bổ sung một số điều của Nghị định số 142/2017/NĐ-CP" });

describe("assembleLegalDocument with quoted amendments", () => {
    it("keeps a quoted article out of the document structure, even without its opening mark", () => {
        const { document, issues } = assemble([
            AMENDING_ARTICLE,
            block("clause", { number: "1", text: "Sửa đổi, bổ sung Điều 17 như sau:" }),
            block("article", { number: "17", title: "Vi phạm quy định đối với người điều khiển ô tô" }),
            block("clause", { number: "1", text: "Phạt tiền từ 800.000 đồng đến 1.000.000 đồng đối với hành vi sau đây:" }),
            block("point", { number: "a", text: "Chạy quá tốc độ quy định từ 05 km/giờ đến dưới 10 km/giờ.”." }),
            block("clause", { number: "2", text: "Bãi bỏ khoản 3 Điều 18." }),
        ]);
        const [article] = document.articles;

        expect(issues.filter((issue) => issue.severity === "ERROR")).toEqual([]);
        expect(document.articles).toHaveLength(1);
        expect(article.clauses.map((clause) => clause.number)).toEqual(["1", "2"]);
        expect(article.clauses[0].quoted?.[0]).toMatchObject({
            kind: "article",
            number: "17",
            children: [{ kind: "clause", number: "1", children: [{ kind: "point", number: "a" }] }],
        });
        expect(article.clauses[1].quoted).toBeUndefined();
    });

    it("reads a quoted heading the reader left inside a continued text block", () => {
        const { document } = assemble([
            AMENDING_ARTICLE,
            block("clause", { number: "15", text: "Sửa đổi, bổ sung Điều 32 như sau:" }),
            block("text", { text: "“Điều 32. Vi phạm quy định về thủ tục vào, rời cảng biển", continues_previous: true }),
            block("clause", { number: "1", text: "Phạt tiền từ 3.000.000 đồng đến 5.000.000 đồng.”." }),
        ]);

        expect(document.articles[0].clauses[0].quoted?.[0]).toMatchObject({ kind: "article", number: "32", children: [{ kind: "clause", number: "1" }] });
    });

    it("does not read an ordinary 'như sau' list or sub-instructions as quoted wording", () => {
        const { document } = assemble([
            block("article", { number: "6", title: "Xử phạt người điều khiển xe ô tô" }),
            block("clause", { number: "1", text: "Ngoài việc bị phạt tiền, người điều khiển xe còn bị áp dụng các hình thức xử phạt bổ sung như sau:" }),
            block("point", { number: "a", text: "Tước quyền sử dụng Giấy phép lái xe từ 01 tháng đến 03 tháng;" }),
            block("clause", { number: "2", text: "Sửa đổi, bổ sung một số điểm của khoản 6 Điều 28 như sau:" }),
            block("point", { number: "a", text: "Sửa đổi, bổ sung điểm i khoản 6 Điều 28 như sau:" }),
            block("text", { text: "“i) Điều 31;”." }),
            block("point", { number: "b", text: "Bãi bỏ điểm k khoản 6 Điều 28." }),
        ]);
        const [first, second] = document.articles[0].clauses;

        expect(first.points.map((point) => point.number)).toEqual(["a"]);
        expect(first.quoted).toBeUndefined();
        expect(second.points.map((point) => point.number)).toEqual(["a", "b"]);
        expect(second.points[0].quoted?.[0]).toMatchObject({ kind: "point", number: "i" });
    });

    it("closes a quote left open at the host's next instruction and says so", () => {
        const { document, issues } = assemble([
            AMENDING_ARTICLE,
            block("clause", { number: "3", text: "Sửa đổi, bổ sung khoản 2 Điều 7 như sau:" }),
            block("text", { text: "“2. Phạt tiền từ 1.000.000 đồng đến 2.000.000 đồng đối với hành vi không khai báo." }),
            block("clause", { number: "4", text: "Bãi bỏ Điều 8." }),
        ]);

        expect(document.articles[0].clauses.map((clause) => clause.number)).toEqual(["3", "4"]);
        expect(issues.map((issue) => issue.code)).toContain("QUOTE_NOT_CLOSED");
    });

    it("maps Cyrillic look-alikes in point markers back to Latin letters", () => {
        const { document, issues } = assemble([
            block("article", { number: "1", title: "Xử phạt" }),
            block("clause", { number: "1", text: "Phạt tiền đối với hành vi sau đây:" }),
            block("point", { marker: "a)", number: "a", text: "Hành vi một;" }),
            block("point", { marker: "b)", number: "b", text: "Hành vi hai;" }),
            block("point", { marker: "с)", number: null, text: "Hành vi ba." }),
        ]);

        expect(document.articles[0].clauses[0].points.map((point) => point.number)).toEqual(["a", "b", "c"]);
        expect(issues.filter((issue) => issue.severity === "ERROR")).toEqual([]);
    });
});
