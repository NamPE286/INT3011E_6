import { detectDeonticConflictInNodes } from "./debug-matching";
import { DEFAULT_GEMINI_MODEL, isGeminiInvalidApiKeyError } from "./gemini-client";
import { extractFineRanges, extractNumericThresholds, toIntervalItems } from "./intervals";
import { compileDraftToLean } from "./lean-compiler";
import { extractLegalFactsWithUserLlm, getCachedSemanticCrossReferences, verifySemanticCrossReferencesWithDecisionApi } from "./llm-extract";
import type { IncrementalExtractStats, IncrementalLlmCache } from "./llm-incremental";
import { getCachedNeuroSymbolicForDraft, runNeuroSymbolicAudit } from "./llm-neurosymbolic";
import { analyzeAgainstLocalWorkspace, buildLocalWorkspaceContext, type LocalWorkspaceFile } from "./local-workspace";
import { parseDraftDocument, rangeFromOffsets, type ParsedDraft, type ParsedNode } from "./parser";
import { analyzeAmbiguities } from "./rules-ambiguity";
import { analyzeLogic } from "./rules-logic";
import { analyzeLoopholes } from "./rules-loophole";
import type {
    AiTokenBreakdown,
    AnalysisResult,
    DraftNode,
    ExtractedLegalFact,
    ExtractedPartitionRule,
    ExtractedSemanticDefect,
    LegalDiagnostic,
    QualityMetrics,
} from "./types";
import { auditDraftReferencesAndBases, buildWorkspaceRelationGraph } from "./workspace-relations";

export type LocalAnalyzeOptions = {
    currentPath?: string;
    includeAi?: boolean;
    useDecisionApi?: boolean;
    deepNeuroSymbolic?: boolean;
    detectDeonticStatic?: boolean;
    apiKey?: string;
    apiBaseUrl?: string;
    model?: string;
    fetcher?: typeof fetch;
    signal?: AbortSignal;
    incrementalCache?: IncrementalLlmCache;
    onProgress?: (phase: "decision_triage" | "extracting" | "verifying", detail: string) => void;
};

/**
 * Runs the entire LexIDE legislative analysis and Lean 4 formal compilation locally in the browser.
 * When `incrementalCache` is supplied, only newly added or modified clauses are sent to the LLM.
 */
