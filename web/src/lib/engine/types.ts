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
    strictlyWorkspaceOnly: true;
};

export type LeanProofStatus = "PROVED" | "REFUTED";

export type LeanObligationKind =
    | "FINE_BOUNDS"
    | "NO_GAP"
    | "DISJOINT"
    | "REF_VALID"
    | "TERM_DEFINED"
    | "SANCTION_COVERAGE"
    | "EXCEPTION_BOUNDED"
    | "PREDICATE_CLEAR"
    | "DEONTIC_CONSISTENT"
    | "AI_INVARIANT";

export type ExtractedModality = "PROHIBITED" | "OBLIGATED" | "PERMITTED" | "SANCTION";

export type ExtractedSubject = "INDIVIDUAL" | "ORGANIZATION" | "BOTH" | "UNSPECIFIED";

export type ExtractedLegalFact = {
    quote: string;
    startOffset: number;
    endOffset: number;
    line: number;
    provisionRef: string | null;
    subject: ExtractedSubject;
    modality: ExtractedModality;
    actionKey: string;
    fineMin: number | null;
    fineMax: number | null;
    thresholdUnit: string | null;
    thresholdMin: number | null;
    thresholdMax: number | null;
    hasSanction: boolean;
    hasOpenException: boolean;
    hasExceptionCriteria: boolean;
    referencedTerms: string[];
};

export type ExtractedPartitionRule = {
    domainKey: string;
    tierLabel: string;
    unit: string;
    min: number | null;
    max: number | null;
    minInclusive: boolean;
    maxInclusive: boolean;
    quote: string;
    startOffset: number;
    endOffset: number;
    line: number;
    provisionRef: string | null;
};

export type ExtractedSemanticDefect = {
    kind: "BOOLEAN_LOGIC" | "TIER_COLLAPSE" | "INTERNAL_CONTRADICTION" | "PROCEDURAL_GAP" | "UNBOUNDED_CRITERIA" | "QUANTITATIVE_PARADOX";
    severity: DiagnosticSeverity;
    title: string;
    message: string;
    suggestion: string;
    quote: string;
    secondQuote: string | null;
    startOffset: number;
    endOffset: number;
    line: number;
    provisionRef: string | null;
};

export type LeanObligation = {
    id: string;
    theoremName: string;
    kind: LeanObligationKind;
    status: LeanProofStatus;
    tactic: "omega" | "decide" | "simp";
    line: number;
    provisionRef: string | null;
    leanStatement: string;
    counterexample: string | null;
    diagnosticCode: string | null;
};

export type AiTokenBreakdown = {
    decisionInputTokens: number;
    extractInputTokens: number;
    extractOutputTokens: number;
    totalTokens: number;
    filteredByDecision: number;
    escalatedToExtract: number;
    cachedUnits: number;
};

export type LeanTokenStats = {
    naiveFullTokens: number;
    actualAiTokens: number;
    savedPercent: number;
    totalClauses: number;
    deterministicClauses: number;
    aiEscalatedClauses: number;
    strategy: string;
    tokenBreakdown?: AiTokenBreakdown;
};

export type LeanVerificationReport = {
    engine: "BUILTIN_KERNEL" | "EXTERNAL_LEAN4";
    leanVersion: string;
    leanCode: string;
    obligations: LeanObligation[];
    provedCount: number;
    refutedCount: number;
    tokenStats: LeanTokenStats;
};

export type VerdictOutcome =
    | "GUILTY_SANCTIONED"
    | "ACQUITTED_LOOPHOLE"
    | "CONFLICT_AMBIGUOUS"
    | "PARTIALLY_ENFORCEABLE"
    | "NOT_COVERED";

export type DebugTraceStatus =
    | "MATCHED"
    | "SKIPPED"
    | "LOOPHOLE_HIT"
    | "CONFLICT_HIT"
    | "UNENFORCEABLE_TERM"
    | "AMBIGUOUS_BRANCH";

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

export type DebugTraceStep = {
    stepNumber: number;
    line: number;
    provisionRef: string;
    status: DebugTraceStatus;
    condition: string;
    evaluation: string;
    leanCheck: string;
    diagnosticCode: string | null;
};

export type ExploitedDefect = {
    code: string;
    category: DiagnosticCategory;
    title: string;
    impactInCourt: string;
};

export type NonMonetarySanctionKind =
    | "IMPRISONMENT"
    | "LIFE_IMPRISONMENT"
    | "DEATH_PENALTY"
    | "NON_CUSTODIAL_REFORM"
    | "CONFISCATION"
    | "SUSPENSION"
    | "WARNING";

export type NonMonetarySanction = {
    kind: NonMonetarySanctionKind;
    label: string;
    minMonths: number | null;
    maxMonths: number | null;
    provisionRef: string | null;
};

export type DebugGroundedCitation = {
    provisionRef: string;
    verbatimQuote: string;
    sourceDocument?: string | null;
};

export type DebugTokenUsage = {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    decisionInputTokens?: number;
};

export type JudgeVerdict = {
    outcome: VerdictOutcome;
    outcomeLabel: string;
    summary: string;
    applicableFine: { min: number; max: number } | null;
    additionalSanctions: string[];
    nonMonetarySanctions?: NonMonetarySanction[];
    citations?: DebugGroundedCitation[];
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
    workspaceOnly: true;
    method: "LEAN_SYMBOLIC" | "LEAN_PLUS_AI";
    durationMs: number;
    tokenUsage?: DebugTokenUsage;
    llmCalls?: number;
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
    lean: LeanVerificationReport;
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
