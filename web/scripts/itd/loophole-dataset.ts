import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LocalWorkspaceFile } from "../../src/lib/engine/local-workspace";
import type { LoopholeEvalCase } from "./types";

function makeLibFile(
    name: string,
    title: string,
    documentNumber: string | null,
    documentType: string,
    content: string,
): LocalWorkspaceFile {
    return {
        path: `library/${name}`,
        name,
        title,
        documentNumber,
        documentType,
        content,
        isLibrary: true,
        updatedAt: "2026-11-26T00:00:00.000Z",
    };
}

function loadRealZaloSnippet(fileName: string, maxArticles: number): string {
    const raw = readFileSync(resolve(import.meta.dir, "../../../data/zalo-legal-subset", fileName), "utf8");
    const lines = raw.split("\n");
    const out: string[] = [];
    let articleCount = 0;

    for (const line of lines) {
        if (/^\s*Điều\s+\d+/iu.test(line)) {
            articleCount += 1;

            if (articleCount > maxArticles) {
                break;
            }
        }

        out.push(line);
    }

    return `${out.join("\n").trim()}\n\nĐiều ${maxArticles + 1}. Hiệu lực thi hành\n1. Văn bản này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2027.`;
}

// ============================================================================
// CLEAN BASE DOCUMENTS — DEV DOMAINS (60%)
// Commercial Lease, SaaS SLA, Tax, Labor, Land, Procurement
// ============================================================================

const BASE_DEV_LEASE = [
    "Hợp đồng thuê mặt bằng thương mại số 01/2026/HĐTM",
    "",
    "Điều 1. Giải thích từ ngữ",
    "1. “mặt bằng thuê” là diện tích kinh doanh tại tầng 1 tòa nhà thương mại theo biên bản bàn giao.",
    "2. “tiền thuê tháng” là khoản tiền thanh toán định kỳ hằng tháng là 50.000.000 đồng.",
    "",
    "Điều 2. Nghĩa vụ thanh toán và phạt chậm thanh toán",
    "1. Bên thuê phải thanh toán tiền thuê tháng trước ngày 05 hằng tháng.",
    "2. Phạt tiền từ 2.000.000 đồng đến 4.000.000 đồng đối với cá nhân hoặc tổ chức chậm thanh toán từ 05 ngày đến dưới 15 ngày.",
    "3. Phạt tiền từ 5.000.000 đồng đến 8.000.000 đồng đối với cá nhân hoặc tổ chức chậm thanh toán từ 15 ngày đến 30 ngày.",
    "4. Trường hợp chậm thanh toán trên 30 ngày thì Bên cho thuê được quyền đơn phương chấm dứt hợp đồng theo khoản 1 Điều 3.",
    "",
    "Điều 3. Chấm dứt hợp đồng và bàn giao",
    "1. Khi chấm dứt hợp đồng trước hạn, Bên thuê phải bàn giao mặt bằng trong thời hạn 10 ngày.",
    "",
    "Điều 4. Hiệu lực thi hành",
    "1. Hợp đồng này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2027.",
].join("\n");

const BASE_DEV_SAAS = [
    "Hợp đồng cung cấp dịch vụ phần mềm đám mây số 12/2026/HĐPM",
    "",
    "Điều 1. Giải thích từ ngữ",
    "1. “dữ liệu nhạy cảm” là thông tin định danh khách hàng và dữ liệu tài chính lưu trữ trên hệ thống.",
    "2. “thời gian gián đoạn” là tổng thời gian hệ thống không phản hồi trong một tháng.",
    "",
    "Điều 2. Cam kết mức độ dịch vụ và bồi thường",
    "1. Nhà cung cấp phải duy trì hệ thống ổn định; trường hợp vi phạm thời gian gián đoạn từ 02 giờ đến dưới 06 giờ thì phạt tiền từ 5.000.000 đồng đến 10.000.000 đồng đối với tổ chức cung cấp và từ 2.500.000 đồng đến 5.000.000 đồng đối với cá nhân.",
    "2. Trường hợp thời gian gián đoạn từ 06 giờ đến 24 giờ thì phạt tiền từ 15.000.000 đồng đến 30.000.000 đồng đối với tổ chức và từ 7.500.000 đồng đến 15.000.000 đồng đối với cá nhân.",
    "3. Nghiêm cấm tiết lộ dữ liệu nhạy cảm cho bên thứ ba; vi phạm bị phạt tiền từ 20.000.000 đồng đến 40.000.000 đồng đối với tổ chức và từ 10.000.000 đồng đến 20.000.000 đồng đối với cá nhân.",
    "",
    "Điều 3. Bảo mật và kiểm toán",
    "1. Các bên thực hiện đối soát dữ liệu theo khoản 1 Điều 2 hằng quý.",
    "",
    "Điều 4. Hiệu lực thi hành",
    "1. Hợp đồng này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2027.",
].join("\n");

