import { analyzeLocalDraft } from "./analyzer";
import {
    buildProvisionKey,
    evaluateQualifiedAndNestedException,
    extractScenarioDateIso,
    resolveWorkspaceProvisionEffects,
    type CrossDocProvisionEffect,
} from "./debug-crossdoc";
import {
    computeClauseSpecificity,
    detectDeonticConflictInNodes,
    detectVehicleKind,
    extractCanonicalConcepts,
    findParentArticle,
    normalizeVietnameseLegalText,
    scoreArticleTopicMatch,
    scoreClauseMatch,
    tokenizeContentWords,
    tokenizeDistinctiveWords,
    type VehicleKind,
} from "./debug-matching";
import {
    callGeminiDecisions,
    callGeminiStructuredInteraction,
    DEFAULT_GEMINI_MODEL,
} from "./gemini-client";
import {
    extractFineRanges,
    extractNumericThresholds,
    normalizeUnit,
    parseDecimal,
    UNIT_PATTERN,
    type ExtractedFineRange,
    type ExtractedThreshold,
} from "./intervals";
import type { LocalWorkspaceFile } from "./local-workspace";
import {
    extractDocumentMetadata,
    findNodeAtOffset,
    parseDraftDocument,
    type ParsedDraft,
    type ParsedNode,
} from "./parser";
import { ORG_CONVERSION_CLAUSE } from "./rules-loophole";
import { extractNonMonetarySanctions, type ExtractedNonMonetarySanction } from "./sanctions";
import type {
    AmbiguityDecisionItem,
    DebugGroundedCitation,
    DebugSimulationResult,
    DebugTokenUsage,
    DebugTraceStep,
    ExploitedDefect,
    JudgeVerdict,
    LegalDiagnostic,
    NonMonetarySanction,
    VerdictOutcome,
} from "./types";

export type DebugSimulationInput = {
    content: string;
    scenario: string;
    workspaceFiles?: readonly LocalWorkspaceFile[];
    currentPath?: string;
    ambiguityOverrides?: Record<string, boolean>;
    useAi?: boolean;
    useDecisionGate?: boolean;
    skipVerdictRefinement?: boolean;
    apiKey?: string;
    apiBaseUrl?: string;
    model?: string;
    fetcher?: typeof fetch;
};

type ExtractedMeasurement = {
    value: number;
    unit: string;
    raw: string;
};

type ScenarioFacts = {
    measurements: ExtractedMeasurement[];
    subject: "INDIVIDUAL" | "ORGANIZATION";
    vehicle: VehicleKind;
    scenarioDateIso: string | null;
    claimsException: boolean;
    claimedExceptionText: string | null;
    mentionsMissingQuantification: boolean;
    keywords: string[];
    concepts: string[];
};

const MEASUREMENT_PATTERN = new RegExp(`(\\d+(?:[.,]\\d+)*)\\s*${UNIT_PATTERN}(?![\\p{L}\\p{N}])`, "giu");
const ORG_HINT = /\b(?:công ty|doanh nghiệp|tổ chức|hợp tác xã|tập đoàn)\b/iu;
const EXCEPTION_HINT = /(trường hợp đặc biệt|lý do chính đáng|trường hợp cần thiết|bất khả kháng)/iu;
const MISSING_QUANT_HINT = /(?:không\s+nêu\s+rõ|không\s+ghi\s+rõ|chưa\s+đo\s+đạc|chưa\s+xác\s+định|chưa\s+cân|chưa\s+rõ\s+mức\s+độ|không\s+rõ\s+bao\s+nhiêu)/iu;

const STOPWORDS = new Set([
    "người", "điều", "khiển", "phương", "tiện", "tham", "giao", "thông", "trên", "đường",
    "hành", "vi", "phạm", "thực", "hiện", "trong", "trường", "hợp", "bị", "về", "của",
    "và", "hoặc", "với", "tại", "theo", "cho", "khi", "đang", "này", "đó", "một", "các",
    "anh", "chị", "ông", "bà", "lái", "chạy", "xe", "quá", "ngày", "tháng", "năm", "triệu",
    "nhưng", "vừa", "đồng", "thời",
]);

const JUDGE_AI_SYSTEM_PROMPT = `Bạn là Thẩm phán Tòa án đang xét xử một tình huống thực tế dựa TUYỆT ĐỐI trên dự thảo văn bản hiện tại, các giả định mơ hồ đã chọn và kết quả kiểm chứng Lean 4.
KHÔNG được viện dẫn bất kỳ văn bản pháp luật nào ngoài workspace.
Trả về JSON gồm:
- summary: 1-2 câu kết luận ngắn gọn của Thẩm phán.
- judicialReasoning: mảng 2-3 lập luận ngắn gọn theo hồ sơ trace đã cung cấp.`;

const JUDGE_AI_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    required: ["summary", "judicialReasoning"],
    properties: {
        summary: { type: "string" },
        judicialReasoning: { type: "array", items: { type: "string" } },
    },
};

const CLAUSE_MAPPER_SYSTEM_PROMPT = `Bạn là trợ lý pháp lý. Cho danh sách các điều khoản (provisionRef + nội dung) trong dự thảo và một tình huống thực tế.
Hãy chọn tối đa 3 provisionRef khớp nhất với hành vi trong tình huống. Nếu không có điều khoản nào khớp, trả về mảng rỗng.`;

const CLAUSE_MAPPER_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    required: ["matchedProvisionRefs"],
    properties: {
        matchedProvisionRefs: { type: "array", items: { type: "string" } },
    },
};

export async function runLocalDebugSimulation(input: DebugSimulationInput): Promise<DebugSimulationResult> {
    const startedAt = Date.now();
    const draft = parseDraftDocument(input.content);
    const draftMeta = extractDocumentMetadata(input.content, input.currentPath);
    const fineRanges = extractFineRanges(draft);
    const thresholds = extractNumericThresholds(draft, fineRanges);
    const nonMonetaryAll = extractNonMonetarySanctions(draft);
    const analysis = await analyzeLocalDraft(input.content, input.workspaceFiles ?? [], {
        currentPath: input.currentPath,
        includeAi: false,
    });
    const overrides = input.ambiguityOverrides ?? {};
    const hasOrgConversionClause = ORG_CONVERSION_CLAUSE.test(input.content);

    const facts = extractScenarioFacts(input.scenario);
    const trace: DebugTraceStep[] = [];
    const ambiguities: AmbiguityDecisionItem[] = [];
    const exploitedDefects: ExploitedDefect[] = [];
    const matchedFine: { min: number; max: number }[] = [];
    const additionalSanctions: string[] = [];
    const nonMonetarySanctions: NonMonetarySanction[] = [];
    const citations: DebugGroundedCitation[] = [];
    const tokenUsage: DebugTokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        decisionInputTokens: 0,
    };
    let llmCalls = 0;

    // ------------------------------------------------------------------------
    // GATE 0: Temporal Validity (violation date vs effectiveDate)
    // ------------------------------------------------------------------------
    if (facts.scenarioDateIso && draftMeta.effectiveDate && facts.scenarioDateIso < draftMeta.effectiveDate) {
        const effNode = findEffectiveDateNode(draft);
        const effLine = effNode?.startLine ?? 1;
        const effRef = effNode?.refLabel ?? "Điều khoản hiệu lực";

        if (effNode) {
            pushCitation(citations, {
                provisionRef: effNode.refLabel,
                verbatimQuote: firstLineOfNode(effNode),
                sourceDocument: null,
            });
        }

        trace.push({
            stepNumber: 1,
            line: effLine,
            provisionRef: effRef,
            status: "SKIPPED",
            condition: `Kiểm tra hiệu lực thời gian (${facts.scenarioDateIso} vs ${draftMeta.effectiveDate})`,
            evaluation: `Hành vi xảy ra ngày ${facts.scenarioDateIso}, trước ngày văn bản có hiệu lực (${draftMeta.effectiveDate}) → chưa thuộc phạm vi áp dụng.`,
            leanCheck: `${facts.scenarioDateIso} < EffectiveDate(${draftMeta.effectiveDate}) → NOT_IN_FORCE`,
            diagnosticCode: null,
        });

        const preEffVerdict: JudgeVerdict = {
            outcome: "NOT_COVERED",
            outcomeLabel: "CHƯA CÓ HIỆU LỰC THI HÀNH",
            summary: `Hành vi xảy ra ngày ${facts.scenarioDateIso}, trước ngày văn bản có hiệu lực thi hành (${draftMeta.effectiveDate}), nên không thuộc phạm vi xử phạt của văn bản này.`,
            applicableFine: null,
            additionalSanctions: [],
            nonMonetarySanctions: [],
            citations,
            exploitedDefects: [],
            judicialReasoning: [
                `Ngày xảy ra hành vi (${facts.scenarioDateIso}) sớm hơn ngày văn bản có hiệu lực (${draftMeta.effectiveDate}) tại ${effRef}.`,
            ],
            lawmakerAction: "Xem xét văn bản có hiệu lực tại thời điểm xảy ra hành vi hoặc điều khoản chuyển tiếp.",
        };

        return {
            scenario: input.scenario,
            extractedFacts: buildExtractedFactList(facts),
            trace,
            ambiguities,
            verdict: preEffVerdict,
            workspaceOnly: true,
            method: "LEAN_SYMBOLIC",
            durationMs: Math.max(1, Date.now() - startedAt),
            tokenUsage,
            llmCalls: 0,
        };
    }

    // ------------------------------------------------------------------------
    // GATE 1: Cross-Document Repeal & Amendment Resolution from Workspace
    // ------------------------------------------------------------------------
    const crossDocEffects = resolveWorkspaceProvisionEffects(
        draft,
        input.workspaceFiles ?? [],
        input.currentPath,
        facts.scenarioDateIso,
    );

    const evaluatedNumericNodeIds = evaluateNumericMeasurements(
        draft,
        input.scenario,
        facts,
        thresholds,
        fineRanges,
        nonMonetaryAll,
        analysis.diagnostics,
        overrides,
        hasOrgConversionClause,
        crossDocEffects,
        trace,
        ambiguities,
        exploitedDefects,
        matchedFine,
        additionalSanctions,
        nonMonetarySanctions,
        citations,
    );

    evaluateMatchedClauses(
        draft,
        input.scenario,
        facts,
        thresholds,
        fineRanges,
        nonMonetaryAll,
        analysis.diagnostics,
        overrides,
        hasOrgConversionClause,
        crossDocEffects,
        evaluatedNumericNodeIds,
        trace,
        ambiguities,
        exploitedDefects,
        matchedFine,
        additionalSanctions,
        nonMonetarySanctions,
        citations,
    );

    let method: "LEAN_SYMBOLIC" | "LEAN_PLUS_AI" = "LEAN_SYMBOLIC";

    if (
        input.useAi
        && input.apiKey
        && input.apiKey.trim().length > 0
        && trace.length === 0
        && evaluatedNumericNodeIds.size === 0
    ) {
        let shouldEscalateToMapper = true;

        if (input.useDecisionGate) {
            const gate = await triageScenarioWithDecisionApi(draft, input.scenario, {
                apiKey: input.apiKey,
                apiBaseUrl: input.apiBaseUrl,
                fetcher: input.fetcher,
            });
            tokenUsage.decisionInputTokens = (tokenUsage.decisionInputTokens ?? 0) + gate.decisionInputTokens;
            tokenUsage.totalTokens += gate.decisionInputTokens;

            if (gate.called) {
                llmCalls += 1;
            }

            shouldEscalateToMapper = gate.shouldEscalate;
        }

        if (shouldEscalateToMapper) {
            const mapped = await mapScenarioToClausesWithAi(draft, input.scenario, {
                apiKey: input.apiKey,
                apiBaseUrl: input.apiBaseUrl,
                model: input.model ?? DEFAULT_GEMINI_MODEL,
                fetcher: input.fetcher,
            });

            if (mapped.usage) {
                tokenUsage.inputTokens += mapped.usage.inputTokens;
                tokenUsage.outputTokens += mapped.usage.outputTokens;
                tokenUsage.totalTokens += mapped.usage.totalTokens;
                llmCalls += 1;
            }

            if (mapped.nodes.length > 0) {
                method = "LEAN_PLUS_AI";
                evaluateClauseList(
                    draft,
                    input.scenario,
                    mapped.nodes,
                    facts,
                    thresholds,
                    fineRanges,
                    nonMonetaryAll,
                    analysis.diagnostics,
                    overrides,
                    hasOrgConversionClause,
                    crossDocEffects,
                    trace,
                    ambiguities,
                    exploitedDefects,
                    matchedFine,
                    additionalSanctions,
                    nonMonetarySanctions,
                    citations,
                );
            }
        }
    }

    let verdict = synthesizeVerdict(
        facts,
        trace,
        ambiguities,
        exploitedDefects,
        matchedFine,
        additionalSanctions,
        nonMonetarySanctions,
        citations,
    );

    if (
        input.useAi
        && !input.skipVerdictRefinement
        && input.apiKey
        && input.apiKey.trim().length > 0
    ) {
        const refined = await refineVerdictWithAi(input.scenario, trace, verdict, {
            apiKey: input.apiKey,
            apiBaseUrl: input.apiBaseUrl,
            model: input.model ?? DEFAULT_GEMINI_MODEL,
            fetcher: input.fetcher,
        });

        if (refined?.usage) {
            tokenUsage.inputTokens += refined.usage.inputTokens;
            tokenUsage.outputTokens += refined.usage.outputTokens;
            tokenUsage.totalTokens += refined.usage.totalTokens;
            llmCalls += 1;
        }

        if (refined) {
            verdict = {
                ...verdict,
                summary: refined.summary,
                judicialReasoning: refined.judicialReasoning,
            };
            method = "LEAN_PLUS_AI";
        }
    }

    return {
        scenario: input.scenario,
        extractedFacts: buildExtractedFactList(facts),
        trace,
        ambiguities,
        verdict,
        workspaceOnly: true,
        method,
        durationMs: Math.max(1, Date.now() - startedAt),
        tokenUsage,
        llmCalls,
    };
}

