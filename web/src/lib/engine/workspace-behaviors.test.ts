import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LocalWorkspaceFile } from "./local-workspace";
import { buildWorkspaceBehaviorHistory, extractLineBehaviorIndicators } from "./workspace-behaviors";
import { buildWorkspaceRelationGraph } from "./workspace-relations";

function loadTrafficLawWorkspace(): LocalWorkspaceFile[] {
    const baseDir = resolve(import.meta.dir, "../../../../data/traffic-law-real");
    const files: { path: string; title: string; docNum: string | null; docType: string; isLibrary: boolean }[] = [
        { path: "library/23-2008-qh12-luat-gtdb.txt", title: "Luật Giao thông đường bộ", docNum: "23/2008/QH12", docType: "Luật", isLibrary: true },
        { path: "library/36-2024-qh15-luat-ttatgtdb.txt", title: "Luật Trật tự, an toàn giao thông đường bộ", docNum: "36/2024/QH15", docType: "Luật", isLibrary: true },
        { path: "library/35-2024-qh15-luat-duong-bo.txt", title: "Luật Đường bộ", docNum: "35/2024/QH15", docType: "Luật", isLibrary: true },
        { path: "library/100-2019-nd-cp-xu-phat-gtdb.txt", title: "Nghị định 100/2019/NĐ-CP", docNum: "100/2019/NĐ-CP", docType: "Nghị định", isLibrary: true },
        { path: "library/123-2021-nd-cp-sua-doi-100-2019.txt", title: "Nghị định 123/2021/NĐ-CP", docNum: "123/2021/NĐ-CP", docType: "Nghị định", isLibrary: true },
        { path: "library/168-2024-nd-cp-xu-phat-ttatgtdb.txt", title: "Nghị định 168/2024/NĐ-CP", docNum: "168/2024/NĐ-CP", docType: "Nghị định", isLibrary: true },
        { path: "du-thao-sua-doi-168-2024-test.txt", title: "Dự thảo sửa đổi 168/2024/NĐ-CP", docNum: "15/2026/NĐ-CP", docType: "Nghị định", isLibrary: false },
    ];

    return files.map((item) => ({
        path: item.path,
        name: item.path.split("/").pop() ?? item.path,
        title: item.title,
        documentNumber: item.docNum,
        documentType: item.docType,
        content: readFileSync(resolve(baseDir, item.path), "utf8"),
        isLibrary: item.isLibrary,
        updatedAt: "2026-11-25T00:00:00.000Z",
    }));
}

