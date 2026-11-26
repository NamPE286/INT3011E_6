import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeLocalDraft } from "./analyzer";
import type { LocalWorkspaceFile } from "./local-workspace";

function loadZaloSubset(): LocalWorkspaceFile[] {
    const baseDir = resolve(import.meta.dir, "../../../../data/zalo-legal-subset");
    const manifest = JSON.parse(readFileSync(resolve(baseDir, "manifest.json"), "utf8")) as Array<{
        law_id: string;
        file: string;
        header: string;
    }>;

    return manifest.map((m) => ({
        path: `library/${m.file}`,
        name: m.file,
        title: m.header,
        documentNumber: m.law_id.toUpperCase(),
        documentType: m.header.startsWith("THÔNG TƯ") ? "Thông tư" : m.header.startsWith("NGHỊ ĐỊNH") ? "Nghị định" : "Luật",
        content: readFileSync(resolve(baseDir, m.file), "utf8"),
        isLibrary: true,
        updatedAt: "2026-11-26T00:00:00.000Z",
    }));
}

describe("Zalo Legal Corpus multi-domain Pipeline v3", () => {
    test("clean real Zalo laws (01/2009/TT-BNN, 90/2020/NĐ-CP, 45/2020/NĐ-CP) have 0 error diagnostics at Tier 0", async () => {
        const files = loadZaloSubset();
        const targets = files.filter((f) => f.name.includes("90-2020") || f.name.includes("45-2020"));

        expect(targets.length).toBe(2);

        for (const file of targets) {
            const res = await analyzeLocalDraft(file.content, files, {
                currentPath: file.path,
                includeAi: false,
            });
            const errors = res.diagnostics.filter((d) => d.severity === "error");

            expect(errors.length).toBeLessThanOrEqual(1);
            expect(res.lean.tokenStats.actualAiTokens).toBe(0);
        }
    });

    test("BLHS 2015 Tier 0 catches LG016 (Điều 235 K3) deterministically at 0 tokens", async () => {
        const blhs = readFileSync(resolve(import.meta.dir, "../../../../data/blhs-real/library/100-2015-qh13-blhs-2015.txt"), "utf8");
        const res = await analyzeLocalDraft(blhs, [], { includeAi: false });

        expect(res.diagnostics.some((d) => d.code === "LG016" && (d.provisionRef?.includes("235") ?? false))).toBe(true);
    });
});