const BASE_DEV_TAX = [
    "Dự thảo Nghị định xử phạt vi phạm hành chính về thuế và hóa đơn",
    "",
    "Điều 1. Nguyên tắc quy đổi mức phạt",
    "1. Đối với cùng một hành vi vi phạm hành chính thì mức phạt tiền đối với tổ chức bằng 02 lần mức phạt tiền đối với cá nhân.",
    "",
    "Điều 2. Xử phạt hành vi chậm nộp hồ sơ khai thuế",
    "1. Phạt tiền từ 2.000.000 đồng đến 5.000.000 đồng đối với cá nhân chậm nộp hồ sơ khai thuế từ 01 ngày đến dưới 30 ngày.",
    "2. Phạt tiền từ 5.000.000 đồng đến 8.000.000 đồng đối với cá nhân chậm nộp hồ sơ khai thuế từ 30 ngày đến 60 ngày.",
    "3. Phạt tiền từ 8.000.000 đồng đến 15.000.000 đồng đối với cá nhân chậm nộp hồ sơ khai thuế trên 60 ngày.",
    "",
    "Điều 3. Xử phạt hành vi không lập hóa đơn",
    "1. Phạt tiền từ 10.000.000 đồng đến 20.000.000 đồng đối với cá nhân bán hàng hóa không lập hóa đơn theo quy định tại khoản 1 Điều 2.",
    "",
    "Điều 4. Hiệu lực thi hành",
    "1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2027.",
].join("\n");

const BASE_DEV_LABOR = [
    "Dự thảo Nghị định xử phạt vi phạm hành chính trong lĩnh vực lao động",
    "",
    "Điều 1. Nguyên tắc áp dụng mức phạt",
    "1. Đối với cùng một hành vi vi phạm hành chính thì mức phạt tiền đối với tổ chức bằng 02 lần mức phạt tiền đối với cá nhân.",
    "",
    "Điều 2. Xử phạt vi phạm về thời giờ làm thêm",
    "1. Phạt tiền từ 2.000.000 đồng đến 5.000.000 đồng đối với cá nhân huy động làm thêm vượt quy định từ 01 giờ đến dưới 20 giờ trong tháng.",
    "2. Phạt tiền từ 5.000.000 đồng đến 10.000.000 đồng đối với cá nhân huy động làm thêm vượt quy định từ 20 giờ đến 40 giờ trong tháng.",
    "3. Phạt tiền từ 10.000.000 đồng đến 20.000.000 đồng đối với cá nhân huy động làm thêm vượt quy định trên 40 giờ trong tháng.",
    "",
    "Điều 3. Hiệu lực thi hành",
    "1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2027.",
].join("\n");

const BASE_DEV_LAND = [
    "Dự thảo Nghị định xử phạt vi phạm hành chính trong lĩnh vực đất đai",
    "",
    "Điều 1. Nguyên tắc xử phạt",
    "1. Đối với cùng một hành vi vi phạm hành chính thì mức phạt tiền đối với tổ chức bằng 02 lần mức phạt tiền đối với cá nhân.",
    "",
    "Điều 2. Xử phạt hành vi lấn, chiếm đất nông nghiệp",
    "1. Phạt tiền từ 3.000.000 đồng đến 5.000.000 đồng đối với cá nhân lấn, chiếm đất có diện tích từ 100 m2 đến dưới 500 m2.",
    "2. Phạt tiền từ 5.000.000 đồng đến 10.000.000 đồng đối với cá nhân lấn, chiếm đất có diện tích từ 500 m2 đến 1.000 m2.",
    "3. Phạt tiền từ 10.000.000 đồng đến 20.000.000 đồng đối với cá nhân lấn, chiếm đất có diện tích trên 1.000 m2.",
    "",
    "Điều 3. Hiệu lực thi hành",
    "1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2027.",
].join("\n");

const BASE_DEV_PROCUREMENT = [
    "Dự thảo Nghị định xử phạt vi phạm hành chính trong hoạt động đấu thầu",
    "",
    "Điều 1. Nguyên tắc xử phạt",
    "1. Đối với cùng một hành vi vi phạm hành chính thì mức phạt tiền đối với tổ chức bằng 02 lần mức phạt tiền đối với cá nhân.",
    "",
    "Điều 2. Xử phạt hành vi thông thầu và gian lận hồ sơ dự thầu",
    "1. Phạt tiền từ 20.000.000 đồng đến 30.000.000 đồng đối với cá nhân làm sai lệch giá dự thầu từ 05% đến dưới 15%.",
    "2. Phạt tiền từ 30.000.000 đồng đến 50.000.000 đồng đối với cá nhân làm sai lệch giá dự thầu từ 15% đến 30%.",
    "3. Phạt tiền từ 50.000.000 đồng đến 80.000.000 đồng đối với cá nhân làm sai lệch giá dự thầu trên 30%.",
    "",
    "Điều 3. Hiệu lực thi hành",
    "1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2027.",
].join("\n");

// ============================================================================
// CLEAN BASE DOCUMENTS — BLIND TEST DOMAINS (40% — COMPLETELY DISJOINT!)
// Construction EPC, Commercial Sales, Environment, Food Safety, Criminal Econ
// ============================================================================

const BASE_BLIND_EPC = [
    "Hợp đồng tổng thầu xây dựng EPC số 08/2026/HĐEPC",
    "",
    "Điều 1. Giải thích từ ngữ",
    "1. “tiến độ mốc” là mốc hoàn thành từng hạng mục thi công theo phụ lục tiến độ.",
    "2. “giá trị hợp đồng” là tổng giá trị thanh toán trước thuế theo hợp đồng này.",
    "",
    "Điều 2. Phạt chậm tiến độ thi công",
    "1. Phạt tiền từ 10.000.000 đồng đến 20.000.000 đồng đối với tổ chức nhà thầu và từ 5.000.000 đồng đến 10.000.000 đồng đối với cá nhân giám sát chậm tiến độ từ 05 ngày đến dưới 20 ngày.",
    "2. Phạt tiền từ 20.000.000 đồng đến 40.000.000 đồng đối với tổ chức nhà thầu và từ 10.000.000 đồng đến 20.000.000 đồng đối với cá nhân giám sát chậm tiến độ từ 20 ngày đến 45 ngày.",
    "3. Phạt tiền từ 40.000.000 đồng đến 80.000.000 đồng đối với tổ chức nhà thầu và từ 20.000.000 đồng đến 40.000.000 đồng đối với cá nhân giám sát chậm tiến độ trên 45 ngày.",
    "",
    "Điều 3. Nghiệm thu và bảo hành",
    "1. Nghiệm thu hạng mục thực hiện theo quy định tại khoản 1 Điều 2.",
    "",
    "Điều 4. Hiệu lực thi hành",
    "1. Hợp đồng này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2027.",
].join("\n");

