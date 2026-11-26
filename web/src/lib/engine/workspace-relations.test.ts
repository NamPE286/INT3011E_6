import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LocalWorkspaceFile } from "./local-workspace";
import { parseDraftDocument } from "./parser";
import { auditDraftReferencesAndBases, buildWorkspaceRelationGraph } from "./workspace-relations";

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

describe("workspace-relations on real traffic law corpus", () => {
    it("detects 23/2008/QH12 as REPLACED by 36/2024/QH15 and 35/2024/QH15", () => {
        const files = loadTrafficLawWorkspace();
        const graph = buildWorkspaceRelationGraph(files);

        const law2008 = graph.nodes.find((n) => n.documentNumber === "23/2008/QH12");
        expect(law2008).toBeDefined();
        expect(law2008?.status).toBe("REPLACED");
        expect(law2008?.replacedBy).toContain("36/2024/QH15");
        expect(law2008?.replacedBy).toContain("35/2024/QH15");

        const nd100 = graph.nodes.find((n) => n.documentNumber === "100/2019/NĐ-CP");
        const nd123 = graph.nodes.find((n) => n.documentNumber === "123/2021/NĐ-CP");
        expect(nd100?.status).toBe("PARTIALLY_REPEALED");
        expect(nd123?.status).toBe("PARTIALLY_REPEALED");
    });

    it("detects LG010 (wrong Căn cứ order) and LG011 (citing replaced 23/2008/QH12) on the test draft", () => {
        const files = loadTrafficLawWorkspace();
        const draftFile = files.find((f) => !f.isLibrary)!;
        const graph = buildWorkspaceRelationGraph(files, draftFile.path, draftFile.content);
        const parsed = parseDraftDocument(draftFile.content);
        const diags = auditDraftReferencesAndBases(parsed, graph, draftFile.path);

        const codes = diags.map((d) => d.code);
        expect(codes).toContain("LG011");
        expect(codes).toContain("LG010");
    });
});