export async function analyzeLocalDraft(
    content: string,
    workspaceFiles: readonly LocalWorkspaceFile[],
    options: LocalAnalyzeOptions = {},
): Promise<AnalysisResult> {
    const startedAt = Date.now();
    const draft = parseDraftDocument(content);
    const fineRanges = extractFineRanges(draft);
    const thresholds = extractNumericThresholds(draft, fineRanges);
    const workspaceContext = buildLocalWorkspaceContext(workspaceFiles, options.currentPath);

    const loopholeDiagnostics = analyzeLoopholes(draft, fineRanges, thresholds);
    const ambiguityResult = analyzeAmbiguities(draft, workspaceContext.definedTerms);
    const logicResult = analyzeLogic(draft, fineRanges, thresholds);
    const corpusDiagnostics = analyzeAgainstLocalWorkspace(draft, workspaceFiles, options.currentPath);
    const relationGraph = buildWorkspaceRelationGraph(workspaceFiles, options.currentPath, content);
    const relationDiagnostics = auditDraftReferencesAndBases(draft, relationGraph, options.currentPath);
    const deonticDiagnostics = options.detectDeonticStatic ? detectStaticDeonticConflicts(draft) : [];

    let extractedFacts: ExtractedLegalFact[] = [];
    let actualAiTokens = 0;
    let aiError: string | null = null;
    let incStats: IncrementalExtractStats | null = null;
    const useAi = Boolean(options.includeAi);

    if (useAi && options.deepNeuroSymbolic && options.apiKey?.trim() && !isGeminiInvalidApiKeyError(aiError)) {
        // High-accuracy Neuro-Symbolic Pipeline v4.1: skip legacy flat extractor
    } else if (useAi && options.incrementalCache) {
        const inc = await options.incrementalCache.extractIncrementally(draft, {
            apiKey: options.apiKey,
            apiBaseUrl: options.apiBaseUrl,
            model: options.model,
            useDecisionApi: options.useDecisionApi,
            workspaceContext,
            fetcher: options.fetcher,
            signal: options.signal,
            onProgress: options.onProgress,
        });
        extractedFacts = inc.facts;
        actualAiTokens = inc.stats.actualAiTokens;
        aiError = inc.error;
        incStats = inc.stats;
    } else if (useAi) {
        const extractResult = await extractLegalFactsWithUserLlm(draft, {
            apiKey: options.apiKey,
            apiBaseUrl: options.apiBaseUrl,
            model: options.model,
            useDecisionApi: options.useDecisionApi,
            workspaceContext,
            fetcher: options.fetcher,
            signal: options.signal,
            onProgress: options.onProgress,
        });
        extractedFacts = extractResult.facts;
        actualAiTokens = extractResult.actualAiTokens;
        aiError = extractResult.error;
    } else if (options.incrementalCache) {
        extractedFacts = options.incrementalCache.getCachedFactsForDraft(
            draft,
            workspaceContext,
            options.model ?? DEFAULT_GEMINI_MODEL,
        );
    }

    let semanticRefDiagnostics: LegalDiagnostic[] = [];

    if (useAi && options.useDecisionApi !== false && options.apiKey?.trim()) {
        const refAudit = await verifySemanticCrossReferencesWithDecisionApi(
            draft,
            logicResult.references,
            {
                apiKey: options.apiKey,
                apiBaseUrl: options.apiBaseUrl,
                useDecisionApi: options.useDecisionApi,
                fetcher: options.fetcher,
                signal: options.signal,
            },
            options.incrementalCache?.refDecisionCache,
        );
        semanticRefDiagnostics = refAudit.diagnostics;
        actualAiTokens += refAudit.decisionInputTokens;

        if (!aiError && refAudit.error) {
            aiError = refAudit.error;
        }

        if (incStats?.tokenBreakdown) {
            incStats.tokenBreakdown.decisionInputTokens += refAudit.decisionInputTokens;
            incStats.tokenBreakdown.totalTokens += refAudit.decisionInputTokens;
        }
    } else if (options.incrementalCache) {
        semanticRefDiagnostics = getCachedSemanticCrossReferences(
            draft,
            logicResult.references,
            options.incrementalCache.refDecisionCache,
        );
    }

    const staticCombined = deduplicateDiagnostics([
        ...loopholeDiagnostics,
        ...ambiguityResult.diagnostics,
        ...logicResult.diagnostics,
        ...corpusDiagnostics,
        ...relationDiagnostics,
        ...deonticDiagnostics,
        ...semanticRefDiagnostics,
    ]);

    let extractedPartitions: ExtractedPartitionRule[] = [];
    let extractedSemanticDefects: ExtractedSemanticDefect[] = [];
    let nsBreakdown: AiTokenBreakdown | null = null;

    if (useAi && options.deepNeuroSymbolic && options.apiKey?.trim() && !isGeminiInvalidApiKeyError(aiError)) {
        const ns = await runNeuroSymbolicAudit(draft, {
            apiKey: options.apiKey,
            apiBaseUrl: options.apiBaseUrl,
            model: options.model,
            useDecisionApi: options.useDecisionApi,
            workspaceContext,
            fetcher: options.fetcher,
            signal: options.signal,
            groupCache: options.incrementalCache?.neuroSymbolicCache,
        });
        extractedPartitions = ns.partitions;
        extractedSemanticDefects = ns.semanticDefects;
        actualAiTokens += ns.tokensUsed;
        nsBreakdown = ns.breakdown;

        if (!aiError && ns.error) {
            aiError = ns.error;
        }
    } else if (options.deepNeuroSymbolic && options.incrementalCache) {
        const cachedNs = getCachedNeuroSymbolicForDraft(
            draft,
            options.incrementalCache.neuroSymbolicCache,
            options.model?.trim() || DEFAULT_GEMINI_MODEL,
        );
        extractedPartitions = cachedNs.partitions;
        extractedSemanticDefects = cachedNs.semanticDefects;
    }

    const { report: lean, derivedDiagnostics } = compileDraftToLean({
        draft,
        fineRanges,
        thresholds,
        references: logicResult.references,
        terms: ambiguityResult.terms,
        diagnostics: staticCombined,
        workspaceContext,
        extractedFacts,
        extractedPartitions,
        extractedSemanticDefects,
        actualAiTokens,
    });

    if (incStats && useAi) {
        lean.tokenStats.aiEscalatedClauses = incStats.sentUnits;
        lean.tokenStats.deterministicClauses = Math.max(0, incStats.totalUnits - incStats.sentUnits);
        lean.tokenStats.tokenBreakdown = incStats.tokenBreakdown;
        lean.tokenStats.strategy = incStats.sentUnits === 0
            ? `Auto-LLM Cache Hit: tái sử dụng ${incStats.cachedUnits}/${incStats.totalUnits} khoản (0 token) → Lean 4 chứng minh`
            : `Gemini Decision + Extract: gửi ${incStats.sentUnits} khoản, cache ${incStats.cachedUnits} khoản → Lean 4 chứng minh`;
    } else if (nsBreakdown && useAi) {
        lean.tokenStats.tokenBreakdown = nsBreakdown;
        lean.tokenStats.aiEscalatedClauses = nsBreakdown.escalatedToExtract;
    }

    const combined = deduplicateDiagnostics([...staticCombined, ...derivedDiagnostics]);

    combined.sort((left, right) => {
        if (left.range.startOffset !== right.range.startOffset) {
            return left.range.startOffset - right.range.startOffset;
        }

        return severityWeight(right.severity) - severityWeight(left.severity);
    });

    const outline = attachNodeCounts(draft.nodes, combined);
    const intervals = toIntervalItems(thresholds);
    const metrics = computeMetrics(outline, combined, logicResult.references.length, fineRanges.length);

    return {
        diagnostics: combined,
        outline,
        intervals,
        references: logicResult.references,
        terms: ambiguityResult.terms,
        termOccurrences: ambiguityResult.termOccurrences,
        metrics,
        workspaceScope: {
            corpusDocumentCount: workspaceContext.corpusDocumentCount,
            savedDraftCount: workspaceContext.savedDraftCount,
            strictlyWorkspaceOnly: true,
        },
        lean,
        analyzedAt: new Date().toISOString(),
        durationMs: Math.max(1, Date.now() - startedAt),
        aiStatus: {
            used:
                (useAi && aiError === null)
                || extractedFacts.length > 0
                || extractedPartitions.length > 0
                || extractedSemanticDefects.length > 0
                || semanticRefDiagnostics.length > 0,
            model:
                useAi
                || extractedFacts.length > 0
                || extractedPartitions.length > 0
                || extractedSemanticDefects.length > 0
                || semanticRefDiagnostics.length > 0
                    ? (options.model ?? DEFAULT_GEMINI_MODEL)
                    : null,
            error: aiError,
        },
    };
}

