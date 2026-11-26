import { isRecord, readNumber, readString } from "./read";

function readArray(source: Record<string, unknown>, key: string): unknown[] | null {
    const value = source[key];

    return Array.isArray(value) ? value : null;
}

function readBoolean(source: Record<string, unknown>, key: string): boolean | null {
    const value = source[key];

    return typeof value === "boolean" ? value : null;
}

export type DiagnosticCategory = "LOOPHOLE" | "AMBIGUITY" | "LOGIC";
export type DiagnosticSeverity = "error" | "warning" | "info";
export type DiagnosticSource = "STATIC" | "CORPUS" | "AI";

export type TextRange = {
    startLine: number;
    endLine: number;
    startCol: number;
    endCol: number;
    startOffset: number;
    endOffset: number;
};

export type QuickFix = {
    label: string;
    replacement: string;
    startOffset: number;
    endOffset: number;
};

export type CorpusLink = {
    documentId: string;
    documentLabel: string;
    provisionId: string | null;
    excerpt: string;
};

export type LegalDiagnostic = {
    id: string;
    code: string;
    category: DiagnosticCategory;
    severity: DiagnosticSeverity;
    title: string;
    message: string;
    exploitScenario: string;
    suggestion: string;
    excerpt: string;
    provisionRef: string | null;
    range: TextRange;
    source: DiagnosticSource;
    quickFix: QuickFix | null;
    corpusLink: CorpusLink | null;
    leanTheorem?: string | null;
    counterexample?: string | null;
};

export type DraftNodeLevel = "CHAPTER" | "ARTICLE" | "CLAUSE" | "POINT";

export type DraftNode = {
    id: string;
    parentId: string | null;
    level: DraftNodeLevel;
    number: string;
    title: string | null;
    text: string;
    refLabel: string;
    startLine: number;
    endLine: number;
    startOffset: number;
    endOffset: number;
    diagnosticCounts: {
        error: number;
        warning: number;
        info: number;
    };
};

export type NumericIntervalStatus = "OK" | "OVERLAP" | "GAP_BEFORE" | "INVERTED";

export type NumericIntervalItem = {
    id: string;
    metric: string;
    unit: string;
    min: number | null;
    max: number | null;
    minInclusive: boolean;
    maxInclusive: boolean;
    fineMin: number | null;
    fineMax: number | null;
    provisionRef: string | null;
    line: number;
    status: NumericIntervalStatus;
    startOffset: number;
    endOffset: number;
};

export type CrossReferenceStatus = "VALID" | "BROKEN" | "SELF_REFERENCE" | "ORPHANED_BY_REPEAL";

export type CrossReferenceItem = {
    id: string;
    rawText: string;
    fromRef: string | null;
    targetRef: string;
    line: number;
    status: CrossReferenceStatus;
    startOffset: number;
    endOffset: number;
};

export type TermStatusItem = {
    term: string;
    normalizedTerm: string;
    status: "DEFINED_IN_DRAFT" | "DEFINED_IN_WORKSPACE" | "UNDEFINED";
    definedBy: string | null;
    definition: string | null;
    sourceDocumentId: string | null;
    sourceProvisionId: string | null;
    line: number;
    startOffset: number;
    endOffset: number;
};

export type TermOccurrence = {
    id: string;
    term: string;
    normalizedTerm: string;
    status: "DEFINED_IN_DRAFT" | "DEFINED_IN_WORKSPACE" | "UNDEFINED";
    definedBy: string | null;
    definition: string | null;
    sourceDocumentPath: string | null;
    sourceProvisionRef: string | null;
    sourceLine: number | null;
    sourceDocumentReplacedBy: string | null;
    line: number;
    startOffset: number;
    endOffset: number;
};

export type WorkspaceScopeInfo = {
    corpusDocumentCount: number;
    savedDraftCount: number;
    strictlyWorkspaceOnly: boolean;
};

export type LeanObligation = {
    id: string;
    theoremName: string;
    kind: string;
    status: "PROVED" | "REFUTED";
    tactic: string;
    line: number;
    provisionRef: string | null;
    leanStatement: string;
    counterexample: string | null;
    diagnosticCode: string | null;
};

export type LeanTokenStats = {
    naiveFullTokens: number;
    actualAiTokens: number;
    savedPercent: number;
    totalClauses: number;
    deterministicClauses: number;
    aiEscalatedClauses: number;
    strategy: string;
};

export type LeanVerificationReport = {
    engine: string;
    leanVersion: string;
    leanCode: string;
    obligations: LeanObligation[];
    provedCount: number;
    refutedCount: number;
    tokenStats: LeanTokenStats;
};

