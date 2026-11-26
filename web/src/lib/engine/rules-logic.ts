import type { ExtractedFineRange, ExtractedThreshold } from "./intervals";
import { buildArticleAddressMap, findNodeAtOffset, positionAtOffset, rangeFromOffsets, type ParsedDraft, type ParsedNode } from "./parser";
import { extractNonMonetarySanctions } from "./sanctions";
import type { CrossReferenceItem, LegalDiagnostic } from "./types";

const FULL_REF = /(?:(điểm)\s+([a-zđ])\s+)?(?:(khoản)\s+(\d+)\s+)?Điều\s+(\d+[a-zđ]?)(?:\s+(này))?/giu;
const LOCAL_CLAUSE_POINT_REF = /(?:(điểm)\s+([a-zđ])\s+)?khoản\s+(\d+)\s+Điều\s+này/giu;
const EXTERNAL_DOC_AFTER = /^(?:(?:,\s*(?:khoản\s+\d+\s+)?Điều\s+\d+[a-zđ]?|\s+(?:và|hoặc)\s+(?:khoản\s+\d+\s+)?Điều\s+\d+[a-zđ]?))*\s*(?:của\s+)?(?:Nghị định|Luật|Thông tư|Bộ luật|Pháp lệnh|Quyết định)(?!\s+này(?![\p{L}\p{N}]))/iu;
const REPEAL_REF = /Bãi bỏ\s+((?:điểm\s+[a-zđ]\s+)?(?:khoản\s+\d+\s+)?Điều\s+\d+[a-zđ]?)/giu;

const VIETNAMESE_POINT_ORDER = ["a", "b", "c", "d", "đ", "e", "g", "h", "i", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "x", "y"];

export function analyzeLogic(
    draft: ParsedDraft,
    fineRanges: readonly ExtractedFineRange[],
    thresholds: readonly ExtractedThreshold[],
): { diagnostics: LegalDiagnostic[]; references: CrossReferenceItem[] } {
    const diagnostics: LegalDiagnostic[] = [];

    detectMandatoryHeaderTitle(draft, diagnostics);
    detectInvertedFineRanges(draft, fineRanges, diagnostics);
    detectInvertedPrisonRanges(draft, diagnostics);
    detectThresholdOverlapsAndProgression(draft, thresholds, diagnostics);
    const references = detectCrossReferencesAndRepeals(draft, diagnostics);
    detectOrphanedSubProvisions(draft, references, diagnostics);
    detectDuplicateAndMismatchedCitations(draft, diagnostics);
    detectPenaltyMonotonicityViolations(draft, fineRanges, diagnostics);
    detectNumberingErrors(draft, diagnostics);

    return { diagnostics, references };
}

