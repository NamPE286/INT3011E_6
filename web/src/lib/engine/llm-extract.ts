import {
    callGeminiDecisions,
    callGeminiStructuredInteraction,
    DEFAULT_GEMINI_MODEL,
    isGeminiInvalidApiKeyError,
    type DecisionQuestion,
} from "./gemini-client";
import { selectAiCandidateClauses } from "./lean-compiler";
import type { WorkspaceContext } from "./local-workspace";
import { findNodeAtOffset, positionAtOffset, rangeFromOffsets, type ParsedDraft } from "./parser";
import type { AiTokenBreakdown, CrossReferenceItem, ExtractedLegalFact, LegalDiagnostic, ExtractedModality, ExtractedSubject } from "./types";

const LLM_EXTRACT_SYSTEM_PROMPT = `Trích xuất sự kiện pháp lý cấu trúc cho Lean 4.
- CHỈ trích từ văn bản gửi, KHÔNG đánh giá đúng/sai, KHÔNG sinh Lean 4.
- "quote" phải là chuỗi nguyên văn (verbatim substring).
- Mỗi khoản 1-2 sự kiện: modality (PROHIBITED|OBLIGATED|PERMITTED|SANCTION), subject, actionKey (snake_case), fineMin/fineMax, thresholdUnit/thresholdMin/thresholdMax, hasSanction, hasOpenException, hasExceptionCriteria, referencedTerms.`;

const LLM_EXTRACT_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    required: ["facts"],
    properties: {
        facts: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: [
                    "quote",
                    "subject",
                    "modality",
                    "actionKey",
                    "fineMin",
                    "fineMax",
                    "thresholdUnit",
                    "thresholdMin",
                    "thresholdMax",
                    "hasSanction",
                    "hasOpenException",
                    "hasExceptionCriteria",
                    "referencedTerms",
                ],
                properties: {
                    quote: { type: "string" },
                    subject: { type: "string", enum: ["INDIVIDUAL", "ORGANIZATION", "BOTH", "UNSPECIFIED"] },
                    modality: { type: "string", enum: ["PROHIBITED", "OBLIGATED", "PERMITTED", "SANCTION"] },
                    actionKey: { type: "string" },
                    fineMin: { type: ["number", "null"] },
                    fineMax: { type: ["number", "null"] },
                    thresholdUnit: { type: ["string", "null"] },
                    thresholdMin: { type: ["number", "null"] },
                    thresholdMax: { type: ["number", "null"] },
                    hasSanction: { type: "boolean" },
                    hasOpenException: { type: "boolean" },
                    hasExceptionCriteria: { type: "boolean" },
                    referencedTerms: { type: "array", items: { type: "string" } },
                },
            },
        },
    },
};

export type UserLlmExtractOptions = {
    apiKey?: string;
    apiBaseUrl?: string;
    model?: string;
    useDecisionApi?: boolean;
    workspaceContext?: WorkspaceContext;
    fetcher?: typeof fetch;
    signal?: AbortSignal;
    onProgress?: (phase: "decision_triage" | "extracting" | "verifying", detail: string) => void;
};

export type ExtractClauseInput = {
    refLabel: string;
    text: string;
};

/**
 * Stage 1: Uses Gemini Decision API (gemini-decision-1, 0 output tokens) to filter out
 * routine/clear clauses and only escalate complex/ambiguous clauses to Stage 2.
 */