export type QualityMetrics = {
    overallScore: number;
    loopholeScore: number;
    clarityScore: number;
    logicScore: number;
    articleCount: number;
    clauseCount: number;
    pointCount: number;
    referenceCount: number;
    fineRuleCount: number;
    countsByCategory: {
        LOOPHOLE: number;
        AMBIGUITY: number;
        LOGIC: number;
    };
    countsBySeverity: {
        error: number;
        warning: number;
        info: number;
    };
};

export type AiAuditStatus = {
    used: boolean;
    model: string | null;
    error: string | null;
};

export type AnalysisResult = {
    diagnostics: LegalDiagnostic[];
    outline: DraftNode[];
    intervals: NumericIntervalItem[];
    references: CrossReferenceItem[];
    terms: TermStatusItem[];
    termOccurrences?: TermOccurrence[];
    metrics: QualityMetrics;
    workspaceScope: WorkspaceScopeInfo;
    lean: LeanVerificationReport | null;
    analyzedAt: string;
    durationMs: number;
    aiStatus: AiAuditStatus;
};

export type DraftDocument = {
    id: string;
    title: string;
    documentNumber: string | null;
    documentType: string | null;
    agency: string | null;
    content: string;
    sourceDocumentId: string | null;
    isTemplate: boolean;
    createdAt: string;
    updatedAt: string;
};

export type DraftSummary = {
    id: string;
    title: string;
    documentNumber: string | null;
    documentType: string | null;
    agency: string | null;
    sourceDocumentId: string | null;
    isTemplate: boolean;
    updatedAt: string;
    errorCount: number;
    warningCount: number;
    infoCount: number;
};

export type DraftListResponse = {
    drafts: DraftSummary[];
    templates: DraftSummary[];
};

export type DraftWithAnalysis = {
    draft: DraftDocument;
    analysis: AnalysisResult;
};

export type WorkspaceSourceKind = "CORPUS" | "DRAFT";

export type WorkspaceBasisItem = {
    id: string;
    label: string;
    documentNumber: string | null;
    documentType: string | null;
    sourceKind: WorkspaceSourceKind;
    sourceLabel: string;
    insertText: string;
    documentation: string;
};

export type WorkspacePatternItem = {
    id: string;
    label: string;
    detail: string;
    insertBody: string;
    sourceKind: WorkspaceSourceKind;
    sourceLabel: string;
    documentation: string;
};

export type WorkspaceProvisionRef = {
    id: string;
    documentId: string;
    documentLabel: string;
    provisionId: string;
    refLabel: string;
    title: string | null;
    excerpt: string;
    sourceKind: WorkspaceSourceKind;
};

export type WorkspaceDefinedTerm = {
    term: string;
    normalizedTerm: string;
    definition: string;
    sourceDocumentId: string | null;
    sourceProvisionId: string | null;
    sourceLabel: string;
    sourceKind: WorkspaceSourceKind;
};

export type WorkspaceContext = {
    corpusDocumentCount: number;
    savedDraftCount: number;
    bases: WorkspaceBasisItem[];
    articlePatterns: WorkspacePatternItem[];
    clausePatterns: WorkspacePatternItem[];
    pointPatterns: WorkspacePatternItem[];
    provisions: WorkspaceProvisionRef[];
    definedTerms: WorkspaceDefinedTerm[];
};

export type VerdictOutcome =
    | "GUILTY_SANCTIONED"
    | "ACQUITTED_LOOPHOLE"
    | "CONFLICT_AMBIGUOUS"
    | "PARTIALLY_ENFORCEABLE"
    | "NOT_COVERED";

export type DebugTraceStep = {
    stepNumber: number;
    line: number;
    provisionRef: string;
    status: "MATCHED" | "SKIPPED" | "LOOPHOLE_HIT" | "CONFLICT_HIT" | "UNENFORCEABLE_TERM" | "AMBIGUOUS_BRANCH";
    condition: string;
    evaluation: string;
    leanCheck: string;
    diagnosticCode: string | null;
};

export type AmbiguityDecisionItem = {
    id: string;
    code: string;
    term: string;
    provisionRef: string;
    line: number;
    question: string;
    trueLabel: string;
    falseLabel: string;
    selectedValue: boolean | null;
};

export type ExploitedDefect = {
    code: string;
    category: DiagnosticCategory;
    title: string;
    impactInCourt: string;
};