function findEffectiveDateNode(draft: ParsedDraft): ParsedNode | null {
    return draft.nodes.find(
        (node) => (node.level === "CLAUSE" || node.level === "POINT") && /có\s+hiệu\s+lực/iu.test(node.text),
    ) ?? draft.nodes.find((node) => node.level === "ARTICLE" && /hiệu\s+lực/iu.test(node.title ?? "")) ?? null;
}

function firstLineOfNode(node: ParsedNode): string {
    return node.text.split("\n")[0]?.trim() ?? node.text.trim();
}

function extractScenarioFacts(scenario: string): ScenarioFacts {
    const measurements: ExtractedMeasurement[] = [];

    for (const match of scenario.matchAll(MEASUREMENT_PATTERN)) {
        const rawVal = parseDecimal(match[1]);
        let unit = normalizeUnit(match[2]);
        let value = rawVal;

        if (unit === "tỷ đồng") {
            value = rawVal * 1000;
            unit = "triệu đồng";
        }

        if (unit === "ngày") {
            const before = scenario.slice(Math.max(0, match.index - 10), match.index);

            if (/tháng\s*$/iu.test(before)) {
                continue;
            }
        }

        if (Number.isFinite(value)) {
            measurements.push({ value, unit, raw: match[0] });
        }
    }

    const subject = ORG_HINT.test(scenario) ? "ORGANIZATION" : "INDIVIDUAL";
    const vehicle = detectVehicleKind(scenario);
    const scenarioDateIso = extractScenarioDateIso(scenario);
    const exceptionMatch = EXCEPTION_HINT.exec(scenario);
    const normalizedScenario = normalizeVietnameseLegalText(scenario);
    const keywords = normalizedScenario
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((word) => word.length >= 2 && !STOPWORDS.has(word));
    const concepts = extractCanonicalConcepts(scenario);

    return {
        measurements,
        subject,
        vehicle,
        scenarioDateIso,
        claimsException: Boolean(exceptionMatch),
        claimedExceptionText: exceptionMatch?.[1] ?? null,
        mentionsMissingQuantification: MISSING_QUANT_HINT.test(scenario),
        keywords: [...new Set(keywords)],
        concepts,
    };
}

function filterThresholdsByTopicAndVehicle(
    draft: ParsedDraft,
    scenario: string,
    facts: ScenarioFacts,
    candidates: readonly ExtractedThreshold[],
): ExtractedThreshold[] {
    let filtered = [...candidates];

    if (facts.vehicle !== null) {
        const vehicleTagged = filtered.map((item) => {
            const node = findNodeAtOffset(draft.nodes, item.startOffset);
            const parentArticle = node ? findParentArticle(draft.nodes, node) : null;
            const itemVehicle = detectVehicleKind(`${parentArticle?.title ?? ""} ${node?.text ?? ""}`);

            return { item, itemVehicle };
        });

        if (vehicleTagged.some((entry) => entry.itemVehicle === facts.vehicle)) {
            filtered = vehicleTagged
                .filter((entry) => entry.itemVehicle === facts.vehicle || entry.itemVehicle === null)
                .map((entry) => entry.item);
        }
    }

    const distinctArticles = [...new Set(filtered.map((item) => item.articleNo).filter((a): a is string => a !== null))];

    if (distinctArticles.length > 1) {
        const articleScores = distinctArticles.map((artNo) => {
            const artNode = draft.nodes.find((n) => n.level === "ARTICLE" && n.articleNo === artNo);
            const artThresholdsText = filtered
                .filter((item) => item.articleNo === artNo)
                .map((item) => findNodeAtOffset(draft.nodes, item.startOffset)?.text ?? item.excerpt)
                .join(" ");
            const score = scoreArticleTopicMatch(artNode?.title ?? null, artThresholdsText, scenario);

            return { artNo, score };
        });

        articleScores.sort((a, b) => b.score - a.score);
        const bestScore = articleScores[0]?.score ?? 0;

        if (bestScore > 0) {
            const winningArticles = new Set(
                articleScores.filter((entry) => entry.score >= bestScore).map((entry) => entry.artNo),
            );
            filtered = filtered.filter((item) => item.articleNo !== null && winningArticles.has(item.articleNo));
        }
    }

    return filtered;
}

function getSanctionsForNode(
    draft: ParsedDraft,
    node: ParsedNode,
    allSanctions: readonly ExtractedNonMonetarySanction[],
): ExtractedNonMonetarySanction[] {
    const direct = allSanctions.filter(
        (s) => s.startOffset >= node.startOffset && s.startOffset <= node.endOffset,
    );

    if (direct.length > 0) {
        return direct;
    }

    if (node.level === "POINT" && node.parentId) {
        const parentClause = draft.nodes.find((n) => n.id === node.parentId);

        if (parentClause) {
            const parentFirstLineEnd = parentClause.startOffset + firstLineOfNode(parentClause).length + 20;

            return allSanctions.filter(
                (s) => s.startOffset >= parentClause.startOffset && s.startOffset <= parentFirstLineEnd,
            );
        }
    }

    return [];
}

