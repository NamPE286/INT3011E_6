import type { ExtractedFineRange, ExtractedThreshold } from "./ide.intervals";
import { buildArticleAddressMap, findNodeAtOffset, positionAtOffset, rangeFromOffsets, type ParsedDraft, type ParsedNode } from "./ide.parser";
import type { CrossReferenceItem, LegalDiagnostic } from "./ide.types";

const FULL_REF = /(?:(điểm)\s+([a-zđ])\s+)?(?:(khoản)\s+(\d+)\s+)?Điều\s+(\d+[a-zđ]?)(?:\s+(này))?/giu;
const LOCAL_CLAUSE_POINT_REF = /(?:(điểm)\s+([a-zđ])\s+)?khoản\s+(\d+)\s+Điều\s+này/giu;
const EXTERNAL_DOC_AFTER = /^\s*(?:của\s+)?(?:Nghị định|Luật|Thông tư|Bộ luật|Pháp lệnh|Quyết định)/iu;
const REPEAL_REF = /Bãi bỏ\s+((?:điểm\s+[a-zđ]\s+)?(?:khoản\s+\d+\s+)?Điều\s+\d+[a-zđ]?)/giu;

const VIETNAMESE_POINT_ORDER = ["a", "b", "c", "d", "đ", "e", "g", "h", "i", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "x", "y"];

export function analyzeLogic(
    draft: ParsedDraft,
    fineRanges: readonly ExtractedFineRange[],
    thresholds: readonly ExtractedThreshold[],
): { diagnostics: LegalDiagnostic[]; references: CrossReferenceItem[] } {
    const diagnostics: LegalDiagnostic[] = [];

    detectInvertedFineRanges(draft, fineRanges, diagnostics);
    detectThresholdOverlapsAndProgression(draft, thresholds, diagnostics);
    const references = detectCrossReferencesAndRepeals(draft, diagnostics);
    detectNumberingErrors(draft, diagnostics);

    return { diagnostics, references };
}

function detectInvertedFineRanges(draft: ParsedDraft, fineRanges: readonly ExtractedFineRange[], out: LegalDiagnostic[]): void {
    for (const fine of fineRanges) {
        if (fine.min <= fine.max) {
            continue;
        }

        const original = draft.content.slice(fine.startOffset, fine.endOffset);
        const swapped = `từ ${fine.maxRaw} đồng đến ${fine.minRaw} đồng`;

        out.push({
            id: `LG001-${fine.startOffset}`,
            code: "LG001",
            category: "LOGIC",
            severity: "error",
            title: "Khung tiền phạt bị đảo ngược (min > max)",
            message: `Mức tối thiểu (${fine.minRaw} đồng) lớn hơn mức tối đa (${fine.maxRaw} đồng), tạo ra khoảng rỗng không thể thi hành.`,
            exploitScenario: "Quyết định xử phạt theo khung này sẽ bị tuyên hủy ngay khi khiếu nại do mức phạt không tồn tại về mặt toán học.",
            suggestion: `Đảo lại cận dưới và cận trên thành "${swapped}".`,
            excerpt: original,
            provisionRef: fine.provisionRef,
            range: rangeFromOffsets(draft.content, draft.lineStarts, fine.startOffset, fine.endOffset),
            source: "STATIC",
            quickFix: {
                label: `Đổi thành "${swapped}"`,
                replacement: swapped,
                startOffset: fine.startOffset,
                endOffset: fine.endOffset,
            },
            corpusLink: null,
        });
    }
}