export type JudgeVerdict = {
    outcome: VerdictOutcome;
    outcomeLabel: string;
    summary: string;
    applicableFine: { min: number; max: number } | null;
    additionalSanctions: string[];
    nonMonetarySanctions?: {
        kind: string;
        label: string;
        minMonths: number | null;
        maxMonths: number | null;
        provisionRef: string | null;
    }[];
    citations?: {
        provisionRef: string;
        verbatimQuote: string;
        sourceDocument?: string | null;
    }[];
    exploitedDefects: ExploitedDefect[];
    judicialReasoning: string[];
    lawmakerAction: string;
};

export type DebugSimulationResult = {
    scenario: string;
    extractedFacts: { label: string; value: string }[];
    trace: DebugTraceStep[];
    ambiguities: AmbiguityDecisionItem[];
    verdict: JudgeVerdict;
    workspaceOnly: boolean;
    method: "LEAN_SYMBOLIC" | "LEAN_PLUS_AI";
    durationMs: number;
    tokenUsage?: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        decisionInputTokens?: number;
    };
    llmCalls?: number;
};

export function parseDraftListResponse(value: unknown): DraftListResponse | null {
    if (!isRecord(value)) {
        return null;
    }

    const rawDrafts = readArray(value, "drafts");
    const rawTemplates = readArray(value, "templates");

    if (!rawDrafts || !rawTemplates) {
        return null;
    }

    return {
        drafts: rawDrafts.map(parseDraftSummary).filter((item): item is DraftSummary => item !== null),
        templates: rawTemplates.map(parseDraftSummary).filter((item): item is DraftSummary => item !== null),
    };
}

export function parseDraftWithAnalysis(value: unknown): DraftWithAnalysis | null {
    if (!isRecord(value)) {
        return null;
    }

    const draft = parseDraftDocument(value.draft);
    const analysis = parseAnalysisResult(value.analysis);

    if (!draft || !analysis) {
        return null;
    }

    return { draft, analysis };
}

export function parseAnalysisResult(value: unknown): AnalysisResult | null {
    if (!isRecord(value)) {
        return null;
    }

    const rawDiagnostics = readArray(value, "diagnostics");
    const rawOutline = readArray(value, "outline");
    const rawIntervals = readArray(value, "intervals");
    const rawReferences = readArray(value, "references");
    const metrics = parseMetrics(value.metrics);
    const aiStatus = parseAiStatus(value.aiStatus);
    const analyzedAt = readString(value, "analyzedAt");
    const durationMs = readNumber(value, "durationMs");

    if (!rawDiagnostics || !rawOutline || !rawIntervals || !rawReferences || !metrics || !aiStatus || !analyzedAt || durationMs === null) {
        return null;
    }

    const rawTerms = readArray(value, "terms") ?? [];

    return {
        diagnostics: rawDiagnostics.map(parseDiagnostic).filter((item): item is LegalDiagnostic => item !== null),
        outline: rawOutline.map(parseDraftNode).filter((item): item is DraftNode => item !== null),
        intervals: rawIntervals.map(parseInterval).filter((item): item is NumericIntervalItem => item !== null),
        references: rawReferences.map(parseReference).filter((item): item is CrossReferenceItem => item !== null),
        terms: rawTerms.map(parseTermStatus).filter((item): item is TermStatusItem => item !== null),
        metrics,
        workspaceScope: parseWorkspaceScope(value.workspaceScope),
        lean: parseLeanReport(value.lean),
        analyzedAt,
        durationMs,
        aiStatus,
    };
}

export function parseWorkspaceContext(value: unknown): WorkspaceContext | null {
    if (!isRecord(value)) {
        return null;
    }

    const bases = (readArray(value, "bases") ?? []).map(parseWorkspaceBasis).filter((item): item is WorkspaceBasisItem => item !== null);
    const articlePatterns = (readArray(value, "articlePatterns") ?? []).map(parseWorkspacePattern).filter((item): item is WorkspacePatternItem => item !== null);
    const clausePatterns = (readArray(value, "clausePatterns") ?? []).map(parseWorkspacePattern).filter((item): item is WorkspacePatternItem => item !== null);
    const pointPatterns = (readArray(value, "pointPatterns") ?? []).map(parseWorkspacePattern).filter((item): item is WorkspacePatternItem => item !== null);
    const provisions = (readArray(value, "provisions") ?? []).map(parseWorkspaceProvision).filter((item): item is WorkspaceProvisionRef => item !== null);
    const definedTerms = (readArray(value, "definedTerms") ?? []).map(parseWorkspaceTerm).filter((item): item is WorkspaceDefinedTerm => item !== null);

    return {
        corpusDocumentCount: readNumber(value, "corpusDocumentCount") ?? 0,
        savedDraftCount: readNumber(value, "savedDraftCount") ?? 0,
        bases,
        articlePatterns,
        clausePatterns,
        pointPatterns,
        provisions,
        definedTerms,
    };
}

