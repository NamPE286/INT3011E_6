import {
    callGeminiDecisions,
    callGeminiStructuredInteraction,
    DEFAULT_GEMINI_MODEL,
    isGeminiInvalidApiKeyError,
    type DecisionQuestion,
} from "./gemini-client";
import { fnv1aHash } from "./llm-incremental";
import type { WorkspaceContext } from "./local-workspace";
import { findNodeAtOffset, positionAtOffset, type ParsedDraft, type ParsedNode } from "./parser";
import type {
    AiTokenBreakdown,
    DiagnosticSeverity,
    ExtractedPartitionRule,
    ExtractedSemanticDefect,
} from "./types";

export type ArticleAuditGroup = {
    id: string;
    hash: string;
    label: string;
    text: string;
    startOffset: number;
    endOffset: number;
};

export type NeuroSymbolicGroupCacheEntry = {
    partitions: ExtractedPartitionRule[];
    semanticDefects: ExtractedSemanticDefect[];
};

export type NeuroSymbolicAuditOptions = {
    apiKey?: string;
    apiBaseUrl?: string;
    model?: string;
    useDecisionApi?: boolean;
    workspaceContext?: WorkspaceContext;
    fetcher?: typeof fetch;
    signal?: AbortSignal;
    groupCache?: Map<string, NeuroSymbolicGroupCacheEntry>;
};

const NEUROSYMBOLIC_SYSTEM_PROMPT = `Bạn là bộ trích xuất Neuro-Symbolic cho hệ thống chứng minh hình thức Lean 4 (KHÔNG bịa đặt, KHÔNG suy đoán ngoài văn bản).
Nhiệm vụ:
1. "partitions": Trích xuất MỌI quy tắc phân loại/ngưỡng định lượng (tỷ lệ %, thời gian tháng/năm/ngày, số lượng, khối lượng, tiền...) thành khoảng toán học chuẩn:
   - "không quá X" / "tối đa X" -> min: 0, max: X, minInclusive: true, maxInclusive: true
   - "dưới X" -> min: 0, max: X, minInclusive: true, maxInclusive: false
   - "trên X" -> min: X, max: 100 (nếu là %) hoặc null, minInclusive: false, maxInclusive: true
   - "ít nhất X" / "X trở lên" -> min: X, max: 100 (nếu là %) hoặc null, minInclusive: true, maxInclusive: true
   - "từ A đến dưới B" -> min: A, max: B, minInclusive: true, maxInclusive: false
   - "domainKey": chuẩn hóa snake_case theo đối tượng + tiêu chí (ví dụ: "can_bo__tieu_chi_nv", "don_vi__chi_tieu", "don_vi__truc_thuoc", "nghi_phep_nam"). TUYỆT ĐỐI KHÔNG đưa tên mức xếp loại (xuat_sac, tot, hoan_thanh, khong_hoan_thanh, khoan_1, khoan_2) vào domainKey! Các Điều phân hạng liên tiếp PHẢI dùng CÙNG domainKey cho cùng tiêu chí.
   - CHỈ trích xuất ngưỡng điều kiện đầu vào (input thresholds), KHÔNG đưa thời hạn hình phạt đầu ra (ví dụ: "phạt tù từ 1 năm đến 5 năm", "cấm hành nghề từ 1 đến 5 năm") vào partitions.
2. "semanticDefects": Chỉ báo lỗi NỘI TẠI chắc chắn có căn cứ nguyên văn trong văn bản gửi:
   - BOOLEAN_LOGIC (dùng "và" thay vì "hoặc" gây điều kiện bất khả thi)
   - TIER_COLLAPSE (mức thấp đòi hỏi điều kiện cao bằng/hơn mức cao)
   - INTERNAL_CONTRADICTION (hai đoạn trong văn bản mâu thuẫn trực tiếp)
   - PROCEDURAL_GAP (thủ tục thiếu thời hạn hoặc bỏ sót nhóm đối tượng)
   - UNBOUNDED_CRITERIA (tiêu chí định tính mơ hồ không có ngưỡng/cơ sở)
   - QUANTITATIVE_PARADOX (nghịch lý số học giữa các mốc)
QUY TẮC CHỐNG ẢO GIÁC:
- Mọi "quote" PHẢI là chuỗi con NGUYÊN VĂN (verbatim) có trong văn bản.
- TUYỆT ĐỐI KHÔNG suy đoán hay kết luận về luật/nghị định bên ngoài không có trong văn bản.`;