function detectThresholdOverlapsAndProgression(
    draft: ParsedDraft,
    thresholds: readonly ExtractedThreshold[],
    out: LegalDiagnostic[],
): void {
    for (const item of thresholds) {
        if (item.status === "INVERTED") {
            out.push({
                id: `LG001-th-${item.startOffset}`,
                code: "LG001",
                category: "LOGIC",
                severity: "error",
                title: "Ngưỡng định lượng bị đảo ngược (min > max)",
                message: `Khoảng "${item.excerpt}" có giá trị bắt đầu (${item.min}) lớn hơn giá trị kết thúc (${item.max}).`,
                exploitScenario: "Không có giá trị thực tế nào thỏa mãn đồng thời điều kiện lớn hơn cận dưới và nhỏ hơn cận trên.",
                suggestion: "Sắp xếp lại cận dưới nhỏ hơn cận trên.",
                excerpt: item.excerpt,
                provisionRef: item.provisionRef,
                range: rangeFromOffsets(draft.content, draft.lineStarts, item.startOffset, item.endOffset),
                source: "STATIC",
                quickFix: null,
                corpusLink: null,
            });

            continue;
        }

        if (item.status === "OVERLAP" && item.overlapWith) {
            out.push({
                id: `LG002-${item.startOffset}`,
                code: "LG002",
                category: "LOGIC",
                severity: "error",
                title: `Chồng chéo ngưỡng định lượng (${item.unit})`,
                message: `Khoảng "${item.excerpt}" giao với "${item.overlapWith.excerpt}" tại ranh giới ${item.min} ${item.unit}.`,
                exploitScenario: `Khi vi phạm đúng mốc ${item.min} ${item.unit}, có thể áp dụng cả hai khung phạt khác nhau, gây xung đột thẩm quyền và khiếu kiện.`,
                suggestion: `Đổi một cận thành "trên ${item.min} ${item.unit}" hoặc "đến dưới ${item.min} ${item.unit}" để phân tách ranh giới.`,
                excerpt: item.excerpt,
                provisionRef: item.provisionRef,
                range: rangeFromOffsets(draft.content, draft.lineStarts, item.startOffset, item.endOffset),
                source: "STATIC",
                quickFix: null,
                corpusLink: null,
            });
        }

        const prev = item.overlapWith ?? item.gapFrom;

        if (prev && prev.fineMax !== null && item.fineMax !== null && item.fineMax < prev.fineMax) {
            out.push({
                id: `LG002-prog-${item.startOffset}`,
                code: "LG002",
                category: "LOGIC",
                severity: "warning",
                title: "Mức phạt không tăng tiến theo mức độ vi phạm",
                message: `Ngưỡng "${item.excerpt}" nghiêm trọng hơn "${prev.excerpt}" nhưng mức phạt tối đa lại thấp hơn (${item.fineMax.toLocaleString("vi-VN")}đ < ${prev.fineMax.toLocaleString("vi-VN")}đ).`,
                exploitScenario: "Tạo bất hợp lý về tính tương xứng: vi phạm nặng hơn lại chịu mức phạt nhẹ hơn.",
                suggestion: "Kiểm tra và nâng khung phạt của ngưỡng cao hơn.",
                excerpt: item.excerpt,
                provisionRef: item.provisionRef,
                range: rangeFromOffsets(draft.content, draft.lineStarts, item.startOffset, item.endOffset),
                source: "STATIC",
                quickFix: null,
                corpusLink: null,
            });
        }
    }
}

function detectCrossReferencesAndRepeals(draft: ParsedDraft, out: LegalDiagnostic[]): CrossReferenceItem[] {
    const addressMap = buildArticleAddressMap(draft.nodes);
    const repealedKeys = collectRepealedKeys(draft.content);
    const references: CrossReferenceItem[] = [];
    const seenOffsets = new Set<number>();

    for (const match of draft.content.matchAll(LOCAL_CLAUSE_POINT_REF)) {
        const startOffset = match.index;
        const endOffset = startOffset + match[0].length;
        const node = findNodeAtOffset(draft.nodes, startOffset);

        if (!node || !node.articleNo) {
            continue;
        }

        const tail = draft.content.slice(endOffset, endOffset + 45);

        if (EXTERNAL_DOC_AFTER.test(tail)) {
            continue;
        }

        seenOffsets.add(startOffset);
        const pointNo = match[2]?.toLowerCase() ?? null;
        const clauseNo = match[3];
        const key = pointNo ? `d:${node.articleNo}|k:${clauseNo}|p:${pointNo}` : `d:${node.articleNo}|k:${clauseNo}`;
        const targetLabel = pointNo
            ? `Điểm ${pointNo} Khoản ${clauseNo} Điều ${node.articleNo}`
            : `Khoản ${clauseNo} Điều ${node.articleNo}`;

        recordReference(draft, addressMap, repealedKeys, {
            rawText: match[0],
            key,
            targetLabel,
            startOffset,
            endOffset,
            fromNode: node,
        }, references, out);
    }

    for (const match of draft.content.matchAll(FULL_REF)) {
        const startOffset = match.index;
        const endOffset = startOffset + match[0].length;

        if (seenOffsets.has(startOffset) || match[6]) {
            continue;
        }

        const node = findNodeAtOffset(draft.nodes, startOffset);

        // Skip article/heading declarations themselves (e.g. "Điều 1. Phạm vi...").
        if (node && startOffset <= node.startOffset + 12) {
            continue;
        }

        const tail = draft.content.slice(endOffset, endOffset + 45);

        if (EXTERNAL_DOC_AFTER.test(tail)) {
            continue;
        }

        const pointNo = match[2]?.toLowerCase() ?? null;
        const clauseNo = match[4] ?? null;
        const art = (match[5] ?? "").toLowerCase();

        if (!art) {
            continue;
        }

        const key = pointNo && clauseNo
            ? `d:${art}|k:${clauseNo}|p:${pointNo}`
            : clauseNo
                ? `d:${art}|k:${clauseNo}`
                : pointNo
                    ? `d:${art}|p:${pointNo}`
                    : `d:${art}`;

        const targetLabel = pointNo && clauseNo
            ? `Điểm ${pointNo} Khoản ${clauseNo} Điều ${art}`
            : clauseNo
                ? `Khoản ${clauseNo} Điều ${art}`
                : `Điều ${art}`;

        recordReference(draft, addressMap, repealedKeys, {
            rawText: match[0],
            key,
            targetLabel,
            startOffset,
            endOffset,
            fromNode: node,
        }, references, out);
    }

    return references;
}