export function parseDebugSimulationResult(value: unknown): DebugSimulationResult | null {
    if (!isRecord(value)) {
        return null;
    }

    const scenario = readString(value, "scenario");
    const verdict = parseJudgeVerdict(value.verdict);
    const durationMs = readNumber(value, "durationMs");

    if (!scenario || !verdict || durationMs === null) {
        return null;
    }

    const extractedFacts = (readArray(value, "extractedFacts") ?? [])
        .map((item) => {
            if (!isRecord(item)) {
                return null;
            }

            const label = readString(item, "label");
            const val = readString(item, "value");

            return label && val ? { label, value: val } : null;
        })
        .filter((item): item is { label: string; value: string } => item !== null);

    const trace = (readArray(value, "trace") ?? []).map(parseDebugStep).filter((item): item is DebugTraceStep => item !== null);
    const ambiguities = (readArray(value, "ambiguities") ?? []).map(parseAmbiguityItem).filter((item): item is AmbiguityDecisionItem => item !== null);

    return {
        scenario,
        extractedFacts,
        trace,
        ambiguities,
        verdict,
        workspaceOnly: readBoolean(value, "workspaceOnly") ?? true,
        method: value.method === "LEAN_PLUS_AI" ? "LEAN_PLUS_AI" : "LEAN_SYMBOLIC",
        durationMs,
    };
}

function parseAmbiguityItem(value: unknown): AmbiguityDecisionItem | null {
    if (!isRecord(value)) {
        return null;
    }

    const id = readString(value, "id");
    const code = readString(value, "code");
    const term = readString(value, "term");
    const provisionRef = readString(value, "provisionRef");
    const line = readNumber(value, "line");
    const question = readString(value, "question");
    const trueLabel = readString(value, "trueLabel");
    const falseLabel = readString(value, "falseLabel");

    if (!id || !code || !term || !provisionRef || line === null || !question || !trueLabel || !falseLabel) {
        return null;
    }

    return {
        id,
        code,
        term,
        provisionRef,
        line,
        question,
        trueLabel,
        falseLabel,
        selectedValue: typeof value.selectedValue === "boolean" ? value.selectedValue : null,
    };
}

function parseDraftSummary(value: unknown): DraftSummary | null {
    if (!isRecord(value)) {
        return null;
    }

    const id = readString(value, "id");
    const title = readString(value, "title");
    const updatedAt = readString(value, "updatedAt");

    if (!id || !title || !updatedAt) {
        return null;
    }

    return {
        id,
        title,
        documentNumber: readString(value, "documentNumber"),
        documentType: readString(value, "documentType"),
        agency: readString(value, "agency"),
        sourceDocumentId: readString(value, "sourceDocumentId"),
        isTemplate: readBoolean(value, "isTemplate") ?? false,
        updatedAt,
        errorCount: readNumber(value, "errorCount") ?? 0,
        warningCount: readNumber(value, "warningCount") ?? 0,
        infoCount: readNumber(value, "infoCount") ?? 0,
    };
}

function parseDraftDocument(value: unknown): DraftDocument | null {
    if (!isRecord(value)) {
        return null;
    }

    const id = readString(value, "id");
    const title = readString(value, "title");
    const content = typeof value.content === "string" ? value.content : null;
    const createdAt = readString(value, "createdAt");
    const updatedAt = readString(value, "updatedAt");

    if (!id || !title || content === null || !createdAt || !updatedAt) {
        return null;
    }

    return {
        id,
        title,
        documentNumber: readString(value, "documentNumber"),
        documentType: readString(value, "documentType"),
        agency: readString(value, "agency"),
        content,
        sourceDocumentId: readString(value, "sourceDocumentId"),
        isTemplate: readBoolean(value, "isTemplate") ?? false,
        createdAt,
        updatedAt,
    };
}

