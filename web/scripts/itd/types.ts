import type { LocalWorkspaceFile } from "../../src/lib/engine/local-workspace";
import type { DiagnosticCategory, VerdictOutcome } from "../../src/lib/engine/types";

export type DatasetSplit = "dev" | "blind_test";

export type LoopholePolarity = "POSITIVE" | "NEGATIVE";

export type ExpectedLoopholeDefect = {
    code: string;
    provisionRef: string | null;
    anchorSubstring: string;
    description: string;
};

export type LoopholeEvalCase = {
    caseId: string;
    split: DatasetSplit;
    domain: string;
    polarity: LoopholePolarity;
    mutationKind: string;
    draftContent: string;
    workspaceFiles: readonly LocalWorkspaceFile[];
    currentPath: string;
    expectedDefects: readonly ExpectedLoopholeDefect[];
};

export type LoopholeFindingOutput = {
    code: string;
    category: DiagnosticCategory;
    provisionRef: string;
    verbatimQuote: string;
    exploitScenario: string;
};

export type LoopholeDetectorOutput = {
    caseId: string;
    hasLoophole: boolean;
    findings: LoopholeFindingOutput[];
    workspaceOnly: boolean;
};

export type BlindSpotTag =
    | "MULTI_VIOLATION"
    | "CRIMINAL_NON_MONETARY"
    | "CROSS_DOC_AMEND_REPEAL"
    | "MULTI_DOMAIN"
    | "NESTED_EXCEPTION_TEMPORAL"
    | "PARAPHRASE_CONSISTENCY"
    | "ABSTENTION";

export type GroundedCitation = {
    provisionRef: string;
    verbatimQuote: string;
};

export type JudgeEvalCase = {
    caseId: string;
    split: DatasetSplit;
    domain: string;
    blindSpotTag: BlindSpotTag;
    paraphraseGroupId: string | null;
    isAbstentionCase: boolean;
    draftContent: string;
    workspaceFiles: readonly LocalWorkspaceFile[];
    currentPath: string;
    scenario: string;
    expectedOutcome: VerdictOutcome;
    expectedAbstained: boolean;
    expectedFine: { min: number; max: number } | null;
    expectedNonMonetaryKeywords: readonly string[];
    expectedDefectCodes: readonly string[];
    expectedCitationHints: readonly string[];
};

export type LiveJudgeOutput = {
    caseId: string;
    outcome: VerdictOutcome;
    abstained: boolean;
    applicableFine: { min: number; max: number } | null;
    nonMonetarySanctions: string[];
    detectedDefectCodes: string[];
    citations: GroundedCitation[];
    reasoning: string;
    workspaceOnly: boolean;
};

export type UsageTelemetry = {
    inputTokens: number;
    outputTokens: number;
    decisionInputTokens: number;
    llmCalls: number;
    durationMs: number;
    modelUsed: string;
};

export type HardGateResult = {
    passed: boolean;
    schemaValidityRate: number;
    citationHallucinationRate: number;
    invalidInvertedBoundsCount: number;
    workspaceOnlyViolationCount: number;
    liveJudgeP95LatencyMs: number;
    liveJudgeLatencyGatePassed: boolean;
    failureReasons: string[];
};

export type LoopholeMetrics = {
    totalCases: number;
    positiveCases: number;
    negativeCases: number;
    truePositives: number;
    falsePositives: number;
    falseNegatives: number;
    cleanNegativePassCount: number;
    precision: number;
    recall: number;
    f1Score: number;
    localizationRate: number;
};

export type LiveJudgeMetrics = {
    totalCases: number;
    verdictAccuracy: number;
    outcomeAccuracy: number;
    fineAccuracy: number;
    nonMonetaryAccuracy: number;
    defectRecall: number;
    consistencyGroupsTotal: number;
    consistencyGroupsPassed: number;
    paraphraseConsistency: number;
    abstentionAccuracy: number;
    abstentionRecall: number;
    abstentionPrecision: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    avgLatencyMs: number;
};

export type CostEfficiencyMetrics = {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalDecisionTokens: number;
    totalTokens: number;
    totalLlmCalls: number;
    avgCallsPerRequest: number;
    estimatedTotalCostUsd: number;
    estimatedCostPerRequestUsd: number;
};

export type DevCaseFailureLog = {
    task: "LOOPHOLE" | "LIVE_JUDGE";
    caseId: string;
    domain: string;
    tag: string;
    expected: string;
    actual: string;
    reason: string;
    citationsChecked: number;
    hallucinatedCitations: number;
};

export type SplitEvalReport = {
    armName: string;
    harnessVersion: string;
    split: DatasetSplit;
    evaluatedAt: string;
    hardGates: HardGateResult;
    loophole: LoopholeMetrics;
    liveJudge: LiveJudgeMetrics;
    softScore: number;
    cost: CostEfficiencyMetrics;
    devFailureLogs: DevCaseFailureLog[];
};

export type ParetoGateReport = {
    accepted: boolean;
    hardGatesPassed: boolean;
    softScoreRatioVsTeacher: number | null;
    costReductionFactorVsTeacher: number | null;
    heldOutNonRegression: boolean;
    reasons: string[];
};

export const MODEL_PRICING_USD_PER_1M: Readonly<Record<string, { input: number; output: number }>> = {
    "gemini-4-neon": { input: 3.0, output: 15.0 },
    "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
    "gemini-decision-1": { input: 0.1, output: 0.0 },
    "deterministic-lean": { input: 0.0, output: 0.0 },
};

export const LIVE_JUDGE_P95_BUDGET_MS = 2_500;