function evaluateNumericMeasurements(
    draft: ParsedDraft,
    scenario: string,
    facts: ScenarioFacts,
    thresholds: readonly ExtractedThreshold[],
    fineRanges: readonly ExtractedFineRange[],
    nonMonetaryAll: readonly ExtractedNonMonetarySanction[],
    diagnostics: readonly LegalDiagnostic[],
    overrides: Record<string, boolean>,
    hasOrgConversionClause: boolean,
    crossDocEffects: ReadonlyMap<string, CrossDocProvisionEffect>,
    trace: DebugTraceStep[],
    ambiguities: AmbiguityDecisionItem[],
    exploitedDefects: ExploitedDefect[],
    matchedFine: { min: number; max: number }[],
    additionalSanctions: string[],
    nonMonetarySanctions: NonMonetarySanction[],
    citations: DebugGroundedCitation[],
): Set<string> {
    const evaluatedNodeIds = new Set<string>();

    for (const measurement of facts.measurements) {
        const rawSameUnit = thresholds.filter((item) => item.unit === measurement.unit);

        if (rawSameUnit.length === 0) {
            continue;
        }

        const sameUnit = filterThresholdsByTopicAndVehicle(draft, scenario, facts, rawSameUnit);

        for (const item of sameUnit) {
            for (const node of draft.nodes) {
                if (
                    (node.level === "CLAUSE" || node.level === "POINT")
                    && item.startOffset >= node.startOffset
                    && item.startOffset <= node.endOffset
                ) {
                    evaluatedNodeIds.add(node.id);
                }
            }
        }

        const hits = sameUnit.filter((item) => matchesThreshold(measurement.value, item));

        if (hits.length === 0) {
            const minBound = Math.min(...sameUnit.map((item) => item.min ?? Infinity));
            const maxBound = Math.max(...sameUnit.map((item) => item.max ?? -Infinity));

            if (measurement.value > minBound && measurement.value < maxBound) {
                const gapDiag = diagnostics.find(
                    (diag) => diag.code === "LP003"
                        && sameUnit.some((u) => u.articleNo && diag.provisionRef?.includes(`Điều ${u.articleNo}`)),
                ) ?? diagnostics.find((diag) => diag.code === "LP003");
                const targetLine = gapDiag?.range.startLine ?? sameUnit[0].line;
                const refLabel = gapDiag?.provisionRef ?? sameUnit[0].provisionRef ?? `Dòng ${targetLine}`;
                const intervalsDesc = sameUnit.map((item) => `[${item.min ?? "?"}, ${item.max ?? "∞"}]`).join(" ∧ ");

                for (const u of sameUnit.slice(0, 2)) {
                    const uNode = findNodeAtOffset(draft.nodes, u.startOffset);

                    if (uNode) {
                        pushCitation(citations, {
                            provisionRef: uNode.refLabel,
                            verbatimQuote: firstLineOfNode(uNode),
                            sourceDocument: null,
                        });
                    }
                }

                trace.push({
                    stepNumber: trace.length + 1,
                    line: targetLine,
                    provisionRef: refLabel,
                    status: "LOOPHOLE_HIT",
                    condition: `Kiểm tra ngưỡng ${measurement.raw}`,
                    evaluation: `Giá trị ${measurement.raw} rơi vào khoảng trống giữa các khung phạt — không khớp bất kỳ điều khoản nào.`,
                    leanCheck: `${measurement.value} ∉ ${intervalsDesc} → UNCOVERED`,
                    diagnosticCode: "LP003",
                });

                pushDefect(exploitedDefects, {
                    code: "LP003",
                    category: "LOOPHOLE",
                    title: gapDiag?.title ?? `Khoảng trống định lượng tại mức ${measurement.raw}`,
                    impactInCourt: `Luật sư bào chữa chứng minh được ${measurement.raw} không thuộc khung phạt nào; Tòa buộc tuyên không đủ căn cứ xử phạt.`,
                });
            }

            continue;
        }

        if (hits.length >= 2) {
            const first = hits[0];
            const second = hits[1];

            for (const h of [first, second]) {
                const hNode = findNodeAtOffset(draft.nodes, h.startOffset);

                if (hNode) {
                    pushCitation(citations, {
                        provisionRef: hNode.refLabel,
                        verbatimQuote: firstLineOfNode(hNode),
                        sourceDocument: null,
                    });
                }
            }

            trace.push({
                stepNumber: trace.length + 1,
                line: second.line,
                provisionRef: second.provisionRef ?? `Dòng ${second.line}`,
                status: "CONFLICT_HIT",
                condition: `Kiểm tra ngưỡng ${measurement.raw}`,
                evaluation: `Giá trị ${measurement.raw} khớp đồng thời cả "${first.excerpt}" và "${second.excerpt}".`,
                leanCheck: `${measurement.value} ∈ [${first.min}, ${first.max ?? "∞"}] ∧ ${measurement.value} ∈ [${second.min}, ${second.max ?? "∞"}] → AMBIGUOUS`,
                diagnosticCode: "LG002",
            });

            pushDefect(exploitedDefects, {
                code: "LG002",
                category: "LOGIC",
                title: `Chồng chéo ngưỡng định lượng tại mốc ${measurement.raw}`,
                impactInCourt: "Hai điều khoản có mức phạt khác nhau cùng áp dụng cho một hành vi, vi phạm nguyên tắc áp dụng có lợi cho người vi phạm.",
            });

            continue;
        }

        const hit = hits[0];
        const hitNode = findNodeAtOffset(draft.nodes, hit.startOffset);
        const crossEffect = hitNode ? lookupCrossDocEffect(hitNode, crossDocEffects) : null;

        if (hitNode && crossEffect?.kind === "REPEALED") {
            recordCrossDocRepeal(hitNode, crossEffect, trace, exploitedDefects, citations);
            continue;
        }

        const effectiveNodeText = crossEffect?.kind === "AMENDED" && crossEffect.amendedText
            ? crossEffect.amendedText
            : (hitNode?.text ?? "");

        // Evaluate qualified / nested exceptions (e.g. "trừ trường hợp có văn bản gia hạn; không áp dụng miễn trừ nếu...")
        if (effectiveNodeText) {
            const excResult = evaluateQualifiedAndNestedException(effectiveNodeText, scenario);

            if (excResult.outcome === "EXEMPT_VALID") {
                if (hitNode) {
                    pushCitation(citations, {
                        provisionRef: hitNode.refLabel,
                        verbatimQuote: firstLineOfNode(hitNode),
                        sourceDocument: null,
                    });
                }

                trace.push({
                    stepNumber: trace.length + 1,
                    line: hit.line,
                    provisionRef: hit.provisionRef ?? `Dòng ${hit.line}`,
                    status: "SKIPPED",
                    condition: `Kiểm tra ngoại lệ "${excResult.exceptionText}"`,
                    evaluation: `Tình huống thỏa mãn điều kiện ngoại lệ hợp lệ "${excResult.exceptionText}" nên không bị xử phạt.`,
                    leanCheck: `QualifiedException = true ∧ Override = false → EXEMPT`,
                    diagnosticCode: null,
                });

                continue;
            }
        }

        // Check cross-document amendment fine override
        let lineFine = findFineForThreshold(draft, fineRanges, hit);

        if (crossEffect?.kind === "AMENDED" && crossEffect.amendedText) {
            const amendedDraft = parseDraftDocument(crossEffect.amendedText);
            const amendedFines = extractFineRanges(amendedDraft);

            if (amendedFines.length > 0) {
                lineFine = amendedFines[0];
            }

            pushCitation(citations, {
                provisionRef: crossEffect.sourceProvisionRef,
                verbatimQuote: crossEffect.verbatimQuote,
                sourceDocument: crossEffect.sourceDocLabel,
            });
        }

        if (lineFine && lineFine.min > lineFine.max) {
            if (hitNode) {
                pushCitation(citations, {
                    provisionRef: hitNode.refLabel,
                    verbatimQuote: firstLineOfNode(hitNode),
                    sourceDocument: null,
                });
            }

            trace.push({
                stepNumber: trace.length + 1,
                line: hit.line,
                provisionRef: hit.provisionRef ?? `Dòng ${hit.line}`,
                status: "CONFLICT_HIT",
                condition: `Khớp ngưỡng ${hit.excerpt}, kiểm tra khung phạt`,
                evaluation: `Khung tiền phạt bị đảo ngược (${lineFine.minRaw}đ > ${lineFine.maxRaw}đ), tạo khoảng rỗng về mặt toán học.`,
                leanCheck: `${lineFine.min} ≤ ${lineFine.max} → FALSE`,
                diagnosticCode: "LG001",
            });

            pushDefect(exploitedDefects, {
                code: "LG001",
                category: "LOGIC",
                title: "Khung tiền phạt bị đảo ngược (min > max)",
                impactInCourt: "Quyết định xử phạt bị Tòa tuyên hủy do mức phạt tối thiểu lớn hơn mức tối đa.",
            });

            continue;
        }

        // Check criminal / non-monetary sanctions on matched threshold node (including inverted prison bounds!)
        const nodeNonMonetary = hitNode ? getSanctionsForNode(draft, hitNode, nonMonetaryAll) : [];
        const invertedPrison = nodeNonMonetary.find((s) => s.kind === "IMPRISONMENT" && s.inverted);

        if (invertedPrison) {
            if (hitNode) {
                pushCitation(citations, {
                    provisionRef: hitNode.refLabel,
                    verbatimQuote: firstLineOfNode(hitNode),
                    sourceDocument: null,
                });
            }

            trace.push({
                stepNumber: trace.length + 1,
                line: hit.line,
                provisionRef: hit.provisionRef ?? `Dòng ${hit.line}`,
                status: "CONFLICT_HIT",
                condition: `Khớp ngưỡng ${hit.excerpt}, kiểm tra khung phạt tù`,
                evaluation: `Khung hình phạt tù bị đảo ngược ("${invertedPrison.label}": ${invertedPrison.minMonths} tháng > ${invertedPrison.maxMonths} tháng).`,
                leanCheck: `${invertedPrison.minMonths} ≤ ${invertedPrison.maxMonths} → FALSE`,
                diagnosticCode: "LG001",
            });

            pushDefect(exploitedDefects, {
                code: "LG001",
                category: "LOGIC",
                title: "Khung hình phạt tù bị đảo ngược (min > max)",
                impactInCourt: "Khung hình phạt tù vô hiệu về mặt toán học, Tòa không thể tuyên án thống nhất.",
            });

            continue;
        }

        let orgDoubled = false;
        let effectiveFine: { min: number; max: number } | null = null;

        if (facts.subject === "ORGANIZATION" && lineFine?.subject === "INDIVIDUAL") {
            if (!hasOrgConversionClause) {
                if (hitNode) {
                    pushCitation(citations, {
                        provisionRef: hitNode.refLabel,
                        verbatimQuote: firstLineOfNode(hitNode),
                        sourceDocument: null,
                    });
                }

                trace.push({
                    stepNumber: trace.length + 1,
                    line: hit.line,
                    provisionRef: hit.provisionRef ?? `Dòng ${hit.line}`,
                    status: "LOOPHOLE_HIT",
                    condition: `Khớp ${hit.excerpt}, kiểm tra chủ thể vi phạm (Tổ chức)`,
                    evaluation: "Điều khoản chỉ quy định mức phạt cho 'cá nhân', không quy định đối với tổ chức/doanh nghiệp.",
                    leanCheck: "Subject = ORGANIZATION ∧ ClauseSubject = INDIVIDUAL → NOT_APPLICABLE",
                    diagnosticCode: "LP006",
                });

                pushDefect(exploitedDefects, {
                    code: "LP006",
                    category: "LOOPHOLE",
                    title: "Bỏ sót chủ thể tổ chức",
                    impactInCourt: "Doanh nghiệp viện dẫn điều khoản chỉ áp dụng cho cá nhân để bác bỏ quyết định xử phạt.",
                });

                continue;
            }

            orgDoubled = true;
            effectiveFine = { min: lineFine.min * 2, max: lineFine.max * 2 };
        } else if (lineFine) {
            effectiveFine = { min: lineFine.min, max: lineFine.max };
        } else if (hit.fineMin !== null && hit.fineMax !== null) {
            effectiveFine = { min: hit.fineMin, max: hit.fineMax };
        }

        const lineAmbiguities = diagnostics.filter(
            (diag) => diag.range.startLine === hit.line && (diag.code === "AM001" || diag.code === "AM002" || diag.code === "AM003"),
        );

        let blockedByAmbiguity = false;

        for (const ambDiag of lineAmbiguities) {
            const decision = buildAmbiguityDecision(ambDiag, overrides);
            pushAmbiguity(ambiguities, decision);

            if (hitNode) {
                pushCitation(citations, {
                    provisionRef: hitNode.refLabel,
                    verbatimQuote: firstLineOfNode(hitNode),
                    sourceDocument: null,
                });
            }

            if (decision.selectedValue === null) {
                blockedByAmbiguity = true;
                trace.push({
                    stepNumber: trace.length + 1,
                    line: hit.line,
                    provisionRef: hit.provisionRef ?? `Dòng ${hit.line}`,
                    status: "AMBIGUOUS_BRANCH",
                    condition: decision.question,
                    evaluation: `Điều khoản chứa yếu tố mơ hồ "${ambDiag.excerpt}". Hãy chọn giả định để kiểm thử logic phân nhánh.`,
                    leanCheck: `Ambiguity("${ambDiag.excerpt}") = ?`,
                    diagnosticCode: ambDiag.code,
                });
            } else if (decision.selectedValue === false) {
                blockedByAmbiguity = true;
                trace.push({
                    stepNumber: trace.length + 1,
                    line: hit.line,
                    provisionRef: hit.provisionRef ?? `Dòng ${hit.line}`,
                    status: "SKIPPED",
                    condition: decision.question,
                    evaluation: `Giả định: KHÔNG thỏa mãn "${ambDiag.excerpt}" → không áp dụng khung phạt này.`,
                    leanCheck: `Assume("${ambDiag.excerpt}" = false) → SKIP`,
                    diagnosticCode: ambDiag.code,
                });
            } else {
                trace.push({
                    stepNumber: trace.length + 1,
                    line: hit.line,
                    provisionRef: hit.provisionRef ?? `Dòng ${hit.line}`,
                    status: "MATCHED",
                    condition: decision.question,
                    evaluation: `Giả định: CÓ thỏa mãn "${ambDiag.excerpt}" → tiếp tục áp dụng khung phạt.`,
                    leanCheck: `Assume("${ambDiag.excerpt}" = true) → APPLY`,
                    diagnosticCode: ambDiag.code,
                });
            }
        }

        if (blockedByAmbiguity) {
            continue;
        }

        if (effectiveFine) {
            matchedFine.push(effectiveFine);
        }

        for (const nm of nodeNonMonetary) {
            pushNonMonetary(additionalSanctions, nonMonetarySanctions, nm);
        }

        if (hitNode) {
            pushCitation(citations, {
                provisionRef: hitNode.refLabel,
                verbatimQuote: firstLineOfNode(hitNode),
                sourceDocument: null,
            });
        }

        const fineNote = effectiveFine
            ? ` từ ${effectiveFine.min.toLocaleString("vi-VN")}đ đến ${effectiveFine.max.toLocaleString("vi-VN")}đ${orgDoubled ? " (quy đổi gấp 02 lần cho tổ chức)" : ""}`
            : nodeNonMonetary.length > 0
                ? `: ${nodeNonMonetary.map((s) => s.label).join(", ")}`
                : "";

        trace.push({
            stepNumber: trace.length + 1,
            line: hit.line,
            provisionRef: hit.provisionRef ?? `Dòng ${hit.line}`,
            status: "MATCHED",
            condition: `Khớp ngưỡng ${hit.excerpt}`,
            evaluation: `Áp dụng được chế tài${fineNote}.`,
            leanCheck: orgDoubled && lineFine
                ? `${measurement.value} ∈ [${hit.min}, ${hit.max ?? "∞"}] ∧ OrgFine = 2 × [${lineFine.min}, ${lineFine.max}] → MATCHED`
                : `${measurement.value} ∈ [${hit.min}, ${hit.max ?? "∞"}] → MATCHED`,
            diagnosticCode: null,
        });

        if (hitNode) {
            evaluateNodeSanctionIssues(
                draft,
                hitNode,
                diagnostics,
                overrides,
                trace,
                ambiguities,
                exploitedDefects,
                additionalSanctions,
            );
        }
    }

    return evaluatedNodeIds;
}