function parseDiagnostic(value: unknown): LegalDiagnostic | null {
    if (!isRecord(value)) {
        return null;
    }

    const id = readString(value, "id");
    const code = readString(value, "code");
    const category = readCategory(value.category);
    const severity = readSeverity(value.severity);
    const title = readString(value, "title");
    const message = readString(value, "message");
    const exploitScenario = readString(value, "exploitScenario");
    const suggestion = readString(value, "suggestion");
    const excerpt = typeof value.excerpt === "string" ? value.excerpt : null;
    const range = parseRange(value.range);
    const source = readSource(value.source);

    if (!id || !code || !category || !severity || !title || !message || !exploitScenario || !suggestion || excerpt === null || !range || !source) {
        return null;
    }

    return {
        id,
        code,
        category,
        severity,
        title,
        message,
        exploitScenario,
        suggestion,
        excerpt,
        provisionRef: readString(value, "provisionRef"),
        range,
        source,
        quickFix: parseQuickFix(value.quickFix),
        corpusLink: parseCorpusLink(value.corpusLink),
        leanTheorem: readString(value, "leanTheorem"),
        counterexample: readString(value, "counterexample"),
    };
}

function parseRange(value: unknown): TextRange | null {
    if (!isRecord(value)) {
        return null;
    }

    const startLine = readNumber(value, "startLine");
    const endLine = readNumber(value, "endLine");
    const startCol = readNumber(value, "startCol");
    const endCol = readNumber(value, "endCol");
    const startOffset = readNumber(value, "startOffset");
    const endOffset = readNumber(value, "endOffset");

    if (startLine === null || endLine === null || startCol === null || endCol === null || startOffset === null || endOffset === null) {
        return null;
    }

    return { startLine, endLine, startCol, endCol, startOffset, endOffset };
}

function parseQuickFix(value: unknown): QuickFix | null {
    if (!isRecord(value)) {
        return null;
    }

    const label = readString(value, "label");
    const replacement = typeof value.replacement === "string" ? value.replacement : null;
    const startOffset = readNumber(value, "startOffset");
    const endOffset = readNumber(value, "endOffset");

    if (!label || replacement === null || startOffset === null || endOffset === null) {
        return null;
    }

    return { label, replacement, startOffset, endOffset };
}

function parseCorpusLink(value: unknown): CorpusLink | null {
    if (!isRecord(value)) {
        return null;
    }

    const documentId = readString(value, "documentId");
    const documentLabel = readString(value, "documentLabel");

    if (!documentId || !documentLabel) {
        return null;
    }

    return {
        documentId,
        documentLabel,
        provisionId: readString(value, "provisionId"),
        excerpt: typeof value.excerpt === "string" ? value.excerpt : "",
    };
}

function parseDraftNode(value: unknown): DraftNode | null {
    if (!isRecord(value)) {
        return null;
    }

    const id = readString(value, "id");
    const level = readNodeLevel(value.level);
    const number = readString(value, "number");
    const refLabel = readString(value, "refLabel");
    const startLine = readNumber(value, "startLine");
    const endLine = readNumber(value, "endLine");
    const startOffset = readNumber(value, "startOffset");
    const endOffset = readNumber(value, "endOffset");

    if (!id || !level || !number || !refLabel || startLine === null || endLine === null || startOffset === null || endOffset === null) {
        return null;
    }

    const counts = isRecord(value.diagnosticCounts) ? value.diagnosticCounts : {};

    return {
        id,
        parentId: readString(value, "parentId"),
        level,
        number,
        title: readString(value, "title"),
        text: typeof value.text === "string" ? value.text : "",
        refLabel,
        startLine,
        endLine,
        startOffset,
        endOffset,
        diagnosticCounts: {
            error: readNumber(counts, "error") ?? 0,
            warning: readNumber(counts, "warning") ?? 0,
            info: readNumber(counts, "info") ?? 0,
        },
    };
}

function parseInterval(value: unknown): NumericIntervalItem | null {
    if (!isRecord(value)) {
        return null;
    }

    const id = readString(value, "id");
    const metric = readString(value, "metric");
    const unit = readString(value, "unit");
    const line = readNumber(value, "line");
    const status = readIntervalStatus(value.status);
    const startOffset = readNumber(value, "startOffset");
    const endOffset = readNumber(value, "endOffset");

    if (!id || !metric || !unit || line === null || !status || startOffset === null || endOffset === null) {
        return null;
    }

    return {
        id,
        metric,
        unit,
        min: readNumber(value, "min"),
        max: readNumber(value, "max"),
        minInclusive: readBoolean(value, "minInclusive") ?? true,
        maxInclusive: readBoolean(value, "maxInclusive") ?? true,
        fineMin: readNumber(value, "fineMin"),
        fineMax: readNumber(value, "fineMax"),
        provisionRef: readString(value, "provisionRef"),
        line,
        status,
        startOffset,
        endOffset,
    };
}

