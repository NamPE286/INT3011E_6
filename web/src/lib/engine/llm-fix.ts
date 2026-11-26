import {
    callGeminiStructuredInteraction,
    DEFAULT_GEMINI_MODEL,
    type GeminiUsage,
} from "./gemini-client";
import { computeLineStarts, parseDraftDocument } from "./parser";
import type { WorkspaceContext } from "./local-workspace";
import type { LegalDiagnostic, QuickFix } from "./types";

export type AiFixRequest = {
    content: string;
    diagnostic: LegalDiagnostic;
    workspaceContext?: WorkspaceContext | null;
    apiKey: string;
    apiBaseUrl?: string;
    model?: string;
    fetcher?: typeof fetch;
    signal?: AbortSignal;
};

export type AiFixResult = {
    fix: QuickFix;
    explanation: string;
    usage: GeminiUsage;
};

export type FixTargetWindow = {
    startOffset: number;
    endOffset: number;
    targetBlock: string;
    startLine: number;
    endLine: number;
};

const AI_FIX_SCHEMA: Record<string, unknown> = {
    type: "object",
    properties: {
        replacement: {
            type: "string",
            description: "Đoạn văn bản quy phạm pháp luật đã được sửa hoàn chỉnh để thay thế nguyên khối TARGET_BLOCK.",
        },
        explanation: {
            type: "string",
            description: "Giải thích ngắn gọn (1 câu tiếng Việt) về nội dung đã sửa.",
        },
    },
    required: ["replacement", "explanation"],
};

const AI_FIX_SYSTEM_INSTRUCTION = [
    "Bạn là chuyên gia kỹ thuật lập pháp Việt Nam (Nghị định 34/2016/NĐ-CP và Nghị định 30/2020/NĐ-CP).",
    "Nhiệm vụ: chỉ sửa đúng lỗi được báo cáo trong TARGET_BLOCK, giữ nguyên cấu trúc Chương/Điều/Khoản/Điểm, văn phong pháp lý và các phần không liên quan.",
    "Quy tắc bắt buộc:",
    "1. Chỉ trả về JSON hợp lệ theo schema { replacement, explanation }.",
    "2. replacement phải thay thế nguyên khối TARGET_BLOCK, không bọc markdown (```), không thêm lời dẫn.",
    "3. Không bịa số hiệu văn bản ngoài danh sách WORKSPACE_DOCS nếu có.",
    "4. Nếu lỗi là thiếu điều khoản Hiệu lực thi hành (LP005), giữ nguyên đoạn cuối và bổ sung Điều Hiệu lực thi hành tiếp theo đúng số thứ tự.",
].join("\n");

function lineRangeToOffsets(
    content: string,
    lineStarts: readonly number[],
    startLine: number,
    endLine: number,
): FixTargetWindow {
    const lines = content.split("\n");
    const safeStartLine = Math.max(1, Math.min(startLine, lines.length));
    const safeEndLine = Math.max(safeStartLine, Math.min(endLine, lines.length));
    const startOffset = lineStarts[safeStartLine - 1] ?? 0;
    const lastLineStart = lineStarts[safeEndLine - 1] ?? startOffset;
    const endOffset = lastLineStart + (lines[safeEndLine - 1]?.length ?? 0);

    return {
        startOffset,
        endOffset,
        targetBlock: content.slice(startOffset, endOffset),
        startLine: safeStartLine,
        endLine: safeEndLine,
    };
}

/**
 * Selects the smallest coherent line window in `content` that the AI should rewrite
 * to resolve `diagnostic`.
 */
export function selectFixTargetWindow(content: string, diagnostic: LegalDiagnostic): FixTargetWindow {
    const lineStarts = computeLineStarts(content);
    const lines = content.split("\n");

    if (diagnostic.code === "LG010") {
        let firstBasis = -1;
        let lastBasis = -1;

        for (let idx = 0; idx < lines.length; idx += 1) {
            const trimmed = lines[idx].trim();

            if (/^Căn\s+cứ\s+/iu.test(trimmed)) {
                if (firstBasis === -1) {
                    firstBasis = idx + 1;
                }

                lastBasis = idx + 1;
            } else if (/^\s*(?:Chương\s+|Điều\s+\d+)/iu.test(trimmed)) {
                break;
            }
        }

        if (firstBasis !== -1 && lastBasis !== -1) {
            return lineRangeToOffsets(content, lineStarts, firstBasis, lastBasis);
        }
    }

    if (diagnostic.code === "LG006" || diagnostic.id === "LG013-missing-basis") {
        return lineRangeToOffsets(content, lineStarts, 1, Math.min(3, lines.length));
    }

    if (diagnostic.code === "LP005" && diagnostic.id.startsWith("LP005-effective-")) {
        const parsed = parseDraftDocument(content);
        const lastArticle = [...parsed.nodes].reverse().find((node) => node.level === "ARTICLE");

        if (lastArticle) {
            return lineRangeToOffsets(content, lineStarts, lastArticle.startLine, lines.length);
        }
    }

    if (diagnostic.code === "LP002" || diagnostic.code === "LP006" || diagnostic.code === "LP007") {
        const parsed = parseDraftDocument(content);
        const enclosingArticle = parsed.nodes.find(
            (node) =>
                node.level === "ARTICLE"
                && diagnostic.range.startLine >= node.startLine
                && diagnostic.range.startLine <= node.endLine,
        );

        if (enclosingArticle && enclosingArticle.endLine - enclosingArticle.startLine <= 25) {
            return lineRangeToOffsets(content, lineStarts, enclosingArticle.startLine, enclosingArticle.endLine);
        }
    }

    return lineRangeToOffsets(
        content,
        lineStarts,
        diagnostic.range.startLine,
        diagnostic.range.endLine,
    );
}