function evaluateMatchedClauses(
    draft: ParsedDraft,
    scenario: string,
    facts: ScenarioFacts,
    thresholds: readonly ExtractedThreshold[],
    fineRanges: readonly ExtractedFineRange[],
    nonMonetaryAll: readonly ExtractedNonMonetarySanction[],
    diagnostics: readonly LegalDiagnostic[],
    overrides: Record<string, boolean>,
    hasOrgConversionClause: boolean,
    crossDocEffects: ReadonlyMap<string, CrossDocProvisionEffect>,
    evaluatedNumericNodeIds: ReadonlySet<string>,
    trace: DebugTraceStep[],
    ambiguities: AmbiguityDecisionItem[],
    exploitedDefects: ExploitedDefect[],
    matchedFine: { min: number; max: number }[],
    additionalSanctions: string[],
    nonMonetarySanctions: NonMonetarySanction[],
    citations: DebugGroundedCitation[],
): void {
    if (facts.keywords.length === 0 && facts.concepts.length === 0) {
        return;
    }

    const scoredNodes: {
        node: ParsedNode;
        score: number;
        concepts: string[];
        distinctiveTokens: Set<string>;
        specificity: { matchedDistinctive: number; totalDistinctive: number; ratio: number };
    }[] = [];

    for (const node of draft.nodes) {
        if (node.level !== "CLAUSE" && node.level !== "POINT") {
            continue;
        }

        if (evaluatedNumericNodeIds.has(node.id)) {
            continue;
        }

        if (trace.some((step) => step.line >= node.startLine && step.line <= node.endLine)) {
            continue;
        }

        const parentArticle = findParentArticle(draft.nodes, node);

        if (parentArticle?.title && /hiệu\s+lực|giải\s+thích\s+từ\s+ngữ|nguyên\s+tắc/iu.test(parentArticle.title)) {
            continue;
        }

        const score = scoreClauseMatch(node, parentArticle, facts.keywords, facts.concepts, facts.vehicle);

        if (score > 0) {
            const specificity = computeClauseSpecificity(node.text, scenario);
            const concepts = extractCanonicalConcepts(node.text);
            const hasConceptHit = concepts.some((c) => facts.concepts.includes(c));

            // When a numeric violation already matched, require strong topical evidence to pull in a secondary clause
            if (evaluatedNumericNodeIds.size > 0 && !hasConceptHit && (specificity.matchedDistinctive < 2 || specificity.ratio < 0.35)) {
                continue;
            }

            // Even without prior numeric matches, drop weak generic overlaps unless a concept matches
            if (!hasConceptHit && specificity.matchedDistinctive < 2) {
                continue;
            }

            scoredNodes.push({
                node,
                score,
                concepts,
                distinctiveTokens: new Set(tokenizeDistinctiveWords(node.text)),
                specificity,
            });
        }
    }

    if (scoredNodes.length === 0) {
        return;
    }

    scoredNodes.sort((left, right) => right.score - left.score);

    // Greedy Set-Cover selection: supports BOTH single-offense precision AND multi-violation recall!
    const topScore = scoredNodes[0].score;
    const scenarioDistinctive = tokenizeDistinctiveWords(scenario);
    const coveredConcepts = new Set<string>();
    const coveredTokens = new Set<string>();
    const candidateNodes: ParsedNode[] = [];

    for (const entry of scoredNodes) {
        const newConceptHits = entry.concepts.filter((c) => facts.concepts.includes(c) && !coveredConcepts.has(c));
        const newTokenHits = scenarioDistinctive.filter((kw) => entry.distinctiveTokens.has(kw) && !coveredTokens.has(kw));
        const isDeonticPairCandidate = candidateNodes.length > 0
            && entry.score >= Math.max(2, topScore - 2)
            && detectDeonticConflictInNodes([candidateNodes[0], entry.node], draft.nodes) !== null;
        const addsDistinctViolation = newConceptHits.length >= 1
            || (newTokenHits.length >= 2 && entry.specificity.ratio >= 0.3);

        if (candidateNodes.length === 0 || isDeonticPairCandidate || addsDistinctViolation) {
            candidateNodes.push(entry.node);

            for (const c of newConceptHits) {
                coveredConcepts.add(c);
            }

            for (const t of newTokenHits) {
                coveredTokens.add(t);
            }

            if (candidateNodes.length >= 6) {
                break;
            }
        }
    }

    const selectedNodes = candidateNodes.filter((node) => {
        if (node.level !== "CLAUSE") {
            return true;
        }

        return !candidateNodes.some(
            (other) => other.id !== node.id && other.level === "POINT" && other.startOffset >= node.startOffset && other.endOffset <= node.endOffset,
        );
    });

    evaluateClauseList(
        draft,
        scenario,
        selectedNodes,
        facts,
        thresholds,
        fineRanges,
        nonMonetaryAll,
        diagnostics,
        overrides,
        hasOrgConversionClause,
        crossDocEffects,
        trace,
        ambiguities,
        exploitedDefects,
        matchedFine,
        additionalSanctions,
        nonMonetarySanctions,
        citations,
    );
}

