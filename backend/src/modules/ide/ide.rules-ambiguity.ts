import { findNodeAtOffset, normalizeLegalTerm, positionAtOffset, rangeFromOffsets, type ParsedDraft } from "./ide.parser";
import type { LegalDiagnostic, TermStatusItem } from "./ide.types";
import type { WorkspaceDefinedTerm } from "./ide.workspace";

type AmbiguousPhraseRule = {
    pattern: RegExp;
    reason: string;
    suggestion: string;
    replacement?: string;
};

const WEASEL_WORD_RULES: readonly AmbiguousPhraseRule[] = [
    {
        pattern: /\bhợp lý\b/giu,
        reason: "Thuật ngữ định tính 'hợp lý' không có thước đo khách quan.",
        suggestion: "Thay bằng mốc thời gian, khoảng cách hoặc tỷ lệ định lượng cụ thể.",
    },
    {
        pattern: /\bphù hợp\b/giu,
        reason: "Từ 'phù hợp' phụ thuộc đánh giá chủ quan của người thực thi.",
        suggestion: "Nêu rõ tiêu chuẩn kỹ thuật hoặc điều khoản dẫn chiếu thay cho 'phù hợp'.",
    },
    {
        pattern: /\b(?:đặc biệt\s+)?nghiêm trọng\b/giu,
        reason: "Khái niệm 'nghiêm trọng' chưa được định lượng bằng ngưỡng thiệt hại hoặc hậu quả.",
        suggestion: "Xác định ngưỡng cụ thể (ví dụ: gây thiệt hại từ ... đồng hoặc làm bị thương từ ... người).",
    },
    {
        pattern: /\bkịp thời\b/giu,
        reason: "'Kịp thời' không xác định thời hạn tối đa phải thực hiện.",
        suggestion: "Thay bằng thời hạn cụ thể (ví dụ: 'trong thời hạn 24 giờ').",
        replacement: "trong thời hạn 24 giờ",
    },
    {
        pattern: /\bnhanh chóng\b/giu,
        reason: "'Nhanh chóng' là khái niệm mơ hồ về thời gian.",
        suggestion: "Thay bằng mốc thời gian cụ thể tính bằng phút hoặc giờ.",
    },
    {
        pattern: /\bđáng kể\b/giu,
        reason: "'Đáng kể' không có ngưỡng phần trăm hoặc giá trị tối thiểu.",
        suggestion: "Định lượng bằng tỷ lệ % hoặc giá trị cụ thể.",
    },
    {
        pattern: /\btương tự\b/giu,
        reason: "Cụm 'tương tự' mở rộng phạm vi áp dụng một cách không rõ ràng.",
        suggestion: "Liệt kê tường minh hoặc dẫn chiếu danh mục kỹ thuật.",
    },
    {
        pattern: /\bmột cách an toàn\b/giu,
        reason: "Cụm 'một cách an toàn' không xác định tiêu chí kiểm tra.",
        suggestion: "Quy định rõ điều kiện bảo đảm an toàn cụ thể.",
    },
];

const OPEN_ENUMERATION = /(?:và\s+các\s+(?:trường hợp|hành vi|loại\s+\S+|đối tượng)\s+khác(?:\s+có\s+liên\s+quan)?|v\.v\.|\.\.\.)/giu;
const DISCRETIONARY_SANCTION = /\bcó thể bị\s+(?:phạt|tước|đình chỉ|tịch thu)\b/giu;
const VAGUE_BACK_REF = /(?:hành vi nêu trên|quy định nêu trên|như trên|và\/hoặc)/giu;