function detectMandatoryHeaderTitle(draft: ParsedDraft, out: LegalDiagnostic[]): void {
    if (draft.nodes.length === 0 || draft.content.trim().length === 0) {
        return;
    }

    const firstLine = draft.content.replace(/\r\n/g, "\n").split("\n")[0]?.trim() ?? "";
    const cleaned = firstLine.replace(/^#+\s*/, "").trim();
    const isMissingHeader = !cleaned || /^(?:Chương\s+|Điều\s+\d+|Căn\s+cứ\s+|Theo\s+đề\s+nghị\s+|\d+\.\s+|[a-zđ]\)\s+)/iu.test(cleaned);

    if (!isMissingHeader) {
        return;
    }

    const endOffset = Math.max(1, Math.min(firstLine.length, draft.content.length));

    out.push({
        id: "LG006-header-0",
        code: "LG006",
        category: "LOGIC",
        severity: "warning",
        title: "Thiếu dòng tiêu đề tên luật ở dòng đầu tiên",
        message: "Mỗi tệp văn bản bắt buộc có dòng đầu tiên là tên luật (header) để hệ thống suy luận tên hiển thị và định danh.",
        exploitScenario: "Tệp thiếu tiêu đề dễ gây nhầm lẫn khi mở nhiều tab hoặc xuất văn bản chuẩn Nghị định 30/2020/NĐ-CP.",
        suggestion: "Thêm dòng tên văn bản ở dòng 1 (ví dụ: Dự thảo Nghị định quy định xử phạt...).",
        excerpt: firstLine.slice(0, 80) || "(Dòng 1 trống)",
        provisionRef: "Dòng 1 (Header)",
        range: rangeFromOffsets(draft.content, draft.lineStarts, 0, endOffset),
        source: "STATIC",
        quickFix: {
            label: "Chèn dòng tiêu đề tên luật ở dòng 1",
            startOffset: 0,
            endOffset: 0,
            replacement: "Dự thảo văn bản quy phạm pháp luật\n\n",
        },
        corpusLink: null,
    });
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

function detectInvertedPrisonRanges(draft: ParsedDraft, out: LegalDiagnostic[]): void {
    const sanctions = extractNonMonetarySanctions(draft);

    for (const item of sanctions) {
        if (item.kind !== "IMPRISONMENT" || !item.inverted) {
            continue;
        }

        out.push({
            id: `LG001-prison-${item.startOffset}`,
            code: "LG001",
            category: "LOGIC",
            severity: "error",
            title: "Khung hình phạt tù bị đảo ngược (min > max)",
            message: `Mức phạt tù tối thiểu (${item.minMonths} tháng) lớn hơn mức tối đa (${item.maxMonths} tháng) tại "${item.label}".`,
            exploitScenario: "Khung hình phạt tù tạo khoảng rỗng về mặt toán học nên không thể tuyên án hợp lệ.",
            suggestion: "Đảo lại cận dưới nhỏ hơn hoặc bằng cận trên của mức phạt tù.",
            excerpt: item.label,
            provisionRef: item.provisionRef,
            range: rangeFromOffsets(draft.content, draft.lineStarts, item.startOffset, item.endOffset),
            source: "STATIC",
            quickFix: null,
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

        if (seenOffsets.has(startOffset) || match[6] || isInsideQuotedAmendment(draft.content, startOffset)) {
            continue;
        }

        const node = findNodeAtOffset(draft.nodes, startOffset);

        // Skip article/heading declarations themselves (e.g. "Điều 1. Phạm vi...").
        if (node && node.level === "ARTICLE" && startOffset <= node.startOffset + 12) {
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

    const isSelfArticleRef = Boolean(
        input.fromNode?.articleNo
        && input.fromNode.level !== "ARTICLE"
        && input.key === `d:${input.fromNode.articleNo}`,
    );

    if ((fromKey && fromKey === input.key) || isSelfArticleRef) {
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
        if (isInsideQuotedAmendment(draft.content, node.startOffset)) {
            continue;
        }

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

function detectOrphanedSubProvisions(
    draft: ParsedDraft,
    references: readonly CrossReferenceItem[],
    out: LegalDiagnostic[],
): void {
    const clauses = draft.nodes.filter((n) => n.level === "CLAUSE" && n.articleNo && n.clauseNo);

    for (const clause of clauses) {
        const points = draft.nodes.filter((n) => n.level === "POINT" && n.parentId === clause.id && n.pointNo);

        if (points.length < 2) {
            continue;
        }

        const wholeClauseKey = `Khoản ${clause.clauseNo} Điều ${clause.articleNo}`.toLowerCase();
        const wholeClauseCited = references.some(
            (r) => r.status === "VALID"
                && r.targetRef.toLowerCase() === wholeClauseKey
                && !(r.fromRef ?? "").toLowerCase().includes(`điều ${clause.articleNo}`),
        );

        if (wholeClauseCited) {
            continue;
        }

        const citeCounts = new Map<string, number>();

        for (const p of points) {
            const pKey = `Điểm ${p.pointNo} Khoản ${clause.clauseNo} Điều ${clause.articleNo}`.toLowerCase();
            const count = references.filter(
                (r) => r.status === "VALID"
                    && r.targetRef.toLowerCase() === pKey
                    && !(r.fromRef ?? "").toLowerCase().includes(`điều ${clause.articleNo}`),
            ).length;
            citeCounts.set(p.id, count);
        }

        const maxSiblingCites = Math.max(...citeCounts.values());

        if (maxSiblingCites < 2) {
            continue;
        }

        for (const p of points) {
            if ((citeCounts.get(p.id) ?? 0) === 0) {
                out.push({
                    id: `LG017-${p.startOffset}`,
                    code: "LG017",
                    category: "LOGIC",
                    severity: "warning",
                    title: `Điều khoản con có thể bị bỏ sót dẫn chiếu: ${p.refLabel}`,
                    message: `Các điểm anh em trong ${clause.refLabel} được dẫn chiếu từ điều khác tới ${maxSiblingCites} lần, nhưng ${p.refLabel} không được dẫn chiếu ở bất kỳ đâu trong văn bản.`,
                    exploitScenario: "Quy định tại điểm bị bỏ sót không được gắn vào bất kỳ khung áp dụng/chế tài nào, trở thành điều khoản chết.",
                    suggestion: `Bổ sung dẫn chiếu tới ${p.refLabel} ở các điều khoản áp dụng tương ứng.`,
                    excerpt: p.text.slice(0, 100),
                    provisionRef: p.refLabel,
                    range: rangeFromOffsets(draft.content, draft.lineStarts, p.startOffset, Math.min(p.endOffset, p.startOffset + 80)),
                    source: "STATIC",
                    quickFix: null,
                    corpusLink: null,
                });
            }
        }
    }
}

const CITATION_WITH_PAREN = /Điều\s+(\d+[a-zđ]?)\s*\(([^)]{4,160})\)/giu;
const STOP_WORDS = new Set(["tội", "về", "của", "quy", "định", "các", "hành", "vi", "hoặc", "và", "trong", "đối", "với", "trái", "phép", "gây", "người", "khác"]);

function tokenizeVi(text: string): Set<string> {
    const tokens = text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));

    return new Set(tokens);
}

function tokenOverlapRatio(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) {
        return 0;
    }

    let hits = 0;

    for (const token of a) {
        if (b.has(token)) {
            hits += 1;
        }
    }

    return hits / Math.min(a.size, b.size);
}

function detectDuplicateAndMismatchedCitations(draft: ParsedDraft, out: LegalDiagnostic[]): void {
    const articlesByNo = new Map<string, ParsedNode>();

    for (const node of draft.nodes) {
        if (node.level === "ARTICLE" && node.articleNo && node.title) {
            articlesByNo.set(node.articleNo.toLowerCase(), node);
        }
    }

    const containers = draft.nodes.filter((n) => n.level === "POINT" || n.level === "CLAUSE");

    for (const container of containers) {
        const slice = draft.content.slice(container.startOffset, container.endOffset);
        const seenInContainer = new Set<string>();

        for (const match of slice.matchAll(CITATION_WITH_PAREN)) {
            const artNo = match[1].toLowerCase();
            const parenDesc = match[2];
            const absStart = container.startOffset + (match.index ?? 0);
            const absEnd = absStart + `Điều ${match[1]}`.length;
            const targetArt = articlesByNo.get(artNo);
            let flaggedMismatch = false;

            if (targetArt?.title) {
                const descTokens = tokenizeVi(parenDesc);
                const titleTokens = tokenizeVi(targetArt.title);

                if (descTokens.size >= 2 && titleTokens.size >= 2 && tokenOverlapRatio(descTokens, titleTokens) < 0.25) {
                    let bestArt: ParsedNode | null = null;
                    let bestScore = 0.45;

                    for (const candidate of articlesByNo.values()) {
                        if (!candidate.title || candidate.articleNo === artNo) {
                            continue;
                        }

                        const score = tokenOverlapRatio(descTokens, tokenizeVi(candidate.title));

                        if (score >= bestScore) {
                            bestScore = score;
                            bestArt = candidate;
                        }
                    }

                    flaggedMismatch = true;
                    const fixLabel = bestArt ? `Đổi thành "Điều ${bestArt.articleNo}"` : null;

                    out.push({
                        id: `LG008-mis-${absStart}`,
                        code: "LG008",
                        category: "LOGIC",
                        severity: "error",
                        title: `Dẫn chiếu sai số Điều so với tên tội danh/mô tả (${match[0].slice(0, 45)})`,
                        message: `Văn bản ghi "Điều ${match[1]} (${parenDesc.slice(0, 60)})", nhưng Điều ${match[1]} thực tế là "${targetArt.title}".${bestArt ? ` Điều phù hợp với mô tả là Điều ${bestArt.articleNo} (${bestArt.title}).` : ""}`,
                        exploitScenario: "Dẫn chiếu nhầm số Điều khiến cơ quan tiến hành tố tụng áp dụng sai khung tội danh hoặc bỏ lọt hành vi.",
                        suggestion: bestArt
                            ? `Sửa "Điều ${match[1]}" thành "Điều ${bestArt.articleNo}".`
                            : `Kiểm tra lại số Điều tương ứng với "${parenDesc.slice(0, 50)}".`,
                        excerpt: match[0],
                        provisionRef: container.refLabel,
                        range: rangeFromOffsets(draft.content, draft.lineStarts, absStart, absEnd),
                        source: "STATIC",
                        quickFix: bestArt && fixLabel
                            ? {
                                label: fixLabel,
                                replacement: `Điều ${bestArt.articleNo}`,
                                startOffset: absStart,
                                endOffset: absEnd,
                            }
                            : null,
                        corpusLink: null,
                    });
                }
            }

            if (!flaggedMismatch && seenInContainer.has(artNo)) {
                out.push({
                    id: `LG008-dup-${absStart}`,
                    code: "LG008",
                    category: "LOGIC",
                    severity: "error",
                    title: `Dẫn chiếu trùng lặp Điều ${match[1]} trong cùng điều khoản`,
                    message: `Điều ${match[1]} xuất hiện lặp lại nhiều lần với mô tả khác nhau trong ${container.refLabel}.`,
                    exploitScenario: "Trùng lặp số Điều thường là lỗi đánh máy dẫn chiếu nhầm sang một điều luật khác.",
                    suggestion: `Kiểm tra lại số Điều đúng cho mô tả "(${parenDesc.slice(0, 50)})".`,
                    excerpt: match[0],
                    provisionRef: container.refLabel,
                    range: rangeFromOffsets(draft.content, draft.lineStarts, absStart, absEnd),
                    source: "STATIC",
                    quickFix: null,
                    corpusLink: null,
                });
            }

            seenInContainer.add(artNo);
        }
    }
}

function isInsideQuotedAmendment(content: string, offset: number): boolean {
    if (!/sửa đổi,\s*bổ sung\s+một\s+số\s+điều/iu.test(content.slice(0, 1200))) {
        return false;
    }

    const lineStart = Math.max(0, content.lastIndexOf("\n", offset) + 1);
    const lineEndIdx = content.indexOf("\n", offset);
    const line = content.slice(lineStart, lineEndIdx === -1 ? content.length : lineEndIdx).trimStart();

    return line.startsWith("“") || line.startsWith("\"");
}

function maxPrisonMonthsInText(text: string): number | null {
    let maxMonths: number | null = null;

    for (const m of text.matchAll(/phạt\s+tù\s+từ\s+\d+\s+(?:năm|tháng)\s+đến\s+(\d+)\s+(năm|tháng)/giu)) {
        const val = Number(m[1]);
        const months = m[2].toLowerCase() === "năm" ? val * 12 : val;

        if (maxMonths === null || months > maxMonths) {
            maxMonths = months;
        }
    }

    return maxMonths;
}

function detectPenaltyMonotonicityViolations(
    draft: ParsedDraft,
    fineRanges: readonly ExtractedFineRange[],
    out: LegalDiagnostic[],
): void {
    const clausesByArt = new Map<string, ParsedNode[]>();

    for (const node of draft.nodes) {
        if (node.level === "CLAUSE" && node.articleNo && node.clauseNo) {
            const list = clausesByArt.get(node.articleNo) ?? [];
            list.push(node);
            clausesByArt.set(node.articleNo, list);
        }
    }

    for (const clauses of clausesByArt.values()) {
        const byNo = new Map<string, ParsedNode>();

        for (const c of clauses) {
            if (c.clauseNo) {
                byNo.set(c.clauseNo, c);
            }
        }

        for (const curr of clauses) {
            const cmpMatch = /(?:nghiêm trọng hơn|nặng hơn|vượt mức)[^.;\n]{0,50}khoản\s+(\d+)/iu.exec(curr.text);

            if (!cmpMatch) {
                continue;
            }

            const baseClause = byNo.get(cmpMatch[1]);

            if (!baseClause || baseClause.id === curr.id) {
                continue;
            }

            const currFines = fineRanges.filter((f) => f.startOffset >= curr.startOffset && f.startOffset <= curr.endOffset);
            const baseFines = fineRanges.filter((f) => f.startOffset >= baseClause.startOffset && f.startOffset <= baseClause.endOffset);
            const currMaxFine = currFines.length > 0 ? Math.max(...currFines.map((f) => f.max)) : null;
            const baseMaxFine = baseFines.length > 0 ? Math.max(...baseFines.map((f) => f.max)) : null;

            const currMaxPrison = maxPrisonMonthsInText(curr.text);
            const baseMaxPrison = maxPrisonMonthsInText(baseClause.text);

            const fineInverted = currMaxFine !== null && baseMaxFine !== null && currMaxFine < baseMaxFine;
            const prisonInverted = currMaxPrison !== null && baseMaxPrison !== null && currMaxPrison < baseMaxPrison;

            if (fineInverted || prisonInverted) {
                const detail = fineInverted && baseMaxFine !== null && currMaxFine !== null
                    ? `mức phạt tối đa ${currMaxFine.toLocaleString("vi-VN")}đ < ${baseMaxFine.toLocaleString("vi-VN")}đ`
                    : `mức tù tối đa ${currMaxPrison} tháng < ${baseMaxPrison} tháng`;

                out.push({
                    id: `LG016-${curr.startOffset}`,
                    code: "LG016",
                    category: "LOGIC",
                    severity: "error",
                    title: `Nghịch lý khung hình phạt: ${curr.refLabel} nặng hơn Khoản ${cmpMatch[1]} nhưng chế tài lại nhẹ hơn`,
                    message: `${curr.refLabel} quy định tính chất "${cmpMatch[0]}" nhưng ${detail} tại Khoản ${cmpMatch[1]}.`,
                    exploitScenario: "Vi phạm nguyên tắc tương xứng: hành vi nghiêm trọng hơn lại chịu khung hình phạt nhẹ hơn.",
                    suggestion: `Nâng khung hình phạt tại ${curr.refLabel} cao hơn Khoản ${cmpMatch[1]}.`,
                    excerpt: cmpMatch[0],
                    provisionRef: curr.refLabel,
                    range: rangeFromOffsets(draft.content, draft.lineStarts, curr.startOffset, Math.min(curr.endOffset, curr.startOffset + 120)),
                    source: "STATIC",
                    quickFix: null,
                    corpusLink: null,
                });
            }
        }
    }
}