function evaluateClauseList(
    draft: ParsedDraft,
    scenario: string,
    selectedNodes: readonly ParsedNode[],
    facts: ScenarioFacts,
    thresholds: readonly ExtractedThreshold[],
    fineRanges: readonly ExtractedFineRange[],
    nonMonetaryAll: readonly ExtractedNonMonetarySanction[],
    diagnostics: readonly LegalDiagnostic[],
    overrides: Record<string, boolean>,
    hasOrgConversionClause: boolean,
    crossDocEffects: ReadonlyMap<string, CrossDocProvisionEffect>,
    trace: DebugTraceStep[],
    ambiguities: AmbiguityDecisionItem[],
    exploitedDefects: ExploitedDefect[],
    matchedFine: { min: number; max: number }[],
    additionalSanctions: string[],
    nonMonetarySanctions: NonMonetarySanction[],
    citations: DebugGroundedCitation[],
): void {
    const deonticConflict = detectDeonticConflictInNodes(selectedNodes, draft.nodes);

    if (deonticConflict) {
        const { prohibitedNode, permittedNode } = deonticConflict;

        pushCitation(citations, {
            provisionRef: prohibitedNode.refLabel,
            verbatimQuote: firstLineOfNode(prohibitedNode),
            sourceDocument: null,
        });
        pushCitation(citations, {
            provisionRef: permittedNode.refLabel,
            verbatimQuote: firstLineOfNode(permittedNode),
            sourceDocument: null,
        });

        trace.push({
            stepNumber: trace.length + 1,
            line: permittedNode.startLine,
            provisionRef: permittedNode.refLabel,
            status: "CONFLICT_HIT",
            condition: `Kiểm tra mâu thuẫn đạo nghĩa giữa ${prohibitedNode.refLabel} và ${permittedNode.refLabel}`,
            evaluation: `${prohibitedNode.refLabel} quy định cấm/xử phạt trong khi ${permittedNode.refLabel} lại cho phép cùng hành vi.`,
            leanCheck: `Prohibited(${prohibitedNode.refLabel}) ∧ Permitted(${permittedNode.refLabel}) → DEONTIC_CONFLICT`,
            diagnosticCode: "DEONTIC_CONFLICT",
        });

        pushDefect(exploitedDefects, {
            code: "DEONTIC_CONFLICT",
            category: "LOGIC",
            title: "Mâu thuẫn đạo nghĩa (Cấm và Cho phép đồng thời)",
            impactInCourt: "Hai quy phạm trong dự thảo mâu thuẫn trực tiếp (vừa cấm vừa cho phép), không thể tuyên phạt thống nhất.",
        });

        return;
    }

    const abstainedThresholdArticles = new Set<string>();

    for (const node of selectedNodes) {
        if (node.articleNo && abstainedThresholdArticles.has(node.articleNo)) {
            continue;
        }

        // Check cross-document repeal or amendment first
        const crossEffect = lookupCrossDocEffect(node, crossDocEffects);

        if (crossEffect?.kind === "REPEALED") {
            recordCrossDocRepeal(node, crossEffect, trace, exploitedDefects, citations);
            continue;
        }

        // Abstention Gate: if this clause requires a quantitative measurement (part of a threshold-tiered article)
        // and the scenario omitted any measurement in that unit, DO NOT guess Clause 1's fine!
        const nodeThreshold = thresholds.find(
            (th) => th.startOffset >= node.startOffset && th.startOffset <= node.endOffset,
        );

        if (nodeThreshold) {
            const hasScenarioMeasurementInUnit = facts.measurements.some((m) => m.unit === nodeThreshold.unit);
            const sameArticleThresholds = thresholds.filter(
                (th) => th.articleNo === nodeThreshold.articleNo && th.unit === nodeThreshold.unit,
            );

            if (!hasScenarioMeasurementInUnit && (sameArticleThresholds.length >= 2 || facts.mentionsMissingQuantification)) {
                if (node.articleNo) {
                    abstainedThresholdArticles.add(node.articleNo);
                }

                pushCitation(citations, {
                    provisionRef: node.refLabel,
                    verbatimQuote: firstLineOfNode(node),
                    sourceDocument: null,
                });

                trace.push({
                    stepNumber: trace.length + 1,
                    line: node.startLine,
                    provisionRef: node.refLabel,
                    status: "AMBIGUOUS_BRANCH",
                    condition: `Yêu cầu dữ kiện định lượng (${nodeThreshold.unit}) để chọn khung xử phạt`,
                    evaluation: `Điều khoản phân chia khung theo đơn vị "${nodeThreshold.unit}" nhưng tình huống không cung cấp giá trị định lượng — Tòa từ chối suy đoán.`,
                    leanCheck: `RequiredMeasurement("${nodeThreshold.unit}") = MISSING → ABSTAIN`,
                    diagnosticCode: "INSUFFICIENT_FACTS",
                });

                pushDefect(exploitedDefects, {
                    code: "INSUFFICIENT_FACTS",
                    category: "AMBIGUITY",
                    title: `Thiếu dữ kiện định lượng (${nodeThreshold.unit})`,
                    impactInCourt: "Hồ sơ tình huống không cung cấp giá trị đo đạc cần thiết để xác định khung xử phạt hợp lệ.",
                });

                continue;
            }
        }

        const nodeDiags = diagnostics.filter(
            (diag) => diag.range.startLine >= node.startLine && diag.range.endLine <= node.endLine,
        );

        const lp002 = nodeDiags.find((diag) => diag.code === "LP002");

        if (lp002) {
            pushCitation(citations, {
                provisionRef: node.refLabel,
                verbatimQuote: firstLineOfNode(node),
                sourceDocument: null,
            });

            trace.push({
                stepNumber: trace.length + 1,
                line: node.startLine,
                provisionRef: node.refLabel,
                status: "LOOPHOLE_HIT",
                condition: `Khớp hành vi tại ${node.refLabel}`,
                evaluation: "Điều khoản nêu lệnh cấm nhưng không có mức phạt tiền hay chế tài kèm theo.",
                leanCheck: `HasSanction "${node.refLabel}" = false → UNSANCTIONED`,
                diagnosticCode: "LP002",
            });

            pushDefect(exploitedDefects, {
                code: "LP002",
                category: "LOOPHOLE",
                title: lp002.title,
                impactInCourt: "Tòa tuyên không thể xử phạt vì hành vi bị cấm không có điều khoản chế tài tương ứng.",
            });

            continue;
        }

        const lp001 = nodeDiags.find((diag) => diag.code === "LP001");

        if (lp001 && facts.claimsException) {
            const decision = buildAmbiguityDecision(lp001, overrides);
            pushAmbiguity(ambiguities, decision);
            pushCitation(citations, {
                provisionRef: node.refLabel,
                verbatimQuote: firstLineOfNode(node),
                sourceDocument: null,
            });

            if (decision.selectedValue === false) {
                trace.push({
                    stepNumber: trace.length + 1,
                    line: node.startLine,
                    provisionRef: node.refLabel,
                    status: "MATCHED",
                    condition: decision.question,
                    evaluation: `Giả định: Tòa BÁC BỎ viện dẫn "${lp001.excerpt}" → vẫn xem xét xử phạt.`,
                    leanCheck: `Assume(AcceptException = false) → PROSECUTE`,
                    diagnosticCode: lp001.code,
                });
            } else {
                trace.push({
                    stepNumber: trace.length + 1,
                    line: node.startLine,
                    provisionRef: node.refLabel,
                    status: "LOOPHOLE_HIT",
                    condition: decision.question,
                    evaluation: `Điều khoản có ngoại lệ mở "${lp001.excerpt}" không kèm tiêu chí định lượng hoặc dẫn chiếu.`,
                    leanCheck: `ExceptionHasCriteria "${lp001.excerpt}" = false → EXEMPT_LOOPHOLE`,
                    diagnosticCode: "LP001",
                });

                pushDefect(exploitedDefects, {
                    code: "LP001",
                    category: "LOOPHOLE",
                    title: lp001.title,
                    impactInCourt: `Bị đơn viện dẫn "${facts.claimedExceptionText}" để được miễn trách nhiệm do luật không quy định điều kiện bác bỏ.`,
                });

                continue;
            }
        }

        // Qualified & Nested Exception evaluation (with double negation override)
        const effectiveText = crossEffect?.kind === "AMENDED" && crossEffect.amendedText
            ? crossEffect.amendedText
            : node.text;
        const excEval = evaluateQualifiedAndNestedException(effectiveText, scenario);

        if (excEval.outcome === "EXEMPT_VALID") {
            pushCitation(citations, {
                provisionRef: node.refLabel,
                verbatimQuote: firstLineOfNode(node),
                sourceDocument: null,
            });

            trace.push({
                stepNumber: trace.length + 1,
                line: node.startLine,
                provisionRef: node.refLabel,
                status: "SKIPPED",
                condition: `Kiểm tra ngoại lệ hợp lệ "${excEval.exceptionText}"`,
                evaluation: `Tình huống thỏa mãn điều kiện ngoại lệ "${excEval.exceptionText}" và không thuộc trường hợp loại trừ miễn trừ → miễn xử phạt.`,
                leanCheck: `QualifiedException = true ∧ Override = false → EXEMPT`,
                diagnosticCode: null,
            });

            continue;
        }

        const ambInClause = nodeDiags.find(
            (diag) => diag.code === "AM001" || diag.code === "AM002" || diag.code === "AM003",
        );

        if (ambInClause) {
            const decision = buildAmbiguityDecision(ambInClause, overrides);
            pushAmbiguity(ambiguities, decision);
            pushCitation(citations, {
                provisionRef: node.refLabel,
                verbatimQuote: firstLineOfNode(node),
                sourceDocument: null,
            });

            if (decision.selectedValue === null) {
                trace.push({
                    stepNumber: trace.length + 1,
                    line: node.startLine,
                    provisionRef: node.refLabel,
                    status: "AMBIGUOUS_BRANCH",
                    condition: decision.question,
                    evaluation: `Điều khoản chứa yếu tố mơ hồ "${ambInClause.excerpt}". Chọn cách diễn giải để kiểm thử.`,
                    leanCheck: `Ambiguity("${ambInClause.excerpt}") = ?`,
                    diagnosticCode: ambInClause.code,
                });

                continue;
            }

            if (decision.selectedValue === false) {
                trace.push({
                    stepNumber: trace.length + 1,
                    line: node.startLine,
                    provisionRef: node.refLabel,
                    status: "SKIPPED",
                    condition: decision.question,
                    evaluation: `Giả định: KHÔNG thỏa mãn "${ambInClause.excerpt}" → bỏ qua điều khoản này.`,
                    leanCheck: `Assume("${ambInClause.excerpt}" = false) → SKIP`,
                    diagnosticCode: ambInClause.code,
                });

                continue;
            }
        }

        // Resolve fine (using cross-doc amended fine if applicable!)
        let nodeFine = fineRanges.find(
            (fine) => fine.startOffset >= node.startOffset && fine.startOffset <= node.endOffset,
        );

        if (crossEffect?.kind === "AMENDED" && crossEffect.amendedText) {
            const amendedDraft = parseDraftDocument(crossEffect.amendedText);
            const amendedFines = extractFineRanges(amendedDraft);

            if (amendedFines.length > 0) {
                nodeFine = amendedFines[0];
            }

            pushCitation(citations, {
                provisionRef: crossEffect.sourceProvisionRef,
                verbatimQuote: crossEffect.verbatimQuote,
                sourceDocument: crossEffect.sourceDocLabel,
            });
        }

        if (nodeFine && nodeFine.min > nodeFine.max) {
            pushCitation(citations, {
                provisionRef: node.refLabel,
                verbatimQuote: firstLineOfNode(node),
                sourceDocument: null,
            });

            trace.push({
                stepNumber: trace.length + 1,
                line: node.startLine,
                provisionRef: node.refLabel,
                status: "CONFLICT_HIT",
                condition: `Khớp hành vi tại ${node.refLabel}`,
                evaluation: `Khung tiền phạt bị đảo ngược (${nodeFine.minRaw}đ > ${nodeFine.maxRaw}đ).`,
                leanCheck: `${nodeFine.min} ≤ ${nodeFine.max} → FALSE`,
                diagnosticCode: "LG001",
            });

            pushDefect(exploitedDefects, {
                code: "LG001",
                category: "LOGIC",
                title: "Khung tiền phạt bị đảo ngược (min > max)",
                impactInCourt: "Quyết định xử phạt bị Tòa tuyên hủy do mức phạt tối thiểu lớn hơn mức tối đa.",
            });

            continue;
        }

        const nodeNonMonetary = getSanctionsForNode(draft, node, nonMonetaryAll);
        const invertedPrison = nodeNonMonetary.find((s) => s.kind === "IMPRISONMENT" && s.inverted);

        if (invertedPrison) {
            pushCitation(citations, {
                provisionRef: node.refLabel,
                verbatimQuote: firstLineOfNode(node),
                sourceDocument: null,
            });

            trace.push({
                stepNumber: trace.length + 1,
                line: node.startLine,
                provisionRef: node.refLabel,
                status: "CONFLICT_HIT",
                condition: `Khớp hành vi tại ${node.refLabel}`,
                evaluation: `Khung hình phạt tù bị đảo ngược ("${invertedPrison.label}").`,
                leanCheck: `${invertedPrison.minMonths} ≤ ${invertedPrison.maxMonths} → FALSE`,
                diagnosticCode: "LG001",
            });

            pushDefect(exploitedDefects, {
                code: "LG001",
                category: "LOGIC",
                title: "Khung hình phạt tù bị đảo ngược (min > max)",
                impactInCourt: "Khung hình phạt tù vô hiệu về mặt toán học.",
            });

            continue;
        }

        if (nodeFine) {
            if (facts.subject === "ORGANIZATION" && nodeFine.subject === "INDIVIDUAL") {
                if (!hasOrgConversionClause) {
                    pushCitation(citations, {
                        provisionRef: node.refLabel,
                        verbatimQuote: firstLineOfNode(node),
                        sourceDocument: null,
                    });

                    trace.push({
                        stepNumber: trace.length + 1,
                        line: node.startLine,
                        provisionRef: node.refLabel,
                        status: "LOOPHOLE_HIT",
                        condition: `Khớp hành vi tại ${node.refLabel} (Tổ chức)`,
                        evaluation: "Điều khoản chỉ quy định mức phạt cho 'cá nhân', không quy định đối với tổ chức/doanh nghiệp.",
                        leanCheck: "Subject = ORGANIZATION ∧ ClauseSubject = INDIVIDUAL → NOT_APPLICABLE",
                        diagnosticCode: "LP006",
                    });

                    pushDefect(exploitedDefects, {
                        code: "LP006",
                        category: "LOOPHOLE",
                        title: "Bỏ sót chủ thể tổ chức",
                        impactInCourt: "Doanh nghiệp viện dẫn điều khoản chỉ áp dụng cho cá nhân để bác bỏ quyết định xử phạt.",
                    });

                    continue;
                }

                const doubled = { min: nodeFine.min * 2, max: nodeFine.max * 2 };
                matchedFine.push(doubled);
                pushCitation(citations, {
                    provisionRef: node.refLabel,
                    verbatimQuote: firstLineOfNode(node),
                    sourceDocument: null,
                });
                trace.push({
                    stepNumber: trace.length + 1,
                    line: node.startLine,
                    provisionRef: node.refLabel,
                    status: "MATCHED",
                    condition: `Khớp hành vi tại ${node.refLabel}`,
                    evaluation: `Áp dụng khung phạt từ ${doubled.min.toLocaleString("vi-VN")}đ đến ${doubled.max.toLocaleString("vi-VN")}đ (quy đổi gấp 02 lần cho tổ chức).`,
                    leanCheck: `OrgFine = 2 × [${nodeFine.min}, ${nodeFine.max}] → MATCHED`,
                    diagnosticCode: null,
                });
            } else {
                matchedFine.push({ min: nodeFine.min, max: nodeFine.max });
                pushCitation(citations, {
                    provisionRef: node.refLabel,
                    verbatimQuote: firstLineOfNode(node),
                    sourceDocument: null,
                });
                const amendNote = crossEffect?.kind === "AMENDED"
                    ? ` (đã cập nhật theo ${crossEffect.sourceDocLabel})`
                    : "";
                const overrideNote = excEval.outcome === "EXEMPTION_OVERRIDDEN"
                    ? ` (phủ định kép loại trừ miễn trừ do "${excEval.overrideText}")`
                    : "";
                trace.push({
                    stepNumber: trace.length + 1,
                    line: node.startLine,
                    provisionRef: node.refLabel,
                    status: "MATCHED",
                    condition: `Khớp hành vi tại ${node.refLabel}`,
                    evaluation: `Áp dụng khung phạt từ ${nodeFine.min.toLocaleString("vi-VN")}đ đến ${nodeFine.max.toLocaleString("vi-VN")}đ${amendNote}${overrideNote}.`,
                    leanCheck: `${nodeFine.min} ≤ ${nodeFine.max} → MATCHED`,
                    diagnosticCode: null,
                });
            }
        } else if (nodeNonMonetary.length > 0) {
            pushCitation(citations, {
                provisionRef: node.refLabel,
                verbatimQuote: firstLineOfNode(node),
                sourceDocument: null,
            });

            for (const nm of nodeNonMonetary) {
                pushNonMonetary(additionalSanctions, nonMonetarySanctions, nm);
            }

            trace.push({
                stepNumber: trace.length + 1,
                line: node.startLine,
                provisionRef: node.refLabel,
                status: "MATCHED",
                condition: `Khớp hành vi tại ${node.refLabel}`,
                evaluation: `Áp dụng chế tài phi tiền tệ: ${nodeNonMonetary.map((s) => s.label).join(", ")}.`,
                leanCheck: `SanctionValid("${node.refLabel}") → MATCHED`,
                diagnosticCode: null,
            });
        }

        if (nodeFine && nodeNonMonetary.length > 0) {
            for (const nm of nodeNonMonetary) {
                pushNonMonetary(additionalSanctions, nonMonetarySanctions, nm);
            }
        }

        evaluateNodeSanctionIssues(
            draft,
            node,
            diagnostics,
            overrides,
            trace,
            ambiguities,
            exploitedDefects,
            additionalSanctions,
        );
    }
}