function deduplicateDiagnostics(items: readonly LegalDiagnostic[]): LegalDiagnostic[] {
    const seen = new Set<string>();
    const out: LegalDiagnostic[] = [];

    for (const item of items) {
        const key = `${item.code}:${item.range.startOffset}:${item.range.endOffset}`;

        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        out.push(item);
    }

    return out;
}

function attachNodeCounts(nodes: readonly ParsedNode[], diagnostics: readonly LegalDiagnostic[]): DraftNode[] {
    const cloned: DraftNode[] = nodes.map((node) => ({
        id: node.id,
        parentId: node.parentId,
        level: node.level,
        number: node.number,
        title: node.title,
        text: node.text,
        refLabel: node.refLabel,
        startLine: node.startLine,
        endLine: node.endLine,
        startOffset: node.startOffset,
        endOffset: node.endOffset,
        diagnosticCounts: { error: 0, warning: 0, info: 0 },
    }));

    for (const diag of diagnostics) {
        for (const node of cloned) {
            if (diag.range.startOffset >= node.startOffset && diag.range.startOffset <= node.endOffset) {
                node.diagnosticCounts[diag.severity] += 1;
            }
        }
    }

    return cloned;
}

function computeMetrics(
    outline: readonly DraftNode[],
    diagnostics: readonly LegalDiagnostic[],
    referenceCount: number,
    fineRuleCount: number,
): QualityMetrics {
    const countsByCategory = { LOOPHOLE: 0, AMBIGUITY: 0, LOGIC: 0 };
    const countsBySeverity = { error: 0, warning: 0, info: 0 };
    const penalties = { LOOPHOLE: 0, AMBIGUITY: 0, LOGIC: 0 };

    for (const diag of diagnostics) {
        countsByCategory[diag.category] += 1;
        countsBySeverity[diag.severity] += 1;
        penalties[diag.category] += diag.severity === "error" ? 14 : diag.severity === "warning" ? 7 : 3;
    }

    const loopholeScore = Math.max(10, 100 - penalties.LOOPHOLE);
    const clarityScore = Math.max(10, 100 - penalties.AMBIGUITY);
    const logicScore = Math.max(10, 100 - penalties.LOGIC);
    const overallScore = Math.round((loopholeScore * 0.35) + (clarityScore * 0.25) + (logicScore * 0.4));

    return {
        overallScore,
        loopholeScore,
        clarityScore,
        logicScore,
        articleCount: outline.filter((node) => node.level === "ARTICLE").length,
        clauseCount: outline.filter((node) => node.level === "CLAUSE").length,
        pointCount: outline.filter((node) => node.level === "POINT").length,
        referenceCount,
        fineRuleCount,
        countsByCategory,
        countsBySeverity,
    };
}

