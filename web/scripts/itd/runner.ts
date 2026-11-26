import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { analyzeLocalDraft } from "../../src/lib/engine/analyzer";
import { runLocalDebugSimulation } from "../../src/lib/engine/debug";
import { runItdLiveJudge, runItdLoopholeDetector } from "../../src/lib/engine/itd-harness";
import { parseDraftDocument } from "../../src/lib/engine/parser";
import {
    DEV_STUDENT_JUDGE_META,
    DEV_STUDENT_JUDGE_RAW,
    DEV_STUDENT_LOOPHOLE_META,
    DEV_STUDENT_LOOPHOLE_RAW,
    DEV_TEACHER_JUDGE_META,
    DEV_TEACHER_JUDGE_RAW,
    DEV_TEACHER_LOOPHOLE_META,
    DEV_TEACHER_LOOPHOLE_RAW,
    type CapturedBatchMeta,
} from "./dev-llm-baselines-data";
import { buildJudgeBlindDataset } from "./judge-blind-dataset";
import { buildJudgeDevDataset } from "./judge-dev-dataset";
import { buildLoopholeGoldenDataset } from "./loophole-dataset";
import {
    evaluateSplit,
    type EvaluatedJudgePair,
    type EvaluatedLoopholePair,
} from "./scoring";
import type {
    DatasetSplit,
    GroundedCitation,
    JudgeEvalCase,
    LiveJudgeOutput,
    LoopholeDetectorOutput,
    LoopholeEvalCase,
    SplitEvalReport,
} from "./types";

function extractVerbatimExcerpt(content: string, line: number, fallback: string): string {
    const cleanFallback = fallback.trim();

    if (cleanFallback.length >= 4 && content.includes(cleanFallback)) {
        return cleanFallback;
    }

    const lines = content.split("\n");
    const lineText = (lines[Math.max(0, line - 1)] ?? "").trim();

    if (lineText.length >= 4) {
        return lineText;
    }

    return content.slice(0, Math.min(80, content.length)).trim() || "Dự thảo";
}

export async function runLegacyV0Loophole(spec: LoopholeEvalCase): Promise<EvaluatedLoopholePair> {
    const startedAt = Date.now();
    const analysis = await analyzeLocalDraft(spec.draftContent, spec.workspaceFiles, {
        currentPath: spec.currentPath,
        includeAi: false,
    });
    const durationMs = Math.max(1, Date.now() - startedAt);
    const substantive = analysis.diagnostics.filter((d) => d.severity !== "info");

    const output: LoopholeDetectorOutput = {
        caseId: spec.caseId,
        hasLoophole: substantive.length > 0,
        workspaceOnly: analysis.workspaceScope.strictlyWorkspaceOnly,
        findings: substantive.map((d) => ({
            code: d.code,
            category: d.category,
            provisionRef: d.provisionRef ?? `Dòng ${d.range.startLine}`,
            verbatimQuote: extractVerbatimExcerpt(spec.draftContent, d.range.startLine, d.excerpt),
            exploitScenario: d.exploitScenario || d.message,
        })),
    };

    return {
        spec,
        rawOutput: output,
        usage: {
            inputTokens: 0,
            outputTokens: 0,
            decisionInputTokens: 0,
            llmCalls: 0,
            durationMs,
            modelUsed: "deterministic-lean",
        },
    };
}

