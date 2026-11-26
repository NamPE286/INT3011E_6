import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runLocalDebugSimulation } from "../src/lib/engine/debug";
import { callGeminiStructuredInteraction } from "../src/lib/engine/gemini-client";
import type { LocalWorkspaceFile } from "../src/lib/engine/local-workspace";
import type { VerdictOutcome } from "../src/lib/engine/types";

type BenchmarkCase = {
    caseId: string;
    group: "CORE_TRAFFIC" | "EXTENSION_HARD";
    draftKey: keyof typeof DOCS;
    workspaceKeys: (keyof typeof DOCS)[];
    scenario: string;
    expectedOutcome: VerdictOutcome;
    requiredDefect: string | null;
    expectedFine: { min: number; max: number } | null;
};

type LlmPrediction = {
    caseId: string;
    outcome: VerdictOutcome;
    fineMin: number | null;
    fineMax: number | null;
    detectedDefectCodes: string[];
    reasoning: string;
};

type ContenderCaseResult = {
    caseId: string;
    outcome: string;
    fine: { min: number; max: number } | null;
    defects: string[];
    outcomeMatch: boolean;
    defectMatch: boolean;
    fineMatch: boolean;
    invalidInvertedFine: boolean;
    durationMs: number;
};

const DOCS = {
    DOC_A: `Dự thảo Nghị định xử phạt vi phạm giao thông thông minh & xe tự hành
Chương I. QUY ĐỊNH CHUNG
Điều 1. Phạm vi điều chỉnh và đối tượng áp dụng
1. Nghị định này quy định hành vi vi phạm hành chính, hình thức, mức xử phạt đối với người điều khiển phương tiện giao thông thông minh và xe tự hành trên đường bộ.
Điều 2. Các hành vi bị nghiêm cấm
1. Nghiêm cấm tự ý can thiệp phần mềm hệ thống hỗ trợ lái của xe tự hành khi tham gia giao thông.
2. Nghiêm cấm tắt thiết bị giám sát hành trình trên đường cao tốc, trừ trường hợp đặc biệt.
Chương II. HÀNH VI VI PHẠM VÀ MỨC XỬ PHẠT
Điều 3. Xử phạt vi phạm quy định về tốc độ và tín hiệu giao thông
1. Phạt tiền từ 800.000 đồng đến 1.000.000 đồng đối với cá nhân điều khiển xe chạy quá tốc độ quy định từ 05 km/h đến 10 km/h.
2. Phạt tiền từ 2.000.000 đồng đến 4.000.000 đồng đối với cá nhân điều khiển xe chạy quá tốc độ quy định từ 15 km/h đến 20 km/h.
3. Phạt tiền từ 6.000.000 đồng đến 4.000.000 đồng đối với hành vi chạy quá tốc độ quy định từ 20 km/h đến 35 km/h, gây hậu quả nghiêm trọng và các trường hợp khác.
Điều 4. Xử phạt hành vi dừng, đỗ xe tự hành
1. Phạt tiền từ 1.000.000 đồng đến 2.000.000 đồng đối với hành vi dừng xe tại nơi có biển cấm dừng, trừ lý do chính đáng.
2. Ngoài việc bị phạt tiền, người điều khiển xe còn bị áp dụng hình thức xử phạt bổ sung:
a) Thực hiện hành vi quy định tại khoản 1 Điều này bị trừ điểm giấy phép lái xe.
Điều 6. Hiệu lực thi hành
1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2027.`,

    DOC_B: `Dự thảo Nghị định quy định xử phạt vi phạm đối với xe tự hành
Điều 1. Phạm vi điều chỉnh và nguyên tắc quy đổi
1. Nghị định này quy định mức xử phạt vi phạm hành chính đối với người điều khiển xe tự hành có sử dụng hệ thống hỗ trợ lái trên đường bộ và đường cao tốc.
2. Đối với cùng một hành vi vi phạm hành chính thì mức phạt tiền đối với tổ chức bằng 02 lần mức phạt tiền đối với cá nhân.
Điều 3. Xử phạt hành vi điều khiển xe tự hành chạy quá tốc độ
1. Phạt tiền từ 800.000 đồng đến 1.000.000 đồng đối với cá nhân điều khiển xe tự hành chạy quá tốc độ từ 05 km/h đến dưới 10 km/h.
2. Phạt tiền từ 2.000.000 đồng đến 4.000.000 đồng đối với cá nhân điều khiển xe tự hành chạy quá tốc độ từ 10 km/h đến dưới 20 km/h; trừ điểm giấy phép lái xe 02 điểm.
3. Phạt tiền từ 6.000.000 đồng đến 8.000.000 đồng đối với cá nhân điều khiển xe tự hành chạy quá tốc độ từ 20 km/h đến 35 km/h; trừ điểm giấy phép lái xe 04 điểm.
4. Phạt tiền từ 12.000.000 đồng đến 14.000.000 đồng đối với cá nhân điều khiển xe tự hành chạy quá tốc độ trên 35 km/h; tước quyền sử dụng giấy phép lái xe từ 01 tháng đến 03 tháng.
Điều 4. Hiệu lực thi hành
1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2027.`,

    LIB_36: `Luật Trật tự, an toàn giao thông đường bộ số 36/2024/QH15
Điều 1. Giải thích từ ngữ
1. Điểm giấy phép lái xe là thông số dùng để quản lý việc chấp hành pháp luật về trật tự, an toàn giao thông đường bộ của người lái xe, gồm 12 điểm.
2. Giấy phép lái xe là chứng chỉ do cơ quan có thẩm quyền cấp cho người đủ điều kiện điều khiển xe cơ giới.
3. Xe tự hành là phương tiện giao thông đường bộ có khả năng tự động điều khiển một phần hoặc toàn bộ hành trình.`,

    DOC_168: `Nghị định số 168/2024/NĐ-CP quy định xử phạt vi phạm hành chính về trật tự, an toàn giao thông đường bộ
Điều 1. Mức phạt tiền đối với tổ chức
1. Đối với cùng một hành vi vi phạm hành chính thì mức phạt tiền đối với tổ chức bằng 02 lần mức phạt tiền đối với cá nhân.
Điều 2. Xử phạt người điều khiển xe ô tô
1. Phạt tiền từ 800.000 đồng đến 1.000.000 đồng đối với người điều khiển xe ô tô chạy quá tốc độ quy định từ 05 km/h đến dưới 10 km/h.
2. Phạt tiền từ 4.000.000 đồng đến 6.000.000 đồng đối với người điều khiển xe ô tô chạy quá tốc độ quy định từ 10 km/h đến 20 km/h; trừ điểm giấy phép lái xe 02 điểm.
3. Phạt tiền từ 18.000.000 đồng đến 20.000.000 đồng đối với người điều khiển xe ô tô không chấp hành hiệu lệnh của đèn tín hiệu giao thông; trừ điểm giấy phép lái xe 04 điểm.
Điều 3. Xử phạt người điều khiển xe mô tô
1. Phạt tiền từ 400.000 đồng đến 600.000 đồng đối với người điều khiển xe mô tô không đội mũ bảo hiểm.
2. Phạt tiền từ 4.000.000 đồng đến 6.000.000 đồng đối với người điều khiển xe mô tô không chấp hành hiệu lệnh của đèn tín hiệu giao thông; trừ điểm giấy phép lái xe 04 điểm.`,

    DOC_AMB: `Dự thảo Quy định xử phạt vi phạm giao thông
Điều 1. Xử phạt vi phạm
1. Phạt tiền từ 2.000.000 đồng đến 4.000.000 đồng đối với hành vi gây hậu quả nghiêm trọng.
Điều 2. Hiệu lực thi hành
1. Có hiệu lực từ ngày 01 tháng 01 năm 2027.`,

    DOC_BLHS_305: `Bộ luật Hình sự số 100/2015/QH13
Điều 305. Tội chế tạo, tàng trữ, vận chuyển, sử dụng, mua bán trái phép hoặc chiếm đoạt vật liệu nổ
2. Phạm tội thuộc một trong các trường hợp sau đây, thì bị phạt tù từ 03 năm đến 10 năm:
b) Thuốc nổ các loại từ 10 kilôgam đến 30 kilôgam hoặc từ 1.000 đến 3.000 nụ xuỳ hoặc ống nổ;
3. Phạm tội thuộc một trong các trường hợp sau đây, thì bị phạt tù từ 07 năm đến 15 năm:
a) Thuốc nổ các loại từ trên 31 kilôgam đến 100 kilôgam; từ 3.001 đến 10.000 nụ xuỳ hoặc ống nổ;`,

    DOC_BLHS_359: `Bộ luật Hình sự số 100/2015/QH13
Điều 359. Tội giả mạo trong công tác
2. Phạm tội thuộc một trong các trường hợp sau đây, thì bị phạt tù từ 03 năm đến 10 năm:
c) Làm, cấp giấy tờ giả với số lượng từ 02 giấy tờ giả đến 05 giấy tờ giả.
3. Phạm tội thuộc một trong các trường hợp sau đây, thì bị phạt tù từ 07 năm đến 15 năm:
a) Làm, cấp giấy tờ giả với số lượng từ 05 giấy tờ giả đến 10 giấy tờ giả;`,

    DOC_DEONTIC: `Dự thảo Nghị định quy định lưu thông xe tự hành trên đường cao tốc
Điều 1. Quy định lưu thông xe tự hành trên đường cao tốc
1. Nghiêm cấm cá nhân điều khiển xe tự hành đi vào đường cao tốc; trường hợp vi phạm bị phạt tiền từ 4.000.000 đồng đến 6.000.000 đồng đối với cá nhân.
2. Cho phép cá nhân điều khiển xe tự hành đi vào đường cao tốc.
Điều 2. Hiệu lực thi hành
1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 05 năm 2027.`,
} as const;

