import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { analyzeLocalDraft } from "../src/lib/engine/analyzer";
import type { LocalWorkspaceFile } from "../src/lib/engine/local-workspace";
import { createZipArchive } from "../src/lib/engine/zip";
import { inferLocalFileMeta } from "../src/lib/local-fs";

type DemoFileSpec = {
    path: string;
    content: string;
    expectation: "LIBRARY" | "CLEAN" | "AI_CONFLICT" | "DEFECTIVE";
};

const DEMO_FILES: readonly DemoFileSpec[] = [
    {
        path: "library/01-giao-thong/36-2024-QH15-Luat-TTATGTDB.txt",
        expectation: "LIBRARY",
        content: [
            "Luật Trật tự, an toàn giao thông đường bộ",
            "",
            "Điều 1. Giải thích từ ngữ",
            "1. Điểm giấy phép lái xe là thang gồm 12 điểm trong 01 năm để theo dõi việc chấp hành pháp luật về trật tự, an toàn giao thông đường bộ của người lái xe.",
            "2. Xe tự hành là phương tiện giao thông đường bộ có hệ thống điều khiển tự động vận hành không cần tác động trực tiếp liên tục của người lái.",
            "3. Hệ thống hỗ trợ lái là tập hợp cảm biến và phần mềm cảnh báo, hỗ trợ kiểm soát tốc độ và làn đường cho người điều khiển.",
            "4. Đường cao tốc là đường dành riêng cho xe cơ giới chạy tốc độ cao, có dải phân cách chia hai chiều xe chạy riêng biệt.",
            "5. Giấy phép lái xe là chứng chỉ do cơ quan có thẩm quyền cấp cho người đủ điều kiện điều khiển xe cơ giới.",
            "",
            "Điều 2. Quy tắc chung",
            "1. Người tham gia giao thông đường bộ phải đi bên phải theo chiều đi của mình, đi đúng làn đường, phần đường quy định và chấp hành báo hiệu đường bộ.",
        ].join("\n"),
    },
    {
        path: "library/01-giao-thong/168-2024-ND-CP-Xu-phat-ATGT.txt",
        expectation: "LIBRARY",
        content: [
            "Nghị định quy định xử phạt vi phạm hành chính về trật tự, an toàn giao thông",
            "",
            "Điều 1. Giải thích từ ngữ",
            "1. Phạt nguội là hình thức xử phạt vi phạm hành chính thông qua kết quả thu thập được bằng phương tiện, thiết bị kỹ thuật nghiệp vụ.",
            "2. Nồng độ cồn là hàm lượng cồn đo được trong máu hoặc hơi thở của người điều khiển phương tiện tham gia giao thông.",
            "",
            "Điều 2. Mức phạt cơ bản",
            "1. Cá nhân và tổ chức vi phạm quy định về trật tự, an toàn giao thông đường bộ bị xử phạt vi phạm hành chính theo mức tương ứng với tính chất, mức độ vi phạm.",
        ].join("\n"),
    },
    {
        path: "library/02-thue/38-2019-QH14-Luat-Quan-ly-thue.txt",
        expectation: "LIBRARY",
        content: [
            "Luật Quản lý thuế",
            "Số: 38/2019/QH14",
            "",
            "Điều 1. Giải thích từ ngữ",
            "1. Tài sản số là tài sản vô hình được tạo lập, phát hành, lưu trữ, chuyển giao và xác thực quyền sở hữu bằng công nghệ chuỗi khối hoặc công nghệ số.",
            "2. Hóa đơn điện tử là hóa đơn có mã hoặc không có mã của cơ quan thuế được thể hiện ở dạng dữ liệu điện tử do tổ chức, cá nhân bán hàng hóa, cung cấp dịch vụ lập.",
            "3. Tiền chậm nộp là khoản tiền người nộp thuế phải nộp thêm do chậm thực hiện nghĩa vụ nộp thuế vào ngân sách nhà nước theo tỷ lệ phần trăm mỗi ngày.",
            "",
            "Điều 2. Nghĩa vụ kê khai và nộp thuế",
            "1. Người nộp thuế có trách nhiệm khai thuế chính xác, trung thực, đầy đủ và nộp hồ sơ thuế đúng thời hạn quy định.",
        ].join("\n"),
    },
    {
        path: "library/02-thue/125-2020-ND-CP-Xu-phat-thue.txt",
        expectation: "LIBRARY",
        content: [
            "Nghị định quy định xử phạt vi phạm hành chính về thuế, hóa đơn",
            "Số: 125/2020/NĐ-CP",
            "",
            "Điều 1. Phạm vi điều chỉnh",
            "1. Nghị định này quy định hành vi vi phạm hành chính, hình thức xử phạt, mức xử phạt và biện pháp khắc phục hậu quả đối với vi phạm về thuế và hóa đơn.",
            "",
            "Điều 2. Nguyên tắc xử phạt vi phạm hành chính về thuế",
            "1. Mọi hành vi vi phạm hành chính về thuế phải được phát hiện, ngăn chặn và xử lý theo đúng thẩm quyền, trình tự pháp luật.",
        ].join("\n"),
    },
    {
        path: "library/03-hinh-su/100-2015-QH13-Bo-luat-Hinh-su.txt",
        expectation: "LIBRARY",
        content: [
            "Bộ luật Hình sự",
            "Số: 100/2015/QH13",
            "",
            "Điều 1. Giải thích từ ngữ",
            "1. Dữ liệu nhạy cảm là dữ liệu cá nhân, bí mật đời tư, dữ liệu tài chính, sinh trắc học hoặc dữ liệu an ninh quốc gia gắn với quyền được pháp luật bảo vệ.",
            "2. Trí tuệ nhân tạo là hệ thống phần mềm có khả năng phân tích, học máy, suy luận và tự động ra quyết định trên dữ liệu số.",
            "3. Phòng vệ chính đáng là hành vi của người vì bảo vệ quyền hoặc lợi ích chính đáng của mình, của người khác hoặc lợi ích của Nhà nước mà chống trả lại một cách cần thiết người đang có hành vi xâm phạm.",
            "",
            "Điều 2. Cơ sở của trách nhiệm hình sự",
            "1. Chỉ người nào phạm một tội đã được Bộ luật Hình sự quy định mới phải chịu trách nhiệm hình sự.",
        ].join("\n"),
    },
    {
        path: "01-giao-thong/du-thao-xe-tu-hanh-co-loi.txt",
        expectation: "DEFECTIVE",
        content: [
            "Dự thảo Nghị định xử phạt vi phạm giao thông thông minh và xe tự hành",
            "",
            "Điều 1. Các hành vi bị nghiêm cấm",
            "1. Nghiêm cấm tự ý can thiệp phần mềm hệ thống hỗ trợ lái của xe tự hành khi tham gia giao thông.",
            "2. Chủ phương tiện phải báo cáo kịp thời sự cố kỹ thuật, trừ trường hợp đặc biệt.",
            "",
            "Điều 2. Xử phạt hành vi điều khiển xe chạy quá tốc độ",
            "1. Phạt tiền từ 800.000 đồng đến 1.000.000 đồng đối với cá nhân điều khiển xe chạy quá tốc độ từ 05 km/h đến 10 km/h.",
            "2. Phạt tiền từ 2.000.000 đồng đến 4.000.000 đồng đối với cá nhân điều khiển xe chạy quá tốc độ từ 15 km/h đến 20 km/h.",
            "3. Phạt tiền từ 6.000.000 đồng đến 4.000.000 đồng đối với cá nhân điều khiển xe chạy quá tốc độ từ 20 km/h đến 35 km/h, gây hậu quả nghiêm trọng và các trường hợp khác.",
            "4. Đối với hành vi nêu trên, người vi phạm có thể bị phạt bổ sung hoặc tước quyền sử dụng giấy phép lái xe.",
            "",
            "Điều 3. Dẫn chiếu xử lý",
            "1. Áp dụng mức phạt tăng nặng theo điểm c khoản 2 Điều 9 và trừ điểm giấy phép lái xe, trừ lý do chính đáng.",
            "",
            "Điều 4. Hiệu lực thi hành",
            "1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2027.",
        ].join("\n"),
    },
    {
        path: "01-giao-thong/du-thao-toc-do-chuan-0-loi.txt",
        expectation: "CLEAN",
        content: [
            "Nghị định quy định xử phạt vi phạm tốc độ phương tiện giao thông đường bộ",
            "",
            "Điều 1. Phạm vi điều chỉnh",
            "1. Nghị định này quy định mức xử phạt đối với cá nhân và tổ chức vận hành xe tự hành có gắn hệ thống hỗ trợ lái theo khoản 1 Điều 1 Luật 36/2024/QH15, kèm cơ chế quản lý điểm giấy phép lái xe.",
            "",
            "Điều 2. Xử phạt hành vi điều khiển xe chạy quá tốc độ quy định",
            "1. Phạt tiền từ 800.000 đồng đến 1.000.000 đồng đối với cá nhân điều khiển xe chạy quá tốc độ từ 05 km/h đến dưới 10 km/h.",
            "2. Phạt tiền từ 2.000.000 đồng đến 4.000.000 đồng đối với cá nhân điều khiển xe chạy quá tốc độ từ 10 km/h đến dưới 20 km/h và trừ điểm giấy phép lái xe 02 điểm.",
            "3. Phạt tiền từ 6.000.000 đồng đến 8.000.000 đồng đối với cá nhân điều khiển xe chạy quá tốc độ từ 20 km/h đến 35 km/h, trừ trường hợp bất khả kháng theo quy định tại Điều 3.",
            "4. Phạt tiền từ 12.000.000 đồng đến 14.000.000 đồng đối với cá nhân điều khiển xe chạy quá tốc độ trên 35 km/h và tước quyền sử dụng giấy phép lái xe từ 01 tháng đến 03 tháng.",
            "5. Phạt tiền từ 1.600.000 đồng đến 28.000.000 đồng đối với tổ chức giao xe cho người điều khiển vi phạm quy định tại Điều này.",
            "",
            "Điều 3. Trường hợp bất khả kháng",
            "1. Hành vi vượt quá tốc độ được miễn xử phạt khi tránh tai nạn khẩn cấp có xác nhận dữ liệu hành trình trong thời gian tối đa 15 giây.",
            "",
            "Điều 4. Hiệu lực thi hành",
            "1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2027.",
        ].join("\n"),
    },
    {
        path: "01-giao-thong/du-thao-mau-thuan-dao-nghia-ai.txt",
        expectation: "AI_CONFLICT",
        content: [
            "Dự thảo Nghị định quy định lưu thông xe tự hành trên đường cao tốc",
            "",
            "Điều 1. Phạm vi áp dụng",
            "1. Nghị định này điều chỉnh hoạt động lưu thông của xe tự hành trên đường cao tốc theo khoản 1 Điều 1 Luật 36/2024/QH15.",
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
        path: "02-thue/du-thao-thue-tai-san-so-co-loi.txt",
        expectation: "DEFECTIVE",
        content: [
            "Dự thảo Nghị định xử phạt vi phạm hành chính về thuế đối với tài sản số",
            "",
            "Điều 1. Nghĩa vụ kê khai thuế giao dịch tài sản số",
            "1. Người nộp thuế phải kê khai kịp thời doanh thu từ giao dịch tài sản số, trừ lý do chính đáng.",
            "",
            "Điều 2. Xử phạt hành vi khai sai và chậm nộp thuế",
            "1. Phạt tiền từ 5.000.000 đồng đến 10.000.000 đồng đối với cá nhân khai sai số thuế phải nộp từ 05 % đến 10 %.",
            "2. Phạt tiền từ 15.000.000 đồng đến 25.000.000 đồng đối với cá nhân khai sai số thuế phải nộp từ 15 % đến 20 %.",
            "3. Phạt tiền từ 50.000.000 đồng đến 30.000.000 đồng đối với cá nhân khai sai từ 20 % đến 30 %, gây hậu quả nghiêm trọng và các trường hợp khác.",
            "4. Đối với hành vi trốn thuế, người vi phạm có thể bị phạt bổ sung theo khoản 9 Điều 9 Luật 38/2019/QH14 và Điều 4 Thông tư 99/2025/TT-BTC.",
            "",
            "Điều 3. Hiệu lực thi hành",
            "1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 03 năm 2027.",
        ].join("\n"),
    },
    {
        path: "02-thue/du-thao-thue-dien-tu-chuan-0-loi.txt",
        expectation: "CLEAN",
        content: [
            "Nghị định quy định xử phạt vi phạm kê khai thuế điện tử và tài sản số",
            "",
            "Điều 1. Phạm vi điều chỉnh",
            "1. Nghị định này quy định xử phạt hành vi khai sai thuế đối với giao dịch tài sản số theo khoản 1 Điều 1 Luật 38/2019/QH14 và khoản 1 Điều 1 Nghị định 125/2020/NĐ-CP.",
            "",
            "Điều 2. Mức phạt hành vi khai sai nghĩa vụ thuế",
            "1. Phạt tiền từ 1.000.000 đồng đến 2.000.000 đồng đối với cá nhân khai sai tỷ lệ thuế từ 05 % đến dưới 15 %.",
            "2. Phạt tiền từ 4.000.000 đồng đến 6.000.000 đồng đối với cá nhân khai sai tỷ lệ thuế từ 15 % đến 30 %.",
            "3. Phạt tiền từ 8.000.000 đồng đến 12.000.000 đồng đối với cá nhân khai sai tỷ lệ thuế trên 30 %.",
            "4. Phạt tiền từ 2.000.000 đồng đến 24.000.000 đồng đối với tổ chức có hành vi khai sai quy định tại Điều này.",
            "",
            "Điều 3. Hiệu lực thi hành",
            "1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 06 năm 2027.",
        ].join("\n"),
    },
    {
        path: "03-hinh-su/du-thao-toi-pham-mang-co-loi.txt",
        expectation: "DEFECTIVE",
        content: [
            "Dự thảo Nghị quyết hướng dẫn xử lý tội phạm sử dụng trí tuệ nhân tạo xâm phạm dữ liệu nhạy cảm",
            "",
            "Điều 1. Các hành vi bị nghiêm cấm",
            "1. Nghiêm cấm sử dụng trí tuệ nhân tạo để thu thập trái phép dữ liệu nhạy cảm của công dân, trừ trường hợp đặc biệt.",
            "",
            "Điều 2. Khung hình phạt tiền đối với hành vi xâm phạm dữ liệu",
            "1. Phạt tiền từ 200.000.000 đồng đến 100.000.000 đồng đối với cá nhân thu thập dữ liệu nhạy cảm gây hậu quả nghiêm trọng và các trường hợp khác.",
            "2. Đối với hành vi nêu trên, người phạm tội có thể bị phạt bổ sung trong thời gian hợp lý theo điểm c khoản 2 Điều 8.",
            "",
            "Điều 4. Trách nhiệm phối hợp",
            "1. Cơ quan tiến hành tố tụng phối hợp xác minh chứng cứ điện tử theo quy định.",
        ].join("\n"),
    },
    {
        path: "03-hinh-su/du-thao-an-ninh-du-lieu-chuan-0-loi.txt",
        expectation: "CLEAN",
        content: [
            "Nghị định quy định xử phạt vi phạm bảo vệ dữ liệu nhạy cảm và hệ thống trí tuệ nhân tạo",
            "",
            "Điều 1. Phạm vi điều chỉnh",
            "1. Nghị định này quy định mức xử phạt đối với hành vi xâm phạm dữ liệu nhạy cảm và vận hành trí tuệ nhân tạo trái phép theo khoản 1 Điều 1 Luật 100/2015/QH13.",
            "",
            "Điều 2. Xử phạt hành vi thu thập và xử lý trái phép dữ liệu nhạy cảm",
            "1. Phạt tiền từ 20.000.000 đồng đến 40.000.000 đồng đối với cá nhân thu thập, lưu trữ dữ liệu nhạy cảm khi chưa có sự đồng ý bằng văn bản của chủ thể dữ liệu.",
            "2. Phạt tiền từ 40.000.000 đồng đến 80.000.000 đồng đối với tổ chức sử dụng trí tuệ nhân tạo khai thác dữ liệu nhạy cảm trái phép.",
            "",
            "Điều 3. Hiệu lực thi hành",
            "1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 08 năm 2027.",
        ].join("\n"),
    },
];

async function main(): Promise<void> {
    const workspaceFiles: LocalWorkspaceFile[] = DEMO_FILES.map((file) => {
        const meta = inferLocalFileMeta(file.path, file.content);

        return {
            path: file.path,
            name: file.path.split("/").pop() ?? file.path,
            title: meta.title,
            documentNumber: meta.documentNumber,
            documentType: meta.documentType,
            content: file.content,
            isLibrary: meta.isLibrary,
            updatedAt: "2026-11-25T13:00:00.000Z",
        };
    });

    for (const file of DEMO_FILES) {
        if (file.expectation === "LIBRARY") {
            continue;
        }

        const analysis = await analyzeLocalDraft(file.content, workspaceFiles, {
            currentPath: file.path,
            includeAi: false,
        });
        const codes = [...new Set(analysis.diagnostics.map((d) => d.code))];

        if (file.expectation === "CLEAN" || file.expectation === "AI_CONFLICT") {
            if (analysis.diagnostics.length > 0 || (analysis.lean?.refutedCount ?? 0) > 0) {
                throw new Error(
                    `Expected ${file.path} (${file.expectation}) to have 0 static diagnostics, got [${codes.join(", ")}] (score=${analysis.metrics.overallScore})`,
                );
            }
        } else {
            const hasLoophole = analysis.diagnostics.some((d) => d.category === "LOOPHOLE");
            const hasAmbiguity = analysis.diagnostics.some((d) => d.category === "AMBIGUITY");
            const hasLogic = analysis.diagnostics.some((d) => d.category === "LOGIC");

            if (!hasLoophole || !hasAmbiguity || !hasLogic) {
                throw new Error(
                    `Expected ${file.path} to cover LOOPHOLE, AMBIGUITY, and LOGIC, got [${codes.join(", ")}]`,
                );
            }
        }

        console.log(
            `[VERIFIED] ${file.path} (${file.expectation}) | Score: ${analysis.metrics.overallScore}/100 | Lean: ${analysis.lean?.provedCount ?? 0}✓/${analysis.lean?.refutedCount ?? 0}✗ | Codes: [${codes.join(", ") || "none"}]`,
        );
    }

    const zipBytes = createZipArchive(
        DEMO_FILES.map((file) => ({
            path: `lexide-demo-workspace/${file.path}`,
            content: file.content,
        })),
    );
    const outPath = join(import.meta.dir, "../../data/lexide-demo-workspace.zip");

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, zipBytes);

    console.log(`\nCreated ${outPath} (${zipBytes.byteLength} bytes, ${DEMO_FILES.length} files).`);
}

await main();
