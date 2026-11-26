// Captured verbatim outputs from blind zero-tool subagent runs on Sealed Blind Test Set (16 Loophole + 28 Live Judge)
// Teacher: Gemini 4 Neon (xhigh) raw (run AFTER ITD Harness v3 freeze; never used for rule tuning)
import type { CapturedBatchMeta } from "./dev-llm-baselines-data";

export const BLIND_TEACHER_LOOPHOLE_META: CapturedBatchMeta = {
    model: "gemini-4-neon",
    totalWallMs: 203_000, // Batch 1 (a67790ec): 119s + Batch 2 (f7206560): 84s
    thinkingTokensPerCaseEstimate: 1_550, // Measured step-3 output+thinking: 27,189 / 16 cases
};

export const BLIND_TEACHER_JUDGE_META: CapturedBatchMeta = {
    model: "gemini-4-neon",
    totalWallMs: 295_000, // Batch 1 (e53e9dc2): 151s + Batch 2 (3f042a50): 144s
    thinkingTokensPerCaseEstimate: 1_300, // Measured step-3 output+thinking: 41,419 / 28 cases
};

export const BLIND_TEACHER_LOOPHOLE_RAW: readonly unknown[] = [
    {
        caseId: "LH-BLIND-P01",
        hasLoophole: true,
        workspaceOnly: true,
        findings: [
            {
                code: "LG001",
                category: "LOGIC",
                provisionRef: "Khoản 2 Điều 2",
                verbatimQuote:
                    "Phạt tiền từ 40.000.000 đồng đến 20.000.000 đồng đối với tổ chức nhà thầu và từ 10.000.000 đồng đến 20.000.000 đồng đối với cá nhân giám sát chậm tiến độ từ 20 ngày đến 45 ngày.",
                exploitScenario:
                    "Khung phạt tiền đối với tổ chức nhà thầu bị đảo ngược (mức tối thiểu 40.000.000 đồng lớn hơn mức tối đa 20.000.000 đồng), tạo ra khoảng rỗng không thể thi hành; tổ chức nhà thầu chậm tiến độ từ 20 đến 45 ngày có thể khiếu nại điều khoản vô hiệu hoặc yêu cầu chỉ áp mức trần 20.000.000 đồng.",
            },
        ],
    },
    {
        caseId: "LH-BLIND-P02",
        hasLoophole: true,
        workspaceOnly: true,
        findings: [
            {
                code: "LP003",
                category: "LOOPHOLE",
                provisionRef: "Khoản 1, Khoản 2 Điều 2",
                verbatimQuote:
                    "1. Phạt tiền từ 10.000.000 đồng đến 20.000.000 đồng đối với tổ chức nhà thầu và từ 5.000.000 đồng đến 10.000.000 đồng đối với cá nhân giám sát chậm tiến độ từ 05 ngày đến dưới 20 ngày.\n2. Phạt tiền từ 20.000.000 đồng đến 40.000.000 đồng đối với tổ chức nhà thầu và từ 10.000.000 đồng đến 20.000.000 đồng đối với cá nhân giám sát chậm tiến độ từ 25 ngày đến 45 ngày.",
                exploitScenario:
                    "Tồn tại khoảng trống định lượng từ đủ 20 ngày đến dưới 25 ngày không thuộc phạm vi điều chỉnh của cả Khoản 1 và Khoản 2; nhà thầu và cá nhân giám sát chậm tiến độ đúng từ 20 đến 24 ngày sẽ thoát hoàn toàn chế tài phạt tiền.",
            },
        ],
    },
    {
        caseId: "LH-BLIND-P03",
        hasLoophole: true,
        workspaceOnly: true,
        findings: [
            {
                code: "DEONTIC_CONFLICT",
                category: "LOGIC",
                provisionRef: "Khoản 3, Khoản 4 Điều 2",
                verbatimQuote:
                    "3. Nghiêm cấm giao hàng giả nhãn hiệu; vi phạm bị phạt tiền từ 30.000.000 đồng đến 50.000.000 đồng đối với tổ chức và từ 15.000.000 đồng đến 25.000.000 đồng đối với cá nhân.\n4. Cho phép giao hàng giả nhãn hiệu.",
                exploitScenario:
                    "Khoản 3 Điều 2 nghiêm cấm và phạt tiền hành vi giao hàng giả nhãn hiệu nhưng Khoản 4 Điều 2 lại trực tiếp cho phép cùng hành vi này; bên bán có thể viện dẫn Khoản 4 Điều 2 để giao hàng giả nhãn hiệu và né tránh chế tài phạt tiền.",
            },
        ],
    },
    {
        caseId: "LH-BLIND-P04",
        hasLoophole: true,
        workspaceOnly: true,
        findings: [
            {
                code: "LG002",
                category: "LOGIC",
                provisionRef: "Khoản 1, Khoản 2 Điều 2",
                verbatimQuote:
                    "1. Phạt tiền từ 3.000.000 đồng đến 6.000.000 đồng đối với tổ chức và từ 1.500.000 đồng đến 3.000.000 đồng đối với cá nhân giao thiếu số lượng từ 02% đến 10%.\n2. Phạt tiền từ 6.000.000 đồng đến 12.000.000 đồng đối với tổ chức và từ 3.000.000 đồng đến 6.000.000 đồng đối với cá nhân giao thiếu số lượng từ 10% đến 25%.",
                exploitScenario:
                    "Điểm biên đúng 10% bị chồng chéo giữa Khoản 1 (từ 02% đến 10%) và Khoản 2 (từ 10% đến 25%) với hai khung phạt khác nhau; bên giao thiếu đúng 10% có thể tranh chấp đòi áp dụng khung phạt thấp hơn ở Khoản 1 hoặc phát sinh tùy nghi khi áp dụng chế tài.",
            },
        ],
    },
    {
        caseId: "LH-BLIND-P05",
        hasLoophole: true,
        workspaceOnly: true,
        findings: [
            {
                code: "LP001",
                category: "LOOPHOLE",
                provisionRef: "Khoản 2 Điều 2",
                verbatimQuote:
                    "Phạt tiền từ 20.000.000 đồng đến 40.000.000 đồng đối với cá nhân xả nước thải có lưu lượng từ 50 m3 đến 100 m3, trừ lý do chính đáng.",
                exploitScenario:
                    "Ngoại lệ mở 'trừ lý do chính đáng' không có tiêu chí xác định hay dẫn chiếu tới điều khoản cụ thể, cho phép cá nhân/tổ chức xả nước thải từ 50 m3 đến 100 m3 viện dẫn lý do chủ quan để né tránh xử phạt và tạo kẽ hở tùy nghi trong thực thi.",
            },
        ],
    },
    {
        caseId: "LH-BLIND-P06",
        hasLoophole: true,
        workspaceOnly: true,
        findings: [
            {
                code: "LG003",
                category: "LOGIC",
                provisionRef: "Khoản 1 Điều 3",
                verbatimQuote: "Việc khắc phục hậu quả áp dụng theo khoản 5 Điều 8.",
                exploitScenario:
                    "Điều khoản dẫn chiếu tới khoản 5 Điều 8 không tồn tại (dự thảo chỉ có Điều 1 đến Điều 4), làm vô hiệu hóa căn cứ buộc khắc phục hậu quả để đối tượng vi phạm né tránh nghĩa vụ khắc phục hậu quả môi trường.",
            },
        ],
    },
    {
        caseId: "LH-BLIND-P07",
        hasLoophole: true,
        workspaceOnly: true,
        findings: [
            {
                code: "LP006",
                category: "LOOPHOLE",
                provisionRef: "Khoản 1, Khoản 2, Khoản 3 Điều 2",
                verbatimQuote:
                    "1. Phạt tiền từ 4.000.000 đồng đến 8.000.000 đồng đối với cá nhân kinh doanh thực phẩm vi phạm có khối lượng từ 10 kg đến dưới 50 kg.\n2. Phạt tiền từ 8.000.000 đồng đến 16.000.000 đồng đối với cá nhân kinh doanh thực phẩm vi phạm có khối lượng từ 50 kg đến 100 kg.\n3. Phạt tiền từ 16.000.000 đồng đến 30.000.000 đồng đối với cá nhân kinh doanh thực phẩm vi phạm có khối lượng trên 100 kg.",
                exploitScenario:
                    "Các khoản xử phạt tại Điều 2 chỉ quy định phạt tiền đối với 'cá nhân' mà bỏ sót 'tổ chức', trong khi toàn bộ dự thảo không có điều khoản quy đổi mức phạt đối với tổ chức bằng 02 lần cá nhân; doanh nghiệp/tổ chức kinh doanh thực phẩm không rõ nguồn gốc có thể lợi dụng kẽ hở này để né tránh xử phạt.",
            },
        ],
    },
    {
        caseId: "LH-BLIND-P08",
        hasLoophole: true,
        workspaceOnly: true,
        findings: [
            {
                code: "LP002",
                category: "LOOPHOLE",
                provisionRef: "Khoản 1 Điều 3",
                verbatimQuote: "Nghiêm cấm sử dụng phụ gia ngoài danh mục cho phép trong chế biến thực phẩm.",
                exploitScenario:
                    "Hành vi sử dụng phụ gia ngoài danh mục cho phép trong chế biến thực phẩm bị nghiêm cấm tại Khoản 1 Điều 3 nhưng không có bất kỳ điều khoản chế tài xử phạt nào đi kèm trong văn bản (Điều 2 chỉ xử phạt hành vi kinh doanh thực phẩm không rõ nguồn gốc), khiến đối tượng vi phạm không thể bị xử phạt.",
            },
        ],
    },
    {
        caseId: "LH-BLIND-P09",
        hasLoophole: true,
        workspaceOnly: true,
        findings: [
            {
                code: "LG001",
                category: "LOGIC",
                provisionRef: "Khoản 2 Điều 1",
                verbatimQuote: "Phạm tội sản xuất hàng cấm có khối lượng từ 50 kg đến 100 kg thì bị phạt tù từ 10 năm đến 05 năm.",
                exploitScenario:
                    "Khung hình phạt tù bị đảo ngược (mức tối thiểu 10 năm lớn hơn mức tối đa 05 năm), tạo khoảng giá trị rỗng khiến cơ quan tiến hành tố tụng không thể xác định mức án hợp lệ và bị cáo có thể lợi dụng để khiếu nại, né tránh áp dụng khung hình phạt tại khoản 2.",
            },
        ],
    },
    {
        caseId: "LH-BLIND-P10",
        hasLoophole: true,
        workspaceOnly: true,
        findings: [
            {
                code: "LG004",
                category: "LOGIC",
                provisionRef: "Khoản 1 Điều 6",
                verbatimQuote: "Việc giải quyết thủ tục thực hiện theo quy định tại khoản 1 Điều 6.",
                exploitScenario:
                    "Khoản 1 Điều 6 dẫn chiếu vòng lặp vào chính khoản 1 Điều 6 mà không quy định căn cứ hay quy trình thực chất, gây bế tắc pháp lý và tạo kẽ hở để trì hoãn hoặc áp dụng tùy tiện khi giải quyết thủ tục.",
            },
        ],
    },
    { caseId: "LH-BLIND-N01", hasLoophole: false, workspaceOnly: true, findings: [] },
    { caseId: "LH-BLIND-N02", hasLoophole: false, workspaceOnly: true, findings: [] },
    { caseId: "LH-BLIND-N03", hasLoophole: false, workspaceOnly: true, findings: [] },
    { caseId: "LH-BLIND-N04", hasLoophole: false, workspaceOnly: true, findings: [] },
    { caseId: "LH-BLIND-N05", hasLoophole: false, workspaceOnly: true, findings: [] },
    { caseId: "LH-BLIND-N06", hasLoophole: false, workspaceOnly: true, findings: [] },
];