const BENCHMARK_CASES: readonly BenchmarkCase[] = [
    {
        caseId: "DBG-01",
        group: "CORE_TRAFFIC",
        draftKey: "DOC_A",
        workspaceKeys: [],
        scenario: "Anh A lái xe tự hành chạy quá tốc độ 12 km/h trên đường bộ.",
        expectedOutcome: "ACQUITTED_LOOPHOLE",
        requiredDefect: "LP003",
        expectedFine: null,
    },
    {
        caseId: "DBG-02",
        group: "CORE_TRAFFIC",
        draftKey: "DOC_A",
        workspaceKeys: [],
        scenario: "Người điều khiển xe chạy quá tốc độ 20 km/h.",
        expectedOutcome: "CONFLICT_AMBIGUOUS",
        requiredDefect: "LG002",
        expectedFine: null,
    },
    {
        caseId: "DBG-03",
        group: "CORE_TRAFFIC",
        draftKey: "DOC_A",
        workspaceKeys: [],
        scenario: "Cá nhân điều khiển xe chạy quá tốc độ 28 km/h.",
        expectedOutcome: "CONFLICT_AMBIGUOUS",
        requiredDefect: "LG001",
        expectedFine: null,
    },
    {
        caseId: "DBG-04",
        group: "CORE_TRAFFIC",
        draftKey: "DOC_A",
        workspaceKeys: [],
        scenario: "Công ty vận tải X điều khiển xe chạy quá tốc độ 8 km/h.",
        expectedOutcome: "ACQUITTED_LOOPHOLE",
        requiredDefect: "LP006",
        expectedFine: null,
    },
    {
        caseId: "DBG-05",
        group: "CORE_TRAFFIC",
        draftKey: "DOC_B",
        workspaceKeys: ["LIB_36"],
        scenario: "Công ty vận tải X có hành vi điều khiển xe tự hành chạy quá tốc độ 8 km/h.",
        expectedOutcome: "GUILTY_SANCTIONED",
        requiredDefect: null,
        expectedFine: { min: 1_600_000, max: 2_000_000 },
    },
    {
        caseId: "DBG-06",
        group: "CORE_TRAFFIC",
        draftKey: "DOC_B",
        workspaceKeys: ["LIB_36"],
        scenario: "Anh B điều khiển xe tự hành chạy quá tốc độ 10 km/h.",
        expectedOutcome: "GUILTY_SANCTIONED",
        requiredDefect: null,
        expectedFine: { min: 2_000_000, max: 4_000_000 },
    },
    {
        caseId: "DBG-07",
        group: "CORE_TRAFFIC",
        draftKey: "DOC_B",
        workspaceKeys: ["LIB_36"],
        scenario: "Anh D điều khiển xe tự hành chạy quá tốc độ 3 km/h.",
        expectedOutcome: "NOT_COVERED",
        requiredDefect: null,
        expectedFine: null,
    },
    {
        caseId: "DBG-08",
        group: "CORE_TRAFFIC",
        draftKey: "DOC_A",
        workspaceKeys: [],
        scenario: "Anh E tự ý can thiệp phần mềm hệ thống hỗ trợ lái của xe tự hành khi tham gia giao thông.",
        expectedOutcome: "ACQUITTED_LOOPHOLE",
        requiredDefect: "LP002",
        expectedFine: null,
    },
    {
        caseId: "DBG-09",
        group: "CORE_TRAFFIC",
        draftKey: "DOC_A",
        workspaceKeys: [],
        scenario: "Tài xế dừng xe tại nơi có biển cấm dừng và viện dẫn lý do chính đáng.",
        expectedOutcome: "ACQUITTED_LOOPHOLE",
        requiredDefect: "LP001",
        expectedFine: null,
    },
    {
        caseId: "DBG-10",
        group: "CORE_TRAFFIC",
        draftKey: "DOC_A",
        workspaceKeys: [],
        scenario: "Anh B dừng xe tại nơi có biển cấm dừng.",
        expectedOutcome: "PARTIALLY_ENFORCEABLE",
        requiredDefect: "AM005",
        expectedFine: { min: 1_000_000, max: 2_000_000 },
    },
    {
        caseId: "DBG-11",
        group: "CORE_TRAFFIC",
        draftKey: "DOC_AMB",
        workspaceKeys: [],
        scenario: "Anh C gây hậu quả trong vụ va quẹt giao thông.",
        expectedOutcome: "CONFLICT_AMBIGUOUS",
        requiredDefect: "AM001",
        expectedFine: null,
    },
    {
        caseId: "DBG-12",
        group: "EXTENSION_HARD",
        draftKey: "DOC_168",
        workspaceKeys: ["LIB_36"],
        scenario: "Anh H lái xe hơi vượt đèn đỏ tại ngã tư.",
        expectedOutcome: "GUILTY_SANCTIONED",
        requiredDefect: null,
        expectedFine: { min: 18_000_000, max: 20_000_000 },
    },
    {
        caseId: "DBG-13",
        group: "EXTENSION_HARD",
        draftKey: "DOC_168",
        workspaceKeys: ["LIB_36"],
        scenario: "Chị M đi xe máy vượt đèn đỏ tại giao lộ.",
        expectedOutcome: "GUILTY_SANCTIONED",
        requiredDefect: null,
        expectedFine: { min: 4_000_000, max: 6_000_000 },
    },
    {
        caseId: "DBG-14",
        group: "EXTENSION_HARD",
        draftKey: "DOC_BLHS_305",
        workspaceKeys: [],
        scenario: "Đối tượng X chế tạo trái phép 30,5 kilôgam thuốc nổ.",
        expectedOutcome: "ACQUITTED_LOOPHOLE",
        requiredDefect: "LP003",
        expectedFine: null,
    },
    {
        caseId: "DBG-15",
        group: "EXTENSION_HARD",
        draftKey: "DOC_BLHS_359",
        workspaceKeys: [],
        scenario: "Bị cáo Y làm giả 05 giấy tờ giả trong hoạt động công vụ.",
        expectedOutcome: "CONFLICT_AMBIGUOUS",
        requiredDefect: "LG002",
        expectedFine: null,
    },
    {
        caseId: "DBG-16",
        group: "EXTENSION_HARD",
        draftKey: "DOC_DEONTIC",
        workspaceKeys: ["LIB_36"],
        scenario: "Anh K điều khiển xe tự hành đi vào đường cao tốc.",
        expectedOutcome: "CONFLICT_AMBIGUOUS",
        requiredDefect: "DEONTIC_CONFLICT",
        expectedFine: null,
    },
];

