import {
    LIVE_JUDGE_P95_BUDGET_MS,
    type CostEfficiencyMetrics,
    type DatasetSplit,
    type DevCaseFailureLog,
    type GroundedCitation,
    type HardGateResult,
    type JudgeEvalCase,
    type LiveJudgeMetrics,
    type LiveJudgeOutput,
    type LoopholeDetectorOutput,
    type LoopholeEvalCase,
    type LoopholeMetrics,
    type ParetoGateReport,
    type SplitEvalReport,
    type UsageTelemetry,
} from "./types";
import {
    computePercentile,
    estimateCostUsd,
    validateJudgeOutputSchema,
    validateLoopholeOutputSchema,
    verifyCitationsVerbatim,
    verifyNoInvertedBounds,
} from "./validators";

export type EvaluatedLoopholePair = {
    spec: LoopholeEvalCase;
    rawOutput: unknown;
    usage: UsageTelemetry;
};

export type EvaluatedJudgePair = {
    spec: JudgeEvalCase;
    rawOutput: unknown;
    usage: UsageTelemetry;
};

function normalizeRef(ref: string | null): string {
    return (ref ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function defectCodesEquivalent(expectedCode: string, actualCode: string): boolean {
    if (expectedCode === actualCode) {
        return true;
    }

    if (expectedCode === "DEONTIC_CONFLICT" && actualCode === "LG002") {
        return true;
    }

    if (expectedCode === "LG002" && actualCode === "DEONTIC_CONFLICT") {
        return true;
    }

    return false;
}

function provisionMatches(expectedRef: string | null, actualRef: string): boolean {
    if (!expectedRef) {
        return true;
    }

    const exp = normalizeRef(expectedRef);
    const act = normalizeRef(actualRef);

    if (act === exp || act.includes(exp) || exp.includes(act)) {
        return true;
    }

    const expArt = /điều\s+(\d+[a-zđ]?)/iu.exec(exp)?.[1];
    const actArt = /điều\s+(\d+[a-zđ]?)/iu.exec(act)?.[1];

    return Boolean(expArt && actArt && expArt === actArt);
}

function fineMatches(
    expected: { min: number; max: number } | null,
    actual: { min: number; max: number } | null,
): boolean {
    if (expected === null) {
        return actual === null;
    }

    return actual !== null && actual.min === expected.min && actual.max === expected.max;
}

function nonMonetaryMatches(
    expectedKeywords: readonly string[],
    actualSanctions: readonly string[],
    reasoning: string,
): boolean {
    if (expectedKeywords.length === 0) {
        return true;
    }

    const blob = `${actualSanctions.join(" ")} ${reasoning}`.toLowerCase();

    return expectedKeywords.every((kw) => blob.includes(kw.toLowerCase()));
}

/**
 * Evaluates a split across both Loophole Detection and Live Judge.
 * Anti-leakage guarantee: when `split === "blind_test"`, `devFailureLogs` is ALWAYS empty
 * so no optimization loop or human/agent can read Blind Test case failures.
 */
export function evaluateSplit(input: {
    armName: string;
    harnessVersion: string;
    split: DatasetSplit;
    loopholePairs: readonly EvaluatedLoopholePair[];
    judgePairs: readonly EvaluatedJudgePair[];
}): SplitEvalReport {
    const allowLogs = input.split === "dev";
    const devFailureLogs: DevCaseFailureLog[] = [];

    let totalSchemaChecked = 0;
    let totalSchemaValid = 0;
    let totalCitationsChecked = 0;
    let totalHallucinatedCitations = 0;
    let invalidInvertedBoundsCount = 0;
    let workspaceOnlyViolationCount = 0;

    // ------------------------------------------------------------------------
    // 1. LOOPHOLE DETECTION SCORING
    // ------------------------------------------------------------------------
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let cleanNegativePassCount = 0;
    let localizedExpected = 0;
    let totalExpectedDefects = 0;

    const positiveCases = input.loopholePairs.filter((p) => p.spec.polarity === "POSITIVE").length;
    const negativeCases = input.loopholePairs.filter((p) => p.spec.polarity === "NEGATIVE").length;

    for (const pair of input.loopholePairs) {
        totalSchemaChecked += 1;
        const schemaCheck = validateLoopholeOutputSchema(pair.rawOutput);

        if (!schemaCheck.valid || !schemaCheck.parsed) {
            if (pair.spec.polarity === "POSITIVE") {
                fn += Math.max(1, pair.spec.expectedDefects.length);
            } else {
                fp += 1;
            }

            if (allowLogs) {
                devFailureLogs.push({
                    task: "LOOPHOLE",
                    caseId: pair.spec.caseId,
                    domain: pair.spec.domain,
                    tag: pair.spec.mutationKind,
                    expected: pair.spec.expectedDefects.map((d) => d.code).join(",") || "CLEAN",
                    actual: `SCHEMA_INVALID: ${schemaCheck.errors.join("; ")}`,
                    reason: "Output failed strict JSON schema validation",
                    citationsChecked: 0,
                    hallucinatedCitations: 0,
                });
            }

            continue;
        }

        totalSchemaValid += 1;
        const output: LoopholeDetectorOutput = schemaCheck.parsed;

        if (!output.workspaceOnly) {
            workspaceOnlyViolationCount += 1;
        }

        const findingCitations: GroundedCitation[] = output.findings.map((f) => ({
            provisionRef: f.provisionRef,
            verbatimQuote: f.verbatimQuote,
        }));
        const citAudit = verifyCitationsVerbatim(findingCitations, pair.spec.draftContent, pair.spec.workspaceFiles);
        totalCitationsChecked += citAudit.totalChecked;
        totalHallucinatedCitations += citAudit.hallucinatedCount;

        if (pair.spec.polarity === "NEGATIVE") {
            if (output.findings.length === 0 && !output.hasLoophole) {
                cleanNegativePassCount += 1;
            } else {
                const falseFindings = Math.max(1, output.findings.length);
                fp += falseFindings;

                if (allowLogs) {
                    devFailureLogs.push({
                        task: "LOOPHOLE",
                        caseId: pair.spec.caseId,
                        domain: pair.spec.domain,
                        tag: "CLEAN_NEGATIVE",
                        expected: "0 findings (CLEAN)",
                        actual: `${output.findings.length} findings: [${output.findings.map((f) => `${f.code}@${f.provisionRef}`).join(", ")}]`,
                        reason: "False Positive on clean negative document",
                        citationsChecked: citAudit.totalChecked,
                        hallucinatedCitations: citAudit.hallucinatedCount,
                    });
                }
            }

            continue;
        }

        // Positive mutated case
        const matchedFindingIndexes = new Set<number>();

        for (const expected of pair.spec.expectedDefects) {
            totalExpectedDefects += 1;
            const matchIdx = output.findings.findIndex(
                (f, idx) =>
                    !matchedFindingIndexes.has(idx)
                    && defectCodesEquivalent(expected.code, f.code)
                    && provisionMatches(expected.provisionRef, f.provisionRef),
            );

            if (matchIdx !== -1) {
                matchedFindingIndexes.add(matchIdx);
                tp += 1;
                localizedExpected += 1;
            } else {
                const codeOnlyIdx = output.findings.findIndex(
                    (f, idx) => !matchedFindingIndexes.has(idx) && defectCodesEquivalent(expected.code, f.code),
                );

                if (codeOnlyIdx !== -1) {
                    matchedFindingIndexes.add(codeOnlyIdx);
                    tp += 1;
                } else {
                    fn += 1;

                    if (allowLogs) {
                        devFailureLogs.push({
                            task: "LOOPHOLE",
                            caseId: pair.spec.caseId,
                            domain: pair.spec.domain,
                            tag: pair.spec.mutationKind,
                            expected: `${expected.code}@${expected.provisionRef ?? "*"}`,
                            actual: output.findings.map((f) => `${f.code}@${f.provisionRef}`).join(", ") || "NONE",
                            reason: `Missed planted defect: ${expected.description}`,
                            citationsChecked: citAudit.totalChecked,
                            hallucinatedCitations: citAudit.hallucinatedCount,
                        });
                    }
                }
            }
        }

        // Count extra unexpected error/warning findings on positive docs as FP if clearly unrelated code
        const expectedCodeSet = new Set(pair.spec.expectedDefects.map((d) => d.code));
        const extraUnrelated = output.findings.filter(
            (f, idx) =>
                !matchedFindingIndexes.has(idx)
                && !expectedCodeSet.has(f.code)
                && !(expectedCodeSet.has("DEONTIC_CONFLICT") && f.code === "LG002")
                && !(expectedCodeSet.has("LG002") && f.code === "DEONTIC_CONFLICT"),
        );

        if (extraUnrelated.length > 0) {
            fp += extraUnrelated.length;

            if (allowLogs) {
                devFailureLogs.push({
                    task: "LOOPHOLE",
                    caseId: pair.spec.caseId,
                    domain: pair.spec.domain,
                    tag: pair.spec.mutationKind,
                    expected: [...expectedCodeSet].join(","),
                    actual: extraUnrelated.map((f) => `${f.code}@${f.provisionRef}("${f.verbatimQuote.slice(0, 30)}")`).join(", "),
                    reason: "Extra unrelated finding (False Positive) on mutated document",
                    citationsChecked: citAudit.totalChecked,
                    hallucinatedCitations: citAudit.hallucinatedCount,
                });
            }
        }
    }

    const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
    const f1Score = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    const localizationRate = totalExpectedDefects === 0 ? 1 : localizedExpected / totalExpectedDefects;

    // ------------------------------------------------------------------------
    // 2. LIVE JUDGE SCORING
    // ------------------------------------------------------------------------
    let outcomeCorrect = 0;
    let verdictCorrect = 0;
    let fineTotal = 0;
    let fineCorrect = 0;
    let nonMonTotal = 0;
    let nonMonCorrect = 0;
    let defectTotal = 0;
    let defectCorrect = 0;

    let abstTp = 0;
    let abstFp = 0;
    let abstTn = 0;
    let abstFn = 0;

    const judgeLatencies: number[] = [];
    const paraphraseMap = new Map<string, {
        expectedOutcome: string;
        expectedFine: string;
        actualOutcomes: string[];
        actualFines: string[];
    }>();

    for (const pair of input.judgePairs) {
        totalSchemaChecked += 1;
        judgeLatencies.push(pair.usage.durationMs);
        const schemaCheck = validateJudgeOutputSchema(pair.rawOutput);

        if (!schemaCheck.valid || !schemaCheck.parsed) {
            if (pair.spec.expectedAbstained) {
                abstFn += 1;
            } else {
                abstFp += 1;
            }

            if (allowLogs) {
                devFailureLogs.push({
                    task: "LIVE_JUDGE",
                    caseId: pair.spec.caseId,
                    domain: pair.spec.domain,
                    tag: pair.spec.blindSpotTag,
                    expected: pair.spec.expectedOutcome,
                    actual: `SCHEMA_INVALID: ${schemaCheck.errors.join("; ")}`,
                    reason: "Output failed strict JSON schema validation",
                    citationsChecked: 0,
                    hallucinatedCitations: 0,
                });
            }

            continue;
        }

        totalSchemaValid += 1;
        const output: LiveJudgeOutput = schemaCheck.parsed;

        if (!output.workspaceOnly) {
            workspaceOnlyViolationCount += 1;
        }

        if (!verifyNoInvertedBounds(output)) {
            invalidInvertedBoundsCount += 1;
        }

        const citAudit = verifyCitationsVerbatim(output.citations, pair.spec.draftContent, pair.spec.workspaceFiles);
        totalCitationsChecked += citAudit.totalChecked;
        totalHallucinatedCitations += citAudit.hallucinatedCount;

        const outOk = output.outcome === pair.spec.expectedOutcome;
        const finOk = fineMatches(pair.spec.expectedFine, output.applicableFine);
        const nmOk = nonMonetaryMatches(pair.spec.expectedNonMonetaryKeywords, output.nonMonetarySanctions, output.reasoning);
        const abstOk = output.abstained === pair.spec.expectedAbstained;
        const defOk = pair.spec.expectedDefectCodes.every((code) =>
            output.detectedDefectCodes.some((actual) => defectCodesEquivalent(code, actual)),
        );
        const citPresentOk = pair.spec.expectedCitationHints.length === 0 || output.citations.length > 0;

        if (outOk) {
            outcomeCorrect += 1;
        }

        if (pair.spec.expectedFine !== null) {
            fineTotal += 1;

            if (finOk) {
                fineCorrect += 1;
            }
        }

        if (pair.spec.expectedNonMonetaryKeywords.length > 0) {
            nonMonTotal += 1;

            if (nmOk) {
                nonMonCorrect += 1;
            }
        }

        if (pair.spec.expectedDefectCodes.length > 0) {
            defectTotal += 1;

            if (defOk) {
                defectCorrect += 1;
            }
        }

        if (pair.spec.expectedAbstained) {
            if (output.abstained) {
                abstTp += 1;
            } else {
                abstFn += 1;
            }
        } else if (output.abstained) {
            abstFp += 1;
        } else {
            abstTn += 1;
        }

        const isFullVerdictPass = outOk && finOk && nmOk && abstOk && citPresentOk;

        if (isFullVerdictPass) {
            verdictCorrect += 1;
        } else if (allowLogs) {
            const reasons: string[] = [];

            if (!outOk) {
                reasons.push(`outcome ${output.outcome} != ${pair.spec.expectedOutcome}`);
            }

            if (!finOk) {
                reasons.push(`fine ${JSON.stringify(output.applicableFine)} != ${JSON.stringify(pair.spec.expectedFine)}`);
            }

            if (!nmOk) {
                reasons.push(`nonMonetary missing [${pair.spec.expectedNonMonetaryKeywords.join(", ")}]`);
            }

            if (!abstOk) {
                reasons.push(`abstained ${output.abstained} != ${pair.spec.expectedAbstained}`);
            }

            if (!defOk) {
                reasons.push(`defects [${output.detectedDefectCodes.join(",")}] missing [${pair.spec.expectedDefectCodes.join(",")}]`);
            }

            if (!citPresentOk) {
                reasons.push("missing verbatim citations");
            }

            if (citAudit.hallucinatedCount > 0) {
                reasons.push(`hallucinated citations: ${citAudit.hallucinatedDetails.join("; ")}`);
            }

            devFailureLogs.push({
                task: "LIVE_JUDGE",
                caseId: pair.spec.caseId,
                domain: pair.spec.domain,
                tag: pair.spec.blindSpotTag,
                expected: `${pair.spec.expectedOutcome} fine=${JSON.stringify(pair.spec.expectedFine)} abst=${pair.spec.expectedAbstained}`,
                actual: `${output.outcome} fine=${JSON.stringify(output.applicableFine)} abst=${output.abstained} defs=[${output.detectedDefectCodes.join(",")}]`,
                reason: reasons.join(" | "),
                citationsChecked: citAudit.totalChecked,
                hallucinatedCitations: citAudit.hallucinatedCount,
            });
        }

        if (pair.spec.paraphraseGroupId) {
            const bucket = paraphraseMap.get(pair.spec.paraphraseGroupId) ?? {
                expectedOutcome: pair.spec.expectedOutcome,
                expectedFine: JSON.stringify(pair.spec.expectedFine),
                actualOutcomes: [],
                actualFines: [],
            };
            bucket.actualOutcomes.push(output.outcome);
            bucket.actualFines.push(JSON.stringify(output.applicableFine));
            paraphraseMap.set(pair.spec.paraphraseGroupId, bucket);
        }
    }

    let consistencyGroupsPassed = 0;

    for (const bucket of paraphraseMap.values()) {
        const allSameOutcome = bucket.actualOutcomes.length === 3
            && new Set(bucket.actualOutcomes).size === 1
            && bucket.actualOutcomes[0] === bucket.expectedOutcome;
        const allSameFine = bucket.actualFines.length === 3
            && new Set(bucket.actualFines).size === 1
            && bucket.actualFines[0] === bucket.expectedFine;

        if (allSameOutcome && allSameFine) {
            consistencyGroupsPassed += 1;
        }
    }

    const totalJudge = input.judgePairs.length;
    const outcomeAccuracy = totalJudge === 0 ? 1 : outcomeCorrect / totalJudge;
    const verdictAccuracy = totalJudge === 0 ? 1 : verdictCorrect / totalJudge;
    const fineAccuracy = fineTotal === 0 ? 1 : fineCorrect / fineTotal;
    const nonMonetaryAccuracy = nonMonTotal === 0 ? 1 : nonMonCorrect / nonMonTotal;
    const defectRecall = defectTotal === 0 ? 1 : defectCorrect / defectTotal;
    const paraphraseConsistency = paraphraseMap.size === 0 ? 1 : consistencyGroupsPassed / paraphraseMap.size;
    const abstentionAccuracy = totalJudge === 0 ? 1 : (abstTp + abstTn) / totalJudge;
    const abstentionRecall = abstTp + abstFn === 0 ? 1 : abstTp / (abstTp + abstFn);
    const abstentionPrecision = abstTp + abstFp === 0 ? 1 : abstTp / (abstTp + abstFp);

    const p50LatencyMs = computePercentile(judgeLatencies, 50);
    const p95LatencyMs = computePercentile(judgeLatencies, 95);
    const avgLatencyMs = judgeLatencies.length === 0
        ? 0
        : Math.round(judgeLatencies.reduce((sum, v) => sum + v, 0) / judgeLatencies.length);

    // ------------------------------------------------------------------------
    // 3. HARD GATES
    // ------------------------------------------------------------------------
    const schemaValidityRate = totalSchemaChecked === 0 ? 1 : totalSchemaValid / totalSchemaChecked;
    const citationHallucinationRate = totalCitationsChecked === 0 ? 0 : totalHallucinatedCitations / totalCitationsChecked;
    const liveJudgeLatencyGatePassed = p95LatencyMs <= LIVE_JUDGE_P95_BUDGET_MS;
    const failureReasons: string[] = [];

    if (schemaValidityRate < 1) {
        failureReasons.push(`Schema validity ${(schemaValidityRate * 100).toFixed(1)}% < 100%`);
    }

    if (totalHallucinatedCitations > 0) {
        failureReasons.push(`Hallucinated citations detected: ${totalHallucinatedCitations}/${totalCitationsChecked}`);
    }

    if (invalidInvertedBoundsCount > 0) {
        failureReasons.push(`Invalid inverted bounds emitted: ${invalidInvertedBoundsCount}`);
    }

    if (workspaceOnlyViolationCount > 0) {
        failureReasons.push(`workspaceOnly violations: ${workspaceOnlyViolationCount}`);
    }

    if (!liveJudgeLatencyGatePassed) {
        failureReasons.push(`Live Judge P95 latency ${p95LatencyMs}ms > ${LIVE_JUDGE_P95_BUDGET_MS}ms`);
    }

    const hardGates: HardGateResult = {
        passed: failureReasons.length === 0,
        schemaValidityRate,
        citationHallucinationRate,
        invalidInvertedBoundsCount,
        workspaceOnlyViolationCount,
        liveJudgeP95LatencyMs: p95LatencyMs,
        liveJudgeLatencyGatePassed,
        failureReasons,
    };

    // ------------------------------------------------------------------------
    // 4. COST & EFFICIENCY
    // ------------------------------------------------------------------------
    const allUsages = [...input.loopholePairs.map((p) => p.usage), ...input.judgePairs.map((p) => p.usage)];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalDecisionTokens = 0;
    let totalLlmCalls = 0;
    let estimatedTotalCostUsd = 0;

    for (const u of allUsages) {
        totalInputTokens += u.inputTokens;
        totalOutputTokens += u.outputTokens;
        totalDecisionTokens += u.decisionInputTokens;
        totalLlmCalls += u.llmCalls;
        estimatedTotalCostUsd += estimateCostUsd(u.modelUsed, u.inputTokens, u.outputTokens, u.decisionInputTokens);
    }

    const totalRequests = Math.max(1, allUsages.length);
    const cost: CostEfficiencyMetrics = {
        totalInputTokens,
        totalOutputTokens,
        totalDecisionTokens,
        totalTokens: totalInputTokens + totalOutputTokens + totalDecisionTokens,
        totalLlmCalls,
        avgCallsPerRequest: Number((totalLlmCalls / totalRequests).toFixed(3)),
        estimatedTotalCostUsd: Number(estimatedTotalCostUsd.toFixed(6)),
        estimatedCostPerRequestUsd: Number((estimatedTotalCostUsd / totalRequests).toFixed(7)),
    };

    // ------------------------------------------------------------------------
    // 5. COMPOSITE SOFT SCORE (0..100)
    // ------------------------------------------------------------------------
    const softScore = Number(
        (
            (f1Score * 35)
            + (verdictAccuracy * 30)
            + (paraphraseConsistency * 15)
            + (abstentionAccuracy * 10)
            + (defectRecall * 10)
        ).toFixed(2),
    );

    const loophole: LoopholeMetrics = {
        totalCases: input.loopholePairs.length,
        positiveCases,
        negativeCases,
        truePositives: tp,
        falsePositives: fp,
        falseNegatives: fn,
        cleanNegativePassCount,
        precision: Number(precision.toFixed(4)),
        recall: Number(recall.toFixed(4)),
        f1Score: Number(f1Score.toFixed(4)),
        localizationRate: Number(localizationRate.toFixed(4)),
    };

    const liveJudge: LiveJudgeMetrics = {
        totalCases: totalJudge,
        verdictAccuracy: Number(verdictAccuracy.toFixed(4)),
        outcomeAccuracy: Number(outcomeAccuracy.toFixed(4)),
        fineAccuracy: Number(fineAccuracy.toFixed(4)),
        nonMonetaryAccuracy: Number(nonMonetaryAccuracy.toFixed(4)),
        defectRecall: Number(defectRecall.toFixed(4)),
        consistencyGroupsTotal: paraphraseMap.size,
        consistencyGroupsPassed,
        paraphraseConsistency: Number(paraphraseConsistency.toFixed(4)),
        abstentionAccuracy: Number(abstentionAccuracy.toFixed(4)),
        abstentionRecall: Number(abstentionRecall.toFixed(4)),
        abstentionPrecision: Number(abstentionPrecision.toFixed(4)),
        p50LatencyMs,
        p95LatencyMs,
        avgLatencyMs,
    };

    return {
        armName: input.armName,
        harnessVersion: input.harnessVersion,
        split: input.split,
        evaluatedAt: new Date().toISOString(),
        hardGates,
        loophole,
        liveJudge,
        softScore,
        cost,
        devFailureLogs: allowLogs ? devFailureLogs : [],
    };
}

export function evaluateParetoAcceptanceGate(input: {
    candidateBlind: SplitEvalReport;
    previousBestBlind: SplitEvalReport | null;
    teacherBlind: SplitEvalReport | null;
}): ParetoGateReport {
    const reasons: string[] = [];
    const hardGatesPassed = input.candidateBlind.hardGates.passed;

    if (!hardGatesPassed) {
        reasons.push(`Hard Gates failed: ${input.candidateBlind.hardGates.failureReasons.join("; ")}`);
    }

    const heldOutNonRegression = input.previousBestBlind === null
        || input.candidateBlind.softScore >= input.previousBestBlind.softScore;

    if (!heldOutNonRegression && input.previousBestBlind) {
        reasons.push(
            `Held-out softScore regressed: ${input.candidateBlind.softScore} < ${input.previousBestBlind.softScore}`,
        );
    }

    let softScoreRatioVsTeacher: number | null = null;
    let costReductionFactorVsTeacher: number | null = null;

    if (input.teacherBlind && input.teacherBlind.softScore > 0) {
        softScoreRatioVsTeacher = Number((input.candidateBlind.softScore / input.teacherBlind.softScore).toFixed(4));

        if (softScoreRatioVsTeacher < 0.95) {
            reasons.push(
                `Blind softScore ratio vs Teacher ${(softScoreRatioVsTeacher * 100).toFixed(1)}% < 95% target`,
            );
        }
    }

    if (input.teacherBlind && input.teacherBlind.cost.estimatedCostPerRequestUsd > 0) {
        const candCost = input.candidateBlind.cost.estimatedCostPerRequestUsd;
        costReductionFactorVsTeacher = candCost <= 0
            ? 999
            : Number((input.teacherBlind.cost.estimatedCostPerRequestUsd / candCost).toFixed(1));

        if (costReductionFactorVsTeacher < 10) {
            reasons.push(`Cost reduction factor ${costReductionFactorVsTeacher}x < 10x target`);
        }
    }

    return {
        accepted: reasons.length === 0,
        hardGatesPassed,
        softScoreRatioVsTeacher,
        costReductionFactorVsTeacher,
        heldOutNonRegression,
        reasons,
    };
}
