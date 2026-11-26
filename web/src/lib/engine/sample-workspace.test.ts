import { describe, expect, it } from "bun:test";
import { analyzeLocalDraft } from "./analyzer";
import { buildSampleWorkspaceFiles } from "./sample-workspace";
import { buildWorkspaceBehaviorHistory } from "./workspace-behaviors";
import { buildWorkspaceRelationGraph } from "./workspace-relations";

describe("sample-workspace (multi-file demo suite)", () => {
    it("contains 6 clean library files, 2 clean 0-error drafts, and 2 drafts with 1-2 targeted errors", async () => {
        const files = buildSampleWorkspaceFiles();

        expect(files.length).toBe(10);
        expect(files.filter((f) => f.isLibrary).length).toBe(6);
        expect(files.filter((f) => !f.isLibrary).length).toBe(4);

        for (const file of files) {
            const analysis = await analyzeLocalDraft(file.content, files, {
                currentPath: file.path,
                includeAi: false,
            });
            const codes = analysis.diagnostics.map((d) => d.code);

            if (file.isLibrary) {
                if (file.path.includes("100-2019") || file.path.includes("123-2021")) {
                    expect({ path: file.path, codes }).toEqual({ path: file.path, codes: ["LG011"] });
                } else {
                    expect({ path: file.path, codes }).toEqual({ path: file.path, codes: [] });
                }
            } else if (file.path.endsWith("-chuan.txt")) {
                expect({ path: file.path, codes }).toEqual({ path: file.path, codes: [] });
                expect(analysis.metrics.overallScore).toBe(100);
            } else if (file.path === "du-thao-sua-doi-toc-do-2-loi.txt") {
                expect(codes).toContain("LP003");
                expect(codes).toContain("LP001");
                expect(codes.length).toBe(2);
            } else if (file.path === "du-thao-sua-doi-168-2024-loi-quan-he.txt") {
                expect(codes).toContain("LG011");
                expect(codes.length).toBeLessThanOrEqual(2);
            }
        }
    });

    it("demonstrates relation graph violations and multi-version behavior history", () => {
        const files = buildSampleWorkspaceFiles();
        const graph = buildWorkspaceRelationGraph(files);

        expect(graph.summary.replacedCount).toBeGreaterThanOrEqual(1);
        expect(graph.summary.amendedCount).toBeGreaterThanOrEqual(1);
        expect(graph.summary.violationCount).toBeGreaterThanOrEqual(1);

        const behaviors = buildWorkspaceBehaviorHistory(files, graph);
        const redLightCar = behaviors.groups.find(
            (g) => g.canonicalKey.startsWith("vuot_den_do") && g.vehicleOrSubject === "Xe ô tô",
        );

        expect(redLightCar).toBeDefined();
        expect(redLightCar?.versions.length).toBeGreaterThanOrEqual(4);
    });
});