export const BLIND_TEACHER_JUDGE_RAW: readonly unknown[] = [
    {
        caseId: "JG-BLIND-MV01",
        outcome: "GUILTY_SANCTIONED",
        abstained: false,
        applicableFine: { min: 25000000, max: 45000000 },
        nonMonetarySanctions: [],
        detectedDefectCodes: [],
        citations: [
            {
                provisionRef: "Điều 2 khoản 1 Nghị định số 45/2022/NĐ-CP",
                verbatimQuote:
                    "1. Phạt tiền từ 10.000.000 đồng đến 20.000.000 đồng đối với cá nhân xả nước thải vượt quy chuẩn có lưu lượng từ 10 m3 đến dưới 50 m3.",
            },
            {
                provisionRef: "Điều 3 khoản 1 Nghị định số 45/2022/NĐ-CP",
                verbatimQuote:
                    "1. Phạt tiền từ 15.000.000 đồng đến 25.000.000 đồng đối với cá nhân không phân loại chất thải nguy hại tại nguồn.",
            },
        ],
        reasoning:
            "Ông Thành (cá nhân) thực hiện đồng thời hai hành vi vi phạm gồm xả nước thải vượt quy chuẩn 30 m3 (phạt 10-20 triệu đồng theo Điều 2 khoản 1) và không phân loại chất thải nguy hại tại nguồn (phạt 15-25 triệu đồng theo Điều 3 khoản 1). Tổng khung phạt tiền áp dụng là từ 25.000.000 đồng đến 45.000.000 đồng.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-MV02",
        outcome: "GUILTY_SANCTIONED",
        abstained: false,
        applicableFine: { min: 45000000, max: 90000000 },
        nonMonetarySanctions: [],
        detectedDefectCodes: [],
        citations: [
            {
                provisionRef: "Điều 1 khoản 2 Hợp đồng số 08/2026/HĐEPC",
                verbatimQuote:
                    "2. Phạt tiền từ 20.000.000 đồng đến 40.000.000 đồng đối với nhà thầu chậm tiến độ thi công từ 20 ngày đến 45 ngày.",
            },
            {
                provisionRef: "Điều 1 khoản 3 Hợp đồng số 08/2026/HĐEPC",
                verbatimQuote:
                    "3. Phạt tiền từ 25.000.000 đồng đến 50.000.000 đồng đối với nhà thầu thi công sai bản vẽ thiết kế đã duyệt.",
            },
            {
                provisionRef: "Điều 2 khoản 1 Hợp đồng số 08/2026/HĐEPC",
                verbatimQuote: "1. Hợp đồng này có hiệu lực thi hành kể từ ngày 01 tháng 06 năm 2026.",
            },
        ],
        reasoning:
            "Vi phạm xảy ra ngày 15/09/2026 sau ngày hợp đồng có hiệu lực (01/06/2026), gồm chậm tiến độ 25 ngày (phạt 20-40 triệu đồng theo Điều 1 khoản 2) và thi công sai bản vẽ thiết kế đã duyệt (phạt 25-50 triệu đồng theo Điều 1 khoản 3). Tổng mức phạt tiền là từ 45.000.000 đồng đến 90.000.000 đồng.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-MV03",
        outcome: "GUILTY_SANCTIONED",
        abstained: false,
        applicableFine: { min: 9000000, max: 18000000 },
        nonMonetarySanctions: [],
        detectedDefectCodes: [],
        citations: [
            {
                provisionRef: "Điều 2 khoản 1 Nghị định số 115/2018/NĐ-CP",
                verbatimQuote:
                    "1. Phạt tiền từ 4.000.000 đồng đến 8.000.000 đồng đối với cá nhân kinh doanh thực phẩm không rõ nguồn gốc có khối lượng từ 10 kg đến dưới 50 kg.",
            },
            {
                provisionRef: "Điều 2 khoản 3 Nghị định số 115/2018/NĐ-CP",
                verbatimQuote:
                    "3. Phạt tiền từ 5.000.000 đồng đến 10.000.000 đồng đối với cá nhân sử dụng người chế biến không có giấy xác nhận tập huấn an toàn thực phẩm.",
            },
        ],
        reasoning:
            "Bà Hạnh (cá nhân) đồng thời vi phạm hai hành vi: kinh doanh thực phẩm không rõ nguồn gốc 20 kg (phạt 4-8 triệu đồng theo Điều 2 khoản 1) và sử dụng người chế biến không có giấy xác nhận tập huấn (phạt 5-10 triệu đồng theo Điều 2 khoản 3). Tổng khung tiền phạt là từ 9.000.000 đồng đến 18.000.000 đồng.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-CR01",
        outcome: "GUILTY_SANCTIONED",
        abstained: false,
        applicableFine: null,
        nonMonetarySanctions: ["phạt tù từ 03 năm đến 07 năm", "tịch thu tang vật"],
        detectedDefectCodes: [],
        citations: [
            {
                provisionRef: "Điều 188 khoản 2 Bộ luật Hình sự",
                verbatimQuote:
                    "2. Phạm tội buôn lậu hàng hóa có trị giá từ 300 triệu đồng đến dưới 500 triệu đồng thì bị phạt tù từ 03 năm đến 07 năm và tịch thu tang vật.",
            },
        ],
        reasoning:
            "Hành vi buôn lậu hàng hóa trị giá 400 triệu đồng của bị cáo Long thuộc khung từ 300 triệu đồng đến dưới 500 triệu đồng tại Điều 188 khoản 2. Do đó đủ căn cứ áp dụng chế tài phạt tù từ 03 năm đến 07 năm và tịch thu tang vật.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-CR02",
        outcome: "ACQUITTED_LOOPHOLE",
        abstained: false,
        applicableFine: null,
        nonMonetarySanctions: [],
        detectedDefectCodes: ["LP003"],
        citations: [
            {
                provisionRef: "Điều 354 khoản 1 Bộ luật Hình sự",
                verbatimQuote: "1. Nhận hối lộ từ 02 triệu đồng đến 100 triệu đồng thì bị phạt tù từ 02 năm đến 07 năm.",
            },
            {
                provisionRef: "Điều 354 khoản 2 Bộ luật Hình sự",
                verbatimQuote: "2. Nhận hối lộ từ 120 triệu đồng đến 500 triệu đồng thì bị phạt tù từ 07 năm đến 15 năm.",
            },
        ],
        reasoning:
            "Khoản 1 Điều 354 chỉ quy định đến 100 triệu đồng còn khoản 2 bắt đầu từ 120 triệu đồng, tạo ra khoảng trống ngưỡng từ trên 100 triệu đồng đến dưới 120 triệu đồng (LP003). Hành vi nhận hối lộ 110 triệu đồng của bị cáo Khải lọt vào kẽ hở này nên không có căn cứ xử phạt.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-CR03",
        outcome: "CONFLICT_AMBIGUOUS",
        abstained: true,
        applicableFine: null,
        nonMonetarySanctions: [],
        detectedDefectCodes: ["LG001"],
        citations: [
            {
                provisionRef: "Điều 355 khoản 1 Bộ luật Hình sự",
                verbatimQuote:
                    "1. Lạm dụng chức vụ chiếm đoạt tài sản từ 10 triệu đồng đến 50 triệu đồng thì bị phạt tù từ 08 năm đến 02 năm.",
            },
        ],
        reasoning:
            "Hành vi chiếm đoạt 25 triệu đồng rơi vào khoản 1 Điều 355 nhưng điều khoản quy định khung hình phạt tù đảo ngược từ 08 năm đến 02 năm (LG001). Do xung đột logic về khung hình phạt không thể áp dụng, Tòa án phải từ chối kết luận.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-XD01",
        outcome: "GUILTY_SANCTIONED",
        abstained: false,
        applicableFine: { min: 20000000, max: 30000000 },
        nonMonetarySanctions: [],
        detectedDefectCodes: [],
        citations: [
            {
                provisionRef: "Điều 1 khoản 1 Nghị định số 143/2021/NĐ-CP",
                verbatimQuote:
                    "1. Sửa đổi khoản 1 Điều 4 Nghị định 88/2019/NĐ-CP như sau: Phạt tiền từ 20.000.000 đồng đến 30.000.000 đồng đối với cá nhân mua bán ngoại tệ tại tổ chức không được phép thu đổi.",
            },
            {
                provisionRef: "Điều 2 khoản 1 Nghị định số 143/2021/NĐ-CP",
                verbatimQuote: "1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2022.",
            },
        ],
        reasoning:
            "Hành vi vi phạm xảy ra ngày 10/04/2023, sau khi Nghị định 143/2021/NĐ-CP sửa đổi khoản 1 Điều 4 Nghị định 88/2019/NĐ-CP có hiệu lực từ 01/01/2022. Do đó áp dụng mức phạt tiền đã được sửa đổi đối với cá nhân là từ 20.000.000 đồng đến 30.000.000 đồng.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-XD02",
        outcome: "ACQUITTED_LOOPHOLE",
        abstained: false,
        applicableFine: null,
        nonMonetarySanctions: [],
        detectedDefectCodes: ["LG007"],
        citations: [
            {
                provisionRef: "Điều 1 khoản 1 Nghị định số 144/2024/NĐ-CP",
                verbatimQuote: "1. Bãi bỏ khoản 2 Điều 4 Nghị định 88/2019/NĐ-CP.",
            },
            {
                provisionRef: "Điều 2 khoản 1 Nghị định số 144/2024/NĐ-CP",
                verbatimQuote: "1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2025.",
            },
            {
                provisionRef: "Điều 4 khoản 2 Nghị định số 88/2019/NĐ-CP",
                verbatimQuote: "2. Phạt tiền từ 30.000.000 đồng đến 50.000.000 đồng đối với cá nhân cho vay vượt hạn mức tín dụng quy định.",
            },
        ],
        reasoning:
            "Khoản 2 Điều 4 Nghị định 88/2019/NĐ-CP đã bị bãi bỏ bởi Nghị định 144/2024/NĐ-CP có hiệu lực từ ngày 01/01/2025 (LG007). Hành vi của ông Toàn xảy ra ngày 20/05/2025 nên không còn căn cứ xử phạt.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-MD01",
        outcome: "GUILTY_SANCTIONED",
        abstained: false,
        applicableFine: { min: 40000000, max: 80000000 },
        nonMonetarySanctions: [],
        detectedDefectCodes: [],
        citations: [
            {
                provisionRef: "Điều 1 khoản 1 Nghị định số 45/2022/NĐ-CP",
                verbatimQuote:
                    "1. Đối với cùng một hành vi vi phạm hành chính thì mức phạt tiền đối với tổ chức bằng 02 lần mức phạt tiền đối với cá nhân.",
            },
            {
                provisionRef: "Điều 2 khoản 2 Nghị định số 45/2022/NĐ-CP",
                verbatimQuote:
                    "2. Phạt tiền từ 20.000.000 đồng đến 40.000.000 đồng đối với cá nhân xả nước thải vượt quy chuẩn có lưu lượng từ 50 m3 đến 100 m3.",
            },
        ],
        reasoning:
            "Hành vi xả nước thải vượt quy chuẩn lưu lượng 75 m3 thuộc Điều 2 khoản 2 với khung phạt cá nhân từ 20-40 triệu đồng. Do chủ thể vi phạm là tổ chức (Công ty TNHH Dệt Nhuộm Z), áp dụng nguyên tắc nhân 2 tại Điều 1 khoản 1 nên khung phạt tiền là từ 40.000.000 đồng đến 80.000.000 đồng.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-MD02",
        outcome: "GUILTY_SANCTIONED",
        abstained: false,
        applicableFine: { min: 16000000, max: 32000000 },
        nonMonetarySanctions: [],
        detectedDefectCodes: [],
        citations: [
            {
                provisionRef: "Điều 1 khoản 1 Nghị định số 115/2018/NĐ-CP",
                verbatimQuote:
                    "1. Đối với cùng một hành vi vi phạm hành chính thì mức phạt tiền đối với tổ chức bằng 02 lần mức phạt tiền đối với cá nhân.",
            },
            {
                provisionRef: "Điều 2 khoản 2 Nghị định số 115/2018/NĐ-CP",
                verbatimQuote:
                    "2. Phạt tiền từ 8.000.000 đồng đến 16.000.000 đồng đối với cá nhân kinh doanh thực phẩm không rõ nguồn gốc có khối lượng từ 50 kg đến 100 kg.",
            },
        ],
        reasoning:
            "Hành vi kinh doanh thực phẩm không rõ nguồn gốc khối lượng 60 kg thuộc Điều 2 khoản 2 với mức phạt cá nhân từ 8-16 triệu đồng. Vì chủ thể là tổ chức (Doanh nghiệp Thực Phẩm Sạch ABC), nhân 2 theo Điều 1 khoản 1 ra mức phạt tiền từ 16.000.000 đồng đến 32.000.000 đồng.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-MD03",
        outcome: "GUILTY_SANCTIONED",
        abstained: false,
        applicableFine: { min: 6000000, max: 12000000 },
        nonMonetarySanctions: [],
        detectedDefectCodes: [],
        citations: [
            {
                provisionRef: "Điều 1 khoản 2 Hợp đồng số 22/2026/HĐMB",
                verbatimQuote:
                    "2. Phạt tiền từ 6.000.000 đồng đến 12.000.000 đồng đối với bên bán giao thiếu số lượng từ 10% đến 25%.",
            },
            {
                provisionRef: "Điều 2 khoản 1 Hợp đồng số 22/2026/HĐMB",
                verbatimQuote: "1. Hợp đồng này có hiệu lực thi hành kể từ ngày 01 tháng 03 năm 2027.",
            },
        ],
        reasoning:
            "Hành vi giao thiếu 12% lô hàng xảy ra ngày 15/04/2027, sau ngày hợp đồng có hiệu lực (01/03/2027), thuộc khung từ 10% đến 25% tại Điều 1 khoản 2. Do đó bên bán bị phạt tiền từ 6.000.000 đồng đến 12.000.000 đồng.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-MD04",
        outcome: "NOT_COVERED",
        abstained: false,
        applicableFine: null,
        nonMonetarySanctions: [],
        detectedDefectCodes: [],
        citations: [
            {
                provisionRef: "Điều 2 khoản 1 Nghị định số 115/2018/NĐ-CP",
                verbatimQuote:
                    "1. Phạt tiền từ 4.000.000 đồng đến 8.000.000 đồng đối với cá nhân kinh doanh thực phẩm không rõ nguồn gốc có khối lượng từ 10 kg đến dưới 50 kg.",
            },
        ],
        reasoning:
            "Ngưỡng xử phạt tối thiểu đối với hành vi kinh doanh thực phẩm không rõ nguồn gốc tại Điều 2 khoản 1 là từ 10 kg. Khối lượng 4 kg của chị Mai nằm dưới ngưỡng tối thiểu nên không thuộc phạm vi xử phạt.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-EX01",
        outcome: "NOT_COVERED",
        abstained: false,
        applicableFine: null,
        nonMonetarySanctions: [],
        detectedDefectCodes: [],
        citations: [
            {
                provisionRef: "Điều 1 khoản 3 Hợp đồng số 22/2026/HĐMB",
                verbatimQuote:
                    "3. Phạt tiền từ 8.000.000 đồng đến 15.000.000 đồng đối với bên bán giao hàng chậm quá 10 ngày, trừ trường hợp có văn bản gia hạn của bên mua; không áp dụng miễn trừ nếu hàng hóa bị hư hỏng toàn bộ.",
            },
            {
                provisionRef: "Điều 2 khoản 1 Hợp đồng số 22/2026/HĐMB",
                verbatimQuote: "1. Hợp đồng này có hiệu lực thi hành kể từ ngày 01 tháng 03 năm 2027.",
            },
        ],
        reasoning:
            "Mặc dù bên bán giao hàng chậm quá 10 ngày trong thời hạn hiệu lực hợp đồng, bên bán có văn bản gia hạn của bên mua và hàng hóa vẫn nguyên vẹn nên không kích hoạt điều khoản phủ định kép. Ngoại lệ miễn trừ tại Điều 1 khoản 3 được thỏa mãn nên không thuộc phạm vi xử phạt.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-EX02",
        outcome: "GUILTY_SANCTIONED",
        abstained: false,
        applicableFine: { min: 8000000, max: 15000000 },
        nonMonetarySanctions: [],
        detectedDefectCodes: [],
        citations: [
            {
                provisionRef: "Điều 1 khoản 3 Hợp đồng số 22/2026/HĐMB",
                verbatimQuote:
                    "3. Phạt tiền từ 8.000.000 đồng đến 15.000.000 đồng đối với bên bán giao hàng chậm quá 10 ngày, trừ trường hợp có văn bản gia hạn của bên mua; không áp dụng miễn trừ nếu hàng hóa bị hư hỏng toàn bộ.",
            },
            {
                provisionRef: "Điều 2 khoản 1 Hợp đồng số 22/2026/HĐMB",
                verbatimQuote: "1. Hợp đồng này có hiệu lực thi hành kể từ ngày 01 tháng 03 năm 2027.",
            },
        ],
        reasoning:
            "Dù bên bán có văn bản gia hạn của bên mua, hàng hóa bị hư hỏng toàn bộ nên rơi vào điều khoản phủ định kép không áp dụng miễn trừ tại Điều 1 khoản 3. Do đó bên bán vẫn bị phạt tiền từ 8.000.000 đồng đến 15.000.000 đồng.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-EX03",
        outcome: "NOT_COVERED",
        abstained: false,
        applicableFine: null,
        nonMonetarySanctions: [],
        detectedDefectCodes: [],
        citations: [
            {
                provisionRef: "Điều 2 khoản 1",
                verbatimQuote: "Hợp đồng này có hiệu lực thi hành kể từ ngày 01 tháng 03 năm 2027.",
            },
            {
                provisionRef: "Điều 1 khoản 2",
                verbatimQuote:
                    "Phạt tiền từ 6.000.000 đồng đến 12.000.000 đồng đối với bên bán giao thiếu số lượng từ 10% đến 25%.",
            },
        ],
        reasoning:
            "Hành vi giao thiếu 15% lô hàng xảy ra vào ngày 10/01/2027, trước thời điểm Hợp đồng số 22/2026/HĐMB có hiệu lực thi hành (ngày 01/03/2027) theo Điều 2 khoản 1. Do đó hành vi này không thuộc phạm vi xử phạt của hợp đồng.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-P1A",
        outcome: "GUILTY_SANCTIONED",
        abstained: false,
        applicableFine: { min: 40000000, max: 80000000 },
        nonMonetarySanctions: [],
        detectedDefectCodes: [],
        citations: [
            {
                provisionRef: "Điều 2 khoản 3",
                verbatimQuote:
                    "Phạt tiền từ 40.000.000 đồng đến 80.000.000 đồng đối với cá nhân xả nước thải vượt quy chuẩn có lưu lượng trên 100 m3.",
            },
        ],
        reasoning:
            "Ông Dũng là cá nhân có hành vi xả nước thải vượt quy chuẩn với lưu lượng 120 m3, thuộc khung trên 100 m3 theo Điều 2 khoản 3. Đủ căn cứ áp dụng mức phạt tiền từ 40.000.000 đồng đến 80.000.000 đồng.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-P1B",
        outcome: "GUILTY_SANCTIONED",
        abstained: false,
        applicableFine: { min: 40000000, max: 80000000 },
        nonMonetarySanctions: [],
        detectedDefectCodes: [],
        citations: [
            {
                provisionRef: "Điều 2 khoản 3",
                verbatimQuote:
                    "Phạt tiền từ 40.000.000 đồng đến 80.000.000 đồng đối với cá nhân xả nước thải vượt quy chuẩn có lưu lượng trên 100 m3.",
            },
        ],
        reasoning:
            "Cơ sở cá nhân của anh Dũng (chủ thể cá nhân) xả 120 m3 nước thải chưa đạt chuẩn, vượt ngưỡng trên 100 m3 quy định tại Điều 2 khoản 3. Đủ căn cứ áp dụng mức phạt tiền từ 40.000.000 đồng đến 80.000.000 đồng.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-P1C",
        outcome: "GUILTY_SANCTIONED",
        abstained: false,
        applicableFine: { min: 40000000, max: 80000000 },
        nonMonetarySanctions: [],
        detectedDefectCodes: [],
        citations: [
            {
                provisionRef: "Điều 2 khoản 3",
                verbatimQuote:
                    "Phạt tiền từ 40.000.000 đồng đến 80.000.000 đồng đối với cá nhân xả nước thải vượt quy chuẩn có lưu lượng trên 100 m3.",
            },
        ],
        reasoning:
            "Ông Dũng là cá nhân xả trực tiếp 120 m3 nước thải vượt ngưỡng quy chuẩn ra kênh, thuộc khung lưu lượng trên 100 m3 tại Điều 2 khoản 3. Đủ căn cứ áp dụng mức phạt tiền từ 40.000.000 đồng đến 80.000.000 đồng.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-P2A",
        outcome: "GUILTY_SANCTIONED",
        abstained: false,
        applicableFine: { min: 10000000, max: 20000000 },
        nonMonetarySanctions: [],
        detectedDefectCodes: [],
        citations: [
            {
                provisionRef: "Điều 1 khoản 1",
                verbatimQuote:
                    "Phạt tiền từ 10.000.000 đồng đến 20.000.000 đồng đối với nhà thầu chậm tiến độ thi công từ 05 ngày đến dưới 20 ngày.",
            },
            {
                provisionRef: "Điều 2 khoản 1",
                verbatimQuote: "Hợp đồng này có hiệu lực thi hành kể từ ngày 01 tháng 06 năm 2026.",
            },
        ],
        reasoning:
            "Hành vi nhà thầu chậm tiến độ thi công 12 ngày vào ngày 10/10/2026 xảy ra sau ngày hợp đồng có hiệu lực (01/06/2026) và nằm trong khung từ 05 ngày đến dưới 20 ngày theo Điều 1 khoản 1. Đủ căn cứ áp dụng mức phạt tiền từ 10.000.000 đồng đến 20.000.000 đồng.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-P2B",
        outcome: "GUILTY_SANCTIONED",
        abstained: false,
        applicableFine: { min: 10000000, max: 20000000 },
        nonMonetarySanctions: [],
        detectedDefectCodes: [],
        citations: [
            {
                provisionRef: "Điều 1 khoản 1",
                verbatimQuote:
                    "Phạt tiền từ 10.000.000 đồng đến 20.000.000 đồng đối với nhà thầu chậm tiến độ thi công từ 05 ngày đến dưới 20 ngày.",
            },
            {
                provisionRef: "Điều 2 khoản 1",
                verbatimQuote: "Hợp đồng này có hiệu lực thi hành kể từ ngày 01 tháng 06 năm 2026.",
            },
        ],
        reasoning:
            "Ngày 10/10/2026 nằm trong thời hạn hiệu lực hợp đồng từ 01/06/2026, việc bên thi công bàn giao trễ 12 ngày thuộc khung chậm tiến độ từ 05 ngày đến dưới 20 ngày tại Điều 1 khoản 1. Đủ căn cứ áp dụng mức phạt tiền từ 10.000.000 đồng đến 20.000.000 đồng.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-P2C",
        outcome: "GUILTY_SANCTIONED",
        abstained: false,
        applicableFine: { min: 10000000, max: 20000000 },
        nonMonetarySanctions: [],
        detectedDefectCodes: [],
        citations: [
            {
                provisionRef: "Điều 1 khoản 1",
                verbatimQuote:
                    "Phạt tiền từ 10.000.000 đồng đến 20.000.000 đồng đối với nhà thầu chậm tiến độ thi công từ 05 ngày đến dưới 20 ngày.",
            },
            {
                provisionRef: "Điều 2 khoản 1",
                verbatimQuote: "Hợp đồng này có hiệu lực thi hành kể từ ngày 01 tháng 06 năm 2026.",
            },
        ],
        reasoning:
            "Tính đến ngày 10/10/2026 (sau ngày hợp đồng có hiệu lực 01/06/2026), đơn vị tổng thầu trễ hạn thi công 12 ngày, thuộc khung từ 05 ngày đến dưới 20 ngày theo Điều 1 khoản 1. Đủ căn cứ áp dụng mức phạt tiền từ 10.000.000 đồng đến 20.000.000 đồng.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-P3A",
        outcome: "GUILTY_SANCTIONED",
        abstained: false,
        applicableFine: { min: 5000000, max: 10000000 },
        nonMonetarySanctions: [],
        detectedDefectCodes: [],
        citations: [
            {
                provisionRef: "Điều 2 khoản 3",
                verbatimQuote:
                    "Phạt tiền từ 5.000.000 đồng đến 10.000.000 đồng đối với cá nhân sử dụng người chế biến không có giấy xác nhận tập huấn an toàn thực phẩm.",
            },
        ],
        reasoning:
            "Chị Hoa là cá nhân sử dụng người chế biến không có giấy xác nhận tập huấn an toàn thực phẩm, vi phạm trực tiếp Điều 2 khoản 3. Đủ căn cứ áp dụng mức phạt tiền từ 5.000.000 đồng đến 10.000.000 đồng.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-P3B",
        outcome: "GUILTY_SANCTIONED",
        abstained: false,
        applicableFine: { min: 5000000, max: 10000000 },
        nonMonetarySanctions: [],
        detectedDefectCodes: [],
        citations: [
            {
                provisionRef: "Điều 2 khoản 3",
                verbatimQuote:
                    "Phạt tiền từ 5.000.000 đồng đến 10.000.000 đồng đối với cá nhân sử dụng người chế biến không có giấy xác nhận tập huấn an toàn thực phẩm.",
            },
        ],
        reasoning:
            "Quán ăn cá nhân của bà Hoa (chủ thể cá nhân) sử dụng đầu bếp chưa có chứng chỉ tập huấn vệ sinh an toàn thực phẩm, thuộc hành vi vi phạm tại Điều 2 khoản 3. Đủ căn cứ áp dụng mức phạt tiền từ 5.000.000 đồng đến 10.000.000 đồng.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-P3C",
        outcome: "GUILTY_SANCTIONED",
        abstained: false,
        applicableFine: { min: 5000000, max: 10000000 },
        nonMonetarySanctions: [],
        detectedDefectCodes: [],
        citations: [
            {
                provisionRef: "Điều 2 khoản 3",
                verbatimQuote:
                    "Phạt tiền từ 5.000.000 đồng đến 10.000.000 đồng đối với cá nhân sử dụng người chế biến không có giấy xác nhận tập huấn an toàn thực phẩm.",
            },
        ],
        reasoning:
            "Cơ sở của chị Hoa (cá nhân) sử dụng nhân viên trực tiếp chế biến thức ăn không có giấy tập huấn an toàn thực phẩm, thuộc hành vi vi phạm theo Điều 2 khoản 3. Đủ căn cứ áp dụng mức phạt tiền từ 5.000.000 đồng đến 10.000.000 đồng.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-AB01",
        outcome: "CONFLICT_AMBIGUOUS",
        abstained: true,
        applicableFine: null,
        nonMonetarySanctions: [],
        detectedDefectCodes: ["AM001"],
        citations: [
            {
                provisionRef: "Điều 1 khoản 1",
                verbatimQuote:
                    "Phạt tiền từ 10.000.000 đồng đến 20.000.000 đồng đối với cá nhân sử dụng thiết bị y tế không hiệu chuẩn gây hậu quả nghiêm trọng.",
            },
        ],
        reasoning:
            "Điều 1 khoản 1 chứa tiêu chí mơ hồ định tính 'gây hậu quả nghiêm trọng' (AM001) không có định nghĩa hay ngưỡng xác định, đồng thời tình huống cũng chưa làm rõ mức độ thiệt hại. Do đó phải từ chối kết luận xử phạt.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-AB02",
        outcome: "CONFLICT_AMBIGUOUS",
        abstained: true,
        applicableFine: null,
        nonMonetarySanctions: [],
        detectedDefectCodes: ["AM001"],
        citations: [
            {
                provisionRef: "Điều 1 khoản 2",
                verbatimQuote:
                    "Phạt tiền từ 5.000.000 đồng đến 10.000.000 đồng đối với cá nhân không thu hồi kịp thời lô vật tư y tế lỗi.",
            },
        ],
        reasoning:
            "Điều 1 khoản 2 sử dụng thuật ngữ mơ hồ định tính 'kịp thời' (AM001) mà không quy định mốc thời hạn cụ thể để đánh giá hành vi chậm thu hồi có đủ căn cứ xử phạt hay không. Do đó phải từ chối kết luận.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-AB03",
        outcome: "CONFLICT_AMBIGUOUS",
        abstained: true,
        applicableFine: null,
        nonMonetarySanctions: [],
        detectedDefectCodes: ["INSUFFICIENT_FACTS"],
        citations: [
            {
                provisionRef: "Điều 2 khoản 1",
                verbatimQuote:
                    "Phạt tiền từ 10.000.000 đồng đến 20.000.000 đồng đối với cá nhân xả nước thải vượt quy chuẩn có lưu lượng từ 10 m3 đến dưới 50 m3.",
            },
            {
                provisionRef: "Điều 2 khoản 2",
                verbatimQuote:
                    "Phạt tiền từ 20.000.000 đồng đến 40.000.000 đồng đối với cá nhân xả nước thải vượt quy chuẩn có lưu lượng từ 50 m3 đến 100 m3.",
            },
            {
                provisionRef: "Điều 2 khoản 3",
                verbatimQuote:
                    "Phạt tiền từ 40.000.000 đồng đến 80.000.000 đồng đối với cá nhân xả nước thải vượt quy chuẩn có lưu lượng trên 100 m3.",
            },
        ],
        reasoning:
            "Điều 2 phân định các khung phạt tiền theo lưu lượng nước thải vượt quy chuẩn (từ 10 m3 trở lên), nhưng biên bản không ghi rõ lưu lượng xả thải của ông Bình (INSUFFICIENT_FACTS). Do thiếu dữ kiện định lượng quan trọng để xác định phạm vi xử phạt và khung phạt, phải từ chối kết luận.",
        workspaceOnly: true,
    },
    {
        caseId: "JG-BLIND-AB04",
        outcome: "CONFLICT_AMBIGUOUS",
        abstained: true,
        applicableFine: null,
        nonMonetarySanctions: [],
        detectedDefectCodes: ["INSUFFICIENT_FACTS"],
        citations: [
            {
                provisionRef: "Điều 2 khoản 1",
                verbatimQuote:
                    "Phạt tiền từ 4.000.000 đồng đến 8.000.000 đồng đối với cá nhân kinh doanh thực phẩm không rõ nguồn gốc có khối lượng từ 10 kg đến dưới 50 kg.",
            },
            {
                provisionRef: "Điều 2 khoản 2",
                verbatimQuote:
                    "Phạt tiền từ 8.000.000 đồng đến 16.000.000 đồng đối với cá nhân kinh doanh thực phẩm không rõ nguồn gốc có khối lượng từ 50 kg đến 100 kg.",
            },
        ],
        reasoning:
            "Điều 2 khoản 1 và khoản 2 xác định khung phạt tiền căn cứ vào khối lượng thực phẩm không rõ nguồn gốc (từ 10 kg đến 100 kg), nhưng tình huống chưa cân xác định được khối lượng hàng vi phạm (INSUFFICIENT_FACTS). Do thiếu dữ kiện định lượng quan trọng để định khung xử phạt, phải từ chối kết luận.",
        workspaceOnly: true,
    },
];