function detectStaticDeonticConflicts(draft: ParsedDraft): LegalDiagnostic[] {
    const diagnostics: LegalDiagnostic[] = [];
    const clausesByArticle = new Map<string, ParsedNode[]>();

    for (const node of draft.nodes) {
        if ((node.level === "CLAUSE" || node.level === "POINT") && node.articleNo) {
            const list = clausesByArticle.get(node.articleNo) ?? [];
            list.push(node);
            clausesByArticle.set(node.articleNo, list);
        }
    }

    for (const group of clausesByArticle.values()) {
        if (group.length < 2) {
            continue;
        }

        const conflict = detectDeonticConflictInNodes(group, draft.nodes);

        if (!conflict) {
            continue;
        }

        const { prohibitedNode, permittedNode } = conflict;
        const quote = permittedNode.text.split("\n")[0]?.trim() ?? permittedNode.text;

        diagnostics.push({
            id: `DEONTIC-${permittedNode.startOffset}`,
            code: "DEONTIC_CONFLICT",
            category: "LOGIC",
            severity: "error",
            title: `Mâu thuẫn đạo nghĩa trực tiếp giữa ${prohibitedNode.refLabel} và ${permittedNode.refLabel}`,
            message: `${prohibitedNode.refLabel} quy định nghiêm cấm trong khi ${permittedNode.refLabel} lại cho phép cùng một hành vi.`,
            exploitScenario: `Đối tượng thực hiện hành vi bị cấm tại ${prohibitedNode.refLabel} có thể viện dẫn ${permittedNode.refLabel} cho phép cùng hành vi để vô hiệu hóa chế tài.`,
            suggestion: `Loại bỏ quy định mâu thuẫn tại ${permittedNode.refLabel} hoặc bổ sung điều kiện ngoại lệ định lượng rõ ràng.`,
            excerpt: quote,
            provisionRef: permittedNode.refLabel,
            range: rangeFromOffsets(draft.content, draft.lineStarts, permittedNode.startOffset, permittedNode.endOffset),
            source: "STATIC",
            quickFix: null,
            corpusLink: null,
            leanTheorem: `deontic_consistent_L${permittedNode.startLine}`,
            counterexample: `Prohibited(${prohibitedNode.refLabel}) ∧ Permitted(${permittedNode.refLabel}) → ⊥`,
        });
    }

    return diagnostics;
}

function severityWeight(severity: LegalDiagnostic["severity"]): number {
    if (severity === "error") {
        return 3;
    }

    if (severity === "warning") {
        return 2;
    }

    return 1;
}