describe("workspace-behaviors on real traffic law corpus", () => {
    it("tracks chronological penalty evolution for red-light running (100/2019 -> 123/2021 -> 168/2024)", () => {
        const files = loadTrafficLawWorkspace();
        const graph = buildWorkspaceRelationGraph(files);
        const summary = buildWorkspaceBehaviorHistory(files, graph);

        expect(summary.totalBehaviors).toBeGreaterThan(5);
        expect(summary.withHistoryCount).toBeGreaterThanOrEqual(2);

        const redLightCar = summary.groups.find(
            (g) => g.canonicalKey.startsWith("vuot_den_do") && g.vehicleOrSubject === "Xe ô tô",
        );

        expect(redLightCar).toBeDefined();
        expect(redLightCar?.versions.length).toBeGreaterThanOrEqual(3);
        expect(redLightCar?.latestVersion.fineMax).toBe(20_000_000);
        expect(redLightCar?.latestVersion.pointsDeducted).toBe(4);
    });

    it("live-updates behaviors when typing new child points under a sanction clause, even on an empty workspace", () => {
        const draftContent = `Nghị định mới về trật tự đô thị

Điều 1. Xử phạt hành vi mới
1. Phạt tiền từ 4.000.000 đồng đến 6.000.000 đồng đối với các hành vi sau:
a) Lấn chiếm vỉa hè để kinh doanh trái phép;
b) Tự ý đặt biển quảng cáo gây cản trở giao thông;`;

        const graph = buildWorkspaceRelationGraph([], "du-thao-moi.txt", draftContent);
        expect(graph.nodes.length).toBe(1);

        const summary = buildWorkspaceBehaviorHistory([], graph, new Map(), "du-thao-moi.txt", draftContent);
        expect(summary.totalBehaviors).toBe(2);
        expect(summary.groups.every((g) => g.latestVersion.fineMin === 4_000_000 && g.latestVersion.fineMax === 6_000_000)).toBe(true);
        expect(summary.groups.every((g) => g.latestVersion.lifecycleStatus === "DRAFT")).toBe(true);
    });

    it("detects behaviors in single-paragraph articles without clauses and broader sanction verbs", () => {
        const draftContent = `Điều 1. Cấm xả rác nơi công cộng
Người xả rác bị phạt tiền từ 1.000.000 đồng đến 2.000.000 đồng.

Điều 2. Phạt cảnh cáo
1. Phạt cảnh cáo đối với hành vi vi phạm lần đầu.`;

        const graph = buildWorkspaceRelationGraph([], "xa-rac.txt", draftContent);
        const summary = buildWorkspaceBehaviorHistory([], graph, new Map(), "xa-rac.txt", draftContent);

        expect(summary.totalBehaviors).toBe(2);
        expect(summary.groups.some((g) => g.latestVersion.fineMax === 2_000_000)).toBe(true);

        const indicators = extractLineBehaviorIndicators(summary, "xa-rac.txt");
        expect(indicators.length).toBe(2);
        expect(indicators[0].isNew).toBe(true);
        expect(indicators[0].line).toBe(1);
    });

    it("excludes clauses without explicit sanctions or behavior definitions (org multipliers, scope, repeals, vague delegations, noun glossaries)", () => {
        const docContent = `Nghị định số 99/2026/NĐ-CP quy định xử phạt vi phạm hành chính
CHÍNH PHỦ
Số: 99/2026/NĐ-CP
Ngày 01 tháng 01 năm 2026

Điều 1. Phạm vi điều chỉnh và giải thích từ ngữ
1. Nghị định này quy định mức xử phạt vi phạm hành chính trong lĩnh vực giao thông đường bộ.
2. Đối với cùng một hành vi vi phạm hành chính thì mức phạt tiền đối với tổ chức bằng 02 lần mức phạt tiền đối với cá nhân.
3. Đường bộ gồm đường, cầu đường bộ, hầm đường bộ, bến phà đường bộ.
4. Nồng độ cồn là hàm lượng cồn đo được trong máu hoặc hơi thở của người điều khiển phương tiện.

Điều 2. Quy định chung
1. Người điều khiển phương tiện trên đường cao tốc phải tuân thủ giới hạn tốc độ, trừ trường hợp đặc biệt.
2. Theo quy định tại khoản 9 Điều 1, hành vi vi phạm bị trừ điểm giấy phép lái xe theo quy định của Chính phủ.
3. Bãi bỏ các quy định về xử phạt vi phạm hành chính tại Nghị định số 100/2019/NĐ-CP.
4. Phạt tiền từ 2.000.000 đồng đến 4.000.000 đồng đối với người điều khiển xe ô tô không chấp hành hiệu lệnh của đèn tín hiệu giao thông; trừ điểm giấy phép lái xe 04 điểm.`;

        const graph = buildWorkspaceRelationGraph([], "99-2026.txt", docContent);
        const summary = buildWorkspaceBehaviorHistory([], graph, new Map(), "99-2026.txt", docContent);

        expect(summary.totalBehaviors).toBe(1);
        expect(summary.groups[0]?.canonicalKey).toBe("vuot_den_do::Xe ô tô");
        expect(summary.groups[0]?.latestVersion.fineMax).toBe(4_000_000);
        expect(summary.groups[0]?.latestVersion.pointsDeducted).toBe(4);
    });

    it("splits behavior history into sanctionHistory and definitionHistory on traffic-law-real and custom drafts", () => {
        const files = loadTrafficLawWorkspace();
        const graph = buildWorkspaceRelationGraph(files);
        const summary = buildWorkspaceBehaviorHistory(files, graph);

        const redLightCar = summary.groups.find(
            (g) => g.canonicalKey.startsWith("vuot_den_do") && g.vehicleOrSubject === "Xe ô tô",
        );

        expect(redLightCar).toBeDefined();
        expect(redLightCar?.sanctionHistory.length).toBeGreaterThanOrEqual(3);
        expect(redLightCar?.definitionHistory.length).toBeGreaterThanOrEqual(2);
        expect(redLightCar?.sanctionHistory.every((v) => v.hasExplicitSanction)).toBe(true);
        expect(redLightCar?.definitionHistory.every((v) => v.hasExplicitDefinition)).toBe(true);
        expect(redLightCar?.latestVersion.fineMax).toBe(20_000_000);

        const alcoholCar = summary.groups.find(
            (g) => g.canonicalKey.startsWith("nong_do_con") && g.vehicleOrSubject === "Xe ô tô",
        );

        expect(alcoholCar).toBeDefined();
        expect(alcoholCar?.sanctionHistory.length).toBeGreaterThanOrEqual(2);
        expect(alcoholCar?.definitionHistory.length).toBeGreaterThanOrEqual(2);

        const oldLawDoc: LocalWorkspaceFile = {
            path: "library/luat-cu.txt",
            name: "luat-cu.txt",
            title: "Luật Giao thông cũ",
            documentNumber: "10/2020/QH14",
            documentType: "Luật",
            isLibrary: true,
            updatedAt: "2026-11-26T00:00:00.000Z",
            content: `Luật số 10/2020/QH14
Ngày 01 tháng 01 năm 2020

Điều 1. Giải thích hành vi
1. Hành vi vượt đèn đỏ được hiểu là việc không dừng lại trước vạch dừng khi đèn tín hiệu chuyển sang màu đỏ.

Điều 2. Hiệu lực thi hành
1. Luật này có hiệu lực thi hành từ ngày 01 tháng 01 năm 2021.`,
        };

        const newLawDoc: LocalWorkspaceFile = {
            path: "du-thao-luat-moi.txt",
            name: "du-thao-luat-moi.txt",
            title: "Dự thảo Luật mới",
            documentNumber: "20/2026/QH15",
            documentType: "Luật",
            isLibrary: false,
            updatedAt: "2026-11-26T00:00:00.000Z",
            content: `Dự thảo Luật số 20/2026/QH15

Điều 1. Giải thích hành vi
1. Hành vi vượt đèn đỏ được hiểu là việc không chấp hành hiệu lệnh của đèn tín hiệu giao thông màu đỏ hoặc màu vàng nhấp nháy tại nút giao.
2. Người điều khiển xe phải tuân thủ quy tắc giao thông.`,
        };

        const customFiles = [oldLawDoc, newLawDoc];
        const customGraph = buildWorkspaceRelationGraph(customFiles);
        const customSummary = buildWorkspaceBehaviorHistory(customFiles, customGraph);

        expect(customSummary.totalBehaviors).toBe(1);
        expect(customSummary.definitionHistoryCount).toBe(1);
        expect(customSummary.sanctionHistoryCount).toBe(0);
        expect(customSummary.groups[0]?.definitionHistory.length).toBe(2);
        expect(customSummary.groups[0]?.sanctionHistory.length).toBe(0);
        expect(customSummary.groups[0]?.definitionHistory[1]?.definitionChangeKind).toBe("DEFINITION_CHANGED");
    });
});