const NEUROSYMBOLIC_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    required: ["partitions", "semanticDefects"],
    properties: {
        partitions: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: ["domainKey", "tierLabel", "unit", "min", "max", "minInclusive", "maxInclusive", "quote"],
                properties: {
                    domainKey: { type: "string" },
                    tierLabel: { type: "string" },
                    unit: { type: "string" },
                    min: { type: ["number", "null"] },
                    max: { type: ["number", "null"] },
                    minInclusive: { type: "boolean" },
                    maxInclusive: { type: "boolean" },
                    quote: { type: "string" },
                },
            },
        },
        semanticDefects: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: ["kind", "severity", "title", "message", "suggestion", "quote", "secondQuote"],
                properties: {
                    kind: {
                        type: "string",
                        enum: [
                            "BOOLEAN_LOGIC",
                            "TIER_COLLAPSE",
                            "INTERNAL_CONTRADICTION",
                            "PROCEDURAL_GAP",
                            "UNBOUNDED_CRITERIA",
                            "QUANTITATIVE_PARADOX",
                        ],
                    },
                    severity: { type: "string", enum: ["error", "warning", "info"] },
                    title: { type: "string" },
                    message: { type: "string" },
                    suggestion: { type: "string" },
                    quote: { type: "string" },
                    secondQuote: { type: ["string", "null"] },
                },
            },
        },
    },
};

export function groupArticlesForNeuroSymbolicAudit(draft: ParsedDraft): ArticleAuditGroup[] {
    const articles = draft.nodes.filter((n) => n.level === "ARTICLE");

    if (articles.length === 0) {
        const trimmed = draft.content.trim();

        if (!trimmed) {
            return [];
        }

        return [{
            id: "G0",
            hash: fnv1aHash(trimmed),
            label: "Toàn văn",
            text: trimmed.slice(0, 7000),
            startOffset: 0,
            endOffset: draft.content.length,
        }];
    }

    const groups: ArticleAuditGroup[] = [];
    let bucket: ParsedNode[] = [];
    let bucketChars = 0;

    const flushBucket = (): void => {
        if (bucket.length === 0) {
            return;
        }

        const first = bucket[0];
        const last = bucket[bucket.length - 1];
        const text = draft.content.slice(first.startOffset, last.endOffset).trim();
        const label = bucket.length === 1
            ? first.refLabel
            : `${first.refLabel}–${last.refLabel}`;

        groups.push({
            id: `G${groups.length}`,
            hash: fnv1aHash(text),
            label,
            text,
            startOffset: first.startOffset,
            endOffset: last.endOffset,
        });
        bucket = [];
        bucketChars = 0;
    };

    for (const art of articles) {
        const artLen = art.endOffset - art.startOffset;

        if (bucket.length >= 4 || (bucket.length > 0 && bucketChars + artLen > 6800)) {
            flushBucket();
        }

        bucket.push(art);
        bucketChars += artLen;
    }

    flushBucket();

    return groups;
}

