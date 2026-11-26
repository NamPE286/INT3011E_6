import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeLocalDraft } from "../src/lib/engine/analyzer";
import { IncrementalLlmCache } from "../src/lib/engine/llm-incremental";

const MAX_TOKEN_BUDGET = 150_000;

async function main(): Promise<void> {
    const apiKey = process.env.GEMINI_API_KEY?.trim() ?? "";

    if (!apiKey) {
        console.error("Missing GEMINI_API_KEY env var.");
        process.exit(1);
    }

    let totalTokensUsed = 0;

    // 1. Real 90/2020/NĐ-CP (25 articles, 34,207 chars)
    console.log("[1/2] Running Pipeline v4 (Neuro-Symbolic) on 90/2020/NĐ-CP...");
    const zalo90 = readFileSync(resolve(import.meta.dir, "../../data/zalo-legal-subset/90-2020-n-cp.txt"), "utf8");
    const cache90 = new IncrementalLlmCache();
    const t90Start = Date.now();
    const res90 = await analyzeLocalDraft(zalo90, [], {
        includeAi: true,
        useDecisionApi: true,
        deepNeuroSymbolic: true,
        apiKey,
        incrementalCache: cache90,
    });
    const ms90Cold = Date.now() - t90Start;
    totalTokensUsed += res90.lean.tokenStats.actualAiTokens;

    const t90WarmStart = Date.now();
    const res90Warm = await analyzeLocalDraft(zalo90, [], {
        includeAi: true,
        useDecisionApi: true,
        deepNeuroSymbolic: true,
        apiKey,
        incrementalCache: cache90,
    });
    const ms90Warm = Date.now() - t90WarmStart;
    totalTokensUsed += res90Warm.lean.tokenStats.actualAiTokens;

    // 2. Real BLHS 100/2015/QH13
    console.log("[2/2] Running Pipeline v4 (Neuro-Symbolic) on BLHS 100/2015/QH13...");
    const blhs = readFileSync(resolve(import.meta.dir, "../../data/blhs-real/library/100-2015-qh13-blhs-2015.txt"), "utf8");
    const cacheBlhs = new IncrementalLlmCache();
    const tBlhsStart = Date.now();
    const resBlhs = await analyzeLocalDraft(blhs, [], {
        includeAi: true,
        useDecisionApi: true,
        deepNeuroSymbolic: true,
        apiKey,
        incrementalCache: cacheBlhs,
    });
    const msBlhsCold = Date.now() - tBlhsStart;
    totalTokensUsed += resBlhs.lean.tokenStats.actualAiTokens;

    if (totalTokensUsed > MAX_TOKEN_BUDGET) {
        throw new Error(`Token budget exceeded: ${totalTokensUsed}`);
    }

    const report = {
        ranAt: new Date().toISOString(),
        totalTokensUsed,
        budgetCap: 500_000,
        zalo902020: {
            coldMs: ms90Cold,
            coldTokens: res90.lean.tokenStats.actualAiTokens,
            warmMs: ms90Warm,
            warmTokens: res90Warm.lean.tokenStats.actualAiTokens,
            leanRefutedCount: res90.lean.refutedCount,
            lg017Count: res90.diagnostics.filter((d) => d.code === "LG017").length,
            aiDerivedCount: res90.diagnostics.filter((d) => d.source === "AI").length,
            aiDiagnostics: res90.diagnostics
                .filter((d) => d.source === "AI" || d.code === "LG017")
                .map((d) => ({ code: d.code, ref: d.provisionRef, title: d.title, counterexample: d.counterexample ?? null })),
            aiError: res90.aiStatus.error,
        },
        blhs2015: {
            coldMs: msBlhsCold,
            coldTokens: resBlhs.lean.tokenStats.actualAiTokens,
            leanRefutedCount: resBlhs.lean.refutedCount,
            aiDerivedCount: resBlhs.diagnostics.filter((d) => d.source === "AI").length,
            aiDiagnostics: resBlhs.diagnostics
                .filter((d) => d.source === "AI" || d.code === "LG016" || d.code === "LG008")
                .map((d) => ({ code: d.code, ref: d.provisionRef, title: d.title })),
            aiError: resBlhs.aiStatus.error,
        },
    };

    const outDir = resolve(import.meta.dir, "../../data/eval/reports");
    mkdirSync(outDir, { recursive: true });
    const outPath = resolve(outDir, "neurosymbolic-v4-benchmark.json");
    writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
    console.log("DONE! Saved:", outPath);
    console.log("90/2020 -> cold:", ms90Cold, "ms,", res90.lean.tokenStats.actualAiTokens, "tok | warm:", ms90Warm, "ms,", res90Warm.lean.tokenStats.actualAiTokens, "tok | LG017:", report.zalo902020.lg017Count, "| AI+Lean:", report.zalo902020.aiDerivedCount);
    console.log("BLHS    -> cold:", msBlhsCold, "ms,", resBlhs.lean.tokenStats.actualAiTokens, "tok | AI+Lean:", report.blhs2015.aiDerivedCount);
}

void main();