function parseReference(value: unknown): CrossReferenceItem | null {
    if (!isRecord(value)) {
        return null;
    }

    const id = readString(value, "id");
    const rawText = readString(value, "rawText");
    const targetRef = readString(value, "targetRef");
    const line = readNumber(value, "line");
    const status = readRefStatus(value.status);
    const startOffset = readNumber(value, "startOffset");
    const endOffset = readNumber(value, "endOffset");

    if (!id || !rawText || !targetRef || line === null || !status || startOffset === null || endOffset === null) {
        return null;
    }

    return {
        id,
        rawText,
        fromRef: readString(value, "fromRef"),
        targetRef,
        line,
        status,
        startOffset,
        endOffset,
    };
}

function parseTermStatus(value: unknown): TermStatusItem | null {
    if (!isRecord(value)) {
        return null;
    }

    const term = readString(value, "term");
    const normalizedTerm = readString(value, "normalizedTerm");
    const line = readNumber(value, "line");
    const startOffset = readNumber(value, "startOffset");
    const endOffset = readNumber(value, "endOffset");

    if (!term || !normalizedTerm || line === null || startOffset === null || endOffset === null) {
        return null;
    }

    const status = value.status === "DEFINED_IN_DRAFT" || value.status === "DEFINED_IN_WORKSPACE"
        ? value.status
        : "UNDEFINED";

    return {
        term,
        normalizedTerm,
        status,
        definedBy: readString(value, "definedBy"),
        definition: readString(value, "definition"),
        sourceDocumentId: readString(value, "sourceDocumentId"),
        sourceProvisionId: readString(value, "sourceProvisionId"),
        line,
        startOffset,
        endOffset,
    };
}

function parseWorkspaceScope(value: unknown): WorkspaceScopeInfo {
    if (!isRecord(value)) {
        return { corpusDocumentCount: 0, savedDraftCount: 0, strictlyWorkspaceOnly: true };
    }

    return {
        corpusDocumentCount: readNumber(value, "corpusDocumentCount") ?? 0,
        savedDraftCount: readNumber(value, "savedDraftCount") ?? 0,
        strictlyWorkspaceOnly: readBoolean(value, "strictlyWorkspaceOnly") ?? true,
    };
}

function parseLeanReport(value: unknown): LeanVerificationReport | null {
    if (!isRecord(value)) {
        return null;
    }

    const leanCode = typeof value.leanCode === "string" ? value.leanCode : null;
    const rawObligations = readArray(value, "obligations");
    const tokenStatsRaw = isRecord(value.tokenStats) ? value.tokenStats : null;

    if (leanCode === null || !rawObligations || !tokenStatsRaw) {
        return null;
    }

    return {
        engine: readString(value, "engine") ?? "BUILTIN_KERNEL",
        leanVersion: readString(value, "leanVersion") ?? "Lean 4.12",
        leanCode,
        obligations: rawObligations.map(parseLeanObligation).filter((item): item is LeanObligation => item !== null),
        provedCount: readNumber(value, "provedCount") ?? 0,
        refutedCount: readNumber(value, "refutedCount") ?? 0,
        tokenStats: {
            naiveFullTokens: readNumber(tokenStatsRaw, "naiveFullTokens") ?? 0,
            actualAiTokens: readNumber(tokenStatsRaw, "actualAiTokens") ?? 0,
            savedPercent: readNumber(tokenStatsRaw, "savedPercent") ?? 100,
            totalClauses: readNumber(tokenStatsRaw, "totalClauses") ?? 0,
            deterministicClauses: readNumber(tokenStatsRaw, "deterministicClauses") ?? 0,
            aiEscalatedClauses: readNumber(tokenStatsRaw, "aiEscalatedClauses") ?? 0,
            strategy: readString(tokenStatsRaw, "strategy") ?? "",
        },
    };
}

function parseLeanObligation(value: unknown): LeanObligation | null {
    if (!isRecord(value)) {
        return null;
    }

    const id = readString(value, "id");
    const theoremName = readString(value, "theoremName");
    const leanStatement = readString(value, "leanStatement");
    const line = readNumber(value, "line");

    if (!id || !theoremName || !leanStatement || line === null) {
        return null;
    }

    return {
        id,
        theoremName,
        kind: readString(value, "kind") ?? "FINE_BOUNDS",
        status: value.status === "PROVED" ? "PROVED" : "REFUTED",
        tactic: readString(value, "tactic") ?? "omega",
        line,
        provisionRef: readString(value, "provisionRef"),
        leanStatement,
        counterexample: readString(value, "counterexample"),
        diagnosticCode: readString(value, "diagnosticCode"),
    };
}