function recordReference(
    draft: ParsedDraft,
    addressMap: Map<string, ParsedNode>,
    repealedKeys: Set<string>,
    input: {
        rawText: string;
        key: string;
        targetLabel: string;
        startOffset: number;
        endOffset: number;
        fromNode: ParsedNode | null;
    },
    references: CrossReferenceItem[],
    out: LegalDiagnostic[],
): void {
    const line = positionAtOffset(draft.lineStarts, input.startOffset).line;
    const targetNode = addressMap.get(input.key);
    const fromKey = nodeKey(input.fromNode);

    if (!targetNode) {
        references.push({
            id: `ref-${references.length + 1}`,
            rawText: input.rawText,
            fromRef: input.fromNode?.refLabel ?? null,
            targetRef: input.targetLabel,
            line,
            status: "BROKEN",
            startOffset: input.startOffset,
            endOffset: input.endOffset,
        });

        out.push({
            id: `LG003-${input.startOffset}`,
            code: "LG003",
            category: "LOGIC",
            severity: "error",
            title: `Dẫn chiếu nội bộ không tồn tại: ${input.targetLabel}`,
            message: `Văn bản dẫn chiếu tới "${input.targetLabel}" nhưng không tìm thấy điều/khoản/điểm này trong dự thảo.`,
            exploitScenario: "Khi áp dụng xử phạt theo dẫn chiếu bị gãy, quyết định hành chính thiếu căn cứ pháp lý và có nguy cơ bị hủy.",
            suggestion: `Kiểm tra lại số thứ tự điều khoản hoặc bổ sung ${input.targetLabel}.`,
            excerpt: input.rawText,
            provisionRef: input.fromNode?.refLabel ?? null,
            range: rangeFromOffsets(draft.content, draft.lineStarts, input.startOffset, input.endOffset),
            source: "STATIC",
            quickFix: null,
            corpusLink: null,
        });

        return;
    }

    if (fromKey && fromKey === input.key) {
        references.push({
            id: `ref-${references.length + 1}`,
            rawText: input.rawText,
            fromRef: input.fromNode?.refLabel ?? null,
            targetRef: input.targetLabel,
            line,
            status: "SELF_REFERENCE",
            startOffset: input.startOffset,
            endOffset: input.endOffset,
        });

        out.push({
            id: `LG004-${input.startOffset}`,
            code: "LG004",
            category: "LOGIC",
            severity: "error",
            title: `Dẫn chiếu vòng lặp vào chính nó (${input.targetLabel})`,
            message: `${input.fromNode?.refLabel ?? "Điều khoản"} tự dẫn chiếu tới chính địa chỉ của mình.`,
            exploitScenario: "Tạo vòng lặp định nghĩa/chế tài, không xác định được nội dung gốc cần áp dụng.",
            suggestion: "Sửa địa chỉ dẫn chiếu sang điều khoản nguồn chính xác.",
            excerpt: input.rawText,
            provisionRef: input.fromNode?.refLabel ?? null,
            range: rangeFromOffsets(draft.content, draft.lineStarts, input.startOffset, input.endOffset),
            source: "STATIC",
            quickFix: null,
            corpusLink: null,
        });

        return;
    }

    if (repealedKeys.has(input.key) && !isInsideRepealInstruction(draft.content, input.startOffset)) {
        references.push({
            id: `ref-${references.length + 1}`,
            rawText: input.rawText,
            fromRef: input.fromNode?.refLabel ?? null,
            targetRef: input.targetLabel,
            line,
            status: "ORPHANED_BY_REPEAL",
            startOffset: input.startOffset,
            endOffset: input.endOffset,
        });

        out.push({
            id: `LG007-${input.startOffset}`,
            code: "LG007",
            category: "LOGIC",
            severity: "error",
            title: `Dẫn chiếu tới điều khoản đã bị bãi bỏ (${input.targetLabel})`,
            message: `Dự thảo có lệnh bãi bỏ "${input.targetLabel}" nhưng điều khoản này vẫn tiếp tục dẫn chiếu tới nó.`,
            exploitScenario: "Điều khoản còn hiệu lực nhưng lại trỏ vào căn cứ đã bị xóa, làm vô hiệu hóa phần chế tài phụ thuộc.",
            suggestion: `Cập nhật dẫn chiếu sang điều khoản thay thế hoặc gỡ bỏ tham chiếu tới ${input.targetLabel}.`,
            excerpt: input.rawText,
            provisionRef: input.fromNode?.refLabel ?? null,
            range: rangeFromOffsets(draft.content, draft.lineStarts, input.startOffset, input.endOffset),
            source: "STATIC",
            quickFix: null,
            corpusLink: null,
        });

        return;
    }

    references.push({
        id: `ref-${references.length + 1}`,
        rawText: input.rawText,
        fromRef: input.fromNode?.refLabel ?? null,
        targetRef: input.targetLabel,
        line,
        status: "VALID",
        startOffset: input.startOffset,
        endOffset: input.endOffset,
    });
}