function stripMarkdownFences(text: string): string {
    const trimmed = text.trim();
    const fenceMatch = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/.exec(trimmed);

    if (fenceMatch) {
        return fenceMatch[1];
    }

    return text;
}

function buildWorkspaceSummary(workspaceContext?: WorkspaceContext | null): string {
    if (!workspaceContext) {
        return "(Workspace trống)";
    }

    const bases = workspaceContext.bases
        .slice(0, 12)
        .map((b) => `- ${b.documentNumber ?? b.label}: ${b.insertText}`)
        .join("\n");
    const terms = workspaceContext.definedTerms
        .slice(0, 12)
        .map((t) => `- ${t.term} (${t.sourceLabel})`)
        .join("\n");

    return [
        bases ? `Văn bản trong workspace:\n${bases}` : "",
        terms ? `Thuật ngữ đã định nghĩa:\n${terms}` : "",
    ]
        .filter(Boolean)
        .join("\n\n") || "(Workspace trống)";
}

/**
 * Generates a structured AI QuickFix for any LegalDiagnostic using Gemini Interactions API.
 */
export async function generateAiFixForDiagnostic(request: AiFixRequest): Promise<AiFixResult> {
    const window = selectFixTargetWindow(request.content, request.diagnostic);
    const contextSnippet = request.content.slice(0, 6000);
    const workspaceSummary = buildWorkspaceSummary(request.workspaceContext);

    const promptInput = [
        `DIAGNOSTIC:`,
        `- Mã lỗi: ${request.diagnostic.code} (${request.diagnostic.category}, ${request.diagnostic.severity})`,
        `- Tiêu đề: ${request.diagnostic.title}`,
        `- Mô tả: ${request.diagnostic.message}`,
        `- Rủi ro lách luật: ${request.diagnostic.exploitScenario}`,
        `- Gợi ý chuẩn: ${request.diagnostic.suggestion}`,
        request.diagnostic.counterexample ? `- Phản ví dụ Lean 4: ${request.diagnostic.counterexample}` : "",
        "",
        `WORKSPACE_DOCS:`,
        workspaceSummary,
        "",
        `DOCUMENT_CONTEXT (trích đoạn):`,
        contextSnippet,
        "",
        `TARGET_BLOCK (Dòng ${window.startLine}-${window.endLine}, cần trả về bản sửa thay thế nguyên khối này):`,
        window.targetBlock,
    ]
        .filter((line) => line !== "")
        .join("\n");

    const { data, usage } = await callGeminiStructuredInteraction({
        apiKey: request.apiKey,
        apiBaseUrl: request.apiBaseUrl,
        model: request.model ?? DEFAULT_GEMINI_MODEL,
        systemInstruction: AI_FIX_SYSTEM_INSTRUCTION,
        input: promptInput,
        schema: AI_FIX_SCHEMA,
        maxOutputTokens: 1200,
        fetcher: request.fetcher,
        signal: request.signal,
    });

    if (typeof data !== "object" || data === null) {
        throw new Error("AI không trả về dữ liệu sửa lỗi hợp lệ.");
    }

    const record = data as Record<string, unknown>;
    const rawReplacement = typeof record.replacement === "string" ? record.replacement : "";
    const replacement = stripMarkdownFences(rawReplacement);
    const explanation = typeof record.explanation === "string" && record.explanation.trim()
        ? record.explanation.trim()
        : "Sửa bằng AI";

    if (!replacement.trim()) {
        throw new Error("AI trả về nội dung thay thế rỗng.");
    }

    if (replacement === window.targetBlock) {
        throw new Error("AI không đề xuất thay đổi nào khác với văn bản hiện tại.");
    }

    return {
        fix: {
            label: explanation,
            replacement,
            startOffset: window.startOffset,
            endOffset: window.endOffset,
        },
        explanation,
        usage,
    };
}
