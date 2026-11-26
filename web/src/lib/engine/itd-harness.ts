import { analyzeLocalDraft } from "./analyzer";
import { runLocalDebugSimulation } from "./debug";
import { callGeminiDecisions, DEFAULT_GEMINI_MODEL } from "./gemini-client";
import type { LocalWorkspaceFile } from "./local-workspace";
import { parseDraftDocument } from "./parser";
import type { DebugGroundedCitation, DiagnosticCategory, VerdictOutcome } from "./types";

export type ItdLoopholeInput = {
    caseId: string;
    draftContent: string;
    workspaceFiles?: readonly LocalWorkspaceFile[];
    currentPath?: string;
    useAi?: boolean;
    useDecisionApi?: boolean;
    apiKey?: string;
    apiBaseUrl?: string;
    model?: string;
    fetcher?: typeof fetch;
};

export type ItdLoopholeFinding = {
    code: string;
    category: DiagnosticCategory;
    provisionRef: string;
    verbatimQuote: string;
    exploitScenario: string;
};

export type ItdLoopholeResult = {
    output: {
        caseId: string;
        hasLoophole: boolean;
        workspaceOnly: true;
        findings: ItdLoopholeFinding[];
    };
    usage: {
        inputTokens: number;
        outputTokens: number;
        decisionInputTokens: number;
        llmCalls: number;
        durationMs: number;
        modelUsed: string;
    };
};

export type ItdLiveJudgeInput = {
    caseId: string;
    draftContent: string;
    scenario: string;
    workspaceFiles?: readonly LocalWorkspaceFile[];
    currentPath?: string;
    useAi?: boolean;
    apiKey?: string;
    apiBaseUrl?: string;
    model?: string;
    fetcher?: typeof fetch;
};

export type ItdLiveJudgeResult = {
    output: {
        caseId: string;
        outcome: VerdictOutcome;
        abstained: boolean;
        applicableFine: { min: number; max: number } | null;
        nonMonetarySanctions: string[];
        detectedDefectCodes: string[];
        citations: { provisionRef: string; verbatimQuote: string }[];
        reasoning: string;
        workspaceOnly: true;
    };
    usage: {
        inputTokens: number;
        outputTokens: number;
        decisionInputTokens: number;
        llmCalls: number;
        durationMs: number;
        modelUsed: string;
    };
};