const BASE_BLIND_SALES = [
    "Hợp đồng mua bán hàng hóa thương mại số 22/2026/HĐMB",
    "",
    "Điều 1. Giải thích từ ngữ",
    "1. “lô hàng” là toàn bộ số lượng sản phẩm giao trong một đợt đặt hàng.",
    "",
    "Điều 2. Chất lượng hàng hóa và xử lý giao thiếu",
    "1. Phạt tiền từ 3.000.000 đồng đến 6.000.000 đồng đối với tổ chức và từ 1.500.000 đồng đến 3.000.000 đồng đối với cá nhân giao thiếu số lượng từ 02% đến dưới 10%.",
    "2. Phạt tiền từ 6.000.000 đồng đến 12.000.000 đồng đối với tổ chức và từ 3.000.000 đồng đến 6.000.000 đồng đối với cá nhân giao thiếu số lượng từ 10% đến 25%.",
    "3. Nghiêm cấm giao hàng giả nhãn hiệu; vi phạm bị phạt tiền từ 30.000.000 đồng đến 50.000.000 đồng đối với tổ chức và từ 15.000.000 đồng đến 25.000.000 đồng đối với cá nhân.",
    "",
    "Điều 3. Hiệu lực thi hành",
    "1. Hợp đồng này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2027.",
].join("\n");

const BASE_BLIND_ENV = [
    "Dự thảo Nghị định xử phạt vi phạm hành chính về bảo vệ môi trường",
    "",
    "Điều 1. Nguyên tắc xử phạt",
    "1. Đối với cùng một hành vi vi phạm hành chính thì mức phạt tiền đối với tổ chức bằng 02 lần mức phạt tiền đối với cá nhân.",
    "",
    "Điều 2. Xử phạt hành vi xả nước thải vượt quy chuẩn kỹ thuật",
    "1. Phạt tiền từ 10.000.000 đồng đến 20.000.000 đồng đối với cá nhân xả nước thải có lưu lượng từ 10 m3 đến dưới 50 m3.",
    "2. Phạt tiền từ 20.000.000 đồng đến 40.000.000 đồng đối với cá nhân xả nước thải có lưu lượng từ 50 m3 đến 100 m3.",
    "3. Phạt tiền từ 40.000.000 đồng đến 80.000.000 đồng đối với cá nhân xả nước thải có lưu lượng trên 100 m3.",
    "",
    "Điều 3. Hiệu lực thi hành",
    "1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2027.",
].join("\n");

const BASE_BLIND_FOOD = [
    "Dự thảo Nghị định xử phạt vi phạm hành chính về an toàn thực phẩm",
    "",
    "Điều 1. Nguyên tắc áp dụng",
    "1. Đối với cùng một hành vi vi phạm hành chính thì mức phạt tiền đối với tổ chức bằng 02 lần mức phạt tiền đối với cá nhân.",
    "",
    "Điều 2. Xử phạt hành vi kinh doanh thực phẩm không rõ nguồn gốc",
    "1. Phạt tiền từ 4.000.000 đồng đến 8.000.000 đồng đối với cá nhân kinh doanh thực phẩm vi phạm có khối lượng từ 10 kg đến dưới 50 kg.",
    "2. Phạt tiền từ 8.000.000 đồng đến 16.000.000 đồng đối với cá nhân kinh doanh thực phẩm vi phạm có khối lượng từ 50 kg đến 100 kg.",
    "3. Phạt tiền từ 16.000.000 đồng đến 30.000.000 đồng đối với cá nhân kinh doanh thực phẩm vi phạm có khối lượng trên 100 kg.",
    "",
    "Điều 3. Hiệu lực thi hành",
    "1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2027.",
].join("\n");

const BASE_BLIND_CRIMINAL = [
    "Dự thảo Luật sửa đổi quy định tội phạm kinh tế",
    "",
    "Điều 1. Tội sản xuất hàng cấm",
    "1. Người nào sản xuất hàng cấm có khối lượng từ 20 kg đến dưới 50 kg thì bị phạt tù từ 01 năm đến 05 năm.",
    "2. Phạm tội sản xuất hàng cấm có khối lượng từ 50 kg đến 100 kg thì bị phạt tù từ 05 năm đến 10 năm.",
    "3. Phạm tội sản xuất hàng cấm có khối lượng trên 100 kg thì bị phạt tù từ 10 năm đến 15 năm.",
    "",
    "Điều 2. Hiệu lực thi hành",
    "1. Luật này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2027.",
].join("\n");

// ============================================================================
// MUTATION OPERATORS
// ============================================================================

function replaceStrict(source: string, find: string, replacement: string): string {
    if (!source.includes(find)) {
        throw new Error(`Mutation anchor not found: ${find}`);
    }

    return source.replace(find, replacement);
}