function parseWorkspaceBasis(value: unknown): WorkspaceBasisItem | null {
    if (!isRecord(value)) {
        return null;
    }

    const id = readString(value, "id");
    const label = readString(value, "label");
    const insertText = readString(value, "insertText");

    if (!id || !label || !insertText) {
        return null;
    }

    return {
        id,
        label,
        documentNumber: readString(value, "documentNumber"),
        documentType: readString(value, "documentType"),
        sourceKind: value.sourceKind === "CORPUS" ? "CORPUS" : "DRAFT",
        sourceLabel: readString(value, "sourceLabel") ?? "Workspace",
        insertText,
        documentation: readString(value, "documentation") ?? "",
    };
}

function parseWorkspacePattern(value: unknown): WorkspacePatternItem | null {
    if (!isRecord(value)) {
        return null;
    }

    const id = readString(value, "id");
    const label = readString(value, "label");
    const insertBody = typeof value.insertBody === "string" ? value.insertBody : null;

    if (!id || !label || insertBody === null) {
        return null;
    }

    return {
        id,
        label,
        detail: readString(value, "detail") ?? "Workspace",
        insertBody,
        sourceKind: value.sourceKind === "CORPUS" ? "CORPUS" : "DRAFT",
        sourceLabel: readString(value, "sourceLabel") ?? "Workspace",
        documentation: readString(value, "documentation") ?? "",
    };
}

function parseWorkspaceProvision(value: unknown): WorkspaceProvisionRef | null {
    if (!isRecord(value)) {
        return null;
    }

    const id = readString(value, "id");
    const documentId = readString(value, "documentId");
    const documentLabel = readString(value, "documentLabel");
    const provisionId = readString(value, "provisionId");
    const refLabel = readString(value, "refLabel");

    if (!id || !documentId || !documentLabel || !provisionId || !refLabel) {
        return null;
    }

    return {
        id,
        documentId,
        documentLabel,
        provisionId,
        refLabel,
        title: readString(value, "title"),
        excerpt: typeof value.excerpt === "string" ? value.excerpt : "",
        sourceKind: value.sourceKind === "CORPUS" ? "CORPUS" : "DRAFT",
    };
}

function parseWorkspaceTerm(value: unknown): WorkspaceDefinedTerm | null {
    if (!isRecord(value)) {
        return null;
    }

    const term = readString(value, "term");
    const normalizedTerm = readString(value, "normalizedTerm");

    if (!term || !normalizedTerm) {
        return null;
    }

    return {
        term,
        normalizedTerm,
        definition: typeof value.definition === "string" ? value.definition : "",
        sourceDocumentId: readString(value, "sourceDocumentId"),
        sourceProvisionId: readString(value, "sourceProvisionId"),
        sourceLabel: readString(value, "sourceLabel") ?? "Workspace",
        sourceKind: value.sourceKind === "CORPUS" ? "CORPUS" : "DRAFT",
    };
}

function parseDebugStep(value: unknown): DebugTraceStep | null {
    if (!isRecord(value)) {
        return null;
    }

    const stepNumber = readNumber(value, "stepNumber");
    const line = readNumber(value, "line");
    const provisionRef = readString(value, "provisionRef");
    const condition = readString(value, "condition");
    const evaluation = readString(value, "evaluation");
    const leanCheck = readString(value, "leanCheck");

    if (stepNumber === null || line === null || !provisionRef || !condition || !evaluation || !leanCheck) {
        return null;
    }

    const status = value.status === "MATCHED"
        || value.status === "SKIPPED"
        || value.status === "LOOPHOLE_HIT"
        || value.status === "CONFLICT_HIT"
        || value.status === "UNENFORCEABLE_TERM"
        || value.status === "AMBIGUOUS_BRANCH"
        ? value.status
        : "SKIPPED";

    return {
        stepNumber,
        line,
        provisionRef,
        status,
        condition,
        evaluation,
        leanCheck,
        diagnosticCode: readString(value, "diagnosticCode"),
    };
}

