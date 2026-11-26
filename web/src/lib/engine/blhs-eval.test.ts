import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeLocalDraft } from "./analyzer";
import type { LocalWorkspaceFile } from "./local-workspace";
import { buildWorkspaceBehaviorHistory } from "./workspace-behaviors";
import { buildWorkspaceRelationGraph } from "./workspace-relations";

function loadBlhsFiles(): LocalWorkspaceFile[] {
    const baseDir = resolve(import.meta.dir, "../../../../data/blhs-real/library");
    const specs = [
        { file: "100-2015-qh13-blhs-2015.txt", title: "Bộ luật Hình sự 2015", docNum: "100/2015/QH13", docType: "Bộ luật" },
        { file: "12-2017-qh14-sua-doi-blhs.txt", title: "Luật sửa đổi, bổ sung một số điều của BLHS", docNum: "12/2017/QH14", docType: "Luật" },
        { file: "02-2018-nq-hdtp-an-treo.txt", title: "Nghị quyết hướng dẫn áp dụng Điều 65 BLHS về án treo", docNum: "02/2018/NQ-HĐTP", docType: "Nghị quyết" },
        { file: "86-2025-qh15-sua-doi-blhs-2025.txt", title: "Luật sửa đổi, bổ sung một số điều của BLHS 2025", docNum: "86/2025/QH15", docType: "Luật" },
    ];

    return specs.map((item) => ({
        path: `library/${item.file}`,
        name: item.file,
        title: item.title,
        documentNumber: item.docNum,
        documentType: item.docType,
        content: readFileSync(resolve(baseDir, item.file), "utf8"),
        isLibrary: true,
        updatedAt: "2026-11-25T00:00:00.000Z",
    }));
}

describe("BLHS real corpus deterministic Tier 0 & Decision v2", () => {
    test("relation graph links 12/2017, 86/2025, and 02/2018 to 100/2015/QH13 with proper hierarchy", () => {
        const files = loadBlhsFiles();
        const law86 = files[3];
        const graph = buildWorkspaceRelationGraph(files, law86.path, law86.content);

        const blhsNode = graph.nodes.find((n) => n.path.includes("100-2015"));
        const nqNode = graph.nodes.find((n) => n.path.includes("02-2018"));

        expect(blhsNode?.documentType).toBe("Bộ luật");
        expect(blhsNode?.hierarchyRank).toBe(2);
        expect(nqNode?.documentType).toBe("Nghị quyết");
        expect(nqNode?.hierarchyRank).toBe(4);
        expect(graph.edges.some((e) => e.fromPath.includes("12-2017") && (e.toPath?.includes("100-2015") ?? false))).toBe(true);
        expect(graph.edges.some((e) => e.fromPath.includes("86-2025") && (e.toPath?.includes("100-2015") ?? false))).toBe(true);
        expect(graph.edges.some((e) => e.fromPath.includes("02-2018") && e.relationType === "REPLACES")).toBe(true);
    });

    test("Tier 0 catches 5/7 real historic BLHS 2015 bugs with 0 tokens and minimal false positives", async () => {
        const files = loadBlhsFiles();
        const blhs2015 = files[0];
        const res = await analyzeLocalDraft(blhs2015.content, files, {
            currentPath: blhs2015.path,
            includeAi: false,
        });

        expect(res.lean.tokenStats.actualAiTokens).toBe(0);
        expect(res.diagnostics.some((d) => d.code === "LG002" && (d.provisionRef?.includes("326") ?? false))).toBe(true);
        expect(res.diagnostics.some((d) => d.code === "LG002" && (d.provisionRef?.includes("359") ?? false))).toBe(true);
        expect(res.diagnostics.some((d) => d.code === "LP003" && (d.provisionRef?.includes("305") ?? false) && (d.counterexample?.includes("30.5") ?? false))).toBe(true);
        expect(res.diagnostics.some((d) => d.code === "LG002" && (d.provisionRef?.includes("303") ?? false))).toBe(true);
        expect(res.diagnostics.some((d) => d.code === "LG008" && (d.provisionRef?.includes("389") ?? false) && (d.quickFix?.replacement === "Điều 304"))).toBe(true);

        // False positives eliminated
        expect(res.diagnostics.filter((d) => d.code === "LG009").length).toBe(0);
        expect(res.diagnostics.filter((d) => d.code === "LG013").length).toBe(0);
        expect(res.diagnostics.filter((d) => d.code === "LP002").length).toBe(0);
        expect(res.diagnostics.filter((d) => d.code === "LP005").length).toBe(0);
        expect(res.diagnostics.filter((d) => d.code === "AM003").length).toBe(0);
    });

    test("behavior history tracks 3-generation BLHS changes (2015 -> 2017 -> 2025)", () => {
        const files = loadBlhsFiles();
        const law86 = files[3];
        const graph = buildWorkspaceRelationGraph(files, law86.path, law86.content);
        const behaviors = buildWorkspaceBehaviorHistory(files, graph, new Map(), law86.path, law86.content);

        expect(behaviors.totalBehaviors).toBeGreaterThanOrEqual(10);
        expect(behaviors.withHistoryCount).toBeGreaterThanOrEqual(6);

        const d235 = behaviors.groups.find((g) => g.canonicalKey === "blhs_dieu_235::Cá nhân");
        const d292 = behaviors.groups.find((g) => g.canonicalKey === "blhs_dieu_292::Cá nhân");
        const d353 = behaviors.groups.find((g) => g.canonicalKey === "blhs_dieu_353::Cá nhân");

        expect(d235?.versions.length).toBe(3);
        expect(d292?.latestVersion.changeKind).toBe("REPEALED");
        expect(d353?.latestVersion.changeKind).toBe("SANCTION_RESTRUCTURED");
        expect(d353?.latestVersion.hasDeathPenalty).toBe(false);
    });
});