function normalizeWs(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

function anchorQuoteInCorpus(
    rawQuote: string,
    draftContent: string,
    workspaceFiles: readonly LocalWorkspaceFile[],
): string | null {
    const clean = rawQuote.trim();

    if (clean.length < 2) {
        return null;
    }

    const sources = [draftContent, ...workspaceFiles.map((f) => f.content)];

    for (const src of sources) {
        if (src.includes(clean)) {
            return clean;
        }

        const normSrc = normalizeWs(src);
        const normClean = normalizeWs(clean);

        if (normSrc.includes(normClean)) {
            return normClean;
        }
    }

    return null;
}

function groundCitationsStrict(
    rawCitations: readonly DebugGroundedCitation[],
    draftContent: string,
    workspaceFiles: readonly LocalWorkspaceFile[],
): { provisionRef: string; verbatimQuote: string }[] {
    const grounded: { provisionRef: string; verbatimQuote: string }[] = [];
    const seen = new Set<string>();

    for (const cit of rawCitations) {
        const anchored = anchorQuoteInCorpus(cit.verbatimQuote, draftContent, workspaceFiles);

        if (!anchored) {
            continue;
        }

        const key = `${cit.provisionRef}::${anchored}`;

        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        grounded.push({
            provisionRef: cit.provisionRef,
            verbatimQuote: anchored,
        });
    }

    return grounded;
}

/**
 * ITD Harness — Loophole Detection Layer (Channel 1 Symbolic + Channel 2 Lean 4 +
 * Channel 3 Decision API Triage + Channel 4 Compact Flash-Lite Extractor + Verbatim Gate).
 */
export async function runItdLoopholeDetector(input: ItdLoopholeInput): Promise<ItdLoopholeResult> {
    const startedAt = Date.now();
    const wsFiles = input.workspaceFiles ?? [];

    // Tier 0 + 1 Deterministic Symbolic + Lean 4 pass first (0 tokens, ~1-5 ms)
    const staticAnalysis = await analyzeLocalDraft(input.draftContent, wsFiles, {
        currentPath: input.currentPath,
        detectDeonticStatic: true,
        includeAi: false,
    });
    const staticSubstantive = staticAnalysis.diagnostics.filter((d) => d.severity !== "info");

    // Channel 3 (Decision API triage) + Channel 4 (Flash-Lite deep escalation) ONLY when requested
    // AND Tier 0+1 found 0 substantive issues.
    let analysis = staticAnalysis;
    let triageDecisionTokens = 0;
    let triageLlmCalls = 0;

    if (staticSubstantive.length === 0 && input.useAi && input.apiKey?.trim()) {
        let shouldEscalateToFlashLite = input.useDecisionApi === false;

        if (input.useDecisionApi !== false) {
            try {
                const triageRes = await callGeminiDecisions({
                    apiKey: input.apiKey,
                    apiBaseUrl: input.apiBaseUrl,
                    input: input.draftContent.slice(0, 6000),
                    questions: {
                        has_implicit_defect: {
                            type: "noul",
                            instructions:
                                "Does this Vietnamese legal/contract text contain a clear internal logical contradiction, impossible conjunctive condition, or severe unpenalized loophole/ambiguity? Answer NO for well-structured standard clauses with contiguous thresholds and clear remedies.",
                        },
                    },
                    fetcher: input.fetcher,
                });
                triageDecisionTokens += triageRes.usage.inputTokens;
                triageLlmCalls += 1;
                const ans = triageRes.answers.has_implicit_defect;

                if (ans && ans.type === "noul" && ans.noul >= 0.72 && ans.confidence >= 0.75) {
                    shouldEscalateToFlashLite = true;
                }
            } catch {
                shouldEscalateToFlashLite = false;
            }
        }

        if (shouldEscalateToFlashLite) {
            analysis = await analyzeLocalDraft(input.draftContent, wsFiles, {
                currentPath: input.currentPath,
                detectDeonticStatic: true,
                includeAi: true,
                useDecisionApi: false,
                deepNeuroSymbolic: true,
                apiKey: input.apiKey,
                apiBaseUrl: input.apiBaseUrl,
                model: input.model ?? DEFAULT_GEMINI_MODEL,
                fetcher: input.fetcher,
            });
        }
    }

    const durationMs = Math.max(1, Date.now() - startedAt);
    const parsed = parseDraftDocument(input.draftContent);
    // Keep all static error/warning findings, and only AI findings that are formal Lean-refuted errors
    const substantive = analysis.diagnostics.filter((d) => {
        if (d.source === "AI") {
            return d.severity === "error" && Boolean(d.leanTheorem);
        }

        return d.severity !== "info";
    });
    const findings: ItdLoopholeFinding[] = [];
    const seenKey = new Set<string>();

    for (const diag of substantive) {
        const provisionRef = diag.provisionRef ?? `Dòng ${diag.range.startLine}`;
        const node = parsed.nodes.find((n) => n.refLabel === provisionRef);
        const rawQuote = diag.excerpt.trim() || (node?.text.split("\n")[0]?.trim() ?? "");
        const anchored = anchorQuoteInCorpus(rawQuote, input.draftContent, wsFiles)
            ?? (node ? anchorQuoteInCorpus(node.text.split("\n")[0]?.trim() ?? "", input.draftContent, wsFiles) : null);

        if (!anchored) {
            continue;
        }

        const dedupeKey = `${diag.code}::${provisionRef}::${anchored}`;

        if (seenKey.has(dedupeKey)) {
            continue;
        }

        seenKey.add(dedupeKey);
        findings.push({
            code: diag.code,
            category: diag.category,
            provisionRef,
            verbatimQuote: anchored,
            exploitScenario: diag.exploitScenario || diag.message,
        });
    }

    const breakdown = analysis.lean.tokenStats.tokenBreakdown;
    const rawActualTokens = analysis.lean.tokenStats.actualAiTokens;
    const inputTokens = breakdown?.extractInputTokens ?? (rawActualTokens > 0 ? Math.round(rawActualTokens * 0.7) : 0);
    const outputTokens = breakdown?.extractOutputTokens ?? (rawActualTokens > 0 ? Math.max(0, rawActualTokens - inputTokens) : 0);
    const decisionInputTokens = triageDecisionTokens + (breakdown?.decisionInputTokens ?? 0);
    const deepCalls = analysis.aiStatus.used && rawActualTokens > 0 ? 1 : 0;
    const llmCalls = triageLlmCalls + deepCalls;

    return {
        output: {
            caseId: input.caseId,
            hasLoophole: findings.length > 0,
            workspaceOnly: analysis.workspaceScope.strictlyWorkspaceOnly,
            findings,
        },
        usage: {
            inputTokens,
            outputTokens,
            decisionInputTokens,
            llmCalls,
            durationMs,
            modelUsed: deepCalls > 0
                ? (input.model ?? DEFAULT_GEMINI_MODEL)
                : triageLlmCalls > 0
                    ? "gemini-decision-1"
                    : "deterministic-lean",
        },
    };
}

/**
 * ITD Harness — Live Judge Layer (Channel 1 Symbolic + Channel 2 Lean 4 Formal Kernel +
 * Channel 4 Single-Pass Compact Flash-Lite Paraphrase Mapper + Code/Regex Verbatim Citation Gate).
 */
export async function runItdLiveJudge(input: ItdLiveJudgeInput): Promise<ItdLiveJudgeResult> {
    const startedAt = Date.now();
    const wsFiles = input.workspaceFiles ?? [];
    const sim = await runLocalDebugSimulation({
        content: input.draftContent,
        scenario: input.scenario,
        workspaceFiles: wsFiles,
        currentPath: input.currentPath,
        useAi: Boolean(input.useAi && input.apiKey?.trim()),
        useDecisionGate: Boolean(input.useAi && input.apiKey?.trim()),
        skipVerdictRefinement: true,
        apiKey: input.apiKey,
        apiBaseUrl: input.apiBaseUrl,
        model: input.model ?? DEFAULT_GEMINI_MODEL,
        fetcher: input.fetcher,
    });
    const durationMs = Math.max(1, Date.now() - startedAt);
    const citations = groundCitationsStrict(sim.verdict.citations ?? [], input.draftContent, wsFiles);
    const defectCodes = [...new Set([
        ...sim.verdict.exploitedDefects.map((d) => d.code),
        ...sim.ambiguities.map((a) => a.code),
    ])];

    // Hard Gate safety guard: never emit inverted monetary fine bounds
    const safeFine = sim.verdict.applicableFine && sim.verdict.applicableFine.min <= sim.verdict.applicableFine.max
        ? sim.verdict.applicableFine
        : null;

    const nonMonetarySanctions = [...new Set([
        ...(sim.verdict.nonMonetarySanctions?.map((s) => s.label) ?? []),
        ...sim.verdict.additionalSanctions,
    ])];
    const abstained = sim.verdict.outcome === "CONFLICT_AMBIGUOUS";
    const usage = sim.tokenUsage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0, decisionInputTokens: 0 };
    const llmCalls = sim.llmCalls ?? 0;

    return {
        output: {
            caseId: input.caseId,
            outcome: sim.verdict.outcome,
            abstained,
            applicableFine: safeFine,
            nonMonetarySanctions,
            detectedDefectCodes: defectCodes,
            citations,
            reasoning: sim.verdict.summary,
            workspaceOnly: sim.workspaceOnly,
        },
        usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            decisionInputTokens: usage.decisionInputTokens ?? 0,
            llmCalls,
            durationMs,
            modelUsed: llmCalls > 0 ? (input.model ?? DEFAULT_GEMINI_MODEL) : "deterministic-lean",
        },
    };
}