// Captured blind outputs from this session's subagents (zero tool calls, verbatim JSON)
const BLIND_FLASH_LITE_TOTAL_MS = 10_000;
const BLIND_FLASH_LITE_RESULTS: readonly LlmPrediction[] = [
    { caseId: "DBG-01", outcome: "NOT_COVERED", fineMin: null, fineMax: null, detectedDefectCodes: [], reasoning: "Quá tốc độ 12 km/h không nằm trong khung 05-10 km/h (Điều 3.1 DOC_A) cũng không nằm trong khung 15-20 km/h (Điều 3.2 DOC_A)." },
    { caseId: "DBG-02", outcome: "PARTIALLY_ENFORCEABLE", fineMin: 6000000, fineMax: 4000000, detectedDefectCodes: ["LG001"], reasoning: "Mức phạt chạy quá tốc độ 20 km/h theo Điều 3.3 DOC_A có khung phạt đảo ngược (6 triệu đến 4 triệu) và chứa từ định tính mơ hồ 'gây hậu quả nghiêm trọng'." },
    { caseId: "DBG-03", outcome: "PARTIALLY_ENFORCEABLE", fineMin: 6000000, fineMax: 4000000, detectedDefectCodes: ["LG001"], reasoning: "Chạy quá tốc độ 28 km/h thuộc khoản 3 Điều 3 DOC_A, vướng khung phạt đảo ngược (6 triệu đến 4 triệu) và điều kiện định tính." },
    { caseId: "DBG-04", outcome: "ACQUITTED_LOOPHOLE", fineMin: null, fineMax: null, detectedDefectCodes: ["LP006"], reasoning: "DOC_A chỉ quy định mức phạt đối với cá nhân, bỏ sót chủ thể tổ chức (Công ty vận tải X)." },
    { caseId: "DBG-05", outcome: "GUILTY_SANCTIONED", fineMin: 1600000, fineMax: 2000000, detectedDefectCodes: [], reasoning: "Quá tốc độ 8 km/h (thuộc 05 đến dưới 10 km/h) phạt cá nhân 800k-1M, tổ chức bằng 2 lần (1.600.000 đến 2.000.000 VNĐ)." },
    { caseId: "DBG-06", outcome: "GUILTY_SANCTIONED", fineMin: 2000000, fineMax: 4000000, detectedDefectCodes: [], reasoning: "Chạy quá tốc độ 10 km/h thuộc khoản 2 Điều 3 DOC_B, phạt tiền từ 2.000.000 đến 4.000.000 đồng và trừ 02 điểm GPLX." },
    { caseId: "DBG-07", outcome: "NOT_COVERED", fineMin: null, fineMax: null, detectedDefectCodes: [], reasoning: "Mức quá tốc độ 3 km/h nằm dưới ngưỡng tối thiểu bị phạt (từ 05 km/h trở lên) theo DOC_B." },
    { caseId: "DBG-08", outcome: "ACQUITTED_LOOPHOLE", fineMin: null, fineMax: null, detectedDefectCodes: ["LP002"], reasoning: "Điều 2.1 DOC_A nghiêm cấm tự ý can thiệp phần mềm nhưng không có điều khoản quy định chế tài xử phạt (LP002)." },
    { caseId: "DBG-09", outcome: "NOT_COVERED", fineMin: null, fineMax: null, detectedDefectCodes: [], reasoning: "Hành vi dừng xe có lý do chính đáng thuộc ngoại lệ hợp pháp được loại trừ tại khoản 1 Điều 4 DOC_A." },
    { caseId: "DBG-10", outcome: "PARTIALLY_ENFORCEABLE", fineMin: 1000000, fineMax: 2000000, detectedDefectCodes: ["AM005"], reasoning: "Phạt tiền từ 1.000.000 đến 2.000.000 đồng áp dụng được, nhưng chế tài bổ sung 'trừ điểm giấy phép lái xe' không định rõ số điểm bị trừ (AM005)." },
    { caseId: "DBG-11", outcome: "CONFLICT_AMBIGUOUS", fineMin: null, fineMax: null, detectedDefectCodes: ["AM001"], reasoning: "Điều khoản dùng từ định tính mơ hồ 'gây hậu quả nghiêm trọng' (AM001) mà không có giả định cụ thể hoặc định nghĩa đi kèm." },
    { caseId: "DBG-12", outcome: "GUILTY_SANCTIONED", fineMin: 18000000, fineMax: 20000000, detectedDefectCodes: [], reasoning: "Anh H lái xe ô tô vượt đèn đỏ, căn cứ Điều 2.3 DOC_168 phạt tiền từ 18.000.000 đến 20.000.000 đồng, trừ 04 điểm GPLX." },
    { caseId: "DBG-13", outcome: "GUILTY_SANCTIONED", fineMin: 4000000, fineMax: 6000000, detectedDefectCodes: [], reasoning: "Chị M đi xe máy vượt đèn đỏ, căn cứ Điều 3.2 DOC_168 phạt tiền từ 4.000.000 đến 6.000.000 đồng, trừ 04 điểm GPLX." },
    { caseId: "DBG-14", outcome: "CONFLICT_AMBIGUOUS", fineMin: null, fineMax: null, detectedDefectCodes: ["LG002"], reasoning: "Khối lượng 30,5 kg thuốc nổ rơi vào vùng chồng chéo ngưỡng định lượng giữa khoản 2 (từ 10 đến 30 kg) và khoản 3 (trên 31 kg) tại Điều 305 BLHS." },
    { caseId: "DBG-15", outcome: "CONFLICT_AMBIGUOUS", fineMin: null, fineMax: null, detectedDefectCodes: ["LG002"], reasoning: "Số lượng 05 giấy tờ giả rơi vào điểm giao nhau/chồng chéo ngưỡng định lượng giữa điểm c khoản 2 (2 đến 5 giấy tờ) và điểm a khoản 3 (5 đến 10 giấy tờ) Điều 359 BLHS." },
    { caseId: "DBG-16", outcome: "CONFLICT_AMBIGUOUS", fineMin: null, fineMax: null, detectedDefectCodes: ["DEONTIC_CONFLICT"], reasoning: "Điều 1 DOC_DEONTIC vừa nghiêm cấm vừa cho phép cá nhân điều khiển xe tự hành đi vào đường cao tốc, dẫn đến mâu thuẫn đạo nghĩa." },
];

