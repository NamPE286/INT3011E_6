import type { VerdictOutcome } from "./types";

export type LexideTestCase = {
    id: string;
    name: string;
    group: "CLEAN" | "DEFECTIVE";
    description: string;
    useSampleLibrary: boolean;
    content: string;
    expectedStaticCodes: readonly string[];
    forbiddenStaticCodes?: readonly string[];
    expectedMinScore?: number;
    expectedMaxScore?: number;
    expectedAiCodes?: readonly string[];
    debugScenario?: {
        scenario: string;
        expectedOutcome: VerdictOutcome;
        expectedExploitedCodes?: readonly string[];
    };
};

export const LEXIDE_TEST_CASES: readonly LexideTestCase[] = [
    {
        id: "TC-CLEAN-01",
        name: "Nghị định xử phạt vi phạm tốc độ chặt chẽ (Empty Workspace)",
        group: "CLEAN",
        description: "Văn bản tự chứa đầy đủ: có tiêu đề dòng 1, giải thích từ ngữ, dải tốc độ khép kín, mức phạt tăng tiến, đủ cá nhân và tổ chức, có hiệu lực thi hành.",
        useSampleLibrary: false,
        expectedStaticCodes: [],
        expectedMinScore: 100,
        content: [
            "Nghị định quy định xử phạt vi phạm hành chính về tốc độ phương tiện đường bộ",
            "",
            "Điều 1. Giải thích từ ngữ",
            "1. “giấy phép lái xe” là chứng chỉ do cơ quan có thẩm quyền cấp cho người đủ điều kiện điều khiển xe cơ giới.",
            "2. “điểm giấy phép lái xe” là thang gồm 12 điểm trong 01 năm để theo dõi việc chấp hành pháp luật của người lái xe.",
            "",
            "Điều 2. Xử phạt hành vi điều khiển xe chạy quá tốc độ quy định",
            "1. Phạt tiền từ 800.000 đồng đến 1.000.000 đồng đối với cá nhân điều khiển xe chạy quá tốc độ quy định từ 05 km/h đến dưới 10 km/h.",
            "2. Phạt tiền từ 4.000.000 đồng đến 6.000.000 đồng đối với cá nhân điều khiển xe chạy quá tốc độ quy định từ 10 km/h đến dưới 20 km/h và trừ điểm giấy phép lái xe 02 điểm.",
            "3. Phạt tiền từ 6.000.000 đồng đến 8.000.000 đồng đối với cá nhân điều khiển xe chạy quá tốc độ quy định từ 20 km/h đến 35 km/h và trừ điểm giấy phép lái xe 04 điểm.",
            "4. Phạt tiền từ 12.000.000 đồng đến 14.000.000 đồng đối với cá nhân điều khiển xe chạy quá tốc độ quy định trên 35 km/h và tước quyền sử dụng giấy phép lái xe từ 01 tháng đến 03 tháng.",
            "5. Phạt tiền từ 1.600.000 đồng đến 28.000.000 đồng đối với tổ chức là chủ phương tiện giao xe cho người điều khiển vi phạm quy định tại Điều này.",
            "",
            "Điều 3. Dẫn chiếu áp dụng",
            "1. Trường hợp tái phạm hành vi quy định tại khoản 1 Điều 2 thì áp dụng tình tiết tăng nặng theo quy định.",
            "",
            "Điều 4. Hiệu lực thi hành",
            "1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2027.",
        ].join("\n"),
        debugScenario: {
            scenario: "Anh A điều khiển xe ô tô chạy quá tốc độ 15 km/h trên đường bộ.",
            expectedOutcome: "GUILTY_SANCTIONED",
        },
    },
    {
        id: "TC-CLEAN-02",
        name: "Dự thảo kế thừa thuật ngữ & dẫn chiếu từ Thư viện Workspace",
        group: "CLEAN",
        description: "Sử dụng thuật ngữ và dẫn chiếu tới Luật 36/2024/QH15 đã nạp trong workspace, có ngoại lệ gắn điều khoản định lượng cụ thể.",
        useSampleLibrary: true,
        expectedStaticCodes: [],
        expectedMinScore: 100,
        content: [
            "Dự thảo Nghị định quy định xử phạt vi phạm vận hành xe tự hành",
            "",
            "Điều 1. Phạm vi điều chỉnh",
            "1. Nghị định này quy định xử phạt hành vi vi phạm đối với xe tự hành và hệ thống hỗ trợ lái theo khoản 1 Điều 1 Luật 36/2024/QH15, kèm cơ chế quản lý điểm giấy phép lái xe.",
            "",
            "Điều 2. Xử phạt vi phạm tốc độ xe tự hành",
            "1. Phạt tiền từ 2.000.000 đồng đến 4.000.000 đồng đối với cá nhân điều khiển xe tự hành chạy quá tốc độ từ 10 km/h đến dưới 20 km/h, trừ trường hợp bất khả kháng theo quy định tại Điều 3.",
            "2. Phạt tiền từ 6.000.000 đồng đến 8.000.000 đồng đối với tổ chức vận hành xe tự hành chạy quá tốc độ từ 20 km/h đến 35 km/h và trừ điểm giấy phép lái xe 04 điểm.",
            "",
            "Điều 3. Trường hợp bất khả kháng",
            "1. Hành vi vượt quá tốc độ chỉ được miễn trừ khi tránh tai nạn khẩn cấp được ghi nhận đầy đủ bằng dữ liệu hành trình trong thời gian tối đa 15 giây.",
            "",
            "Điều 4. Hiệu lực thi hành",
            "1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 03 năm 2027.",
        ].join("\n"),
        debugScenario: {
            scenario: "Công ty ABC vận hành xe tự hành chạy quá tốc độ 25 km/h trên đường bộ.",
            expectedOutcome: "GUILTY_SANCTIONED",
        },
    },
    {
        id: "TC-CLEAN-03",
        name: "Dự thảo sửa đổi, bổ sung có Điều khoản chuyển tiếp đầy đủ",
        group: "CLEAN",
        description: "Sửa đổi khoản 1 Điều 1 Nghị định 168/2024/NĐ-CP trong workspace, có điều khoản chuyển tiếp và hiệu lực thi hành.",
        useSampleLibrary: true,
        expectedStaticCodes: [],
        expectedMinScore: 100,
        content: [
            "Dự thảo Nghị định sửa đổi, bổ sung Nghị định 168/2024/NĐ-CP",
            "",
            "Điều 1. Sửa đổi, bổ sung một số quy định của Nghị định 168/2024/NĐ-CP",
            "1. Sửa đổi, bổ sung khoản 1 Điều 1 Nghị định 168/2024/NĐ-CP theo hướng bổ sung dữ liệu từ thiết bị cân tải trọng tự động.",
            "",
            "Điều 2. Điều khoản chuyển tiếp",
            "1. Đối với hồ sơ đã thực hiện trước ngày Nghị định này có hiệu lực thi hành thì tiếp tục áp dụng quy định xử phạt tại thời điểm lập biên bản.",
            "",
            "Điều 3. Hiệu lực thi hành",
            "1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 07 năm 2027.",
        ].join("\n"),
    },
    {
        id: "TC-ERR-01",
        name: "Lỗi Toán học & Kẽ hở định lượng (LG001, LP003, LG002, LP006)",
        group: "DEFECTIVE",
        description: "Khung tiền đảo ngược (min > max), khoảng trống tốc độ 10-15 km/h, chồng chéo tại 20 và 35 km/h, mức phạt giảm dần, bỏ sót tổ chức.",
        useSampleLibrary: false,
        expectedStaticCodes: ["LG001", "LP003", "LG002", "LP006"],
        expectedMaxScore: 80,
        content: [
            "Dự thảo Nghị định xử phạt vi phạm tốc độ (bản lỗi định lượng)",
            "",
            "Điều 1. Xử phạt vi phạm tốc độ",
            "1. Phạt tiền từ 800.000 đồng đến 1.000.000 đồng đối với cá nhân điều khiển xe chạy quá tốc độ quy định từ 05 km/h đến 10 km/h.",
            "2. Phạt tiền từ 2.000.000 đồng đến 4.000.000 đồng đối với cá nhân điều khiển xe chạy quá tốc độ quy định từ 15 km/h đến 20 km/h.",
            "3. Phạt tiền từ 6.000.000 đồng đến 4.000.000 đồng đối với cá nhân điều khiển xe chạy quá tốc độ quy định từ 20 km/h đến 35 km/h.",
            "4. Phạt tiền từ 2.000.000 đồng đến 3.000.000 đồng đối với cá nhân điều khiển xe chạy quá tốc độ quy định từ 35 km/h đến 50 km/h.",
            "",
            "Điều 2. Hiệu lực thi hành",
            "1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2027.",
        ].join("\n"),
        debugScenario: {
            scenario: "Anh B điều khiển xe chạy quá tốc độ 12 km/h trên đường bộ.",
            expectedOutcome: "ACQUITTED_LOOPHOLE",
            expectedExploitedCodes: ["LP003"],
        },
    },
    {
        id: "TC-ERR-02",
        name: "Mâu thuẫn Đạo nghĩa (Deontic Conflict — AI + Lean 4)",
        group: "DEFECTIVE",
        description: "Hình thức tĩnh sạch 100%, nhưng Khoản 1 nghiêm cấm và Khoản 2 cho phép cùng một hành vi đi vào đường cao tốc (cần GPT-5.4 + Lean 4 phát hiện).",
        useSampleLibrary: false,
        expectedStaticCodes: [],
        expectedMinScore: 100,
        expectedAiCodes: ["LG002"],
        content: [
            "Dự thảo Nghị định quy định lưu thông xe tự hành trên đường cao tốc",
            "",
            "Điều 1. Giải thích từ ngữ",
            "1. “xe tự hành” là phương tiện giao thông đường bộ có hệ thống điều khiển tự động.",
            "2. “đường cao tốc” là đường dành riêng cho xe cơ giới chạy tốc độ cao có dải phân cách.",
            "",
            "Điều 2. Quy định lưu thông xe tự hành trên đường cao tốc",
            "1. Nghiêm cấm cá nhân điều khiển xe tự hành đi vào đường cao tốc; trường hợp vi phạm bị phạt tiền từ 4.000.000 đồng đến 6.000.000 đồng đối với cá nhân và từ 8.000.000 đồng đến 12.000.000 đồng đối với tổ chức.",
            "2. Cho phép cá nhân điều khiển xe tự hành đi vào đường cao tốc.",
            "",
            "Điều 3. Hiệu lực thi hành",
            "1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 05 năm 2027.",
        ].join("\n"),
    },
    {
        id: "TC-ERR-03",
        name: "Kẽ hở Ngoại lệ mở, Lệnh cấm thiếu chế tài & Mơ hồ ngôn từ",
        group: "DEFECTIVE",
        description: "Chứa đầy đủ nhóm lỗi LP001, LP002, LP004, AM001, AM002, AM003, AM004, AM005.",
        useSampleLibrary: false,
        expectedStaticCodes: ["LP001", "LP002", "LP004", "AM001", "AM002", "AM003", "AM004", "AM005"],
        expectedMaxScore: 80,
        content: [
            "Dự thảo Nghị định quản lý phương tiện thông minh (bản nhiều lỗi mơ hồ)",
            "",
            "Điều 1. Các hành vi bị nghiêm cấm",
            "1. Nghiêm cấm tự ý can thiệp hệ thống hỗ trợ lái của xe tự hành khi tham gia giao thông.",
            "2. Chủ phương tiện phải báo cáo kịp thời sự cố kỹ thuật, trừ trường hợp đặc biệt.",
            "",
            "Điều 2. Xử phạt vi phạm dừng, đỗ xe tự hành",
            "1. Phạt tiền từ 1.000.000 đồng đến 2.000.000 đồng đối với cá nhân và từ 2.000.000 đồng đến 4.000.000 đồng đối với tổ chức dừng xe tại nơi có biển cấm dừng, trừ lý do chính đáng, gây hậu quả nghiêm trọng và các trường hợp khác.",
            "2. Đối với hành vi nêu trên, người vi phạm có thể bị phạt trừ điểm giấy phép lái xe hoặc tước quyền sử dụng giấy phép lái xe.",
            "",
            "Điều 3. Hiệu lực thi hành",
            "1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2027.",
        ].join("\n"),
        debugScenario: {
            scenario: "Anh C dừng xe tự hành tại nơi có biển cấm dừng vì lý do chính đáng.",
            expectedOutcome: "ACQUITTED_LOOPHOLE",
            expectedExploitedCodes: ["LP001"],
        },
    },
    {
        id: "TC-ERR-04",
        name: "Lỗi Cấu trúc, Dẫn chiếu gãy/vòng lặp/bãi bỏ & Lệch Workspace",
        group: "DEFECTIVE",
        description: "Thiếu tiêu đề dòng 1 (LG006), Điều rỗng (LP007), nhảy cóc Điều 1→3 (LG005), dẫn chiếu gãy (LG003), tự tham chiếu (LG004), dẫn chiếu điều đã bãi bỏ (LG007), sai điều khoản workspace (LG008), văn bản ngoài workspace (WS001), thiếu hiệu lực & chuyển tiếp (LP005).",
        useSampleLibrary: true,
        expectedStaticCodes: ["LG006", "LP007", "LP002", "LG005", "LG003", "LG004", "LG007", "LG008", "WS001", "LP005"],
        expectedMaxScore: 70,
        content: [
            "Điều 1. Lỗi vượt đèn đỏ",
            "",
            "Điều 3. Quy định dẫn chiếu và sửa đổi",
            "1. Áp dụng mức phạt theo điểm c khoản 2 Điều 9 hoặc theo khoản 1 Điều 3.",
            "2. Bãi bỏ khoản 1 Điều 3. Người vi phạm bị xử lý theo khoản 1 Điều 3.",
            "3. Dẫn chiếu tới khoản 9 Điều 9 Luật 36/2024/QH15 và Điều 5 Luật 99/2025/QH15.",
        ].join("\n"),
    },
];

export const INCREMENTAL_CACHE_TEST_CASE = {
    id: "TC-ERR-05",
    name: "Incremental LLM Cache (3 vòng: Cold -> Append 1 khoản lỗi -> Cache Hit 0 token)",
    baseDraft: [
        "Nghị định thử nghiệm Incremental Cache",
        "",
        "Điều 1. Quy định chung",
        "1. Người điều khiển xe phải chấp hành báo hiệu đường bộ.",
    ].join("\n"),
    appendedClause: "2. Nghiêm cấm điều khiển phương tiện đi ngược chiều trên đường cao tốc, trừ trường hợp đặc biệt.",
};