export async function triageClausesWithDecisionApi(
    units: readonly ExtractClauseInput[],
    options: UserLlmExtractOptions,
): Promise<{
    escalated: ExtractClauseInput[];
    filtered: ExtractClauseInput[];
    decisionInputTokens: number;
}> {
    const apiKey = options.apiKey?.trim() ?? "";

    if (!apiKey || units.length === 0 || options.useDecisionApi === false) {
        return { escalated: [...units], filtered: [], decisionInputTokens: 0 };
    }

    options.onProgress?.("decision_triage", `Sàng lọc ${units.length} khoản bằng Decision API (0 output token)...`);

    const batch = units.slice(0, 20);
    const inputText = batch.map((u, idx) => `[U${idx}] (${u.refLabel}) ${u.text}`).join("\n");
    const questions: Record<string, DecisionQuestion> = {};

    for (let idx = 0; idx < batch.length; idx += 1) {
        questions[`u${idx}_complex`] = {
            type: "noul",
            instructions: `Does unit [U${idx}] contain an implicit legal loophole, deontic contradiction, unbounded subjective exception, or complex sanction rule needing deep extraction?`,
        };
    }

    try {
        const res = await callGeminiDecisions({
            apiKey,
            apiBaseUrl: options.apiBaseUrl,
            input: inputText,
            questions,
            fetcher: options.fetcher,
            signal: options.signal,
        });

        const escalated: ExtractClauseInput[] = [];
        const filtered: ExtractClauseInput[] = [];

        for (let idx = 0; idx < batch.length; idx += 1) {
            const ans = res.answers[`u${idx}_complex`];

            if (ans && ans.type === "noul" && ans.noul < 0.45 && ans.confidence >= 0.7) {
                filtered.push(batch[idx]);
            } else {
                escalated.push(batch[idx]);
            }
        }

        return {
            escalated,
            filtered,
            decisionInputTokens: res.usage.inputTokens,
        };
    } catch {
        return { escalated: [...units], filtered: [], decisionInputTokens: 0 };
    }
}

/**
 * Extracts structured legal facts strictly for the provided list of changed/new clause units.
 */
export async function extractLegalFactsForUnits(
    draft: ParsedDraft,
    units: readonly ExtractClauseInput[],
    options: UserLlmExtractOptions,
): Promise<{
    facts: ExtractedLegalFact[];
    actualAiTokens: number;
    tokenBreakdown: AiTokenBreakdown;
    error: string | null;
}> {
    const apiKey = options.apiKey?.trim() ?? "";

    if (!apiKey) {
        return {
            facts: [],
            actualAiTokens: 0,
            tokenBreakdown: {
                decisionInputTokens: 0,
                extractInputTokens: 0,
                extractOutputTokens: 0,
                totalTokens: 0,
                filteredByDecision: 0,
                escalatedToExtract: 0,
                cachedUnits: 0,
            },
            error: "Chưa cấu hình Gemini API Key. Hãy mở Cài đặt để nhập key — engine Lean 4 vẫn chạy 0 token.",
        };
    }

    if (units.length === 0) {
        return {
            facts: [],
            actualAiTokens: 0,
            tokenBreakdown: {
                decisionInputTokens: 0,
                extractInputTokens: 0,
                extractOutputTokens: 0,
                totalTokens: 0,
                filteredByDecision: 0,
                escalatedToExtract: 0,
                cachedUnits: 0,
            },
            error: null,
        };
    }

    const triage = await triageClausesWithDecisionApi(units, options);

    if (triage.escalated.length === 0) {
        return {
            facts: [],
            actualAiTokens: triage.decisionInputTokens,
            tokenBreakdown: {
                decisionInputTokens: triage.decisionInputTokens,
                extractInputTokens: 0,
                extractOutputTokens: 0,
                totalTokens: triage.decisionInputTokens,
                filteredByDecision: triage.filtered.length,
                escalatedToExtract: 0,
                cachedUnits: 0,
            },
            error: null,
        };
    }

    options.onProgress?.("extracting", `Trích xuất ${triage.escalated.length} khoản phức tạp bằng Gemini...`);

    const compactClauses = triage.escalated.map((item) => `[${item.refLabel}] ${item.text}`).join("\n");
    const wsSummary = formatWorkspaceSummary(options.workspaceContext, compactClauses);
    const userText = `${wsSummary}\n\nCÁC KHOẢN CẦN TRÍCH XUẤT:\n${compactClauses}`;
    const model = options.model?.trim() || DEFAULT_GEMINI_MODEL;

    try {
        const res = await callGeminiStructuredInteraction({
            apiKey,
            apiBaseUrl: options.apiBaseUrl,
            model,
            systemInstruction: LLM_EXTRACT_SYSTEM_PROMPT,
            input: userText,
            schema: LLM_EXTRACT_SCHEMA,
            maxOutputTokens: 1200,
            fetcher: options.fetcher,
            signal: options.signal,
        });

        const facts = anchorExtractedFacts(draft, res.data);
        const totalTokens = triage.decisionInputTokens + res.usage.totalTokens;

        return {
            facts,
            actualAiTokens: totalTokens,
            tokenBreakdown: {
                decisionInputTokens: triage.decisionInputTokens,
                extractInputTokens: res.usage.inputTokens,
                extractOutputTokens: res.usage.outputTokens,
                totalTokens,
                filteredByDecision: triage.filtered.length,
                escalatedToExtract: triage.escalated.length,
                cachedUnits: 0,
            },
            error: null,
        };
    } catch (cause: unknown) {
        if (cause instanceof DOMException && cause.name === "AbortError") {
            return {
                facts: [],
                actualAiTokens: 0,
                tokenBreakdown: {
                    decisionInputTokens: 0,
                    extractInputTokens: 0,
                    extractOutputTokens: 0,
                    totalTokens: 0,
                    filteredByDecision: 0,
                    escalatedToExtract: 0,
                    cachedUnits: 0,
                },
                error: null,
            };
        }

        return {
            facts: [],
            actualAiTokens: triage.decisionInputTokens,
            tokenBreakdown: {
                decisionInputTokens: triage.decisionInputTokens,
                extractInputTokens: 0,
                extractOutputTokens: 0,
                totalTokens: triage.decisionInputTokens,
                filteredByDecision: triage.filtered.length,
                escalatedToExtract: triage.escalated.length,
                cachedUnits: 0,
            },
            error: cause instanceof Error ? cause.message : "Không thể kết nối tới Gemini API",
        };
    }
}

