import { describe, expect, it } from "bun:test";
import { analyzeLocalDraft } from "./analyzer";
import { runLocalDebugSimulation } from "./debug";
import { INCREMENTAL_CACHE_TEST_CASE, LEXIDE_TEST_CASES } from "./lexide-test-cases";
import { IncrementalLlmCache } from "./llm-incremental";
import type { LocalWorkspaceFile } from "./local-workspace";
import { buildSampleLibraryZip, extractLawsFromZipArchive } from "./zip-library";

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

describe("LexIDE curated test suite (clean & defective cases)", () => {
    for (const testCase of LEXIDE_TEST_CASES) {
        it(`${testCase.id}: ${testCase.name}`, async () => {
            const wsFiles = testCase.useSampleLibrary ? await loadSampleLibraryFiles() : [];
            const result = await analyzeLocalDraft(testCase.content, wsFiles, { includeAi: false });
            const actualCodes = new Set(result.diagnostics.map((diag) => diag.code));

            if (testCase.group === "CLEAN") {
                expect(result.diagnostics).toEqual([]);
                expect(result.lean?.refutedCount).toBe(0);
            }

            for (const expectedCode of testCase.expectedStaticCodes) {
                expect(actualCodes.has(expectedCode)).toBe(true);
            }

            for (const forbiddenCode of testCase.forbiddenStaticCodes ?? []) {
                expect(actualCodes.has(forbiddenCode)).toBe(false);
            }

            if (typeof testCase.expectedMinScore === "number") {
                expect(result.metrics.overallScore).toBeGreaterThanOrEqual(testCase.expectedMinScore);
            }

            if (typeof testCase.expectedMaxScore === "number") {
                expect(result.metrics.overallScore).toBeLessThanOrEqual(testCase.expectedMaxScore);
            }

            if (testCase.debugScenario) {
                const debugRes = await runLocalDebugSimulation({
                    content: testCase.content,
                    scenario: testCase.debugScenario.scenario,
                    workspaceFiles: wsFiles,
                });

                expect(debugRes.verdict.outcome).toBe(testCase.debugScenario.expectedOutcome);

                for (const exploitedCode of testCase.debugScenario.expectedExploitedCodes ?? []) {
                    expect(debugRes.verdict.exploitedDefects.some((defect) => defect.code === exploitedCode)).toBe(true);
                }
            }
        });
    }

    it(`${INCREMENTAL_CACHE_TEST_CASE.id}: incremental cache sends only new clause and reuses unchanged units`, async () => {
        const cache = new IncrementalLlmCache();
        const sentInputs: string[] = [];

        const fakeFetch = (async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as { input?: string };
            const input = body.input ?? "";
            sentInputs.push(input);

            const facts = [];

            if (input.includes("đi ngược chiều")) {
                facts.push({
                    quote: "Nghiêm cấm điều khiển phương tiện đi ngược chiều trên đường cao tốc, trừ trường hợp đặc biệt",
                    subject: "INDIVIDUAL",
                    modality: "PROHIBITED",
                    actionKey: "di_nguoc_chieu_cao_toc",
                    fineMin: null,
                    fineMax: null,
                    thresholdUnit: null,
                    thresholdMin: null,
                    thresholdMax: null,
                    hasSanction: false,
                    hasOpenException: true,
                    hasExceptionCriteria: false,
                    referencedTerms: ["đường cao tốc"],
                });
            }

            return new Response(JSON.stringify({ output_text: JSON.stringify({ facts }) }), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }) as unknown as typeof fetch;

        const round1 = await analyzeLocalDraft(INCREMENTAL_CACHE_TEST_CASE.baseDraft, [], {
            includeAi: true,
            useDecisionApi: false,
            apiKey: "sk-unit-test-only",
            model: "gemini-3.5-flash-lite",
            incrementalCache: cache,
            fetcher: fakeFetch,
        });

        expect(sentInputs.length).toBe(1);
        expect(round1.lean?.tokenStats.aiEscalatedClauses).toBe(1);

        const updatedDraft = `${INCREMENTAL_CACHE_TEST_CASE.baseDraft}\n${INCREMENTAL_CACHE_TEST_CASE.appendedClause}`;
        const round2 = await analyzeLocalDraft(updatedDraft, [], {
            includeAi: true,
            useDecisionApi: false,
            apiKey: "sk-unit-test-only",
            model: "gemini-3.5-flash-lite",
            incrementalCache: cache,
            fetcher: fakeFetch,
        });

        expect(sentInputs.length).toBe(2);
        expect(sentInputs[1]).not.toContain("báo hiệu đường bộ");
        expect(sentInputs[1]).toContain("đi ngược chiều");
        expect(round2.lean?.tokenStats.aiEscalatedClauses).toBe(1);
        expect(round2.diagnostics.some((diag) => diag.source === "AI" && diag.code === "LP002")).toBe(true);

        const round3 = await analyzeLocalDraft(updatedDraft, [], {
            includeAi: true,
            useDecisionApi: false,
            apiKey: "sk-unit-test-only",
            model: "gemini-3.5-flash-lite",
            incrementalCache: cache,
            fetcher: fakeFetch,
        });

        expect(sentInputs.length).toBe(2);
        expect(round3.lean?.tokenStats.actualAiTokens).toBe(0);
    });
});