const TRACKED_LEGAL_TERMS: readonly RegExp[] = [
    /(?<![\p{L}\p{N}_])điểm\s+giấy\s+phép\s+lái\s+xe(?![\p{L}\p{N}_])/giu,
    /(?<![\p{L}\p{N}_])điểm\s+gplx(?![\p{L}\p{N}_])/giu,
    /(?<![\p{L}\p{N}_])giấy\s+phép\s+lái\s+xe(?![\p{L}\p{N}_])/giu,
    /(?<![\p{L}\p{N}_])xe\s+tự\s+hành(?![\p{L}\p{N}_])/giu,
    /(?<![\p{L}\p{N}_])phương\s+tiện\s+giao\s+thông\s+thông\s+minh(?![\p{L}\p{N}_])/giu,
    /(?<![\p{L}\p{N}_])hệ\s+thống\s+hỗ\s+trợ\s+lái(?![\p{L}\p{N}_])/giu,
    /(?<![\p{L}\p{N}_])thiết\s+bị\s+giám\s+sát\s+hành\s+trình(?![\p{L}\p{N}_])/giu,
    /(?<![\p{L}\p{N}_])đường\s+cao\s+tốc(?![\p{L}\p{N}_])/giu,
    /(?<![\p{L}\p{N}_])nồng\s+độ\s+cồn(?![\p{L}\p{N}_])/giu,
    /(?<![\p{L}\p{N}_])trí\s+tuệ\s+nhân\s+tạo(?![\p{L}\p{N}_])/giu,
    /(?<![\p{L}\p{N}_])dữ\s+liệu\s+nhạy\s+cảm(?![\p{L}\p{N}_])/giu,
    /(?<![\p{L}\p{N}_])tài\s+sản\s+số(?![\p{L}\p{N}_])/giu,
];

export function analyzeAmbiguities(
    draft: ParsedDraft,
    workspaceDefinedTerms: readonly WorkspaceDefinedTerm[] = [],
): { diagnostics: LegalDiagnostic[]; terms: TermStatusItem[] } {
    const diagnostics: LegalDiagnostic[] = [];

    detectWeaselWords(draft, diagnostics);
    detectOpenEnumerations(draft, diagnostics);
    detectDiscretionarySanctions(draft, diagnostics);
    detectVagueBackReferences(draft, diagnostics);
    const terms = detectUndefinedTerms(draft, workspaceDefinedTerms, diagnostics);

    return { diagnostics, terms };
}

function detectWeaselWords(draft: ParsedDraft, out: LegalDiagnostic[]): void {
    for (const rule of WEASEL_WORD_RULES) {
        for (const match of draft.content.matchAll(rule.pattern)) {
            const startOffset = match.index;
            const endOffset = startOffset + match[0].length;
            const node = findNodeAtOffset(draft.nodes, startOffset);

            out.push({
                id: `AM001-${startOffset}`,
                code: "AM001",
                category: "AMBIGUITY",
                severity: "warning",
                title: `Ngôn từ định tính mơ hồ: "${match[0]}"`,
                message: rule.reason,
                exploitScenario: "Người thực thi có thể giải thích tùy nghi theo hướng bất lợi hoặc bỏ qua vi phạm do không có tiêu chuẩn đo lường thống nhất.",
                suggestion: rule.suggestion,
                excerpt: match[0],
                provisionRef: node?.refLabel ?? null,
                range: rangeFromOffsets(draft.content, draft.lineStarts, startOffset, endOffset),
                source: "STATIC",
                quickFix: rule.replacement
                    ? {
                        label: `Thay bằng "${rule.replacement}"`,
                        replacement: rule.replacement,
                        startOffset,
                        endOffset,
                    }
                    : null,
                corpusLink: null,
            });
        }
    }
}