function lookupCrossDocEffect(
    node: ParsedNode,
    effects: ReadonlyMap<string, CrossDocProvisionEffect>,
): CrossDocProvisionEffect | null {
    if (effects.size === 0) {
        return null;
    }

    const exactKey = buildProvisionKey(node);

    if (exactKey && effects.has(exactKey)) {
        return effects.get(exactKey) ?? null;
    }

    if (node.articleNo && node.clauseNo) {
        const clauseKey = `d:${node.articleNo.toLowerCase()}|k:${node.clauseNo}`;

        if (effects.has(clauseKey)) {
            return effects.get(clauseKey) ?? null;
        }
    }

    if (node.articleNo) {
        const artKey = `d:${node.articleNo.toLowerCase()}`;

        if (effects.has(artKey)) {
            return effects.get(artKey) ?? null;
        }
    }

    return null;
}

function recordCrossDocRepeal(
    node: ParsedNode,
    effect: CrossDocProvisionEffect,
    trace: DebugTraceStep[],
    exploitedDefects: ExploitedDefect[],
    citations: DebugGroundedCitation[],
): void {
    pushCitation(citations, {
        provisionRef: node.refLabel,
        verbatimQuote: firstLineOfNode(node),
        sourceDocument: null,
    });
    pushCitation(citations, {
        provisionRef: effect.sourceProvisionRef,
        verbatimQuote: effect.verbatimQuote,
        sourceDocument: effect.sourceDocLabel,
    });

    trace.push({
        stepNumber: trace.length + 1,
        line: node.startLine,
        provisionRef: node.refLabel,
        status: "LOOPHOLE_HIT",
        condition: `Kiểm tra hiệu lực liên văn bản đối với ${node.refLabel}`,
        evaluation: `${node.refLabel} đã bị bãi bỏ bởi ${effect.sourceDocLabel} (${effect.sourceProvisionRef}) → không còn căn cứ xử phạt.`,
        leanCheck: `IsRepealedInWorkspace("${node.refLabel}") = true → UNENFORCEABLE`,
        diagnosticCode: "LG007",
    });

    pushDefect(exploitedDefects, {
        code: "LG007",
        category: "LOGIC",
        title: `Điều khoản đã bị bãi bỏ bởi ${effect.sourceDocLabel}`,
        impactInCourt: `${node.refLabel} đã hết hiệu lực theo ${effect.sourceDocLabel}, không thể dùng làm căn cứ xử phạt.`,
    });
}

function evaluateNodeSanctionIssues(
    draft: ParsedDraft,
    node: ParsedNode,
    diagnostics: readonly LegalDiagnostic[],
    overrides: Record<string, boolean>,
    trace: DebugTraceStep[],
    ambiguities: AmbiguityDecisionItem[],
    exploitedDefects: ExploitedDefect[],
    additionalSanctions: string[],
): void {
    const nodeDiags = diagnostics.filter(
        (diag) => diag.range.startLine >= node.startLine && diag.range.endLine <= node.endLine,
    );

    const termIssue = nodeDiags.find((diag) => diag.code === "AM005")
        ?? findLinkedAdditionalSanctionIssue(draft, node, diagnostics);

    if (termIssue) {
        const decision = buildAmbiguityDecision(termIssue, overrides);
        pushAmbiguity(ambiguities, decision);

        if (decision.selectedValue === true) {
            additionalSanctions.push(`${termIssue.excerpt} (theo giả định Tòa chấp nhận)`);
            trace.push({
                stepNumber: trace.length + 1,
                line: termIssue.range.startLine,
                provisionRef: termIssue.provisionRef ?? node.refLabel,
                status: "MATCHED",
                condition: decision.question,
                evaluation: `Giả định: Tòa CHẤP NHẬN áp dụng "${termIssue.excerpt}" dù chưa có văn bản định nghĩa trong workspace.`,
                leanCheck: `Assume(AcceptTerm "${termIssue.excerpt}" = true) → APPLIED`,
                diagnosticCode: termIssue.code,
            });
        } else {
            trace.push({
                stepNumber: trace.length + 1,
                line: termIssue.range.startLine,
                provisionRef: termIssue.provisionRef ?? node.refLabel,
                status: "UNENFORCEABLE_TERM",
                condition: decision.question,
                evaluation: termIssue.message,
                leanCheck: `DefinedInWorkspace "${termIssue.excerpt}" = false → UNENFORCEABLE`,
                diagnosticCode: termIssue.code,
            });

            pushDefect(exploitedDefects, {
                code: termIssue.code,
                category: termIssue.category,
                title: termIssue.title,
                impactInCourt: `Phần chế tài liên quan đến "${termIssue.excerpt}" bị đình chỉ áp dụng do thiếu văn bản định nghĩa trong workspace.`,
            });
        }
    }

    const lp004 = nodeDiags.find((diag) => diag.code === "LP004")
        ?? diagnostics.find((diag) => diag.code === "LP004" && diag.provisionRef?.includes(`Điều ${node.articleNo ?? ""}`));

    if (lp004) {
        additionalSanctions.push(`${lp004.excerpt} (thiếu định mức — không thi hành được)`);
        pushDefect(exploitedDefects, {
            code: "LP004",
            category: "LOOPHOLE",
            title: lp004.title,
            impactInCourt: "Hình phạt bổ sung thiếu thời hạn/số điểm cụ thể nên không đủ căn cứ thi hành.",
        });
    }
}