const BLIND_GEMINI_4_NEON_TOTAL_MS = 163_000;
const BLIND_GEMINI_4_NEON_RESULTS: readonly LlmPrediction[] = [
    { caseId: "DBG-01", outcome: "ACQUITTED_LOOPHOLE", fineMin: null, fineMax: null, detectedDefectCodes: ["LP003"], reasoning: "Điều 3 DOC_A chỉ xử phạt mức quá tốc độ từ 05–10 km/h (khoản 1) và từ 15–20 km/h (khoản 2), tạo ra khoảng trống ngưỡng từ trên 10 km/h đến dưới 15 km/h." },
    { caseId: "DBG-02", outcome: "CONFLICT_AMBIGUOUS", fineMin: null, fineMax: null, detectedDefectCodes: ["LG002", "LG001"], reasoning: "Mốc quá tốc độ đúng 20 km/h bị chồng chéo giữa khoản 2 và khoản 3 Điều 3 DOC_A; khoản 3 còn có khung phạt đảo ngược 6 triệu đến 4 triệu." },
    { caseId: "DBG-03", outcome: "CONFLICT_AMBIGUOUS", fineMin: null, fineMax: null, detectedDefectCodes: ["LG001", "AM001", "LP004"], reasoning: "Mức quá tốc độ 28 km/h thuộc khoản 3 Điều 3 DOC_A có khung phạt đảo ngược (6M–4M), từ định tính mơ hồ và liệt kê mở." },
    { caseId: "DBG-04", outcome: "ACQUITTED_LOOPHOLE", fineMin: null, fineMax: null, detectedDefectCodes: ["LP006"], reasoning: "Khoản 1 Điều 3 DOC_A chỉ quy định mức phạt tiền đối với cá nhân, bỏ sót chủ thể tổ chức." },
    { caseId: "DBG-05", outcome: "GUILTY_SANCTIONED", fineMin: 1600000, fineMax: 2000000, detectedDefectCodes: [], reasoning: "Quá tốc độ 8 km/h thuộc khoản 1 Điều 3 DOC_B; áp dụng khoản 2 Điều 1 DOC_B mức phạt tổ chức gấp 02 lần cá nhân." },
    { caseId: "DBG-06", outcome: "GUILTY_SANCTIONED", fineMin: 2000000, fineMax: 4000000, detectedDefectCodes: [], reasoning: "Mức quá tốc độ đúng 10 km/h thuộc khoản 2 Điều 3 DOC_B, phạt 2–4 triệu đồng và trừ 02 điểm GPLX (đã định nghĩa tại LIB_36)." },
    { caseId: "DBG-07", outcome: "NOT_COVERED", fineMin: null, fineMax: null, detectedDefectCodes: [], reasoning: "Chạy quá tốc độ 3 km/h dưới ngưỡng tối thiểu 05 km/h theo Điều 3 DOC_B." },
    { caseId: "DBG-08", outcome: "ACQUITTED_LOOPHOLE", fineMin: null, fineMax: null, detectedDefectCodes: ["LP002"], reasoning: "Khoản 1 Điều 2 DOC_A nghiêm cấm tự ý can thiệp phần mềm nhưng không có chế tài xử phạt." },
    { caseId: "DBG-09", outcome: "ACQUITTED_LOOPHOLE", fineMin: null, fineMax: null, detectedDefectCodes: ["LP001"], reasoning: "Khoản 1 Điều 4 DOC_A chứa ngoại lệ mở 'trừ lý do chính đáng' không có tiêu chí định lượng hoặc dẫn chiếu." },
    { caseId: "DBG-10", outcome: "PARTIALLY_ENFORCEABLE", fineMin: 1000000, fineMax: 2000000, detectedDefectCodes: ["AM005"], reasoning: "Phạt tiền chính 1–2 triệu áp dụng được, nhưng chế tài bổ sung trừ điểm GPLX thiếu số điểm và thiếu văn bản định nghĩa trong workspace." },
    { caseId: "DBG-11", outcome: "CONFLICT_AMBIGUOUS", fineMin: null, fineMax: null, detectedDefectCodes: ["AM001"], reasoning: "Khoản 1 Điều 1 DOC_AMB dùng thuật ngữ định tính mơ hồ 'gây hậu quả nghiêm trọng' chưa có tiêu chí định lượng." },
    { caseId: "DBG-12", outcome: "GUILTY_SANCTIONED", fineMin: 18000000, fineMax: 20000000, detectedDefectCodes: [], reasoning: "Lái xe ô tô vượt đèn đỏ áp dụng khoản 3 Điều 2 DOC_168, phạt 18–20 triệu đồng và trừ 04 điểm GPLX." },
    { caseId: "DBG-13", outcome: "GUILTY_SANCTIONED", fineMin: 4000000, fineMax: 6000000, detectedDefectCodes: [], reasoning: "Đi xe mô tô vượt đèn đỏ áp dụng khoản 2 Điều 3 DOC_168, phạt 4–6 triệu đồng và trừ 04 điểm GPLX." },
    { caseId: "DBG-14", outcome: "ACQUITTED_LOOPHOLE", fineMin: null, fineMax: null, detectedDefectCodes: ["LP003"], reasoning: "Điều 305 BLHS bỏ trống khoảng từ trên 30 kg đến 31 kg thuốc nổ; 30,5 kg lọt khoảng trống ngưỡng." },
    { caseId: "DBG-15", outcome: "CONFLICT_AMBIGUOUS", fineMin: null, fineMax: null, detectedDefectCodes: ["LG002"], reasoning: "Số lượng 05 giấy tờ giả chồng chéo giữa điểm c khoản 2 (2–5) và điểm a khoản 3 (5–10) Điều 359 BLHS." },
    { caseId: "DBG-16", outcome: "CONFLICT_AMBIGUOUS", fineMin: null, fineMax: null, detectedDefectCodes: ["DEONTIC_CONFLICT"], reasoning: "Điều 1 DOC_DEONTIC mâu thuẫn đạo nghĩa trực tiếp giữa khoản 1 (nghiêm cấm) và khoản 2 (cho phép)." },
];