export async function runLegacyV0Judge(spec: JudgeEvalCase): Promise<EvaluatedJudgePair> {
    const startedAt = Date.now();
    const sim = await runLocalDebugSimulation({
        content: spec.draftContent,
        scenario: spec.scenario,
        workspaceFiles: spec.workspaceFiles,
        currentPath: spec.currentPath,
        useAi: false,
    });
    const durationMs = Math.max(1, Date.now() - startedAt);
    const parsed = parseDraftDocument(spec.draftContent);
    const citations: GroundedCitation[] = [];
    const seenRefs = new Set<string>();

    for (const step of sim.trace) {
        if (seenRefs.has(step.provisionRef)) {
            continue;
        }

        const matchedNode = parsed.nodes.find((n) => n.refLabel === step.provisionRef);
        const quote = matchedNode
            ? matchedNode.text.split("\n")[0]?.trim() ?? ""
            : extractVerbatimExcerpt(spec.draftContent, step.line, "");

        if (quote.length >= 4 && spec.draftContent.includes(quote)) {
            seenRefs.add(step.provisionRef);
            citations.push({
                provisionRef: step.provisionRef,
                verbatimQuote: quote,
            });
        }
    }

    const defects = [...new Set([
        ...sim.verdict.exploitedDefects.map((d) => d.code),
        ...sim.ambiguities.map((a) => a.code),
    ])];

    const output: LiveJudgeOutput = {
        caseId: spec.caseId,
        outcome: sim.verdict.outcome,
        abstained: sim.verdict.outcome === "CONFLICT_AMBIGUOUS",
        applicableFine: sim.verdict.applicableFine,
        nonMonetarySanctions: [...sim.verdict.additionalSanctions],
        detectedDefectCodes: defects,
        citations,
        reasoning: sim.verdict.summary,
        workspaceOnly: sim.workspaceOnly,
    };

    return {
        spec,
        rawOutput: output,
        usage: {
            inputTokens: 0,
            outputTokens: 0,
            decisionInputTokens: 0,
            llmCalls: 0,
            durationMs,
            modelUsed: "deterministic-lean",
        },
    };
}

export async function runHarnessOnSplit(input: {
    version: string;
    armName: string;
    split: DatasetSplit;
    useAi?: boolean;
    apiKey?: string;
    model?: string;
}): Promise<SplitEvalReport> {
    const loopholeAll = buildLoopholeGoldenDataset().filter((c) => c.split === input.split);
    const judgeAll = input.split === "dev" ? buildJudgeDevDataset() : buildJudgeBlindDataset();
    const loopholePairs: EvaluatedLoopholePair[] = [];
    const judgePairs: EvaluatedJudgePair[] = [];

    for (const spec of loopholeAll) {
        if (input.version === "v0") {
            loopholePairs.push(await runLegacyV0Loophole(spec));
        } else {
            const res = await runItdLoopholeDetector({
                caseId: spec.caseId,
                draftContent: spec.draftContent,
                workspaceFiles: spec.workspaceFiles,
                currentPath: spec.currentPath,
                useAi: input.useAi,
                apiKey: input.apiKey,
                model: input.model,
            });
            loopholePairs.push({ spec, rawOutput: res.output, usage: res.usage });
        }
    }

    for (const spec of judgeAll) {
        if (input.version === "v0") {
            judgePairs.push(await runLegacyV0Judge(spec));
        } else {
            const res = await runItdLiveJudge({
                caseId: spec.caseId,
                draftContent: spec.draftContent,
                scenario: spec.scenario,
                workspaceFiles: spec.workspaceFiles,
                currentPath: spec.currentPath,
                useAi: input.useAi,
                apiKey: input.apiKey,
                model: input.model,
            });
            judgePairs.push({ spec, rawOutput: res.output, usage: res.usage });
        }
    }

    return evaluateSplit({
        armName: input.armName,
        harnessVersion: input.version,
        split: input.split,
        loopholePairs,
        judgePairs,
    });
}