function detectNumberingErrors(draft: ParsedDraft, out: LegalDiagnostic[]): void {
    const articles = draft.nodes.filter((node) => node.level === "ARTICLE");
    checkNumericSequence(draft, articles, "Điều", out);

    for (const article of articles) {
        const clauses = draft.nodes.filter((node) => node.level === "CLAUSE" && node.parentId === article.id);
        checkNumericSequence(draft, clauses, "Khoản", out);

        for (const clause of clauses) {
            const points = draft.nodes.filter((node) => node.level === "POINT" && node.parentId === clause.id);
            checkPointSequence(draft, points, out);
        }
    }
}

function checkNumericSequence(draft: ParsedDraft, nodes: readonly ParsedNode[], label: string, out: LegalDiagnostic[]): void {
    const seen = new Set<number>();
    let previous = 0;

    for (const node of nodes) {
        const numMatch = /^(\d+)$/.exec(node.number);

        if (!numMatch) {
            continue;
        }

        const num = Number(numMatch[1]);
        const headEnd = Math.min(node.endOffset, node.startOffset + 24);

        if (seen.has(num)) {
            out.push({
                id: `LG005-dup-${node.startOffset}`,
                code: "LG005",
                category: "LOGIC",
                severity: "error",
                title: `Trùng số thứ tự ${label} ${num}`,
                message: `${label} ${num} xuất hiện nhiều hơn một lần trong cùng cấp cấu trúc.`,
                exploitScenario: "Hai quy phạm trùng địa chỉ khiến mọi dẫn chiếu tới số hiệu này bị mơ hồ và xung đột.",
                suggestion: `Đánh số lại ${label} ${num} theo đúng thứ tự liên tục.`,
                excerpt: node.refLabel,
                provisionRef: node.refLabel,
                range: rangeFromOffsets(draft.content, draft.lineStarts, node.startOffset, headEnd),
                source: "STATIC",
                quickFix: null,
                corpusLink: null,
            });
        } else if (previous > 0 && num > previous + 1) {
            out.push({
                id: `LG005-skip-${node.startOffset}`,
                code: "LG005",
                category: "LOGIC",
                severity: "warning",
                title: `Nhảy cóc đánh số: ${label} ${previous} → ${label} ${num}`,
                message: `Thiếu ${label} ${previous + 1} giữa ${label} ${previous} và ${label} ${num}.`,
                exploitScenario: "Người đọc có thể hiểu nhầm có một điều khoản đã bị cắt bỏ nhầm trong quá trình soạn thảo.",
                suggestion: `Kiểm tra lại thứ tự hoặc đánh số lại thành ${label} ${previous + 1}.`,
                excerpt: node.refLabel,
                provisionRef: node.refLabel,
                range: rangeFromOffsets(draft.content, draft.lineStarts, node.startOffset, headEnd),
                source: "STATIC",
                quickFix: null,
                corpusLink: null,
            });
        }

        seen.add(num);
        previous = num;
    }
}