function buildAmbiguityDecision(diag: LegalDiagnostic, overrides: Record<string, boolean>): AmbiguityDecisionItem {
    const selectedValue = Object.prototype.hasOwnProperty.call(overrides, diag.id) ? overrides[diag.id] : null;
    const ref = diag.provisionRef ?? `Dòng ${diag.range.startLine}`;

    if (diag.code === "AM001") {
        return {
            id: diag.id,
            code: diag.code,
            term: diag.excerpt,
            provisionRef: ref,
            line: diag.range.startLine,
            question: `Thực tế tình huống có thỏa mãn mức "${diag.excerpt}" hay không?`,
            trueLabel: `Có — Đạt "${diag.excerpt}" (Áp dụng)`,
            falseLabel: `Không — Chưa đạt "${diag.excerpt}" (Bỏ qua)`,
            selectedValue,
        };
    }

    if (diag.code === "AM003") {
        return {
            id: diag.id,
            code: diag.code,
            term: diag.excerpt,
            provisionRef: ref,
            line: diag.range.startLine,
            question: `Người có thẩm quyền có chọn áp dụng "${diag.excerpt}" hay không?`,
            trueLabel: "Có — Quyết định xử phạt",
            falseLabel: "Không — Không áp dụng",
            selectedValue,
        };
    }

    if (diag.code === "AM005") {
        return {
            id: diag.id,
            code: diag.code,
            term: diag.excerpt,
            provisionRef: ref,
            line: diag.range.startLine,
            question: `Tòa có chấp nhận thi hành "${diag.excerpt}" khi chưa có văn bản định nghĩa?`,
            trueLabel: "Có — Chấp nhận thi hành",
            falseLabel: "Không — Bác bỏ (Thiếu định nghĩa)",
            selectedValue,
        };
    }

    if (diag.code === "LP001") {
        return {
            id: diag.id,
            code: diag.code,
            term: diag.excerpt,
            provisionRef: ref,
            line: diag.range.startLine,
            question: `Tòa có chấp nhận viện dẫn "${diag.excerpt}" của bị đơn không?`,
            trueLabel: "Có — Chấp nhận miễn trừ (Trắng án)",
            falseLabel: "Không — Bác bỏ ngoại lệ (Vẫn phạt)",
            selectedValue,
        };
    }

    return {
        id: diag.id,
        code: diag.code,
        term: diag.excerpt,
        provisionRef: ref,
        line: diag.range.startLine,
        question: `Hành vi có thuộc phạm vi "${diag.excerpt}" hay không?`,
        trueLabel: "Có — Thuộc phạm vi",
        falseLabel: "Không — Ngoài phạm vi",
        selectedValue,
    };
}

function findLinkedAdditionalSanctionIssue(
    draft: ParsedDraft,
    node: ParsedNode,
    diagnostics: readonly LegalDiagnostic[],
): LegalDiagnostic | null {
    if (!node.articleNo) {
        return null;
    }

    const articleDiags = diagnostics.filter(
        (diag) => diag.code === "AM005" && diag.provisionRef?.endsWith(`Điều ${node.articleNo}`),
    );

    if (articleDiags.length === 0) {
        return null;
    }

    const target = articleDiags[0];
    const lineStart = Math.max(0, target.range.startOffset - 120);
    const slice = draft.content.slice(lineStart, target.range.endOffset);

    if (node.clauseNo && slice.includes(`khoản ${node.clauseNo}`)) {
        return target;
    }

    return null;
}

function aggregateFines(fines: readonly { min: number; max: number }[]): { min: number; max: number } | null {
    if (fines.length === 0) {
        return null;
    }

    let minSum = 0;
    let maxSum = 0;

    for (const fine of fines) {
        if (fine.min <= fine.max) {
            minSum += fine.min;
            maxSum += fine.max;
        }
    }

    return { min: minSum, max: maxSum };
}

function synthesizeVerdict(
    facts: ScenarioFacts,
    trace: readonly DebugTraceStep[],
    ambiguities: readonly AmbiguityDecisionItem[],
    exploitedDefects: readonly ExploitedDefect[],
    matchedFine: readonly { min: number; max: number }[],
    additionalSanctions: readonly string[],
    nonMonetarySanctions: readonly NonMonetarySanction[],
    citations: readonly DebugGroundedCitation[],
): JudgeVerdict {
    const hasLoophole = trace.some((step) => step.status === "LOOPHOLE_HIT");
    const hasConflict = trace.some((step) => step.status === "CONFLICT_HIT");
    const hasUnenforceable = trace.some((step) => step.status === "UNENFORCEABLE_TERM");
    const hasUnresolvedAmbiguity = trace.some((step) => step.status === "AMBIGUOUS_BRANCH");
    const hasMatched = trace.some((step) => step.status === "MATCHED");
    const applicableFine = aggregateFines(matchedFine);

    let outcome: VerdictOutcome = "NOT_COVERED";
    let outcomeLabel = "CHƯA CÓ QUY PHẠM ĐIỀU CHỈNH";
    let summary = "Dự thảo hiện tại chưa có điều khoản nào điều chỉnh trực tiếp tình huống được mô tả.";
    let lawmakerAction = "Bổ sung quy phạm điều chỉnh hành vi này nếu thuộc phạm vi điều chỉnh của văn bản.";

    if (hasUnresolvedAmbiguity && !hasMatched) {
        outcome = "CONFLICT_AMBIGUOUS";
        outcomeLabel = "CẦN CHỌN GIẢ ĐỊNH MƠ HỒ ĐỂ KẾT LUẬN";
        const unresolvedCount = Math.max(1, ambiguities.filter((item) => item.selectedValue === null).length);
        summary = `Tình huống thiếu dữ kiện định lượng hoặc phụ thuộc vào ${unresolvedCount} điểm mơ hồ chưa định lượng — Tòa từ chối suy đoán kết luận.`;
        lawmakerAction = "Định lượng hóa các khái niệm mơ hồ và bổ sung đầy đủ dữ kiện đo đạc trước khi xử phạt.";
    } else if (hasConflict && !hasMatched) {
        outcome = "CONFLICT_AMBIGUOUS";
        outcomeLabel = "XUNG ĐỘT QUY PHẠM — TÒA HỦY / ÁP DỤNG MỨC NHẸ NHẤT";
        summary = "Hành vi rơi vào vùng chồng chéo, mâu thuẫn đạo nghĩa hoặc khung phạt lỗi logic trong dự thảo, không thể ấn định chế tài thống nhất.";
        lawmakerAction = "Sửa ngay các lỗi logic (LG001/LG002/mâu thuẫn đạo nghĩa) để phân tách ranh giới định lượng và sắp xếp cận min ≤ max.";
    } else if (hasLoophole && !hasMatched) {
        outcome = "ACQUITTED_LOOPHOLE";
        outcomeLabel = "KHÔNG THỂ XỬ PHẠT — LỌT KẼ HỞ PHÁP LÝ";
        summary = "Đương sự thoát chế tài vì tình huống khai thác đúng kẽ hở trong dự thảo (khoảng trống ngưỡng, lệnh cấm không chế tài, ngoại lệ mở hoặc điều khoản đã bị bãi bỏ).";
        lawmakerAction = "Vá các kẽ hở đã bị khai thác trong trace (khép kín ngưỡng, thêm chế tài hoặc giới hạn ngoại lệ).";
    } else if (hasMatched && (hasUnenforceable || hasLoophole || hasConflict || hasUnresolvedAmbiguity)) {
        outcome = "PARTIALLY_ENFORCEABLE";
        outcomeLabel = "XỬ PHẠT MỘT PHẦN — VƯỚNG CHẾ TÀI BỔ SUNG / THUẬT NGỮ";
        summary = `Có căn cứ phạt tiền (${applicableFine ? `${applicableFine.min.toLocaleString("vi-VN")}–${applicableFine.max.toLocaleString("vi-VN")}đ` : "theo khung"}), nhưng phần chế tài bổ sung, hành vi đi kèm hoặc thuật ngữ liên quan không thể thi hành tại Tòa.`;
        lawmakerAction = "Bổ sung văn bản định nghĩa thuật ngữ vào Thư viện workspace và hoàn thiện chế tài cho toàn bộ hành vi liên quan.";
    } else if (hasMatched) {
        outcome = "GUILTY_SANCTIONED";
        outcomeLabel = "ĐỦ CĂN CỨ TUYÊN PHẠT";
        const fineDesc = applicableFine
            ? ` phạt tiền từ ${applicableFine.min.toLocaleString("vi-VN")}đ đến ${applicableFine.max.toLocaleString("vi-VN")}đ`
            : "";
        const nmDesc = nonMonetarySanctions.length > 0
            ? `${fineDesc ? " và " : " "}${nonMonetarySanctions.map((s) => s.label).join(", ")}`
            : "";
        summary = `Hội đồng xét xử có đủ căn cứ pháp lý và chứng minh Lean 4 hợp lệ để áp dụng chế tài${fineDesc}${nmDesc}.`;
        lawmakerAction = "Quy phạm áp dụng cho tình huống này đã chặt chẽ; tiếp tục kiểm thử các tình huống biên khác.";
    }

    const judicialReasoning = buildJudicialReasoning(facts, trace, exploitedDefects, outcome);

    return {
        outcome,
        outcomeLabel,
        summary,
        applicableFine,
        additionalSanctions: [...additionalSanctions],
        nonMonetarySanctions: [...nonMonetarySanctions],
        citations: [...citations],
        exploitedDefects: [...exploitedDefects],
        judicialReasoning,
        lawmakerAction,
    };
}