export function scoreCapturedLlmBaseline(input: {
    armName: string;
    harnessVersion: string;
    split: DatasetSplit;
    loopholeRaw: readonly unknown[];
    loopholeMeta: CapturedBatchMeta;
    judgeRaw: readonly unknown[];
    judgeMeta: CapturedBatchMeta;
}): SplitEvalReport {
    const loopholeAll = buildLoopholeGoldenDataset().filter((c) => c.split === input.split);
    const judgeAll = input.split === "dev" ? buildJudgeDevDataset() : buildJudgeBlindDataset();

    const lhById = new Map<string, unknown>();

    for (const item of input.loopholeRaw) {
        if (typeof item === "object" && item !== null && typeof (item as { caseId?: unknown }).caseId === "string") {
            lhById.set((item as { caseId: string }).caseId, item);
        }
    }

    const jgById = new Map<string, unknown>();

    for (const item of input.judgeRaw) {
        if (typeof item === "object" && item !== null && typeof (item as { caseId?: unknown }).caseId === "string") {
            jgById.set((item as { caseId: string }).caseId, item);
        }
    }

    const lhPerCaseMs = Math.round(input.loopholeMeta.totalWallMs / Math.max(1, loopholeAll.length));
    const jgPerCaseMs = Math.round(input.judgeMeta.totalWallMs / Math.max(1, judgeAll.length));

    const loopholePairs: EvaluatedLoopholePair[] = loopholeAll.map((spec) => {
        const rawOutput = lhById.get(spec.caseId) ?? null;
        const promptChars = 1400 + spec.draftContent.length + spec.workspaceFiles.reduce((s, f) => s + f.content.length, 0);
        const outputChars = JSON.stringify(rawOutput ?? {}).length;

        return {
            spec,
            rawOutput,
            usage: {
                inputTokens: Math.ceil(promptChars / 3.2),
                outputTokens: Math.ceil(outputChars / 3.2) + input.loopholeMeta.thinkingTokensPerCaseEstimate,
                decisionInputTokens: 0,
                llmCalls: 1,
                durationMs: lhPerCaseMs,
                modelUsed: input.loopholeMeta.model,
            },
        };
    });

    const judgePairs: EvaluatedJudgePair[] = judgeAll.map((spec) => {
        const rawOutput = jgById.get(spec.caseId) ?? null;
        const promptChars = 1600 + spec.draftContent.length + spec.scenario.length + spec.workspaceFiles.reduce((s, f) => s + f.content.length, 0);
        const outputChars = JSON.stringify(rawOutput ?? {}).length;

        return {
            spec,
            rawOutput,
            usage: {
                inputTokens: Math.ceil(promptChars / 3.2),
                outputTokens: Math.ceil(outputChars / 3.2) + input.judgeMeta.thinkingTokensPerCaseEstimate,
                decisionInputTokens: 0,
                llmCalls: 1,
                durationMs: jgPerCaseMs,
                modelUsed: input.judgeMeta.model,
            },
        };
    });

    return evaluateSplit({
        armName: input.armName,
        harnessVersion: input.harnessVersion,
        split: input.split,
        loopholePairs,
        judgePairs,
    });
}

