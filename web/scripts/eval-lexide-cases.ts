/**
 * Live evaluation of LexIDE test cases (clean + defective) against OpenAI (default: gpt-5.4).
 *
 * Usage:
 *   OPENAI_API_KEY=... OPENAI_MODEL=gpt-5.4 bun run scripts/eval-lexide-cases.ts
 */
import { analyzeLocalDraft } from "../src/lib/engine/analyzer";
import { runLocalDebugSimulation } from "../src/lib/engine/debug";
import { INCREMENTAL_CACHE_TEST_CASE, LEXIDE_TEST_CASES } from "../src/lib/engine/lexide-test-cases";
import { IncrementalLlmCache } from "../src/lib/engine/llm-incremental";
import type { LocalWorkspaceFile } from "../src/lib/engine/local-workspace";
import { buildSampleLibraryZip, extractLawsFromZipArchive } from "../src/lib/engine/zip-library";

const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
const model = process.env.OPENAI_MODEL?.trim() || "gpt-5.4";

if (!apiKey) {
    console.error("ERROR: Missing OPENAI_API_KEY environment variable.");
    process.exit(1);
}

async function loadSampleLibraryFiles(): Promise<LocalWorkspaceFile[]> {
    const { laws } = await extractLawsFromZipArchive(buildSampleLibraryZip());

    return laws.map((law, idx) => ({
        path: `library/sample-${idx}.txt`,
        name: `sample-${idx}.txt`,
        title: law.title,
        documentNumber: law.documentNumber,
        documentType: law.documentType,
        content: law.content,
        isLibrary: true,
        updatedAt: "2026-01-01T00:00:00.000Z",
    }));
}

async function main(): Promise<void> {
    const sampleFiles = await loadSampleLibraryFiles();
    console.log(`Running LexIDE live suite with model=${model} (${LEXIDE_TEST_CASES.length} core cases + 1 incremental cache case)...\n`);

    let passedCount = 0;
    let totalCases = 0;

    for (const testCase of LEXIDE_TEST_CASES) {
        totalCases += 1;
        const wsFiles = testCase.useSampleLibrary ? sampleFiles : [];

        const staticRes = await analyzeLocalDraft(testCase.content, wsFiles, { includeAi: false });
        const aiStart = Date.now();
        const aiRes = await analyzeLocalDraft(testCase.content, wsFiles, {
            includeAi: true,
            apiKey,
            model,
        });
        const aiDurationMs = Date.now() - aiStart;

        const staticCodes = [...new Set(staticRes.diagnostics.map((d) => d.code))];
        const aiOnlyDiags = aiRes.diagnostics.filter((d) => d.source === "AI");
        const aiOnlyCodes = [...new Set(aiOnlyDiags.map((d) => d.code))];
        const allCodesSet = new Set(aiRes.diagnostics.map((d) => d.code));

        const missingStatic = testCase.expectedStaticCodes.filter((code) => !staticCodes.includes(code));
        const missingAi = (testCase.expectedAiCodes ?? []).filter((code) => !aiOnlyCodes.includes(code) && !allCodesSet.has(code));

        let debugSummary = "-";
        let debugPassed = true;

        if (testCase.debugScenario) {
            const dbg = await runLocalDebugSimulation({
                content: testCase.content,
                scenario: testCase.debugScenario.scenario,
                workspaceFiles: wsFiles,
                useAi: true,
                apiKey,
                model,
            });
            debugSummary = `${dbg.verdict.outcome} (${dbg.method})`;
            debugPassed = dbg.verdict.outcome === testCase.debugScenario.expectedOutcome;
        }

        const aiOk = aiRes.aiStatus.error === null;
        const cleanOk = testCase.group === "CLEAN" ? staticCodes.length === 0 && aiOnlyCodes.length === 0 : true;
        const casePassed = aiOk && missingStatic.length === 0 && missingAi.length === 0 && debugPassed && cleanOk;

        if (casePassed) {
            passedCount += 1;
        }

        const statusLabel = casePassed ? "PASS" : aiOk ? "WARN" : "FAIL";
        console.log(
            `[${statusLabel}] ${testCase.id} (${testCase.group}) | Score: ${staticRes.metrics.overallScore} -> ${aiRes.metrics.overallScore} | Static: [${staticCodes.join(",") || "none"}] | AI-derived: [${aiOnlyCodes.join(",") || "none"}] | Lean: ${aiRes.lean?.provedCount ?? 0}✓/${aiRes.lean?.refutedCount ?? 0}✗ | Tokens: ${aiRes.lean?.tokenStats.actualAiTokens ?? 0} | Time: ${aiDurationMs}ms | Debug: ${debugSummary}`,
        );

        if (aiRes.aiStatus.error) {
            console.log(`   AI Error: ${aiRes.aiStatus.error}`);
        }

        if (missingStatic.length > 0) {
            console.log(`   Missing expected static codes: ${missingStatic.join(", ")}`);
        }

        if (missingAi.length > 0) {
            console.log(`   Missing expected AI codes: ${missingAi.join(", ")}`);
        }

        if (!debugPassed && testCase.debugScenario) {
            console.log(`   Debug mismatch: expected ${testCase.debugScenario.expectedOutcome}, got ${debugSummary}`);
        }

        if (aiOnlyDiags.length > 0) {
            for (const diag of aiOnlyDiags) {
                console.log(`   -> AI [${diag.code}] (${diag.provisionRef ?? "?"}): ${diag.title} | Lean: ${diag.leanTheorem ?? "-"}`);
            }
        }
    }

    totalCases += 1;
    const cache = new IncrementalLlmCache();
    const r1 = await analyzeLocalDraft(INCREMENTAL_CACHE_TEST_CASE.baseDraft, [], {
        includeAi: true,
        apiKey,
        model,
        incrementalCache: cache,
    });
    const updated = `${INCREMENTAL_CACHE_TEST_CASE.baseDraft}\n${INCREMENTAL_CACHE_TEST_CASE.appendedClause}`;
    const r2 = await analyzeLocalDraft(updated, [], {
        includeAi: true,
        apiKey,
        model,
        incrementalCache: cache,
    });
    const r3 = await analyzeLocalDraft(updated, [], {
        includeAi: true,
        apiKey,
        model,
        incrementalCache: cache,
    });

    const incPassed =
        r1.aiStatus.error === null &&
        r2.aiStatus.error === null &&
        r3.aiStatus.error === null &&
        (r2.lean?.tokenStats.aiEscalatedClauses ?? 0) === 1 &&
        (r3.lean?.tokenStats.actualAiTokens ?? -1) === 0;

    if (incPassed) {
        passedCount += 1;
    }

    console.log(
        `[${incPassed ? "PASS" : "FAIL"}] ${INCREMENTAL_CACHE_TEST_CASE.id} | R1 sent=${r1.lean?.tokenStats.aiEscalatedClauses ?? 0} tok=${r1.lean?.tokenStats.actualAiTokens ?? 0} | R2 sent=${r2.lean?.tokenStats.aiEscalatedClauses ?? 0} tok=${r2.lean?.tokenStats.actualAiTokens ?? 0} | R3 sent=${r3.lean?.tokenStats.aiEscalatedClauses ?? 0} tok=${r3.lean?.tokenStats.actualAiTokens ?? 0} | R2 AI codes=[${[...new Set(r2.diagnostics.filter((d) => d.source === "AI").map((d) => d.code))].join(",") || "none"}]`,
    );

    console.log(`\nSummary: ${passedCount}/${totalCases} cases passed cleanly with ${model}.`);
}

await main();