function buildJudicialReasoning(
    facts: ScenarioFacts,
    trace: readonly DebugTraceStep[],
    exploitedDefects: readonly ExploitedDefect[],
    outcome: VerdictOutcome,
): string[] {
    const reasons: string[] = [];

    reasons.push(
        `Chủ thể được xác định: ${facts.subject === "ORGANIZATION" ? "Tổ chức/Doanh nghiệp" : "Cá nhân"}${facts.measurements.length > 0 ? ` · Thông số đo: ${facts.measurements.map((item) => item.raw).join(", ")}` : ""}.`,
    );

    for (const step of trace.slice(0, 5)) {
        reasons.push(`[${step.provisionRef}] ${step.evaluation}`);
    }

    if (exploitedDefects.length > 0) {
        reasons.push(
            `Lỗ hổng bị khai thác tại Tòa (${exploitedDefects.map((item) => item.code).join(", ")}): ${exploitedDefects[0].impactInCourt}`,
        );
    } else if (outcome === "NOT_COVERED") {
        reasons.push("Không tìm thấy điều khoản nào áp dụng chế tài cho hành vi của tình huống.");
    }

    return reasons;
}

async function triageScenarioWithDecisionApi(
    draft: ParsedDraft,
    scenario: string,
    options: { apiKey: string; apiBaseUrl?: string; fetcher?: typeof fetch },
): Promise<{ shouldEscalate: boolean; decisionInputTokens: number; called: boolean }> {
    const candidates = draft.nodes.filter((node) => node.level === "CLAUSE" || node.level === "POINT").slice(0, 20);

    if (candidates.length === 0) {
        return { shouldEscalate: false, decisionInputTokens: 0, called: false };
    }

    try {
        const listing = candidates.map((node) => `- ${node.refLabel}: ${node.text.slice(0, 140)}`).join("\n");
        const res = await callGeminiDecisions({
            apiKey: options.apiKey,
            apiBaseUrl: options.apiBaseUrl,
            input: `SCENARIO: ${scenario}\n\nPROVISIONS:\n${listing}`,
            questions: {
                matches_any: {
                    type: "noul",
                    instructions: "Does the SCENARIO describe a violation, breach, or legal action that matches at least one provision in PROVISIONS (even using different words/synonyms), rather than being completely unrelated?",
                },
            },
            fetcher: options.fetcher,
        });
        const ans = res.answers.matches_any;
        const shouldEscalate = !(ans && ans.type === "noul" && ans.noul < 0.45 && ans.confidence >= 0.7);

        return {
            shouldEscalate,
            decisionInputTokens: res.usage.inputTokens,
            called: true,
        };
    } catch {
        return { shouldEscalate: true, decisionInputTokens: 0, called: false };
    }
}

async function mapScenarioToClausesWithAi(
    draft: ParsedDraft,
    scenario: string,
    options: { apiKey: string; apiBaseUrl?: string; model: string; fetcher?: typeof fetch },
): Promise<{ nodes: ParsedNode[]; usage: DebugTokenUsage | null }> {
    const candidates = draft.nodes.filter((node) => node.level === "CLAUSE" || node.level === "POINT").slice(0, 40);

    if (candidates.length === 0) {
        return { nodes: [], usage: null };
    }

    try {
        const listing = candidates.map((node) => `- ${node.refLabel}: ${node.text.slice(0, 220)}`).join("\n");
        const res = await callGeminiStructuredInteraction({
            apiKey: options.apiKey,
            apiBaseUrl: options.apiBaseUrl,
            model: options.model,
            systemInstruction: CLAUSE_MAPPER_SYSTEM_PROMPT,
            input: `Tình huống: ${scenario}\n\nCác điều khoản trong dự thảo:\n${listing}`,
            schema: CLAUSE_MAPPER_SCHEMA,
            maxOutputTokens: 250,
            fetcher: options.fetcher,
        });

        const raw = res.data;

        if (typeof raw !== "object" || raw === null) {
            return { nodes: [], usage: res.usage };
        }

        const refs = (raw as { matchedProvisionRefs?: unknown }).matchedProvisionRefs;

        if (!Array.isArray(refs)) {
            return { nodes: [], usage: res.usage };
        }

        const refSet = new Set(refs.filter((item): item is string => typeof item === "string"));

        return {
            nodes: candidates.filter((node) => refSet.has(node.refLabel)),
            usage: res.usage,
        };
    } catch {
        return { nodes: [], usage: null };
    }
}

async function refineVerdictWithAi(
    scenario: string,
    trace: readonly DebugTraceStep[],
    verdict: JudgeVerdict,
    options: { apiKey: string; apiBaseUrl?: string; model: string; fetcher?: typeof fetch },
): Promise<{ summary: string; judicialReasoning: string[]; usage: DebugTokenUsage } | null> {
    try {
        const traceText = trace.map((step) => `- [${step.provisionRef}] (${step.status}) ${step.evaluation} | Lean: ${step.leanCheck}`).join("\n");
        const res = await callGeminiStructuredInteraction({
            apiKey: options.apiKey,
            apiBaseUrl: options.apiBaseUrl,
            model: options.model,
            systemInstruction: JUDGE_AI_SYSTEM_PROMPT,
            input: `Tình huống: ${scenario}\nKết quả máy Lean: ${verdict.outcomeLabel}\nTrace:\n${traceText || "(Không khớp điều khoản nào)"}`,
            schema: JUDGE_AI_SCHEMA,
            maxOutputTokens: 600,
            fetcher: options.fetcher,
        });

        const raw = res.data;

        if (typeof raw !== "object" || raw === null) {
            return null;
        }

        const rec = raw as { summary?: unknown; judicialReasoning?: unknown };

        if (typeof rec.summary !== "string" || !Array.isArray(rec.judicialReasoning)) {
            return null;
        }

        const reasoning = rec.judicialReasoning.filter((item): item is string => typeof item === "string" && item.trim().length > 0);

        if (reasoning.length === 0) {
            return null;
        }

        return {
            summary: rec.summary.trim(),
            judicialReasoning: reasoning,
            usage: res.usage,
        };
    } catch {
        return null;
    }
}

function matchesThreshold(value: number, item: ExtractedThreshold): boolean {
    if (item.min === null) {
        return false;
    }

    const lowerOk = item.minInclusive ? value >= item.min : value > item.min;

    if (!lowerOk) {
        return false;
    }

    if (item.max === null) {
        return true;
    }

    return item.maxInclusive ? value <= item.max : value < item.max;
}

function findFineForThreshold(
    draft: ParsedDraft,
    fineRanges: readonly ExtractedFineRange[],
    threshold: ExtractedThreshold,
): ExtractedFineRange | null {
    const node = findNodeAtOffset(draft.nodes, threshold.startOffset);

    if (node) {
        const nodeFines = fineRanges.filter(
            (fine) => fine.startOffset >= node.startOffset && fine.startOffset <= node.endOffset,
        );

        if (nodeFines.length > 0) {
            let bestInNode: ExtractedFineRange | null = null;

            for (const fine of nodeFines) {
                if (fine.startOffset <= threshold.startOffset) {
                    if (!bestInNode || fine.startOffset > bestInNode.startOffset) {
                        bestInNode = fine;
                    }
                }
            }

            return bestInNode ?? nodeFines[0];
        }
    }

    let bestPreceding: ExtractedFineRange | null = null;

    for (const fine of fineRanges) {
        if (fine.startOffset <= threshold.startOffset && threshold.startOffset - fine.startOffset < 400) {
            if (!bestPreceding || fine.startOffset > bestPreceding.startOffset) {
                bestPreceding = fine;
            }
        }
    }

    return bestPreceding;
}

function pushDefect(list: ExploitedDefect[], item: ExploitedDefect): void {
    if (!list.some((existing) => existing.code === item.code)) {
        list.push(item);
    }
}

function pushAmbiguity(list: AmbiguityDecisionItem[], item: AmbiguityDecisionItem): void {
    if (!list.some((existing) => existing.id === item.id)) {
        list.push(item);
    }
}

function pushCitation(list: DebugGroundedCitation[], item: DebugGroundedCitation): void {
    const cleanQuote = item.verbatimQuote.trim();

    if (cleanQuote.length < 2) {
        return;
    }

    const key = `${item.provisionRef}::${cleanQuote}`;

    if (!list.some((existing) => `${existing.provisionRef}::${existing.verbatimQuote}` === key)) {
        list.push({
            provisionRef: item.provisionRef,
            verbatimQuote: cleanQuote,
            sourceDocument: item.sourceDocument ?? null,
        });
    }
}

function pushNonMonetary(
    additionalSanctions: string[],
    structured: NonMonetarySanction[],
    item: ExtractedNonMonetarySanction,
): void {
    if (!additionalSanctions.includes(item.label)) {
        additionalSanctions.push(item.label);
    }

    if (!structured.some((existing) => existing.label === item.label && existing.provisionRef === item.provisionRef)) {
        structured.push({
            kind: item.kind,
            label: item.label,
            minMonths: item.minMonths,
            maxMonths: item.maxMonths,
            provisionRef: item.provisionRef,
        });
    }
}

function buildExtractedFactList(facts: ScenarioFacts): { label: string; value: string }[] {
    const items: { label: string; value: string }[] = [
        { label: "Chủ thể", value: facts.subject === "ORGANIZATION" ? "Tổ chức / Doanh nghiệp" : "Cá nhân" },
    ];

    if (facts.vehicle !== null) {
        const vehicleLabel = facts.vehicle === "CAR"
            ? "Xe ô tô"
            : facts.vehicle === "MOTORBIKE"
                ? "Xe mô tô / Xe máy"
                : "Xe tự hành";
        items.push({ label: "Phương tiện", value: vehicleLabel });
    }

    if (facts.scenarioDateIso) {
        items.push({ label: "Thời điểm xảy ra", value: facts.scenarioDateIso });
    }

    if (facts.measurements.length > 0) {
        items.push({ label: "Định lượng", value: facts.measurements.map((item) => item.raw).join(", ") });
    }

    if (facts.claimsException && facts.claimedExceptionText) {
        items.push({ label: "Viện dẫn ngoại lệ", value: facts.claimedExceptionText });
    }

    return items;
}
