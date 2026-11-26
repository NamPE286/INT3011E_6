import { isRecord, requestStructuredJson } from "../llm/openai-json";
import { selectAiCandidateClauses } from "./ide.lean-compiler";
import { findNodeAtOffset, positionAtOffset, type ParsedDraft } from "./ide.parser";
import type { ExtractedLegalFact, ExtractedModality, ExtractedSubject } from "./ide.types";
import type { WorkspaceContext } from "./ide.workspace";

const LLM_EXTRACT_SYSTEM_PROMPT = `Bạn là bộ trích xuất cấu trúc sự kiện pháp lý (Structured Legal Fact Extractor) cho trình biên dịch Lean 4.
NGUYÊN TẮC BẮT BUỘC:
1. CHỈ trích xuất dữ kiện cấu trúc có trong các khoản được gửi. TUYỆT ĐỐI KHÔNG tự đánh giá đúng/sai, KHÔNG sinh lỗi, KHÔNG sinh mã Lean 4, KHÔNG viện dẫn bất kỳ văn bản nào ngoài workspace.
2. "quote" PHẢI là trích đoạn nguyên văn (verbatim substring) xuất hiện trong dự thảo.
3. Với mỗi khoản phức tạp, trích xuất tối đa 1-2 sự kiện gồm:
   - modality: PROHIBITED (hành vi bị cấm), OBLIGATED (nghĩa vụ bắt buộc), PERMITTED (được phép), SANCTION (quy định xử phạt).
   - subject: INDIVIDUAL, ORGANIZATION, BOTH, hoặc UNSPECIFIED.
   - actionKey: cụm snake_case ngắn mô tả hành vi chính (vd: "vuot_den_do", "lai_xe_tu_hanh").
   - fineMin / fineMax (số nguyên VNĐ nếu có, ngược lại null).
   - thresholdUnit / thresholdMin / thresholdMax (đơn vị và ngưỡng định lượng nếu có, ngược lại null).
   - hasSanction: true nếu điều khoản có chế tài kèm theo.
   - hasOpenException: true nếu có ngoại lệ mở ("trường hợp đặc biệt", "lý do chính đáng"...).
   - hasExceptionCriteria: true nếu ngoại lệ có tiêu chí/điều kiện định lượng cụ thể.
   - referencedTerms: mảng các thuật ngữ chuyên ngành xuất hiện trong trích đoạn.`;

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

export type LlmExtractOptions = {
    apiKey?: string;
    model: string;
    workspaceContext?: WorkspaceContext;
    fetcher?: typeof fetch;
};

/**
 * Uses an LLM strictly as a structured fact extractor on complex clauses.
 * All formal verification, theorem generation, and diagnostics are computed deterministically by the Lean 4 compiler.
 */
export async function extractLegalFactsWithLlm(
    draft: ParsedDraft,
    options: LlmExtractOptions,
): Promise<{
    facts: ExtractedLegalFact[];
    actualAiTokens: number;
    error: string | null;
}> {
    if (!options.apiKey || options.apiKey.trim().length === 0) {
        return {
            facts: [],
            actualAiTokens: 0,
            error: "Chưa cấu hình OPENAI_API_KEY trên máy chủ nên chỉ chạy biên dịch Lean 4 tất định (0 token).",
        };
    }

    const candidates = selectAiCandidateClauses(draft);
    const compactClauses = candidates.length > 0
        ? candidates.map((item) => `[${item.refLabel}] ${item.text}`).join("\n")
        : draft.content.slice(0, 4000);

    const wsSummary = formatWorkspaceSummary(options.workspaceContext);
    const userText = `${wsSummary}\n\nCÁC KHOẢN CẦN TRÍCH XUẤT SỰ KIỆN PHÁP LÝ:\n${compactClauses}`;

    try {
        const raw = await requestStructuredJson({
            apiKey: options.apiKey,
            model: options.model,
            schemaName: "legislative_extract_facts_v1",
            schema: LLM_EXTRACT_SCHEMA,
            systemPrompt: LLM_EXTRACT_SYSTEM_PROMPT,
            userText,
            maxOutputTokens: 1200,
            fetcher: options.fetcher,
        });

        const facts = anchorExtractedFacts(draft, raw);
        const estimatedTokens = Math.ceil((LLM_EXTRACT_SYSTEM_PROMPT.length + userText.length + JSON.stringify(raw).length) / 3.5);

        return {
            facts,
            actualAiTokens: estimatedTokens,
            error: null,
        };
    } catch (cause: unknown) {
        const message = cause instanceof Error ? cause.message : "Lỗi gọi mô hình trích xuất LLM";

        return {
            facts: [],
            actualAiTokens: 0,
            error: message,
        };
    }
}

function formatWorkspaceSummary(workspace: WorkspaceContext | undefined): string {
    if (!workspace || (workspace.corpusDocumentCount === 0 && workspace.savedDraftCount === 0)) {
        return "WORKSPACE_DOCUMENTS: (Trống — chưa có văn bản nào ngoài dự thảo hiện tại)\nWORKSPACE_TERMS: (Không có)";
    }

    const docs = workspace.bases.slice(0, 8).map((item) => `- ${item.label} [${item.sourceLabel}]`).join("\n") || "(Không có)";
    const terms = workspace.definedTerms.slice(0, 12).map((item) => `- ${item.term} (${item.sourceLabel})`).join("\n") || "(Không có)";

    return `WORKSPACE_DOCUMENTS:\n${docs}\nWORKSPACE_TERMS:\n${terms}`;
}

function anchorExtractedFacts(draft: ParsedDraft, raw: unknown): ExtractedLegalFact[] {
    if (!isRecord(raw) || !Array.isArray(raw.facts)) {
        return [];
    }

    const facts: ExtractedLegalFact[] = [];
    const lowerContent = draft.content.toLowerCase();

    for (const item of raw.facts) {
        if (!isRecord(item)) {
            continue;
        }

        const quote = readText(item.quote);
        const modality = readModality(item.modality);
        const subject = readSubject(item.subject);
        const actionKey = normalizeActionKey(readText(item.actionKey) ?? "");

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
        const referencedTerms = Array.isArray(item.referencedTerms)
            ? item.referencedTerms.filter((t): t is string => typeof t === "string" && t.trim().length >= 2).map((t) => t.trim())
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
            fineMin: readFiniteNumber(item.fineMin),
            fineMax: readFiniteNumber(item.fineMax),
            thresholdUnit: readText(item.thresholdUnit),
            thresholdMin: readFiniteNumber(item.thresholdMin),
            thresholdMax: readFiniteNumber(item.thresholdMax),
            hasSanction: Boolean(item.hasSanction),
            hasOpenException: Boolean(item.hasOpenException),
            hasExceptionCriteria: Boolean(item.hasExceptionCriteria),
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

function readFiniteNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
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
