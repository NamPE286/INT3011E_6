import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildJudgeBlindDataset } from "./judge-blind-dataset";
import { buildJudgeDevDataset } from "./judge-dev-dataset";
import { buildLoopholeGoldenDataset } from "./loophole-dataset";
import type { DatasetSplit, JudgeEvalCase, LoopholeEvalCase } from "./types";

function formatLoopholeBatchPrompt(cases: readonly LoopholeEvalCase[]): string {
    const header = `Hãy kiểm tra từng văn bản dưới đây để phát hiện các kẽ hở pháp lý / lỗi logic / lỗi hợp đồng thực sự nghiêm trọng (KHÔNG báo lỗi giả trên văn bản sạch!).
Mã lỗi chuẩn:
- LG001: Khung phạt tiền hoặc khung phạt tù bị đảo ngược (min > max).
- LP003: Khoảng trống định lượng giữa các ngưỡng liên tiếp (boundary gap).
- LG002: Chồng chéo định lượng tại điểm biên (boundary overlap).
- DEONTIC_CONFLICT: Mâu thuẫn đạo nghĩa trực tiếp (vừa Nghiêm cấm vừa Cho phép cùng hành vi).
- LG003: Dẫn chiếu nội bộ gãy (trỏ tới Điều/Khoản không tồn tại).
- LG004: Dẫn chiếu vòng lặp vào chính nó.
- LG007: Dẫn chiếu tới Điều/Khoản đã bị bãi bỏ.
- LP001: Ngoại lệ mở không có tiêu chí/dẫn chiếu (ví dụ: "trừ trường hợp đặc biệt", "trừ lý do chính đáng"). Lưu ý: ngoại lệ có dẫn chiếu "theo quy định tại Điều ..." là HỢP LỆ, không phải lỗi!
- LP002: Hành vi bị nghiêm cấm nhưng không có chế tài xử lý.
- LP006: Điều khoản chỉ phạt "cá nhân" mà bỏ sót "tổ chức" (khi không có điều khoản quy đổi gấp 2 lần và không ghi "cá nhân hoặc tổ chức" / "cá nhân và tổ chức").
- LG016: Nghịch lý khung hình phạt (hành vi nghiêm trọng hơn khoản trước nhưng mức phạt lại thấp hơn).
- AM005: Thuật ngữ pháp lý chuyên ngành (như "dữ liệu nhạy cảm", "điểm giấy phép lái xe") chưa được định nghĩa trong văn bản và workspace.

Trả về DUY NHẤT một JSON array gồm đúng ${cases.length} phần tử, mỗi phần tử đúng schema:
{
  "caseId": "string",
  "hasLoophole": boolean,
  "workspaceOnly": true,
  "findings": [
    {
      "code": "string",
      "category": "LOOPHOLE" | "AMBIGUITY" | "LOGIC",
      "provisionRef": "Khoản X Điều Y",
      "verbatimQuote": "chuỗi trích dẫn nguyên văn trong DRAFT",
      "exploitScenario": "kịch bản khai thác ngắn gọn"
    }
  ]
}
Nếu văn bản sạch 100%, trả về "hasLoophole": false và "findings": [].

DANH SÁCH VĂN BẢN:`;

    const body = cases.map((c) => {
        const ws = c.workspaceFiles.length > 0
            ? c.workspaceFiles.map((f) => `[WS:${f.title}]\n${f.content}`).join("\n")
            : "(Trống)";

        return `\n=== CASE ${c.caseId} ===\nWORKSPACE:\n${ws}\nDRAFT:\n${c.draftContent}`;
    }).join("\n");

    return `${header}${body}`;
}