export async function triageArticleGroupsWithDecisionApi(
    groups: readonly ArticleAuditGroup[],
    options: NeuroSymbolicAuditOptions,
): Promise<{
    escalated: ArticleAuditGroup[];
    filtered: ArticleAuditGroup[];
    decisionInputTokens: number;
    error?: string | null;
}> {
    const apiKey = options.apiKey?.trim() ?? "";

    if (!apiKey || groups.length === 0 || options.useDecisionApi === false) {
        return { escalated: [...groups], filtered: [], decisionInputTokens: 0 };
    }

    const batch = groups.slice(0, 16);
    const inputText = batch
        .map((g, idx) => `[G${idx}] (${g.label}): ${g.text.replace(/\s+/g, " ").slice(0, 320)}`)
        .join("\n");
    const questions: Record<string, DecisionQuestion> = {};

    for (let idx = 0; idx < batch.length; idx += 1) {
        questions[`g${idx}_audit`] = {
            type: "noul",
            instructions: `Does group [G${idx}] contain quantitative thresholds, classification tiers, logical conditions, or substantive obligations/procedures that could harbor gaps, overlaps, or contradictions?`,
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

        const escalated: ArticleAuditGroup[] = [];
        const filtered: ArticleAuditGroup[] = [];

        for (let idx = 0; idx < batch.length; idx += 1) {
            const ans = res.answers[`g${idx}_audit`];

            if (ans && ans.type === "noul" && ans.noul < 0.35 && ans.confidence >= 0.7) {
                filtered.push(batch[idx]);
            } else {
                escalated.push(batch[idx]);
            }
        }

        return {
            escalated,
            filtered,
            decisionInputTokens: res.usage.inputTokens,
            error: null as string | null,
        };
    } catch (err: unknown) {
        if (isGeminiInvalidApiKeyError(err)) {
            return {
                escalated: [] as ArticleAuditGroup[],
                filtered: [] as ArticleAuditGroup[],
                decisionInputTokens: 0,
                error: err instanceof Error ? err.message : String(err),
            };
        }

        return { escalated: [...groups], filtered: [], decisionInputTokens: 0, error: null as string | null };
    }
}

export function findVerbatimSpan(
    content: string,
    quote: string,
    hintStart = 0,
    hintEnd = content.length,
): { startOffset: number; endOffset: number } | null {
    const clean = quote.trim();

    if (clean.length < 6) {
        return null;
    }

    const windowSlice = content.slice(hintStart, hintEnd);
    let idx = windowSlice.indexOf(clean);

    if (idx !== -1) {
        return { startOffset: hintStart + idx, endOffset: hintStart + idx + clean.length };
    }

    idx = windowSlice.toLowerCase().indexOf(clean.toLowerCase());

    if (idx !== -1) {
        return { startOffset: hintStart + idx, endOffset: hintStart + idx + clean.length };
    }

    idx = content.indexOf(clean);

    if (idx !== -1) {
        return { startOffset: idx, endOffset: idx + clean.length };
    }

    idx = content.toLowerCase().indexOf(clean.toLowerCase());

    if (idx !== -1) {
        return { startOffset: idx, endOffset: idx + clean.length };
    }

    return null;
}

function isExternalLawHallucination(title: string, message: string): boolean {
    const blob = `${title} ${message}`.toLowerCase();

    return /(?:luật|nghị định|thông tư)\s+[^.\n]{2,60}(?:không có khoản|không có điều|không tồn tại|không quy định)/iu.test(blob);
}

export function anchorNeuroSymbolicOutput(
    draft: ParsedDraft,
    raw: unknown,
    hintStart = 0,
    hintEnd = draft.content.length,
): NeuroSymbolicGroupCacheEntry {
    if (typeof raw !== "object" || raw === null) {
        return { partitions: [], semanticDefects: [] };
    }

    const rec = raw as { partitions?: unknown[]; semanticDefects?: unknown[] };
    const partitions: ExtractedPartitionRule[] = [];
    const semanticDefects: ExtractedSemanticDefect[] = [];

    if (Array.isArray(rec.partitions)) {
        for (const item of rec.partitions) {
            if (typeof item !== "object" || item === null) {
                continue;
            }

            const p = item as Record<string, unknown>;
            const quote = typeof p.quote === "string" ? p.quote.trim() : "";
            const domainKey = typeof p.domainKey === "string" ? p.domainKey.trim() : "";
            const unit = typeof p.unit === "string" ? p.unit.trim() : "";
            const tierLabel = typeof p.tierLabel === "string" ? p.tierLabel.trim() : "";

            if (!quote || !domainKey || !unit) {
                continue;
            }

            const span = findVerbatimSpan(draft.content, quote, hintStart, hintEnd);

            if (!span) {
                continue;
            }

            const node = findNodeAtOffset(draft.nodes, span.startOffset);
            const line = positionAtOffset(draft.lineStarts, span.startOffset).line;

            partitions.push({
                domainKey: domainKey.toLowerCase().replace(/[^a-z0-9_]+/g, "_"),
                tierLabel: tierLabel || (node?.refLabel ?? `Dòng ${line}`),
                unit: unit.toLowerCase(),
                min: typeof p.min === "number" && Number.isFinite(p.min) ? p.min : null,
                max: typeof p.max === "number" && Number.isFinite(p.max) ? p.max : null,
                minInclusive: Boolean(p.minInclusive),
                maxInclusive: Boolean(p.maxInclusive),
                quote: draft.content.slice(span.startOffset, span.endOffset),
                startOffset: span.startOffset,
                endOffset: span.endOffset,
                line,
                provisionRef: node?.refLabel ?? null,
            });
        }
    }

    if (Array.isArray(rec.semanticDefects)) {
        for (const item of rec.semanticDefects) {
            if (typeof item !== "object" || item === null) {
                continue;
            }

            const d = item as Record<string, unknown>;
            const quote = typeof d.quote === "string" ? d.quote.trim() : "";
            const title = typeof d.title === "string" ? d.title.trim() : "";
            const message = typeof d.message === "string" ? d.message.trim() : "";
            const suggestion = typeof d.suggestion === "string" ? d.suggestion.trim() : "";
            const kind = d.kind as ExtractedSemanticDefect["kind"];
            const severity = (d.severity === "error" || d.severity === "warning" || d.severity === "info"
                ? d.severity
                : "warning") as DiagnosticSeverity;

            if (!quote || !title || !message || isExternalLawHallucination(title, message)) {
                continue;
            }

            const span = findVerbatimSpan(draft.content, quote, hintStart, hintEnd);

            if (!span) {
                continue;
            }

            const node = findNodeAtOffset(draft.nodes, span.startOffset);
            const line = positionAtOffset(draft.lineStarts, span.startOffset).line;

            semanticDefects.push({
                kind: kind || "INTERNAL_CONTRADICTION",
                severity,
                title,
                message,
                suggestion: suggestion || "Rà soát và chỉnh sửa lại quy định cho nhất quán.",
                quote: draft.content.slice(span.startOffset, span.endOffset),
                secondQuote: typeof d.secondQuote === "string" ? d.secondQuote.trim() : null,
                startOffset: span.startOffset,
                endOffset: span.endOffset,
                line,
                provisionRef: node?.refLabel ?? null,
            });
        }
    }

    return { partitions, semanticDefects };
}

function reanchorGroupEntry(
    draft: ParsedDraft,
    entry: NeuroSymbolicGroupCacheEntry,
    hintStart: number,
    hintEnd: number,
): NeuroSymbolicGroupCacheEntry {
    const partitions: ExtractedPartitionRule[] = [];
    const semanticDefects: ExtractedSemanticDefect[] = [];

    for (const p of entry.partitions) {
        const span = findVerbatimSpan(draft.content, p.quote, hintStart, hintEnd);

        if (!span) {
            continue;
        }

        const node = findNodeAtOffset(draft.nodes, span.startOffset);
        const line = positionAtOffset(draft.lineStarts, span.startOffset).line;

        partitions.push({
            ...p,
            startOffset: span.startOffset,
            endOffset: span.endOffset,
            line,
            provisionRef: node?.refLabel ?? p.provisionRef,
        });
    }

    for (const d of entry.semanticDefects) {
        const span = findVerbatimSpan(draft.content, d.quote, hintStart, hintEnd);

        if (!span) {
            continue;
        }

        const node = findNodeAtOffset(draft.nodes, span.startOffset);
        const line = positionAtOffset(draft.lineStarts, span.startOffset).line;

        semanticDefects.push({
            ...d,
            startOffset: span.startOffset,
            endOffset: span.endOffset,
            line,
            provisionRef: node?.refLabel ?? d.provisionRef,
        });
    }

    return { partitions, semanticDefects };
}

export function getCachedNeuroSymbolicForDraft(
    draft: ParsedDraft,
    groupCache: Map<string, NeuroSymbolicGroupCacheEntry> | undefined,
    model = DEFAULT_GEMINI_MODEL,
): {
    partitions: ExtractedPartitionRule[];
    semanticDefects: ExtractedSemanticDefect[];
    cachedCount: number;
} {
    if (!groupCache || groupCache.size === 0) {
        return { partitions: [], semanticDefects: [], cachedCount: 0 };
    }

    const groups = groupArticlesForNeuroSymbolicAudit(draft);
    const partitions: ExtractedPartitionRule[] = [];
    const semanticDefects: ExtractedSemanticDefect[] = [];
    let cachedCount = 0;

    for (const g of groups) {
        const hit = groupCache.get(`${model}::${g.hash}`) ?? groupCache.get(g.hash);

        if (!hit) {
            continue;
        }

        cachedCount += 1;
        const reanchored = reanchorGroupEntry(draft, hit, g.startOffset, g.endOffset);
        partitions.push(...reanchored.partitions);
        semanticDefects.push(...reanchored.semanticDefects);
    }

    return { partitions, semanticDefects, cachedCount };
}

export async function runNeuroSymbolicAudit(
    draft: ParsedDraft,
    options: NeuroSymbolicAuditOptions,
): Promise<{
    partitions: ExtractedPartitionRule[];
    semanticDefects: ExtractedSemanticDefect[];
    tokensUsed: number;
    breakdown: AiTokenBreakdown;
    modelUsed: string | null;
    error: string | null;
}> {
    const apiKey = options.apiKey?.trim() ?? "";
    const groups = groupArticlesForNeuroSymbolicAudit(draft);

    if (!apiKey || groups.length === 0) {
        return {
            partitions: [],
            semanticDefects: [],
            tokensUsed: 0,
            breakdown: {
                decisionInputTokens: 0,
                extractInputTokens: 0,
                extractOutputTokens: 0,
                totalTokens: 0,
                filteredByDecision: 0,
                escalatedToExtract: 0,
                cachedUnits: 0,
            },
            modelUsed: null,
            error: null,
        };
    }

    const cache = options.groupCache;
    const requestedModel = options.model?.trim() || DEFAULT_GEMINI_MODEL;
    const allPartitions: ExtractedPartitionRule[] = [];
    const allDefects: ExtractedSemanticDefect[] = [];
    const missGroups: ArticleAuditGroup[] = [];
    let cachedCount = 0;

    for (const g of groups) {
        const hit = cache?.get(`${requestedModel}::${g.hash}`) ?? cache?.get(g.hash);

        if (hit) {
            cachedCount += 1;
            const reanchored = reanchorGroupEntry(draft, hit, g.startOffset, g.endOffset);
            allPartitions.push(...reanchored.partitions);
            allDefects.push(...reanchored.semanticDefects);
        } else {
            missGroups.push(g);
        }
    }

    if (missGroups.length === 0) {
        return {
            partitions: allPartitions,
            semanticDefects: allDefects,
            tokensUsed: 0,
            breakdown: {
                decisionInputTokens: 0,
                extractInputTokens: 0,
                extractOutputTokens: 0,
                totalTokens: 0,
                filteredByDecision: 0,
                escalatedToExtract: 0,
                cachedUnits: cachedCount,
            },
            modelUsed: options.model ?? DEFAULT_GEMINI_MODEL,
            error: null,
        };
    }

    const triage = await triageArticleGroupsWithDecisionApi(missGroups, options);

    if (triage.error) {
        return {
            partitions: allPartitions,
            semanticDefects: allDefects,
            tokensUsed: triage.decisionInputTokens,
            breakdown: {
                decisionInputTokens: triage.decisionInputTokens,
                extractInputTokens: 0,
                extractOutputTokens: 0,
                totalTokens: triage.decisionInputTokens,
                filteredByDecision: triage.filtered.length,
                escalatedToExtract: 0,
                cachedUnits: cachedCount,
            },
            modelUsed: options.model ?? DEFAULT_GEMINI_MODEL,
            error: triage.error,
        };
    }

    let extractInputTokens = 0;
    let extractOutputTokens = 0;
    let modelUsed: string | null = options.model?.trim() || DEFAULT_GEMINI_MODEL;
    let lastError: string | null = null;
    let fatalAuthError: string | null = null;
    const candidateModels = [...new Set([modelUsed, "gemini-3.5-flash-lite", "gemini-3.7-flash", "gemini-3.6-flash"])];

    for (let i = 0; i < triage.escalated.length; i += 1) {
        const g = triage.escalated[i];
        let succeeded = false;

        for (const m of candidateModels) {
            const isThinking = /3\.[678]|gemini-4/i.test(m);

            try {
                const res = await callGeminiStructuredInteraction({
                    apiKey,
                    apiBaseUrl: options.apiBaseUrl,
                    model: m,
                    systemInstruction: NEUROSYMBOLIC_SYSTEM_PROMPT,
                    input: `[NHÓM ${g.label}]\n${g.text}`,
                    schema: NEUROSYMBOLIC_SCHEMA,
                    maxOutputTokens: isThinking ? 8192 : 3200,
                    fetcher: options.fetcher,
                    signal: options.signal,
                });
                const anchored = anchorNeuroSymbolicOutput(draft, res.data, g.startOffset, g.endOffset);
                cache?.set(`${requestedModel}::${g.hash}`, anchored);
                allPartitions.push(...anchored.partitions);
                allDefects.push(...anchored.semanticDefects);
                extractInputTokens += res.usage.inputTokens;
                extractOutputTokens += res.usage.outputTokens;
                modelUsed = m;
                succeeded = true;
                break;
            } catch (err: unknown) {
                lastError = err instanceof Error ? err.message : String(err);

                if (isGeminiInvalidApiKeyError(err)) {
                    fatalAuthError = lastError;
                    break;
                }

                if (err instanceof DOMException && err.name === "AbortError") {
                    break;
                }
            }
        }

        if (fatalAuthError) {
            break;
        }

        if (!succeeded && !options.fetcher) {
            await new Promise((r) => setTimeout(r, 600));
        } else if (!options.fetcher && i + 1 < triage.escalated.length) {
            await new Promise((r) => setTimeout(r, 500));
        }
    }

    const totalTokens = triage.decisionInputTokens + extractInputTokens + extractOutputTokens;

    return {
        partitions: allPartitions,
        semanticDefects: allDefects,
        tokensUsed: totalTokens,
        breakdown: {
            decisionInputTokens: triage.decisionInputTokens,
            extractInputTokens,
            extractOutputTokens,
            totalTokens,
            filteredByDecision: triage.filtered.length,
            escalatedToExtract: triage.escalated.length,
            cachedUnits: cachedCount,
        },
        modelUsed,
        error: fatalAuthError ?? (allPartitions.length === 0 && allDefects.length === 0 ? lastError : null),
    };
}