function checkPointSequence(draft: ParsedDraft, points: readonly ParsedNode[], out: LegalDiagnostic[]): void {
    const seen = new Set<string>();
    let prevIdx = -1;

    for (const point of points) {
        const letter = point.number.toLowerCase();
        const idx = VIETNAMESE_POINT_ORDER.indexOf(letter);
        const headEnd = Math.min(point.endOffset, point.startOffset + 12);

        if (seen.has(letter)) {
            out.push({
                id: `LG005-pdup-${point.startOffset}`,
                code: "LG005",
                category: "LOGIC",
                severity: "error",
                title: `Trùng điểm "${letter})" trong cùng khoản`,
                message: `Điểm "${letter})" bị lặp lại trong ${point.refLabel}.`,
                exploitScenario: "Dẫn chiếu tới điểm bị trùng không xác định được quy phạm nào được áp dụng.",
                suggestion: "Đánh lại chữ cái các điểm theo bảng chữ cái quy phạm (a, b, c, d, đ, e...).",
                excerpt: `${letter})`,
                provisionRef: point.refLabel,
                range: rangeFromOffsets(draft.content, draft.lineStarts, point.startOffset, headEnd),
                source: "STATIC",
                quickFix: null,
                corpusLink: null,
            });
        } else if (prevIdx >= 0 && idx > prevIdx + 1) {
            out.push({
                id: `LG005-pskip-${point.startOffset}`,
                code: "LG005",
                category: "LOGIC",
                severity: "warning",
                title: `Nhảy cóc thứ tự điểm: ${VIETNAMESE_POINT_ORDER[prevIdx]}) → ${letter})`,
                message: `Thiếu điểm "${VIETNAMESE_POINT_ORDER[prevIdx + 1]})" trong cùng khoản.`,
                exploitScenario: "Thiếu sót thứ tự điểm thường là dấu hiệu bỏ sót nội dung khi cắt ghép dự thảo.",
                suggestion: `Đổi thành "${VIETNAMESE_POINT_ORDER[prevIdx + 1]})" hoặc bổ sung điểm bị thiếu.`,
                excerpt: `${letter})`,
                provisionRef: point.refLabel,
                range: rangeFromOffsets(draft.content, draft.lineStarts, point.startOffset, headEnd),
                source: "STATIC",
                quickFix: null,
                corpusLink: null,
            });
        }

        seen.add(letter);

        if (idx >= 0) {
            prevIdx = idx;
        }
    }
}

function collectRepealedKeys(content: string): Set<string> {
    const keys = new Set<string>();

    for (const match of content.matchAll(REPEAL_REF)) {
        const phrase = match[1];
        const point = /điểm\s+([a-zđ])/iu.exec(phrase)?.[1]?.toLowerCase();
        const clause = /khoản\s+(\d+)/iu.exec(phrase)?.[1];
        const article = /Điều\s+(\d+[a-zđ]?)/iu.exec(phrase)?.[1]?.toLowerCase();

        if (!article) {
            continue;
        }

        if (point && clause) {
            keys.add(`d:${article}|k:${clause}|p:${point}`);
        } else if (clause) {
            keys.add(`d:${article}|k:${clause}`);
        } else {
            keys.add(`d:${article}`);
        }
    }

    return keys;
}

function isInsideRepealInstruction(content: string, offset: number): boolean {
    const lineStart = Math.max(0, content.lastIndexOf("\n", offset) + 1);
    const linePrefix = content.slice(lineStart, offset);

    return /bãi bỏ\s*$/iu.test(linePrefix);
}

function nodeKey(node: ParsedNode | null): string | null {
    if (!node || !node.articleNo) {
        return null;
    }

    if (node.level === "POINT" && node.clauseNo && node.pointNo) {
        return `d:${node.articleNo}|k:${node.clauseNo}|p:${node.pointNo}`;
    }

    if (node.level === "CLAUSE" && node.clauseNo) {
        return `d:${node.articleNo}|k:${node.clauseNo}`;
    }

    if (node.level === "ARTICLE") {
        return `d:${node.articleNo}`;
    }

    return null;
}