const LIVE_JUDGE_SYSTEM_PROMPT = `Bạn là Thẩm phán Tòa án đang xét xử một tình huống thực tế.
NGUYÊN TẮC BẮT BUỘC:
1. CHỈ được căn cứ trên văn bản dự thảo (DRAFT) và các văn bản trong WORKSPACE đi kèm (nếu WORKSPACE ghi "Trống", KHÔNG được tự viện dẫn Luật/Nghị định ngoài thực tế). Nếu thuật ngữ/chế tài bổ sung chưa có định nghĩa trong DRAFT/WORKSPACE, hãy xét AM005 / PARTIALLY_ENFORCEABLE.
2. Phân loại outcome vào ĐÚNG 1 trong 5 nhãn:
   - GUILTY_SANCTIONED: Đủ căn cứ tuyên phạt rõ ràng, không vướng kẽ hở/xung đột/mơ hồ.
   - PARTIALLY_ENFORCEABLE: Phạt chính áp dụng được, nhưng phần chế tài bổ sung hoặc thuật ngữ thiếu định nghĩa/định mức không thi hành được.
   - ACQUITTED_LOOPHOLE: Không thể xử phạt vì lọt kẽ hở pháp lý (LP003 khoảng trống ngưỡng, LP002 lệnh cấm không chế tài, LP001 ngoại lệ mở, LP006 bỏ sót tổ chức).
   - CONFLICT_AMBIGUOUS: Xung đột/mơ hồ không thể tuyên phạt thống nhất (LG002 chồng chéo ngưỡng, LG001 khung phạt đảo ngược, DEONTIC_CONFLICT Cấm vs Cho phép, AM001 từ định tính mơ hồ).
   - NOT_COVERED: Ngoài phạm vi điều chỉnh / dưới mức tối thiểu bị phạt.
3. Mã lỗi chuẩn (nếu có): LP001, LP002, LP003, LP004, LP006, AM001, AM005, LG001, LG002, DEONTIC_CONFLICT.
Trả về JSON đúng schema.`;