function parseJudgeVerdict(value: unknown): JudgeVerdict | null {
    if (!isRecord(value)) {
        return null;
    }

    const outcome = value.outcome === "GUILTY_SANCTIONED"
        || value.outcome === "ACQUITTED_LOOPHOLE"
        || value.outcome === "CONFLICT_AMBIGUOUS"
        || value.outcome === "PARTIALLY_ENFORCEABLE"
        || value.outcome === "NOT_COVERED"
        ? value.outcome
        : null;
    const outcomeLabel = readString(value, "outcomeLabel");
    const summary = readString(value, "summary");
    const lawmakerAction = readString(value, "lawmakerAction");

    if (!outcome || !outcomeLabel || !summary || !lawmakerAction) {
        return null;
    }

    const fineRaw = isRecord(value.applicableFine) ? value.applicableFine : null;
    const fineMin = fineRaw ? readNumber(fineRaw, "min") : null;
    const fineMax = fineRaw ? readNumber(fineRaw, "max") : null;
    const applicableFine = fineMin !== null && fineMax !== null ? { min: fineMin, max: fineMax } : null;

    const additionalSanctions = (readArray(value, "additionalSanctions") ?? []).filter((item): item is string => typeof item === "string");
    const judicialReasoning = (readArray(value, "judicialReasoning") ?? []).filter((item): item is string => typeof item === "string");
    const exploitedDefects = (readArray(value, "exploitedDefects") ?? [])
        .map((item) => {
            if (!isRecord(item)) {
                return null;
            }

            const code = readString(item, "code");
            const category = readCategory(item.category);
            const title = readString(item, "title");
            const impactInCourt = readString(item, "impactInCourt");

            return code && category && title && impactInCourt ? { code, category, title, impactInCourt } : null;
        })
        .filter((item): item is ExploitedDefect => item !== null);

    return {
        outcome,
        outcomeLabel,
        summary,
        applicableFine,
        additionalSanctions,
        exploitedDefects,
        judicialReasoning,
        lawmakerAction,
    };
}

function parseMetrics(value: unknown): QualityMetrics | null {
    if (!isRecord(value)) {
        return null;
    }

    const overallScore = readNumber(value, "overallScore");
    const loopholeScore = readNumber(value, "loopholeScore");
    const clarityScore = readNumber(value, "clarityScore");
    const logicScore = readNumber(value, "logicScore");

    if (overallScore === null || loopholeScore === null || clarityScore === null || logicScore === null) {
        return null;
    }

    const cat = isRecord(value.countsByCategory) ? value.countsByCategory : {};
    const sev = isRecord(value.countsBySeverity) ? value.countsBySeverity : {};

    return {
        overallScore,
        loopholeScore,
        clarityScore,
        logicScore,
        articleCount: readNumber(value, "articleCount") ?? 0,
        clauseCount: readNumber(value, "clauseCount") ?? 0,
        pointCount: readNumber(value, "pointCount") ?? 0,
        referenceCount: readNumber(value, "referenceCount") ?? 0,
        fineRuleCount: readNumber(value, "fineRuleCount") ?? 0,
        countsByCategory: {
            LOOPHOLE: readNumber(cat, "LOOPHOLE") ?? 0,
            AMBIGUITY: readNumber(cat, "AMBIGUITY") ?? 0,
            LOGIC: readNumber(cat, "LOGIC") ?? 0,
        },
        countsBySeverity: {
            error: readNumber(sev, "error") ?? 0,
            warning: readNumber(sev, "warning") ?? 0,
            info: readNumber(sev, "info") ?? 0,
        },
    };
}

function parseAiStatus(value: unknown): AiAuditStatus | null {
    if (!isRecord(value)) {
        return null;
    }

    return {
        used: readBoolean(value, "used") ?? false,
        model: readString(value, "model"),
        error: readString(value, "error"),
    };
}

function readCategory(value: unknown): DiagnosticCategory | null {
    return value === "LOOPHOLE" || value === "AMBIGUITY" || value === "LOGIC" ? value : null;
}

function readSeverity(value: unknown): DiagnosticSeverity | null {
    return value === "error" || value === "warning" || value === "info" ? value : null;
}

function readSource(value: unknown): DiagnosticSource | null {
    return value === "STATIC" || value === "CORPUS" || value === "AI" ? value : null;
}

function readNodeLevel(value: unknown): DraftNodeLevel | null {
    return value === "CHAPTER" || value === "ARTICLE" || value === "CLAUSE" || value === "POINT" ? value : null;
}

function readIntervalStatus(value: unknown): NumericIntervalStatus | null {
    return value === "OK" || value === "OVERLAP" || value === "GAP_BEFORE" || value === "INVERTED" ? value : null;
}

function readRefStatus(value: unknown): CrossReferenceStatus | null {
    return value === "VALID" || value === "BROKEN" || value === "SELF_REFERENCE" || value === "ORPHANED_BY_REPEAL" ? value : null;
}