/**
 * The ONLY network call in LexIDE: calls the user's configured LLM API directly with their own token,
 * strictly for extracting structured legal facts before deterministic Lean 4 compilation.
 */
export async function extractLegalFactsWithUserLlm(
    draft: ParsedDraft,
    options: UserLlmExtractOptions,
): Promise<{
    facts: ExtractedLegalFact[];
    actualAiTokens: number;
    error: string | null;
}> {
    const candidates = selectAiCandidateClauses(draft);
    const units: ExtractClauseInput[] = candidates.length > 0
        ? candidates
        : [{ refLabel: "Dự thảo", text: draft.content.slice(0, 4000) }];

    return extractLegalFactsForUnits(draft, units, options);
}

function extractOutputText(payload: Record<string, unknown>): string | null {
    if (typeof payload.output_text === "string" && payload.output_text.trim()) {
        return payload.output_text;
    }

    if (Array.isArray(payload.output)) {
        for (const item of payload.output) {
            if (typeof item !== "object" || item === null) {
                continue;
            }

            const content = (item as { content?: unknown }).content;

            if (!Array.isArray(content)) {
                continue;
            }

            for (const part of content) {
                if (typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string") {
                    return (part as { text: string }).text;
                }
            }
        }
    }

    return null;
}

function formatWorkspaceSummary(workspace: WorkspaceContext | undefined, clausesText = ""): string {
    if (!workspace || (workspace.corpusDocumentCount === 0 && workspace.savedDraftCount === 0)) {
        return "WORKSPACE_DOCUMENTS: (Trống)\nWORKSPACE_TERMS: (Không có)";
    }

    const lowerClauses = clausesText.toLowerCase();
    const docs = workspace.bases.slice(0, 6).map((item) => `- ${item.label}`).join("\n") || "(Không có)";
    const relevantTerms = workspace.definedTerms
        .filter((item) => !lowerClauses || lowerClauses.includes(item.normalizedTerm) || lowerClauses.includes(item.term.toLowerCase()))
        .slice(0, 10)
        .map((item) => `- ${item.term}`)
        .join("\n") || "(Không có)";

    return `WORKSPACE_DOCUMENTS:\n${docs}\nWORKSPACE_TERMS:\n${relevantTerms}`;
}