const LIVE_JUDGE_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    required: ["outcome", "fineMin", "fineMax", "detectedDefectCodes", "reasoning"],
    properties: {
        outcome: {
            type: "string",
            enum: [
                "GUILTY_SANCTIONED",
                "PARTIALLY_ENFORCEABLE",
                "ACQUITTED_LOOPHOLE",
                "CONFLICT_AMBIGUOUS",
                "NOT_COVERED",
            ],
        },
        fineMin: { type: ["number", "null"] },
        fineMax: { type: ["number", "null"] },
        detectedDefectCodes: { type: "array", items: { type: "string" } },
        reasoning: { type: "string" },
    },
};

async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    const delays = [2000, 5000];

    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
        try {
            return await fn();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            const isTransient = msg.includes("(429)") || msg.includes("(503)") || msg.includes("timed out");

            if (!isTransient || attempt === delays.length) {
                throw err;
            }

            await new Promise((resolveTimer) => setTimeout(resolveTimer, delays[attempt]));
        }
    }

    return fn();
}

async function runLivePureLlmSuite(
    apiKey: string,
    model: string,
    cases: readonly BenchmarkCase[],
): Promise<{
    results: ContenderCaseResult[];
    totalMs: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    apiErrors: number;
    details: { caseId: string; reasoning: string; error: string | null }[];
}> {
    const results: ContenderCaseResult[] = [];
    const details: { caseId: string; reasoning: string; error: string | null }[] = [];
    let totalMs = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let apiErrors = 0;

    for (const spec of cases) {
        const wsText = spec.workspaceKeys.length > 0
            ? spec.workspaceKeys.map((k) => `[${k}]\n${DOCS[k]}`).join("\n\n")
            : "Trống";
        const start = Date.now();

        try {
            const res = await callWithRetry(() =>
                callGeminiStructuredInteraction({
                    apiKey,
                    model,
                    systemInstruction: LIVE_JUDGE_SYSTEM_PROMPT,
                    input: `DRAFT:\n${DOCS[spec.draftKey]}\n\nWORKSPACE:\n${wsText}\n\nSCENARIO:\n${spec.scenario}`,
                    schema: LIVE_JUDGE_SCHEMA,
                    maxOutputTokens: 600,
                }),
            );
            const dur = Date.now() - start;
            totalMs += dur;
            inputTokens += res.usage.inputTokens;
            outputTokens += res.usage.outputTokens;
            totalTokens += res.usage.totalTokens;

            const rec = res.data as {
                outcome?: string;
                fineMin?: number | null;
                fineMax?: number | null;
                detectedDefectCodes?: string[];
                reasoning?: string;
            };
            const fine = typeof rec.fineMin === "number" && typeof rec.fineMax === "number"
                ? { min: rec.fineMin, max: rec.fineMax }
                : null;
            results.push(scoreCase(spec, rec.outcome ?? "NOT_COVERED", fine, rec.detectedDefectCodes ?? [], dur));
            details.push({ caseId: spec.caseId, reasoning: rec.reasoning ?? "", error: null });
        } catch (err: unknown) {
            const dur = Date.now() - start;
            totalMs += dur;
            apiErrors += 1;
            const msg = err instanceof Error ? err.message : String(err);
            results.push(scoreCase(spec, "API_ERROR", null, [], dur));
            details.push({ caseId: spec.caseId, reasoning: "", error: msg });
        }
    }

    return { results, totalMs, inputTokens, outputTokens, totalTokens, apiErrors, details };
}

function makeWorkspaceFiles(keys: readonly (keyof typeof DOCS)[]): LocalWorkspaceFile[] {
    return keys.map((key) => ({
        path: `library/${key.toLowerCase()}.txt`,
        name: `${key.toLowerCase()}.txt`,
        title: key,
        documentNumber: key === "LIB_36" ? "36/2024/QH15" : null,
        documentType: "Luật",
        content: DOCS[key],
        isLibrary: true,
        updatedAt: "2026-11-26T00:00:00.000Z",
    }));
}

function scoreCase(
    spec: BenchmarkCase,
    outcome: string,
    fine: { min: number; max: number } | null,
    defects: readonly string[],
    durationMs: number,
): ContenderCaseResult {
    const outcomeMatch = outcome === spec.expectedOutcome;
    const defectMatch = spec.requiredDefect === null || defects.includes(spec.requiredDefect);
    const fineMatch = spec.expectedFine === null
        ? fine === null
        : fine !== null && fine.min === spec.expectedFine.min && fine.max === spec.expectedFine.max;
    const invalidInvertedFine = fine !== null && fine.min > fine.max;

    return {
        caseId: spec.caseId,
        outcome,
        fine,
        defects: [...defects],
        outcomeMatch,
        defectMatch,
        fineMatch,
        invalidInvertedFine,
        durationMs,
    };
}