export function printSplitReport(report: SplitEvalReport): void {
    console.log(`\n=== ${report.armName} [${report.harnessVersion}] | split=${report.split} ===`);
    console.log(
        `Hard Gates: ${report.hardGates.passed ? "PASS" : "FAIL"}`
        + ` | Schema=${(report.hardGates.schemaValidityRate * 100).toFixed(1)}%`
        + ` | HallucinatedCit=${(report.hardGates.citationHallucinationRate * 100).toFixed(2)}%`
        + ` | InvertedBounds=${report.hardGates.invalidInvertedBoundsCount}`
        + ` | LiveJudgeP95=${report.hardGates.liveJudgeP95LatencyMs}ms`,
    );

    if (!report.hardGates.passed) {
        console.log(`  Hard Gate Failures: ${report.hardGates.failureReasons.join(" | ")}`);
    }

    console.log(
        `Loophole Detection: F1=${(report.loophole.f1Score * 100).toFixed(1)}%`
        + ` (P=${(report.loophole.precision * 100).toFixed(1)}%, R=${(report.loophole.recall * 100).toFixed(1)}%)`
        + ` | CleanNeg=${report.loophole.cleanNegativePassCount}/${report.loophole.negativeCases}`
        + ` | Loc=${(report.loophole.localizationRate * 100).toFixed(1)}%`,
    );
    console.log(
        `Live Judge: VerdictAcc=${(report.liveJudge.verdictAccuracy * 100).toFixed(1)}%`
        + ` | OutcomeAcc=${(report.liveJudge.outcomeAccuracy * 100).toFixed(1)}%`
        + ` | FineAcc=${(report.liveJudge.fineAccuracy * 100).toFixed(1)}%`
        + ` | NonMonAcc=${(report.liveJudge.nonMonetaryAccuracy * 100).toFixed(1)}%`
        + ` | DefectRec=${(report.liveJudge.defectRecall * 100).toFixed(1)}%`,
    );
    console.log(
        `  Consistency(3-way)=${report.liveJudge.consistencyGroupsPassed}/${report.liveJudge.consistencyGroupsTotal} (${(report.liveJudge.paraphraseConsistency * 100).toFixed(1)}%)`
        + ` | AbstentionAcc=${(report.liveJudge.abstentionAccuracy * 100).toFixed(1)}% (R=${(report.liveJudge.abstentionRecall * 100).toFixed(1)}%)`
        + ` | P50=${report.liveJudge.p50LatencyMs}ms P95=${report.liveJudge.p95LatencyMs}ms`,
    );
    console.log(
        `Soft Score: ${report.softScore}/100 | Tokens=${report.cost.totalTokens} | Calls=${report.cost.totalLlmCalls} | EstCost/req=$${report.cost.estimatedCostPerRequestUsd.toFixed(6)}`,
    );

    if (report.split === "dev" && report.devFailureLogs.length > 0) {
        console.log(`\nDev Failure Logs (${report.devFailureLogs.length} failures):`);

        for (const f of report.devFailureLogs) {
            console.log(`  [${f.task}] ${f.caseId} (${f.domain} / ${f.tag}): ${f.reason}`);
            console.log(`      expected=${f.expected} | actual=${f.actual}`);
        }
    }
}

if (import.meta.main) {
    const splitArg = process.argv.find((a) => a.startsWith("--split="))?.split("=")[1] as DatasetSplit | undefined;
    const harnessArg = process.argv.find((a) => a.startsWith("--harness="))?.split("=")[1] ?? "v1";
    const split: DatasetSplit = splitArg === "blind_test" ? "blind_test" : "dev";
    const apiKey = process.env.GEMINI_API_KEY?.trim() ?? "";

    if (harnessArg === "dev-baselines") {
        const teacher = scoreCapturedLlmBaseline({
            armName: "Teacher Baseline: Gemini 4 Neon (xhigh) Raw",
            harnessVersion: "teacher-raw",
            split: "dev",
            loopholeRaw: DEV_TEACHER_LOOPHOLE_RAW,
            loopholeMeta: DEV_TEACHER_LOOPHOLE_META,
            judgeRaw: DEV_TEACHER_JUDGE_RAW,
            judgeMeta: DEV_TEACHER_JUDGE_META,
        });
        const student = scoreCapturedLlmBaseline({
            armName: "Student Baseline: Gemini 3.5 Flash-Lite Raw",
            harnessVersion: "student-raw",
            split: "dev",
            loopholeRaw: DEV_STUDENT_LOOPHOLE_RAW,
            loopholeMeta: DEV_STUDENT_LOOPHOLE_META,
            judgeRaw: DEV_STUDENT_JUDGE_RAW,
            judgeMeta: DEV_STUDENT_JUDGE_META,
        });
        printSplitReport(teacher);
        printSplitReport(student);

        const outPath = resolve(import.meta.dir, "../../../data/eval/reports/itd-dev-llm-baselines.json");
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, JSON.stringify({ teacher, student }, null, 2), "utf8");
    } else {
        const report = await runHarnessOnSplit({
            version: harnessArg,
            armName: harnessArg === "v0"
                ? "LexIDE Baseline v0 (Pre-ITD)"
                : `Gemini 3.5 Flash-Lite + ITD Harness ${harnessArg}`,
            split,
            useAi: apiKey.length > 0,
            apiKey: apiKey || undefined,
        });
        printSplitReport(report);

        const outPath = resolve(import.meta.dir, `../../../data/eval/reports/itd-${harnessArg}-${split}.json`);
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
    }
}