function detectOpenEnumerations(draft: ParsedDraft, out: LegalDiagnostic[]): void {
    for (const match of draft.content.matchAll(OPEN_ENUMERATION)) {
        const startOffset = match.index;
        const endOffset = startOffset + match[0].length;
        const tail = draft.content.slice(endOffset, endOffset + 50);

        if (/^\s*theo\s+quy\s+định/iu.test(tail)) {
            continue;
        }

        const node = findNodeAtOffset(draft.nodes, startOffset);

        out.push({
            id: `AM002-${startOffset}`,
            code: "AM002",
            category: "AMBIGUITY",
            severity: "warning",
            title: "Liệt kê mở không giới hạn phạm vi",
            message: `Cụm "${match[0]}" khiến danh sách hành vi/đối tượng bị xử phạt không khép kín, vi phạm nguyên tắc minh bạch chế tài.`,
            exploitScenario: "Cơ quan xử phạt có thể mở rộng sang hành vi không được dự liệu, hoặc người dân khiếu nại vì không thể biết trước hành vi nào bị cấm.",
            suggestion: "Liệt kê đầy đủ các trường hợp cụ thể hoặc dẫn chiếu điều khoản quy định chi tiết trong workspace.",
            excerpt: match[0],
            provisionRef: node?.refLabel ?? null,
            range: rangeFromOffsets(draft.content, draft.lineStarts, startOffset, endOffset),
            source: "STATIC",
            quickFix: {
                label: "Gắn dẫn chiếu 'theo quy định tại Điều ...'",
                replacement: `${match[0]} theo quy định tại Điều ...`,
                startOffset,
                endOffset,
            },
            corpusLink: null,
        });
    }
}

function detectDiscretionarySanctions(draft: ParsedDraft, out: LegalDiagnostic[]): void {
    for (const match of draft.content.matchAll(DISCRETIONARY_SANCTION)) {
        const startOffset = match.index;
        const endOffset = startOffset + match[0].length;
        const node = findNodeAtOffset(draft.nodes, startOffset);
        const replacement = match[0].replace(/^có thể\s+/iu, "");

        out.push({
            id: `AM003-${startOffset}`,
            code: "AM003",
            category: "AMBIGUITY",
            severity: "warning",
            title: "Chế tài tùy nghi ('có thể bị...')",
            message: `Cách diễn đạt "${match[0]}" cho phép người có thẩm quyền tự chọn có xử phạt hay không mà không kèm điều kiện bắt buộc.`,
            exploitScenario: "Dễ phát sinh tiêu cực, xin-cho hoặc áp dụng không đồng đều giữa các địa phương đối với cùng một hành vi.",
            suggestion: `Đổi sang thể bắt buộc ("${replacement}") hoặc tách rõ trường hợp áp dụng hình thức phạt bổ sung.`,
            excerpt: match[0],
            provisionRef: node?.refLabel ?? null,
            range: rangeFromOffsets(draft.content, draft.lineStarts, startOffset, endOffset),
            source: "STATIC",
            quickFix: {
                label: `Chuyển thành thể bắt buộc ("${replacement}")`,
                replacement,
                startOffset,
                endOffset,
            },
            corpusLink: null,
        });
    }
}

function detectVagueBackReferences(draft: ParsedDraft, out: LegalDiagnostic[]): void {
    for (const match of draft.content.matchAll(VAGUE_BACK_REF)) {
        const startOffset = match.index;
        const endOffset = startOffset + match[0].length;
        const node = findNodeAtOffset(draft.nodes, startOffset);

        out.push({
            id: `AM004-${startOffset}`,
            code: "AM004",
            category: "AMBIGUITY",
            severity: "info",
            title: `Tham chiếu mơ hồ ("${match[0]}")`,
            message: `Cụm "${match[0]}" không chỉ rõ điểm, khoản hoặc điều nào được dẫn chiếu, gây khó khăn khi văn bản bị sửa đổi về sau.`,
            exploitScenario: "Khi một khoản phía trên được chèn hoặc bãi bỏ, tham chiếu 'nêu trên' sẽ trỏ sai ngữ cảnh.",
            suggestion: "Thay bằng địa chỉ điều khoản tường minh (ví dụ: 'điểm a khoản 1 Điều này').",
            excerpt: match[0],
            provisionRef: node?.refLabel ?? null,
            range: rangeFromOffsets(draft.content, draft.lineStarts, startOffset, endOffset),
            source: "STATIC",
            quickFix: null,
            corpusLink: null,
        });
    }
}