function summarizeContender(
    name: string,
    results: readonly ContenderCaseResult[],
    totalDurationMs: number,
    tokensUsed: number,
) {
    const total = results.length;
    const outcomePassed = results.filter((r) => r.outcomeMatch).length;
    const defectCases = BENCHMARK_CASES.filter((c) => c.requiredDefect !== null);
    const defectPassed = results.filter((r, idx) => BENCHMARK_CASES[idx].requiredDefect !== null && r.defectMatch).length;
    const fineCases = BENCHMARK_CASES.filter((c) => c.expectedFine !== null);
    const finePassed = results.filter((r, idx) => BENCHMARK_CASES[idx].expectedFine !== null && r.fineMatch).length;
    const coreCases = results.filter((_, idx) => BENCHMARK_CASES[idx].group === "CORE_TRAFFIC");
    const extCases = results.filter((_, idx) => BENCHMARK_CASES[idx].group === "EXTENSION_HARD");
    const invertedFines = results.filter((r) => r.invalidInvertedFine).length;

    return {
        name,
        outcomeAccuracy: `${outcomePassed}/${total} (${Math.round((outcomePassed / total) * 100)}%)`,
        outcomePassed,
        defectRecall: `${defectPassed}/${defectCases.length} (${Math.round((defectPassed / defectCases.length) * 100)}%)`,
        fineAccuracy: `${finePassed}/${fineCases.length} (${Math.round((finePassed / fineCases.length) * 100)}%)`,
        coreTrafficAccuracy: `${coreCases.filter((r) => r.outcomeMatch).length}/${coreCases.length}`,
        extensionHardAccuracy: `${extCases.filter((r) => r.outcomeMatch).length}/${extCases.length}`,
        invalidInvertedFinesEmitted: invertedFines,
        totalDurationMs,
        avgMsPerCase: Math.round(totalDurationMs / total),
        tokensUsed,
    };
}