function formatJudgeBatchPrompt(cases: readonly JudgeEvalCase[]): string {
    const header = `Hãy đóng vai Thẩm phán Live Judge xét xử từng tình huống dưới đây CHỈ dựa trên DRAFT và WORKSPACE cung cấp.
Quy tắc bắt buộc:
1. outcome thuộc ĐÚNG 1 trong 5 nhãn:
   - GUILTY_SANCTIONED: Đủ căn cứ áp dụng chế tài rõ ràng (tính tổng khung tiền phạt nếu đa vi phạm, nhân 2 cho tổ chức nếu có điều khoản quy đổi, áp dụng mức phạt đã được sửa đổi nếu có văn bản sửa đổi trong WORKSPACE).
   - PARTIALLY_ENFORCEABLE: Một phần xử phạt được, phần còn lại vướng thuật ngữ thiếu định nghĩa (AM005) hoặc lệnh cấm thiếu chế tài (LP002).
   - ACQUITTED_LOOPHOLE: Không xử phạt được do lọt kẽ hở (LP003 khoảng trống ngưỡng, LP001 ngoại lệ mở, LP002 lệnh cấm không chế tài, LP006 thiếu tổ chức, hoặc LG007 điều khoản đã bị bãi bỏ trong WORKSPACE).
   - CONFLICT_AMBIGUOUS: Phải từ chối kết luận (abstained = true) do xung đột (LG001 khung phạt/tù đảo ngược, LG002 chồng chéo ngưỡng, DEONTIC_CONFLICT), mơ hồ định tính (AM001 như "gây hậu quả nghiêm trọng", "kịp thời"), hoặc thiếu dữ kiện định lượng quan trọng (INSUFFICIENT_FACTS).
   - NOT_COVERED: Không thuộc phạm vi xử phạt (dưới ngưỡng tối thiểu, ngoại lệ hợp lệ đã thỏa mãn mà không rơi vào phủ định kép, hoặc ngày vi phạm xảy ra TRƯỚC ngày văn bản có hiệu lực).
2. abstained = true khi và chỉ khi outcome === "CONFLICT_AMBIGUOUS".
3. nonMonetarySanctions: ghi rõ chế tài hình sự/phi tiền tệ nếu có (ví dụ: "phạt tù từ 05 năm đến 10 năm", "tịch thu tang vật", "tù chung thân").
4. citations: trích dẫn nguyên văn (verbatimQuote) và địa chỉ điều khoản (provisionRef) từ DRAFT hoặc WORKSPACE. KHÔNG bịa trích dẫn.

Trả về DUY NHẤT một JSON array gồm đúng ${cases.length} phần tử, mỗi phần tử đúng schema:
{
  "caseId": "string",
  "outcome": "GUILTY_SANCTIONED" | "ACQUITTED_LOOPHOLE" | "CONFLICT_AMBIGUOUS" | "PARTIALLY_ENFORCEABLE" | "NOT_COVERED",
  "abstained": boolean,
  "applicableFine": { "min": number, "max": number } | null,
  "nonMonetarySanctions": ["string"],
  "detectedDefectCodes": ["string"],
  "citations": [{ "provisionRef": "string", "verbatimQuote": "string" }],
  "reasoning": "1-2 câu lập luận ngắn gọn",
  "workspaceOnly": true
}

DANH SÁCH CA XÉT XỬ:`;

    const body = cases.map((c) => {
        const ws = c.workspaceFiles.length > 0
            ? c.workspaceFiles.map((f) => `[WS:${f.title}]\n${f.content}`).join("\n")
            : "(Trống)";

        return `\n=== CASE ${c.caseId} ===\nWORKSPACE:\n${ws}\nDRAFT:\n${c.draftContent}\nSCENARIO:\n${c.scenario}`;
    }).join("\n");

    return `${header}${body}`;
}

export function writePromptBatches(split: DatasetSplit, outDir: string): void {
    mkdirSync(outDir, { recursive: true });
    const lh = buildLoopholeGoldenDataset().filter((c) => c.split === split);
    const jg = split === "dev" ? buildJudgeDevDataset() : buildJudgeBlindDataset();

    const lhMid = Math.ceil(lh.length / 2);
    const jgMid = Math.ceil(jg.length / 2);

    const files: { name: string; content: string; count: number }[] = [
        { name: `${split}-loophole-1.txt`, content: formatLoopholeBatchPrompt(lh.slice(0, lhMid)), count: lhMid },
        { name: `${split}-loophole-2.txt`, content: formatLoopholeBatchPrompt(lh.slice(lhMid)), count: lh.length - lhMid },
        { name: `${split}-judge-1.txt`, content: formatJudgeBatchPrompt(jg.slice(0, jgMid)), count: jgMid },
        { name: `${split}-judge-2.txt`, content: formatJudgeBatchPrompt(jg.slice(jgMid)), count: jg.length - jgMid },
    ];

    for (const f of files) {
        const p = resolve(outDir, f.name);
        writeFileSync(p, f.content, "utf8");
        console.log(`${f.name}: ${f.count} cases, ${f.content.length} chars (~${Math.ceil(f.content.length / 3.5)} est tokens)`);
    }
}

if (import.meta.main) {
    const splitArg = (process.argv.find((a) => a.startsWith("--split="))?.split("=")[1] ?? "dev") as DatasetSplit;
    const outDir = process.argv.find((a) => a.startsWith("--out="))?.split("=")[1]
        ?? "/Users/nambh/.gemini/antigravity/brain/4eed5fea-11db-4005-9f5c-9882dde16f5a/scratch/itd-batches";
    writePromptBatches(splitArg, outDir);
}