function anchorExtractedFacts(draft: ParsedDraft, raw: unknown): ExtractedLegalFact[] {
    if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { facts?: unknown }).facts)) {
        return [];
    }

    const facts: ExtractedLegalFact[] = [];
    const lowerContent = draft.content.toLowerCase();

    for (const item of (raw as { facts: unknown[] }).facts) {
        if (typeof item !== "object" || item === null) {
            continue;
        }

        const rec = item as Record<string, unknown>;
        const quote = readText(rec.quote);
        const modality = readModality(rec.modality);
        const subject = readSubject(rec.subject);
        const actionKey = normalizeActionKey(readText(rec.actionKey) ?? "");

        if (!quote || quote.length < 4 || !modality || !subject || !actionKey) {
            continue;
        }

        let startOffset = draft.content.indexOf(quote);

        if (startOffset === -1) {
            startOffset = lowerContent.indexOf(quote.toLowerCase());
        }

        if (startOffset === -1) {
            continue;
        }

        const endOffset = startOffset + quote.length;
        const node = findNodeAtOffset(draft.nodes, startOffset);
        const line = positionAtOffset(draft.lineStarts, startOffset).line;
        const referencedTerms = Array.isArray(rec.referencedTerms)
            ? rec.referencedTerms
                .filter((t): t is string => typeof t === "string" && t.trim().length >= 2 && !/^(?:điều|khoản|điểm|chương|mục)\s+\d+/iu.test(t.trim()))
                .map((t) => t.trim())
            : [];

        facts.push({
            quote: draft.content.slice(startOffset, endOffset),
            startOffset,
            endOffset,
            line,
            provisionRef: node?.refLabel ?? null,
            subject,
            modality,
            actionKey,
            fineMin: typeof rec.fineMin === "number" && Number.isFinite(rec.fineMin) ? rec.fineMin : null,
            fineMax: typeof rec.fineMax === "number" && Number.isFinite(rec.fineMax) ? rec.fineMax : null,
            thresholdUnit: readText(rec.thresholdUnit),
            thresholdMin: typeof rec.thresholdMin === "number" && Number.isFinite(rec.thresholdMin) ? rec.thresholdMin : null,
            thresholdMax: typeof rec.thresholdMax === "number" && Number.isFinite(rec.thresholdMax) ? rec.thresholdMax : null,
            hasSanction: Boolean(rec.hasSanction),
            hasOpenException: Boolean(rec.hasOpenException),
            hasExceptionCriteria: Boolean(rec.hasExceptionCriteria),
            referencedTerms,
        });
    }

    return facts;
}

function readModality(value: unknown): ExtractedModality | null {
    return value === "PROHIBITED" || value === "OBLIGATED" || value === "PERMITTED" || value === "SANCTION" ? value : null;
}

function readSubject(value: unknown): ExtractedSubject | null {
    return value === "INDIVIDUAL" || value === "ORGANIZATION" || value === "BOTH" || value === "UNSPECIFIED" ? value : null;
}

function readText(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : null;
}

function normalizeActionKey(raw: string): string {
    return raw
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40);
}

function reanchorSemanticRefDiagnostic(
    draft: ParsedDraft,
    ref: CrossReferenceItem,
    cachedDiag: LegalDiagnostic,
): LegalDiagnostic {
    return {
        ...cachedDiag,
        id: `LG015-${ref.startOffset}`,
        provisionRef: ref.fromRef,
        range: rangeFromOffsets(draft.content, draft.lineStarts, ref.startOffset, ref.endOffset),
    };
}

export function getCachedSemanticCrossReferences(
    draft: ParsedDraft,
    references: readonly CrossReferenceItem[],
    cache?: Map<string, LegalDiagnostic | null>,
): LegalDiagnostic[] {
    if (!cache || cache.size === 0 || references.length === 0) {
        return [];
    }

    const diagnostics: LegalDiagnostic[] = [];

    for (const ref of references) {
        if (ref.status !== "VALID") {
            continue;
        }

        const srcNode = findNodeAtOffset(draft.nodes, ref.startOffset);
        const srcArtNo = srcNode?.articleNo?.toLowerCase();
        const tgtMatch = /Điều\s+(\d+[a-zđ]?)/iu.exec(ref.targetRef);
        const tgtArtNo = tgtMatch?.[1]?.toLowerCase();

        if (!srcArtNo || !tgtArtNo || srcArtNo === tgtArtNo) {
            continue;
        }

        const sentStart = Math.max(0, ref.startOffset - 100);
        const sentEnd = Math.min(draft.content.length, ref.endOffset + 80);
        const localSentence = draft.content.slice(sentStart, sentEnd).replace(/\s+/g, " ").trim();
        const cacheKey = `${srcArtNo}:${tgtArtNo}:${localSentence}`;
        const cachedDiag = cache.get(cacheKey);

        if (cachedDiag) {
            diagnostics.push(reanchorSemanticRefDiagnostic(draft, ref, cachedDiag));
        }
    }

    return diagnostics;
}