async function main(): Promise<void> {
    const lexideResults: ContenderCaseResult[] = [];
    let lexideTotalMs = 0;

    for (const spec of BENCHMARK_CASES) {
        const res = await runLocalDebugSimulation({
            content: DOCS[spec.draftKey],
            scenario: spec.scenario,
            workspaceFiles: makeWorkspaceFiles(spec.workspaceKeys),
            currentPath: `${spec.draftKey.toLowerCase()}.txt`,
            useAi: false,
        });
        const defects = [...new Set([
            ...res.verdict.exploitedDefects.map((d) => d.code),
            ...res.ambiguities.map((a) => a.code),
        ])];
        lexideTotalMs += res.durationMs;
        lexideResults.push(scoreCase(spec, res.verdict.outcome, res.verdict.applicableFine, defects, res.durationMs));
    }

    // Verify interactive ambiguityOverrides on DBG-11
    const dbg11Base = await runLocalDebugSimulation({
        content: DOCS.DOC_AMB,
        scenario: "Anh C gây hậu quả trong vụ va quẹt giao thông.",
    });
    const ambId = dbg11Base.ambiguities[0]?.id ?? "";
    const dbg11True = ambId
        ? await runLocalDebugSimulation({
            content: DOCS.DOC_AMB,
            scenario: "Anh C gây hậu quả trong vụ va quẹt giao thông.",
            ambiguityOverrides: { [ambId]: true },
        })
        : null;
    const dbg11False = ambId
        ? await runLocalDebugSimulation({
            content: DOCS.DOC_AMB,
            scenario: "Anh C gây hậu quả trong vụ va quẹt giao thông.",
            ambiguityOverrides: { [ambId]: false },
        })
        : null;
    const interactiveOverrideVerified = Boolean(
        dbg11Base.verdict.outcome === "CONFLICT_AMBIGUOUS"
        && dbg11True?.verdict.outcome === "GUILTY_SANCTIONED"
        && dbg11False?.verdict.outcome === "NOT_COVERED",
    );

    const flashLiteResults = BENCHMARK_CASES.map((spec, idx) => {
        const pred = BLIND_FLASH_LITE_RESULTS[idx];
        const fine = pred.fineMin !== null && pred.fineMax !== null
            ? { min: pred.fineMin, max: pred.fineMax }
            : null;

        return scoreCase(spec, pred.outcome, fine, pred.detectedDefectCodes, Math.round(BLIND_FLASH_LITE_TOTAL_MS / BENCHMARK_CASES.length));
    });

    const neonResults = BENCHMARK_CASES.map((spec, idx) => {
        const pred = BLIND_GEMINI_4_NEON_RESULTS[idx];
        const fine = pred.fineMin !== null && pred.fineMax !== null
            ? { min: pred.fineMin, max: pred.fineMax }
            : null;

        return scoreCase(spec, pred.outcome, fine, pred.detectedDefectCodes, Math.round(BLIND_GEMINI_4_NEON_TOTAL_MS / BENCHMARK_CASES.length));
    });

    // Live API suites when GEMINI_API_KEY is present
    let liveFlashLiteSummary: (ReturnType<typeof summarizeContender> & {
        inputTokens: number;
        outputTokens: number;
        apiErrors: number;
    }) | null = null;
    let liveFlashLiteResults: ContenderCaseResult[] | null = null;
    let liveFlashLiteDetails: { caseId: string; reasoning: string; error: string | null }[] | null = null;

    let lexideAiSummary: (ReturnType<typeof summarizeContender> & {
        leanPlusAiCount: number;
    }) | null = null;
    let lexideAiResults: ContenderCaseResult[] | null = null;

    let liveNeonStatus: { available: boolean; error: string | null } | null = null;
    let liveNeonSummary: (ReturnType<typeof summarizeContender> & {
        inputTokens: number;
        outputTokens: number;
        apiErrors: number;
    }) | null = null;
    let liveNeonResults: ContenderCaseResult[] | null = null;

    const apiKey = process.env.GEMINI_API_KEY?.trim() ?? "";

    if (apiKey.length > 0) {
        console.log("Running Suite A: Live Pure gemini-3.5-flash-lite (16 cases)...");
        const suiteA = await runLivePureLlmSuite(apiKey, "gemini-3.5-flash-lite", BENCHMARK_CASES);
        liveFlashLiteResults = suiteA.results;
        liveFlashLiteDetails = suiteA.details;
        liveFlashLiteSummary = {
            ...summarizeContender("Live Pure gemini-3.5-flash-lite (API)", suiteA.results, suiteA.totalMs, suiteA.totalTokens),
            inputTokens: suiteA.inputTokens,
            outputTokens: suiteA.outputTokens,
            apiErrors: suiteA.apiErrors,
        };

        console.log("Running Suite B: Live LexIDE Debug LEAN_PLUS_AI (gemini-3.5-flash-lite, 16 cases)...");
        const aiResList: ContenderCaseResult[] = [];
        let aiTotalMs = 0;
        let leanPlusAiCount = 0;

        for (const spec of BENCHMARK_CASES) {
            const res = await runLocalDebugSimulation({
                content: DOCS[spec.draftKey],
                scenario: spec.scenario,
                workspaceFiles: makeWorkspaceFiles(spec.workspaceKeys),
                currentPath: `${spec.draftKey.toLowerCase()}.txt`,
                useAi: true,
                apiKey,
                model: "gemini-3.5-flash-lite",
            });

            if (res.method === "LEAN_PLUS_AI") {
                leanPlusAiCount += 1;
            }

            const defects = [...new Set([
                ...res.verdict.exploitedDefects.map((d) => d.code),
                ...res.ambiguities.map((a) => a.code),
            ])];
            aiTotalMs += res.durationMs;
            aiResList.push(scoreCase(spec, res.verdict.outcome, res.verdict.applicableFine, defects, res.durationMs));
        }

        lexideAiResults = aiResList;
        lexideAiSummary = {
            ...summarizeContender("LexIDE Debug (LEAN_PLUS_AI)", aiResList, aiTotalMs, 0),
            leanPlusAiCount,
        };

        console.log("Probing Suite C: Live gemini-4-neon on DBG-01...");
        const probe = await runLivePureLlmSuite(apiKey, "gemini-4-neon", [BENCHMARK_CASES[0]]);

        if (probe.apiErrors === 0) {
            console.log("gemini-4-neon probe succeeded! Running remaining 15 cases...");
            const rest = await runLivePureLlmSuite(apiKey, "gemini-4-neon", BENCHMARK_CASES.slice(1));
            liveNeonResults = [...probe.results, ...rest.results];
            liveNeonStatus = { available: true, error: null };
            liveNeonSummary = {
                ...summarizeContender(
                    "Live Pure gemini-4-neon (API)",
                    liveNeonResults,
                    probe.totalMs + rest.totalMs,
                    probe.totalTokens + rest.totalTokens,
                ),
                inputTokens: probe.inputTokens + rest.inputTokens,
                outputTokens: probe.outputTokens + rest.outputTokens,
                apiErrors: rest.apiErrors,
            };
        } else {
            liveNeonStatus = {
                available: false,
                error: probe.details[0]?.error ?? "gemini-4-neon unavailable",
            };
            console.log(`gemini-4-neon probe failed: ${liveNeonStatus.error}`);
        }
    }

    const report = {
        ranAt: new Date().toISOString(),
        totalCases: BENCHMARK_CASES.length,
        interactiveOverrideVerified,
        liveNeonStatus,
        summary: {
            lexideDebug: summarizeContender("LexIDE Debug (Lean Symbolic)", lexideResults, lexideTotalMs, 0),
            lexideDebugPlusAi: lexideAiSummary,
            pureFlashLite: summarizeContender("Pure Flash-Lite (Blind)", flashLiteResults, BLIND_FLASH_LITE_TOTAL_MS, 0),
            liveFlashLiteApi: liveFlashLiteSummary,
            pureGemini4Neon: summarizeContender("Pure Gemini 4 Neon (Blind Paid Frontier)", neonResults, BLIND_GEMINI_4_NEON_TOTAL_MS, 0),
            liveGemini4NeonApi: liveNeonSummary,
        },
        cases: BENCHMARK_CASES.map((spec, idx) => ({
            caseId: spec.caseId,
            group: spec.group,
            expectedOutcome: spec.expectedOutcome,
            requiredDefect: spec.requiredDefect,
            expectedFine: spec.expectedFine,
            lexide: lexideResults[idx],
            lexidePlusAi: lexideAiResults?.[idx] ?? null,
            flashLite: flashLiteResults[idx],
            liveFlashLite: liveFlashLiteResults?.[idx] ?? null,
            liveFlashLiteReasoning: liveFlashLiteDetails?.[idx] ?? null,
            gemini4Neon: neonResults[idx],
            liveGemini4Neon: liveNeonResults?.[idx] ?? null,
        })),
    };

    const outPath = resolve(import.meta.dir, "../../data/eval/reports/debug-court-benchmark.json");
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(report, null, 2));

    console.log("=== BENCHMARK DEBUG LUẬT (TÒA ÁN AI) ===");
    console.log(`Interactive ambiguityOverrides verified (DBG-11): ${interactiveOverrideVerified}`);
    console.table([
        report.summary.lexideDebug,
        ...(lexideAiSummary ? [lexideAiSummary] : []),
        report.summary.pureFlashLite,
        ...(liveFlashLiteSummary ? [liveFlashLiteSummary] : []),
        report.summary.pureGemini4Neon,
        ...(liveNeonSummary ? [liveNeonSummary] : []),
    ]);
    console.log(`Saved report to ${outPath}`);
}

await main();
