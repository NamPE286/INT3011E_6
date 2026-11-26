import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeLocalDraft } from "../src/lib/engine/analyzer";
import { IncrementalLlmCache } from "../src/lib/engine/llm-incremental";
import type { LocalWorkspaceFile } from "../src/lib/engine/local-workspace";
import { buildWorkspaceBehaviorHistory } from "../src/lib/engine/workspace-behaviors";
import { buildWorkspaceRelationGraph } from "../src/lib/engine/workspace-relations";

const MAX_TOKEN_BUDGET = 150_000;

function loadTrafficLawWorkspace(): LocalWorkspaceFile[] {
    const baseDir = resolve(import.meta.dir, "../../data/traffic-law-real");
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

async function main(): Promise<void> {
    const apiKey = process.env.GEMINI_API_KEY?.trim() ?? "";

    if (!apiKey) {
        console.error("Missing GEMINI_API_KEY env var.");
        process.exit(1);
    }

    const files = loadTrafficLawWorkspace();
    const draftFile = files.find((f) => !f.isLibrary)!;
    const cache = new IncrementalLlmCache();

    // Pass A: Tier 0 (0 tokens)
    const t0Start = Date.now();
    const tier0 = await analyzeLocalDraft(draftFile.content, files, {
        currentPath: draftFile.path,
        includeAi: false,
    });
    const relationGraph = buildWorkspaceRelationGraph(files, draftFile.path, draftFile.content);
    const behaviorSummary = buildWorkspaceBehaviorHistory(files, relationGraph, new Map(), draftFile.path, draftFile.content);
    const tier0Ms = Date.now() - t0Start;

    // Pass B+C: Tier 1 (Decision API) + Tier 2 (gemini-3.5-flash-lite)
    const t1Start = Date.now();
    const tier12 = await analyzeLocalDraft(draftFile.content, files, {
        currentPath: draftFile.path,
        includeAi: true,
        useDecisionApi: true,
        apiKey,
        model: "gemini-4-hydrogen",
        incrementalCache: cache,
    });
    const tier12Ms = Date.now() - t1Start;

    let totalTokensUsed = tier12.lean.tokenStats.actualAiTokens;

    if (totalTokensUsed > MAX_TOKEN_BUDGET) {
        throw new Error(`Token budget exceeded: ${totalTokensUsed}`);
    }

    // Pass D: Incremental edit (modify 1 clause, re-run)
    const editedContent = `${draftFile.content}\n6. Phạt tiền từ 500.000 đồng đến 1.000.000 đồng đối với hành vi không bật đèn chiếu sáng khi vào hầm đường bộ.`;
    const tIncStart = Date.now();
    const incRun = await analyzeLocalDraft(editedContent, files, {
        currentPath: draftFile.path,
        includeAi: true,
        useDecisionApi: true,
        apiKey,
        model: "gemini-4-hydrogen",
        incrementalCache: cache,
    });
    const incMs = Date.now() - tIncStart;
    totalTokensUsed += incRun.lean.tokenStats.actualAiTokens;

    const report = {
        ranAt: new Date().toISOString(),
        corpus: {
            files: files.length,
            totalChars: files.reduce((acc, f) => acc + f.content.length, 0),
        },
        tier0Deterministic: {
            tokens: 0,
            durationMs: tier0Ms,
            diagnosticsCount: tier0.diagnostics.length,
            diagnosticCodes: [...new Set(tier0.diagnostics.map((d) => d.code))],
            leanProved: tier0.lean.provedCount,
            leanRefuted: tier0.lean.refutedCount,
            relationNodes: relationGraph.summary.totalDocuments,
            relationEdges: relationGraph.summary.totalEdges,
            relationViolations: relationGraph.summary.violationCount,
            behaviorGroups: behaviorSummary.totalBehaviors,
            behaviorsWithHistory: behaviorSummary.withHistoryCount,
        },
        tier12GeminiFreeTier: {
            model: "gemini-4-hydrogen",
            decisionModel: "gemini-decision-1",
            durationMs: tier12Ms,
            actualAiTokens: tier12.lean.tokenStats.actualAiTokens,
            naiveFullTokens: tier12.lean.tokenStats.naiveFullTokens,
            savedPercent: tier12.lean.tokenStats.savedPercent,
            tokenBreakdown: tier12.lean.tokenStats.tokenBreakdown ?? null,
            aiError: tier12.aiStatus.error,
        },
        incrementalEditRun: {
            durationMs: incMs,
            actualAiTokens: incRun.lean.tokenStats.actualAiTokens,
            tokenBreakdown: incRun.lean.tokenStats.tokenBreakdown ?? null,
        },
        totalTokensUsed,
        budgetCap: 500_000,
    };

    const outDir = resolve(import.meta.dir, "../../data/eval/reports");
    mkdirSync(outDir, { recursive: true });
    const outPath = resolve(outDir, "traffic-law-gemini-benchmark.json");
    writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
    console.log(JSON.stringify(report, null, 2));
}

void main();