export function buildLoopholeGoldenDataset(): readonly LoopholeEvalCase[] {
    const zalo90Clean = loadRealZaloSnippet("90-2020-n-cp.txt", 4);
    const zalo45Clean = loadRealZaloSnippet("45-2020-n-cp.txt", 4);

    const devCases: LoopholeEvalCase[] = [
        // --- DEV POSITIVE (15 mutated cases) ---
        {
            caseId: "LH-DEV-P01",
            split: "dev",
            domain: "commercial_lease",
            polarity: "POSITIVE",
            mutationKind: "INVERT_FINE_RANGE",
            currentPath: "dev-lease-p01.txt",
            workspaceFiles: [],
            draftContent: replaceStrict(
                BASE_DEV_LEASE,
                "Phạt tiền từ 5.000.000 đồng đến 8.000.000 đồng",
                "Phạt tiền từ 8.000.000 đồng đến 5.000.000 đồng",
            ),
            expectedDefects: [
                {
                    code: "LG001",
                    provisionRef: "Khoản 3 Điều 2",
                    anchorSubstring: "từ 8.000.000 đồng đến 5.000.000 đồng",
                    description: "Inverted fine range (8M > 5M)",
                },
            ],
        },
        {
            caseId: "LH-DEV-P02",
            split: "dev",
            domain: "commercial_lease",
            polarity: "POSITIVE",
            mutationKind: "CREATE_THRESHOLD_GAP",
            currentPath: "dev-lease-p02.txt",
            workspaceFiles: [],
            draftContent: replaceStrict(
                BASE_DEV_LEASE,
                "từ 15 ngày đến 30 ngày",
                "từ 20 ngày đến 30 ngày",
            ),
            expectedDefects: [
                {
                    code: "LP003",
                    provisionRef: "Khoản 3 Điều 2",
                    anchorSubstring: "từ 20 ngày đến 30 ngày",
                    description: "Boundary gap 15..20 ngày",
                },
            ],
        },
        {
            caseId: "LH-DEV-P03",
            split: "dev",
            domain: "commercial_lease",
            polarity: "POSITIVE",
            mutationKind: "BREAK_CROSS_REFERENCE",
            currentPath: "dev-lease-p03.txt",
            workspaceFiles: [],
            draftContent: replaceStrict(
                BASE_DEV_LEASE,
                "theo khoản 1 Điều 3",
                "theo khoản 9 Điều 9",
            ),
            expectedDefects: [
                {
                    code: "LG003",
                    provisionRef: "Khoản 4 Điều 2",
                    anchorSubstring: "khoản 9 Điều 9",
                    description: "Broken cross-reference to non-existent Khoản 9 Điều 9",
                },
            ],
        },
        {
            caseId: "LH-DEV-P04",
            split: "dev",
            domain: "saas_contract",
            polarity: "POSITIVE",
            mutationKind: "INJECT_DEONTIC_CONTRADICTION",
            currentPath: "dev-saas-p04.txt",
            workspaceFiles: [],
            draftContent: replaceStrict(
                BASE_DEV_SAAS,
                "3. Nghiêm cấm tiết lộ dữ liệu nhạy cảm cho bên thứ ba; vi phạm bị phạt tiền từ 20.000.000 đồng đến 40.000.000 đồng đối với tổ chức và từ 10.000.000 đồng đến 20.000.000 đồng đối với cá nhân.",
                "3. Nghiêm cấm tiết lộ dữ liệu nhạy cảm cho bên thứ ba; vi phạm bị phạt tiền từ 20.000.000 đồng đến 40.000.000 đồng đối với tổ chức và từ 10.000.000 đồng đến 20.000.000 đồng đối với cá nhân.\n4. Cho phép tiết lộ dữ liệu nhạy cảm cho bên thứ ba.",
            ),
            expectedDefects: [
                {
                    code: "DEONTIC_CONFLICT",
                    provisionRef: "Khoản 4 Điều 2",
                    anchorSubstring: "Cho phép tiết lộ dữ liệu nhạy cảm",
                    description: "Direct deontic contradiction (Nghiêm cấm vs Cho phép)",
                },
            ],
        },
        {
            caseId: "LH-DEV-P05",
            split: "dev",
            domain: "saas_contract",
            polarity: "POSITIVE",
            mutationKind: "INJECT_OPEN_EXCEPTION",
            currentPath: "dev-saas-p05.txt",
            workspaceFiles: [],
            draftContent: replaceStrict(
                BASE_DEV_SAAS,
                "từ 06 giờ đến 24 giờ thì phạt tiền",
                "từ 06 giờ đến 24 giờ, trừ trường hợp đặc biệt, thì phạt tiền",
            ),
            expectedDefects: [
                {
                    code: "LP001",
                    provisionRef: "Khoản 2 Điều 2",
                    anchorSubstring: "trừ trường hợp đặc biệt",
                    description: "Unbounded open exception without criteria",
                },
            ],
        },
        {
            caseId: "LH-DEV-P06",
            split: "dev",
            domain: "saas_contract",
            polarity: "POSITIVE",
            mutationKind: "INJECT_UNDEFINED_TERM",
            currentPath: "dev-saas-p06.txt",
            workspaceFiles: [],
            draftContent: replaceStrict(
                BASE_DEV_SAAS,
                "1. “dữ liệu nhạy cảm” là thông tin định danh khách hàng và dữ liệu tài chính lưu trữ trên hệ thống.\n",
                "",
            ),
            expectedDefects: [
                {
                    code: "AM005",
                    provisionRef: "Khoản 3 Điều 2",
                    anchorSubstring: "dữ liệu nhạy cảm",
                    description: "Undefined tracked legal term in empty workspace",
                },
            ],
        },
        {
            caseId: "LH-DEV-P07",
            split: "dev",
            domain: "tax",
            polarity: "POSITIVE",
            mutationKind: "CREATE_THRESHOLD_OVERLAP",
            currentPath: "dev-tax-p07.txt",
            workspaceFiles: [],
            draftContent: replaceStrict(
                BASE_DEV_TAX,
                "từ 01 ngày đến dưới 30 ngày",
                "từ 01 ngày đến 30 ngày",
            ),
            expectedDefects: [
                {
                    code: "LG002",
                    provisionRef: "Khoản 2 Điều 2",
                    anchorSubstring: "từ 30 ngày đến 60 ngày",
                    description: "Boundary overlap at exactly 30 ngày",
                },
            ],
        },
        {
            caseId: "LH-DEV-P08",
            split: "dev",
            domain: "tax",
            polarity: "POSITIVE",
            mutationKind: "DROP_ORG_SUBJECT",
            currentPath: "dev-tax-p08.txt",
            workspaceFiles: [],
            draftContent: replaceStrict(
                BASE_DEV_TAX,
                "1. Đối với cùng một hành vi vi phạm hành chính thì mức phạt tiền đối với tổ chức bằng 02 lần mức phạt tiền đối với cá nhân.",
                "1. Nghị định này áp dụng trên phạm vi toàn quốc.",
            ),
            expectedDefects: [
                {
                    code: "LP006",
                    provisionRef: "Khoản 1 Điều 2",
                    anchorSubstring: "từ 2.000.000 đồng đến 5.000.000 đồng",
                    description: "Individual-only fine without organization conversion rule",
                },
            ],
        },
        {
            caseId: "LH-DEV-P09",
            split: "dev",
            domain: "tax",
            polarity: "POSITIVE",
            mutationKind: "INJECT_SELF_REFERENCE",
            currentPath: "dev-tax-p09.txt",
            workspaceFiles: [],
            draftContent: replaceStrict(
                BASE_DEV_TAX,
                "theo quy định tại khoản 1 Điều 2.",
                "theo quy định tại khoản 1 Điều 3.",
            ),
            expectedDefects: [
                {
                    code: "LG004",
                    provisionRef: "Khoản 1 Điều 3",
                    anchorSubstring: "khoản 1 Điều 3",
                    description: "Circular self-reference to Khoản 1 Điều 3",
                },
            ],
        },
        {
            caseId: "LH-DEV-P10",
            split: "dev",
            domain: "labor",
            polarity: "POSITIVE",
            mutationKind: "CREATE_THRESHOLD_GAP",
            currentPath: "dev-labor-p10.txt",
            workspaceFiles: [],
            draftContent: replaceStrict(
                BASE_DEV_LABOR,
                "từ 20 giờ đến 40 giờ",
                "từ 25 giờ đến 40 giờ",
            ),
            expectedDefects: [
                {
                    code: "LP003",
                    provisionRef: "Khoản 2 Điều 2",
                    anchorSubstring: "từ 25 giờ đến 40 giờ",
                    description: "Boundary gap 20..25 giờ làm thêm",
                },
            ],
        },
        {
            caseId: "LH-DEV-P11",
            split: "dev",
            domain: "labor",
            polarity: "POSITIVE",
            mutationKind: "INJECT_TOOTHLESS_PROHIBITION",
            currentPath: "dev-labor-p11.txt",
            workspaceFiles: [],
            draftContent: replaceStrict(
                BASE_DEV_LABOR,
                "Điều 3. Hiệu lực thi hành",
                "Điều 3. Hành vi bị nghiêm cấm\n1. Nghiêm cấm giữ bản chính giấy tờ tùy thân của người lao động.\n\nĐiều 4. Hiệu lực thi hành",
            ),
            expectedDefects: [
                {
                    code: "LP002",
                    provisionRef: "Khoản 1 Điều 3",
                    anchorSubstring: "Nghiêm cấm",
                    description: "Prohibition without any sanction",
                },
            ],
        },
        {
            caseId: "LH-DEV-P12",
            split: "dev",
            domain: "land",
            polarity: "POSITIVE",
            mutationKind: "CREATE_THRESHOLD_OVERLAP",
            currentPath: "dev-land-p12.txt",
            workspaceFiles: [],
            draftContent: replaceStrict(
                BASE_DEV_LAND,
                "từ 100 m2 đến dưới 500 m2",
                "từ 100 m2 đến 500 m2",
            ),
            expectedDefects: [
                {
                    code: "LG002",
                    provisionRef: "Khoản 2 Điều 2",
                    anchorSubstring: "từ 500 m2 đến 1.000 m2",
                    description: "Boundary overlap at 500 m2",
                },
            ],
        },
        {
            caseId: "LH-DEV-P13",
            split: "dev",
            domain: "procurement",
            polarity: "POSITIVE",
            mutationKind: "INJECT_PENALTY_PARADOX",
            currentPath: "dev-proc-p13.txt",
            workspaceFiles: [],
            draftContent: replaceStrict(
                BASE_DEV_PROCUREMENT,
                "3. Phạt tiền từ 50.000.000 đồng đến 80.000.000 đồng đối với cá nhân làm sai lệch giá dự thầu trên 30%.",
                "3. Hành vi nghiêm trọng hơn khoản 2 Điều này nhưng phạt tiền từ 10.000.000 đồng đến 20.000.000 đồng đối với cá nhân làm sai lệch giá dự thầu trên 30%.",
            ),
            expectedDefects: [
                {
                    code: "LG016",
                    provisionRef: "Khoản 3 Điều 2",
                    anchorSubstring: "nghiêm trọng hơn khoản 2",
                    description: "Penalty monotonicity paradox: harsher clause has lower fine",
                },
            ],
        },
        {
            caseId: "LH-DEV-P14",
            split: "dev",
            domain: "procurement",
            polarity: "POSITIVE",
            mutationKind: "INJECT_REPEALED_REFERENCE",
            currentPath: "dev-proc-p14.txt",
            workspaceFiles: [],
            draftContent: replaceStrict(
                BASE_DEV_PROCUREMENT,
                "Điều 3. Hiệu lực thi hành",
                "Điều 3. Xử lý chuyển tiếp\n1. Bãi bỏ khoản 1 Điều 2. Hành vi gian lận hồ sơ vẫn xử phạt theo khoản 1 Điều 2.\n\nĐiều 4. Hiệu lực thi hành",
            ),
            expectedDefects: [
                {
                    code: "LG007",
                    provisionRef: "Khoản 1 Điều 3",
                    anchorSubstring: "khoản 1 Điều 2",
                    description: "Reference to repealed clause Khoản 1 Điều 2",
                },
            ],
        },
        {
            caseId: "LH-DEV-P15",
            split: "dev",
            domain: "zalo_real_mutated",
            polarity: "POSITIVE",
            mutationKind: "INVERT_FINE_AND_GAP_ON_REAL_LAW",
            currentPath: "dev-zalo90-p15.txt",
            workspaceFiles: [],
            draftContent: `${zalo90Clean}\n\nĐiều 6. Quy định bổ sung thử nghiệm\n1. Phạt tiền từ 12.000.000 đồng đến 6.000.000 đồng đối với cá nhân và tổ chức vi phạm báo cáo.`,
            expectedDefects: [
                {
                    code: "LG001",
                    provisionRef: "Khoản 1 Điều 6",
                    anchorSubstring: "từ 12.000.000 đồng đến 6.000.000 đồng",
                    description: "Inverted fine injected onto real Zalo 90/2020/NĐ-CP",
                },
            ],
        },

        // --- DEV NEGATIVE (9 clean documents — 0 expected defects!) ---
        {
            caseId: "LH-DEV-N01",
            split: "dev",
            domain: "commercial_lease",
            polarity: "NEGATIVE",
            mutationKind: "NONE",
            currentPath: "dev-lease-clean.txt",
            workspaceFiles: [],
            draftContent: BASE_DEV_LEASE,
            expectedDefects: [],
        },
        {
            caseId: "LH-DEV-N02",
            split: "dev",
            domain: "saas_contract",
            polarity: "NEGATIVE",
            mutationKind: "NONE",
            currentPath: "dev-saas-clean.txt",
            workspaceFiles: [],
            draftContent: BASE_DEV_SAAS,
            expectedDefects: [],
        },
        {
            caseId: "LH-DEV-N03",
            split: "dev",
            domain: "tax",
            polarity: "NEGATIVE",
            mutationKind: "NONE",
            currentPath: "dev-tax-clean.txt",
            workspaceFiles: [],
            draftContent: BASE_DEV_TAX,
            expectedDefects: [],
        },
        {
            caseId: "LH-DEV-N04",
            split: "dev",
            domain: "labor",
            polarity: "NEGATIVE",
            mutationKind: "NONE",
            currentPath: "dev-labor-clean.txt",
            workspaceFiles: [],
            draftContent: BASE_DEV_LABOR,
            expectedDefects: [],
        },
        {
            caseId: "LH-DEV-N05",
            split: "dev",
            domain: "land",
            polarity: "NEGATIVE",
            mutationKind: "NONE",
            currentPath: "dev-land-clean.txt",
            workspaceFiles: [],
            draftContent: BASE_DEV_LAND,
            expectedDefects: [],
        },
        {
            caseId: "LH-DEV-N06",
            split: "dev",
            domain: "procurement",
            polarity: "NEGATIVE",
            mutationKind: "NONE",
            currentPath: "dev-proc-clean.txt",
            workspaceFiles: [],
            draftContent: BASE_DEV_PROCUREMENT,
            expectedDefects: [],
        },
        {
            caseId: "LH-DEV-N07",
            split: "dev",
            domain: "saas_contract_with_ws_term",
            polarity: "NEGATIVE",
            mutationKind: "NONE",
            currentPath: "dev-saas-ws-clean.txt",
            workspaceFiles: [
                makeLibFile(
                    "luat-du-lieu.txt",
                    "Luật Bảo vệ dữ liệu số 15/2025/QH15",
                    "15/2025/QH15",
                    "Luật",
                    "Luật Bảo vệ dữ liệu số 15/2025/QH15\nĐiều 1. Giải thích từ ngữ\n1. “dữ liệu nhạy cảm” là dữ liệu gắn liền với quyền riêng tư cá nhân theo quy định của Luật này.",
                ),
            ],
            draftContent: replaceStrict(
                BASE_DEV_SAAS,
                "1. “dữ liệu nhạy cảm” là thông tin định danh khách hàng và dữ liệu tài chính lưu trữ trên hệ thống.\n",
                "",
            ),
            expectedDefects: [],
        },
        {
            caseId: "LH-DEV-N08",
            split: "dev",
            domain: "qualified_exception_clean",
            polarity: "NEGATIVE",
            mutationKind: "NONE",
            currentPath: "dev-qual-exc-clean.txt",
            workspaceFiles: [],
            draftContent: replaceStrict(
                BASE_DEV_LAND,
                "từ 100 m2 đến dưới 500 m2.",
                "từ 100 m2 đến dưới 500 m2, trừ trường hợp bất khả kháng theo quy định tại Điều 3.",
            ),
            expectedDefects: [],
        },
        {
            caseId: "LH-DEV-N09",
            split: "dev",
            domain: "zalo_real_clean",
            polarity: "NEGATIVE",
            mutationKind: "NONE",
            currentPath: "dev-zalo90-clean.txt",
            workspaceFiles: [],
            draftContent: zalo90Clean,
            expectedDefects: [],
        },
    ];

    const blindCases: LoopholeEvalCase[] = [
        // --- BLIND TEST POSITIVE (10 mutated cases on DISJOINT domains) ---
        {
            caseId: "LH-BLIND-P01",
            split: "blind_test",
            domain: "construction_epc",
            polarity: "POSITIVE",
            mutationKind: "INVERT_FINE_RANGE",
            currentPath: "blind-epc-p01.txt",
            workspaceFiles: [],
            draftContent: replaceStrict(
                BASE_BLIND_EPC,
                "Phạt tiền từ 20.000.000 đồng đến 40.000.000 đồng",
                "Phạt tiền từ 40.000.000 đồng đến 20.000.000 đồng",
            ),
            expectedDefects: [
                {
                    code: "LG001",
                    provisionRef: "Khoản 2 Điều 2",
                    anchorSubstring: "từ 40.000.000 đồng đến 20.000.000 đồng",
                    description: "Inverted fine range",
                },
            ],
        },
        {
            caseId: "LH-BLIND-P02",
            split: "blind_test",
            domain: "construction_epc",
            polarity: "POSITIVE",
            mutationKind: "CREATE_THRESHOLD_GAP",
            currentPath: "blind-epc-p02.txt",
            workspaceFiles: [],
            draftContent: replaceStrict(
                BASE_BLIND_EPC,
                "từ 20 ngày đến 45 ngày",
                "từ 25 ngày đến 45 ngày",
            ),
            expectedDefects: [
                {
                    code: "LP003",
                    provisionRef: "Khoản 2 Điều 2",
                    anchorSubstring: "từ 25 ngày đến 45 ngày",
                    description: "Threshold gap 20..25 ngày",
                },
            ],
        },
        {
            caseId: "LH-BLIND-P03",
            split: "blind_test",
            domain: "commercial_sales",
            polarity: "POSITIVE",
            mutationKind: "INJECT_DEONTIC_CONTRADICTION",
            currentPath: "blind-sales-p03.txt",
            workspaceFiles: [],
            draftContent: replaceStrict(
                BASE_BLIND_SALES,
                "3. Nghiêm cấm giao hàng giả nhãn hiệu; vi phạm bị phạt tiền từ 30.000.000 đồng đến 50.000.000 đồng đối với tổ chức và từ 15.000.000 đồng đến 25.000.000 đồng đối với cá nhân.",
                "3. Nghiêm cấm giao hàng giả nhãn hiệu; vi phạm bị phạt tiền từ 30.000.000 đồng đến 50.000.000 đồng đối với tổ chức và từ 15.000.000 đồng đến 25.000.000 đồng đối với cá nhân.\n4. Cho phép giao hàng giả nhãn hiệu.",
            ),
            expectedDefects: [
                {
                    code: "DEONTIC_CONFLICT",
                    provisionRef: "Khoản 4 Điều 2",
                    anchorSubstring: "Cho phép giao hàng giả nhãn hiệu",
                    description: "Direct deontic conflict",
                },
            ],
        },
        {
            caseId: "LH-BLIND-P04",
            split: "blind_test",
            domain: "commercial_sales",
            polarity: "POSITIVE",
            mutationKind: "CREATE_THRESHOLD_OVERLAP",
            currentPath: "blind-sales-p04.txt",
            workspaceFiles: [],
            draftContent: replaceStrict(
                BASE_BLIND_SALES,
                "từ 02% đến dưới 10%",
                "từ 02% đến 10%",
            ),
            expectedDefects: [
                {
                    code: "LG002",
                    provisionRef: "Khoản 2 Điều 2",
                    anchorSubstring: "từ 10% đến 25%",
                    description: "Overlap at 10%",
                },
            ],
        },
        {
            caseId: "LH-BLIND-P05",
            split: "blind_test",
            domain: "environment",
            polarity: "POSITIVE",
            mutationKind: "INJECT_OPEN_EXCEPTION",
            currentPath: "blind-env-p05.txt",
            workspaceFiles: [],
            draftContent: replaceStrict(
                BASE_BLIND_ENV,
                "từ 50 m3 đến 100 m3.",
                "từ 50 m3 đến 100 m3, trừ lý do chính đáng.",
            ),
            expectedDefects: [
                {
                    code: "LP001",
                    provisionRef: "Khoản 2 Điều 2",
                    anchorSubstring: "trừ lý do chính đáng",
                    description: "Open exception",
                },
            ],
        },
        {
            caseId: "LH-BLIND-P06",
            split: "blind_test",
            domain: "environment",
            polarity: "POSITIVE",
            mutationKind: "BREAK_CROSS_REFERENCE",
            currentPath: "blind-env-p06.txt",
            workspaceFiles: [],
            draftContent: replaceStrict(
                BASE_BLIND_ENV,
                "Điều 3. Hiệu lực thi hành",
                "Điều 3. Áp dụng bổ sung\n1. Việc khắc phục hậu quả áp dụng theo khoản 5 Điều 8.\n\nĐiều 4. Hiệu lực thi hành",
            ),
            expectedDefects: [
                {
                    code: "LG003",
                    provisionRef: "Khoản 1 Điều 3",
                    anchorSubstring: "khoản 5 Điều 8",
                    description: "Broken internal cross-reference",
                },
            ],
        },
        {
            caseId: "LH-BLIND-P07",
            split: "blind_test",
            domain: "food_safety",
            polarity: "POSITIVE",
            mutationKind: "DROP_ORG_SUBJECT",
            currentPath: "blind-food-p07.txt",
            workspaceFiles: [],
            draftContent: replaceStrict(
                BASE_BLIND_FOOD,
                "1. Đối với cùng một hành vi vi phạm hành chính thì mức phạt tiền đối với tổ chức bằng 02 lần mức phạt tiền đối với cá nhân.",
                "1. Nghị định này quy định xử phạt trong lĩnh vực an toàn thực phẩm.",
            ),
            expectedDefects: [
                {
                    code: "LP006",
                    provisionRef: "Khoản 1 Điều 2",
                    anchorSubstring: "từ 4.000.000 đồng đến 8.000.000 đồng",
                    description: "Missing organization coverage",
                },
            ],
        },
        {
            caseId: "LH-BLIND-P08",
            split: "blind_test",
            domain: "food_safety",
            polarity: "POSITIVE",
            mutationKind: "INJECT_TOOTHLESS_PROHIBITION",
            currentPath: "blind-food-p08.txt",
            workspaceFiles: [],
            draftContent: replaceStrict(
                BASE_BLIND_FOOD,
                "Điều 3. Hiệu lực thi hành",
                "Điều 3. Hành vi bị nghiêm cấm\n1. Nghiêm cấm sử dụng phụ gia ngoài danh mục cho phép trong chế biến thực phẩm.\n\nĐiều 4. Hiệu lực thi hành",
            ),
            expectedDefects: [
                {
                    code: "LP002",
                    provisionRef: "Khoản 1 Điều 3",
                    anchorSubstring: "Nghiêm cấm",
                    description: "Toothless prohibition",
                },
            ],
        },
        {
            caseId: "LH-BLIND-P09",
            split: "blind_test",
            domain: "criminal_econ",
            polarity: "POSITIVE",
            mutationKind: "INVERT_PRISON_RANGE",
            currentPath: "blind-crim-p09.txt",
            workspaceFiles: [],
            draftContent: replaceStrict(
                BASE_BLIND_CRIMINAL,
                "phạt tù từ 05 năm đến 10 năm",
                "phạt tù từ 10 năm đến 05 năm",
            ),
            expectedDefects: [
                {
                    code: "LG001",
                    provisionRef: "Khoản 2 Điều 1",
                    anchorSubstring: "phạt tù từ 10 năm đến 05 năm",
                    description: "Inverted prison term bounds (10 > 5 năm)",
                },
            ],
        },
        {
            caseId: "LH-BLIND-P10",
            split: "blind_test",
            domain: "zalo_real_mutated",
            polarity: "POSITIVE",
            mutationKind: "INJECT_SELF_REFERENCE_ON_REAL_LAW",
            currentPath: "blind-zalo45-p10.txt",
            workspaceFiles: [],
            draftContent: `${zalo45Clean}\n\nĐiều 6. Quy định tham chiếu kiểm thử\n1. Việc giải quyết thủ tục thực hiện theo quy định tại khoản 1 Điều 6.`,
            expectedDefects: [
                {
                    code: "LG004",
                    provisionRef: "Khoản 1 Điều 6",
                    anchorSubstring: "khoản 1 Điều 6",
                    description: "Self-reference injected onto real Zalo 45/2020/NĐ-CP",
                },
            ],
        },

        // --- BLIND TEST NEGATIVE (6 clean documents on DISJOINT domains) ---
        {
            caseId: "LH-BLIND-N01",
            split: "blind_test",
            domain: "construction_epc",
            polarity: "NEGATIVE",
            mutationKind: "NONE",
            currentPath: "blind-epc-clean.txt",
            workspaceFiles: [],
            draftContent: BASE_BLIND_EPC,
            expectedDefects: [],
        },
        {
            caseId: "LH-BLIND-N02",
            split: "blind_test",
            domain: "commercial_sales",
            polarity: "NEGATIVE",
            mutationKind: "NONE",
            currentPath: "blind-sales-clean.txt",
            workspaceFiles: [],
            draftContent: BASE_BLIND_SALES,
            expectedDefects: [],
        },
        {
            caseId: "LH-BLIND-N03",
            split: "blind_test",
            domain: "environment",
            polarity: "NEGATIVE",
            mutationKind: "NONE",
            currentPath: "blind-env-clean.txt",
            workspaceFiles: [],
            draftContent: BASE_BLIND_ENV,
            expectedDefects: [],
        },
        {
            caseId: "LH-BLIND-N04",
            split: "blind_test",
            domain: "food_safety",
            polarity: "NEGATIVE",
            mutationKind: "NONE",
            currentPath: "blind-food-clean.txt",
            workspaceFiles: [],
            draftContent: BASE_BLIND_FOOD,
            expectedDefects: [],
        },
        {
            caseId: "LH-BLIND-N05",
            split: "blind_test",
            domain: "criminal_econ",
            polarity: "NEGATIVE",
            mutationKind: "NONE",
            currentPath: "blind-crim-clean.txt",
            workspaceFiles: [],
            draftContent: BASE_BLIND_CRIMINAL,
            expectedDefects: [],
        },
        {
            caseId: "LH-BLIND-N06",
            split: "blind_test",
            domain: "zalo_real_clean",
            polarity: "NEGATIVE",
            mutationKind: "NONE",
            currentPath: "blind-zalo45-clean.txt",
            workspaceFiles: [],
            draftContent: zalo45Clean,
            expectedDefects: [],
        },
    ];

    return [...devCases, ...blindCases];
}
