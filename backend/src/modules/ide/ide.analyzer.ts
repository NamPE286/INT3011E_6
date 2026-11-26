import type { D1Database } from "@cloudflare/workers-types";
import { analyzeAgainstCorpus } from "./ide.corpus-check";
import { extractFineRanges, extractNumericThresholds, toIntervalItems } from "./ide.intervals";
import { compileDraftToLean } from "./ide.lean-compiler";
import { extractLegalFactsWithLlm } from "./ide.llm";
import { parseDraftDocument, type ParsedNode } from "./ide.parser";
import { analyzeAmbiguities } from "./ide.rules-ambiguity";
import { analyzeLogic } from "./ide.rules-logic";
import { analyzeLoopholes } from "./ide.rules-loophole";
import type { AnalysisResult, DraftNode, ExtractedLegalFact, LegalDiagnostic, QualityMetrics } from "./ide.types";
import { loadWorkspaceContext } from "./ide.workspace";

export type AnalyzeDraftOptions = {
    db?: D1Database;
    includeAi?: boolean;
    apiKey?: string;
    model?: string;
    fetcher?: typeof fetch;
};

export async function analyzeDraftContent(content: string, options: AnalyzeDraftOptions = {}): Promise<AnalysisResult> {
    const startedAt = Date.now();
    const draft = parseDraftDocument(content);
    const fineRanges = extractFineRanges(draft);
    const thresholds = extractNumericThresholds(draft, fineRanges);
    const workspaceContext = await loadWorkspaceContext(options.db);

    const loopholeDiagnostics = analyzeLoopholes(draft, fineRanges, thresholds);
    const ambiguityResult = analyzeAmbiguities(draft, workspaceContext.definedTerms);
    const logicResult = analyzeLogic(draft, fineRanges, thresholds);
    const corpusDiagnostics = await analyzeAgainstCorpus(options.db, draft, fineRanges);

    let extractedFacts: ExtractedLegalFact[] = [];
    let actualAiTokens = 0;
    let aiError: string | null = null;
    const useAi = Boolean(options.includeAi);

    if (useAi) {
        const extractResult = await extractLegalFactsWithLlm(draft, {
            apiKey: options.apiKey,
            model: options.model ?? "gpt-5.4",
            workspaceContext,
            fetcher: options.fetcher,
        });
        extractedFacts = extractResult.facts;
        actualAiTokens = extractResult.actualAiTokens;
        aiError = extractResult.error;
    }

    const staticCombined = deduplicateDiagnostics([
        ...loopholeDiagnostics,
        ...ambiguityResult.diagnostics,
        ...logicResult.diagnostics,
        ...corpusDiagnostics,
    ]);

    const { report: lean, derivedDiagnostics } = compileDraftToLean({
        draft,
        fineRanges,
        thresholds,
        references: logicResult.references,
        terms: ambiguityResult.terms,
        diagnostics: staticCombined,
        workspaceContext,
        extractedFacts,
        actualAiTokens,
    });

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
            used: useAi && aiError === null,
            model: useAi ? (options.model ?? "gpt-5.4") : null,
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

function severityWeight(severity: LegalDiagnostic["severity"]): number {
    if (severity === "error") {
        return 3;
    }

    if (severity === "warning") {
        return 2;
    }

    return 1;
}