/**
 * Tier 1.5: Uses Gemini Decisions API (0 output tokens) to audit VALID internal cross-article
 * references for semantic mismatches (e.g. citing an unrelated crime or wrong article).
 */
export async function verifySemanticCrossReferencesWithDecisionApi(
    draft: ParsedDraft,
    references: readonly CrossReferenceItem[],
    options: UserLlmExtractOptions,
    cache?: Map<string, LegalDiagnostic | null>,
): Promise<{
    diagnostics: LegalDiagnostic[];
    decisionInputTokens: number;
    checkedCount: number;
    error?: string | null;
}> {
    const apiKey = options.apiKey?.trim() ?? "";

    if (!apiKey || options.useDecisionApi === false || references.length === 0) {
        return { diagnostics: [], decisionInputTokens: 0, checkedCount: 0 };
    }

    const articleMap = new Map<string, { title: string; body: string }>();

    for (const node of draft.nodes) {
        if (node.level === "ARTICLE" && node.articleNo && node.title) {
            articleMap.set(node.articleNo.toLowerCase(), {
                title: node.title,
                body: draft.content.slice(node.startOffset, Math.min(node.endOffset, node.startOffset + 220)).replace(/\s+/g, " ").trim(),
            });
        }
    }

    type RefCandidate = {
        ref: CrossReferenceItem;
        cacheKey: string;
        dossier: string;
        srcTitle: string;
        tgtTitle: string;
    };

    const diagnostics: LegalDiagnostic[] = [];
    const toAsk: RefCandidate[] = [];
    const sortedRefs = [...references].sort((a, b) => {
        const aExcl = /không thuộc|trừ trường hợp/iu.test(draft.content.slice(Math.max(0, a.startOffset - 40), a.startOffset)) ? 0 : 1;
        const bExcl = /không thuộc|trừ trường hợp/iu.test(draft.content.slice(Math.max(0, b.startOffset - 40), b.startOffset)) ? 0 : 1;

        return aExcl - bExcl;
    });

    for (const ref of sortedRefs) {
        if (ref.status !== "VALID") {
            continue;
        }

        const srcNode = findNodeAtOffset(draft.nodes, ref.startOffset);
        const srcArtNo = srcNode?.articleNo?.toLowerCase();
        const tgtMatch = /Điều\s+(\d+[a-zđ]?)/iu.exec(ref.targetRef);
        const tgtArtNo = tgtMatch?.[1]?.toLowerCase();

        if (!srcArtNo || !tgtArtNo || srcArtNo === tgtArtNo) {
            continue;
        }

        const srcInfo = articleMap.get(srcArtNo);
        const tgtInfo = articleMap.get(tgtArtNo);

        if (!srcInfo || !tgtInfo) {
            continue;
        }

        const sentStart = Math.max(0, ref.startOffset - 100);
        const sentEnd = Math.min(draft.content.length, ref.endOffset + 80);
        const localSentence = draft.content.slice(sentStart, sentEnd).replace(/\s+/g, " ").trim();
        const cacheKey = `${srcArtNo}:${tgtArtNo}:${localSentence}`;

        if (cache && cache.has(cacheKey)) {
            const cachedDiag = cache.get(cacheKey);

            if (cachedDiag) {
                diagnostics.push(reanchorSemanticRefDiagnostic(draft, ref, cachedDiag));
            }

            continue;
        }

        const tgtNum = Number.parseInt(tgtArtNo, 10);
        const neighbors: string[] = [];

        if (!Number.isNaN(tgtNum)) {
            const prevArt = articleMap.get(String(tgtNum - 1));
            const nextArt = articleMap.get(String(tgtNum + 1));

            if (prevArt) {
                neighbors.push(`Điều ${tgtNum - 1} (${prevArt.title})`);
            }

            if (nextArt) {
                neighbors.push(`Điều ${tgtNum + 1} (${nextArt.title})`);
            }
        }

        const neighborLine = neighbors.length > 0 ? `\nAdjacent Neighbor Articles: ${neighbors.join(" | ")}` : "";
        const dossier = `Source Điều ${srcArtNo} (${srcInfo.title}) [${ref.fromRef ?? ""}] says: "${localSentence}"\nCited Target Điều ${tgtArtNo} (${tgtInfo.title}): "${tgtInfo.body.slice(0, 140)}"${neighborLine}`;
        toAsk.push({
            ref,
            cacheKey,
            dossier,
            srcTitle: srcInfo.title,
            tgtTitle: tgtInfo.title,
        });
    }

    const batch = toAsk.slice(0, 16);

    if (batch.length === 0) {
        return { diagnostics, decisionInputTokens: 0, checkedCount: 0 };
    }

    const inputText = batch.map((item, idx) => `[R${idx}]\n${item.dossier}`).join("\n\n");
    const questions: Record<string, DecisionQuestion> = {};

    for (let idx = 0; idx < batch.length; idx += 1) {
        questions[`r${idx}_mismatch`] = {
            type: "noul",
            instructions: `In [R${idx}], is citing the Cited Target article likely a legislative drafting error — such as citing an unrelated topic, or citing a narrow special-case article when an adjacent general Neighbor article is clearly intended?`,
        };
    }

    try {
        const res = await callGeminiDecisions({
            apiKey,
            apiBaseUrl: options.apiBaseUrl,
            input: inputText,
            questions,
            fetcher: options.fetcher,
            signal: options.signal,
        });

        for (let idx = 0; idx < batch.length; idx += 1) {
            const item = batch[idx];
            const ans = res.answers[`r${idx}_mismatch`];
            let diag: LegalDiagnostic | null = null;

            if (ans && ans.type === "noul" && ans.noul >= 0.55 && ans.confidence >= 0.6) {
                diag = {
                    id: `LG015-${item.ref.startOffset}`,
                    code: "LG015",
                    category: "LOGIC",
                    severity: "warning",
                    title: `Nghi ngờ dẫn chiếu sai ngữ nghĩa điều luật: ${item.ref.targetRef}`,
                    message: `Điều nguồn ("${item.srcTitle}") dẫn chiếu tới ${item.ref.targetRef} ("${item.tgtTitle}"), nhưng Decision API đánh giá chủ đề không tương thích (score=${ans.noul.toFixed(2)}, conf=${ans.confidence.toFixed(2)}).`,
                    exploitScenario: "Dẫn chiếu nhầm sang tội danh hoặc điều khoản không liên quan gây xung đột áp dụng pháp luật.",
                    suggestion: `Kiểm tra lại số Điều được dẫn chiếu tại ${item.ref.fromRef ?? "điều khoản này"}.`,
                    excerpt: item.ref.rawText,
                    provisionRef: item.ref.fromRef,
                    range: rangeFromOffsets(draft.content, draft.lineStarts, item.ref.startOffset, item.ref.endOffset),
                    source: "AI",
                    quickFix: null,
                    corpusLink: null,
                };
                diagnostics.push(diag);
            }

            if (cache) {
                cache.set(item.cacheKey, diag);
            }
        }

        return {
            diagnostics,
            decisionInputTokens: res.usage.inputTokens,
            checkedCount: batch.length,
            error: null as string | null,
        };
    } catch (err: unknown) {
        if (isGeminiInvalidApiKeyError(err)) {
            return {
                diagnostics,
                decisionInputTokens: 0,
                checkedCount: 0,
                error: err instanceof Error ? err.message : String(err),
            };
        }

        return { diagnostics, decisionInputTokens: 0, checkedCount: 0, error: null as string | null };
    }
}