function detectUndefinedTerms(
    draft: ParsedDraft,
    workspaceDefinedTerms: readonly WorkspaceDefinedTerm[],
    out: LegalDiagnostic[],
): TermStatusItem[] {
    const workspaceMap = new Map<string, WorkspaceDefinedTerm>();

    for (const entry of workspaceDefinedTerms) {
        if (!workspaceMap.has(entry.normalizedTerm)) {
            workspaceMap.set(entry.normalizedTerm, entry);
        }
    }

    const terms: TermStatusItem[] = [];
    const seenNormalized = new Set<string>();

    for (const pattern of TRACKED_LEGAL_TERMS) {
        for (const match of draft.content.matchAll(pattern)) {
            const startOffset = match.index;
            const endOffset = startOffset + match[0].length;
            const node = findNodeAtOffset(draft.nodes, startOffset);

            if (node && node.title && /giải thích từ ngữ/iu.test(node.title)) {
                continue;
            }

            const normalized = normalizeLegalTerm(match[0]);

            if (seenNormalized.has(normalized)) {
                continue;
            }

            // Skip generic "giấy phép lái xe" if a more specific "điểm giấy phép lái xe" at the same offset is already tracked.
            if (normalized === "giấy phép lái xe" && seenNormalized.has("điểm giấy phép lái xe")) {
                continue;
            }

            seenNormalized.add(normalized);
            const line = positionAtOffset(draft.lineStarts, startOffset).line;
            const inDraftDef = draft.definedTermDetails.get(normalized);
            const inWorkspaceDef = workspaceMap.get(normalized);

            if (inDraftDef) {
                terms.push({
                    term: match[0],
                    normalizedTerm: normalized,
                    status: "DEFINED_IN_DRAFT",
                    definedBy: "Điều Giải thích từ ngữ (Dự thảo)",
                    definition: inDraftDef,
                    sourceDocumentId: null,
                    sourceProvisionId: null,
                    line,
                    startOffset,
                    endOffset,
                });

                continue;
            }

            if (inWorkspaceDef) {
                terms.push({
                    term: match[0],
                    normalizedTerm: normalized,
                    status: "DEFINED_IN_WORKSPACE",
                    definedBy: inWorkspaceDef.sourceLabel,
                    definition: inWorkspaceDef.definition,
                    sourceDocumentId: inWorkspaceDef.sourceDocumentId,
                    sourceProvisionId: inWorkspaceDef.sourceProvisionId,
                    line,
                    startOffset,
                    endOffset,
                });

                continue;
            }

            terms.push({
                term: match[0],
                normalizedTerm: normalized,
                status: "UNDEFINED",
                definedBy: null,
                definition: null,
                sourceDocumentId: null,
                sourceProvisionId: null,
                line,
                startOffset,
                endOffset,
            });

            out.push({
                id: `AM005-${startOffset}`,
                code: "AM005",
                category: "AMBIGUITY",
                severity: "warning",
                title: `Thuật ngữ chưa có văn bản định nghĩa trong workspace: "${match[0]}"`,
                message: `Thuật ngữ "${match[0]}" được sử dụng trong quy phạm nhưng chưa có định nghĩa trong Điều Giải thích từ ngữ của dự thảo và chưa có văn bản định nghĩa trong workspace.`,
                exploitScenario: `Thiếu văn bản định nghĩa "${match[0]}" trong workspace sẽ không xác định được phạm vi pháp lý, cơ chế tính/trừ/phục hồi (ví dụ tổng số điểm hoặc điều kiện áp dụng) khi thực thi.`,
                suggestion: `Bổ sung định nghĩa "${match[0]}" vào Điều Giải thích từ ngữ hoặc nhập văn bản luật gốc định nghĩa thuật ngữ này vào workspace.`,
                excerpt: match[0],
                provisionRef: node?.refLabel ?? null,
                range: rangeFromOffsets(draft.content, draft.lineStarts, startOffset, endOffset),
                source: "STATIC",
                quickFix: null,
                corpusLink: null,
            });
        }
    }

    return terms;
}
