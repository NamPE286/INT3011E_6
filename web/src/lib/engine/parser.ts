import type { DraftNode, DraftNodeLevel, TextRange } from "./types";

export type ParsedNode = DraftNode & {
    articleNo: string | null;
    clauseNo: string | null;
    pointNo: string | null;
};

export type DefinedTermDetail = {
    term: string;
    normalizedTerm: string;
    definition: string;
    provisionRef: string;
    line: number;
    startOffset: number;
    endOffset: number;
};

export type ExtractedDocMetadata = {
    documentNumber: string | null;
    documentType: string | null;
    hierarchyRank: number;
    issuedDate: string | null;
    effectiveDate: string | null;
};

export type ParsedDraft = {
    content: string;
    lineStarts: number[];
    nodes: ParsedNode[];
    definedTerms: Set<string>;
    definedTermDetails: Map<string, string>;
    definedTermEntries: Map<string, DefinedTermDetail>;
};

const CHAPTER_LINE = /^\s*Chương\s+([IVXLCDM]+|\d+)\b(?:\s*[:.\-–—]?\s*(.*))?$/iu;
const ARTICLE_LINE = /^\s*Điều\s+(\d+[a-zđ]?)\s*(?:[.:–—-]\s*(.*))?$/iu;
const CLAUSE_LINE = /^\s*(\d+)\.\s+(.*)$/;
const POINT_LINE = /^\s*([a-zđ])\)\s+(.*)$/u;
const GLOSSARY_TITLE = /giải thích từ ngữ|phân loại\s+tội\s+phạm/iu;
const DEF_VERB = String.raw`(?:là|được\s+hiểu\s+là|được\s+coi\s+là|được\s+xác\s+định\s+là|có\s+nghĩa\s+là|nghĩa\s+là|bao\s+gồm)`;
const EXPLICIT_DEF_VERB = String.raw`(?:được\s+hiểu\s+là|được\s+coi\s+là|được\s+xác\s+định\s+là|có\s+nghĩa\s+là)`;
const DEFINED_TERM_PATTERN = new RegExp(
    String.raw`(?:“([^”]{2,80})”|"([^"]{2,80})")\s*${DEF_VERB}\s+([^\n]+)`,
    "giu",
);
const UNQUOTED_TERM_PATTERN = new RegExp(
    String.raw`^\s*(?:\d+\.|[a-zđ]\)|[-•])\s*([\p{L}\p{N}\s/-]{2,60}?)\s+${DEF_VERB}\s+(.+)$|^\s*([\p{L}\p{N}\s/-]{2,60}?)\s+${DEF_VERB}\s+(.+)$`,
    "iu",
);
const COLON_TERM_PATTERN = /^\s*(?:\d+\.|[a-zđ]\)|[-•])?\s*([^:\n]{2,50}):\s+(.+)$/iu;
const INLINE_EXPLICIT_DEF_PATTERN = new RegExp(
    String.raw`^\s*(?:Trong\s+(?:Luật|Bộ\s+luật|Nghị\s+định|Thông\s+tư|Quyết\s+định|Nghị\s+quyết|Điều|Khoản)\s+này,\s*)?(?:\d+\.|[a-zđ]\)|[-•])?\s*(?:“([^”]{2,80})”|"([^"]{2,80})"|([\p{L}\p{N}\s/-]{2,60}?))\s+${EXPLICIT_DEF_VERB}\s+(.+)$`,
    "iu",
);

export function normalizeLegalTerm(term: string): string {
    return term
        .toLowerCase()
        .replace(/\bgplx\b/gu, "giấy phép lái xe")
        .replace(/\bgtđb\b/gu, "giao thông đường bộ")
        .replace(/\bttatgt\b/gu, "trật tự an toàn giao thông")
        .replace(/\bvphc\b/gu, "vi phạm hành chính")
        .replace(/\s+/g, " ")
        .trim();
}

export function computeLineStarts(content: string): number[] {
    const starts = [0];

    for (let index = 0; index < content.length; index += 1) {
        if (content[index] === "\n") {
            starts.push(index + 1);
        }
    }

    return starts;
}

export function positionAtOffset(lineStarts: readonly number[], offset: number): { line: number; col: number } {
    const clamped = Math.max(0, offset);
    let low = 0;
    let high = lineStarts.length - 1;

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);

        if (lineStarts[mid] <= clamped) {
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    const lineIndex = Math.max(0, high);

    return {
        line: lineIndex + 1,
        col: clamped - lineStarts[lineIndex] + 1,
    };
}

export function rangeFromOffsets(content: string, lineStarts: readonly number[], startOffset: number, endOffset: number): TextRange {
    const safeStart = Math.max(0, Math.min(startOffset, content.length));
    const safeEnd = Math.max(safeStart, Math.min(endOffset, content.length));
    const start = positionAtOffset(lineStarts, safeStart);
    const end = positionAtOffset(lineStarts, safeEnd);

    return {
        startLine: start.line,
        endLine: end.line,
        startCol: start.col,
        endCol: end.col,
        startOffset: safeStart,
        endOffset: safeEnd,
    };
}

export function parseDraftDocument(content: string): ParsedDraft {
    const lineStarts = computeLineStarts(content);
    const rawLines = content.split("\n");
    const nodes: ParsedNode[] = [];
    const definedTerms = new Set<string>();
    const definedTermDetails = new Map<string, string>();
    const definedTermEntries = new Map<string, DefinedTermDetail>();

    let currentChapterId: string | null = null;
    let currentArticle: ParsedNode | null = null;
    let currentClause: ParsedNode | null = null;
    let activeNode: ParsedNode | null = null;
    let nodeCounter = 0;

    for (let lineIdx = 0; lineIdx < rawLines.length; lineIdx += 1) {
        const lineText = rawLines[lineIdx];
        const lineStart = lineStarts[lineIdx];
        const lineEnd = lineStart + lineText.length;
        const lineNumber = lineIdx + 1;

        const chapterMatch = CHAPTER_LINE.exec(lineText);

        if (chapterMatch) {
            closeNode(activeNode, lineIdx, lineStarts, content);
            closeNode(currentClause, lineIdx, lineStarts, content);
            closeNode(currentArticle, lineIdx, lineStarts, content);
            currentClause = null;
            currentArticle = null;

            nodeCounter += 1;
            const number = chapterMatch[1].toUpperCase();
            const title = cleanTitle(chapterMatch[2]);
            const node = createNode({
                id: `node-${nodeCounter}`,
                parentId: null,
                level: "CHAPTER",
                number,
                title,
                text: lineText.trim(),
                refLabel: `Chương ${number}`,
                lineNumber,
                lineStart,
                lineEnd,
                articleNo: null,
                clauseNo: null,
                pointNo: null,
            });

            nodes.push(node);
            currentChapterId = node.id;
            activeNode = node;

            continue;
        }

        const articleMatch = ARTICLE_LINE.exec(lineText);

        if (articleMatch) {
            closeNode(activeNode, lineIdx, lineStarts, content);
            closeNode(currentClause, lineIdx, lineStarts, content);
            closeNode(currentArticle, lineIdx, lineStarts, content);
            currentClause = null;

            nodeCounter += 1;
            const number = articleMatch[1].toLowerCase();
            const title = cleanTitle(articleMatch[2]);
            const node = createNode({
                id: `node-${nodeCounter}`,
                parentId: currentChapterId,
                level: "ARTICLE",
                number,
                title,
                text: lineText.trim(),
                refLabel: `Điều ${number}`,
                lineNumber,
                lineStart,
                lineEnd,
                articleNo: number,
                clauseNo: null,
                pointNo: null,
            });

            nodes.push(node);
            currentArticle = node;
            activeNode = node;

            continue;
        }

        const clauseMatch = currentArticle ? CLAUSE_LINE.exec(lineText) : null;

        if (clauseMatch && currentArticle) {
            if (activeNode && activeNode.level === "POINT") {
                closeNode(activeNode, lineIdx, lineStarts, content);
            }

            closeNode(currentClause, lineIdx, lineStarts, content);

            nodeCounter += 1;
            const number = clauseMatch[1];
            const node = createNode({
                id: `node-${nodeCounter}`,
                parentId: currentArticle.id,
                level: "CLAUSE",
                number,
                title: null,
                text: clauseMatch[2].trim(),
                refLabel: `Khoản ${number} Điều ${currentArticle.number}`,
                lineNumber,
                lineStart,
                lineEnd,
                articleNo: currentArticle.number,
                clauseNo: number,
                pointNo: null,
            });

            nodes.push(node);
            currentClause = node;
            activeNode = node;

            continue;
        }

        const pointMatch = currentArticle ? POINT_LINE.exec(lineText) : null;

        if (pointMatch && currentArticle) {
            if (activeNode && activeNode.level === "POINT") {
                closeNode(activeNode, lineIdx, lineStarts, content);
            }

            nodeCounter += 1;
            const number = pointMatch[1].toLowerCase();
            const parent = currentClause ?? currentArticle;
            const refLabel = currentClause
                ? `Điểm ${number} Khoản ${currentClause.number} Điều ${currentArticle.number}`
                : `Điểm ${number} Điều ${currentArticle.number}`;

            const node = createNode({
                id: `node-${nodeCounter}`,
                parentId: parent.id,
                level: "POINT",
                number,
                title: null,
                text: pointMatch[2].trim(),
                refLabel,
                lineNumber,
                lineStart,
                lineEnd,
                articleNo: currentArticle.number,
                clauseNo: currentClause?.number ?? null,
                pointNo: number,
            });

            nodes.push(node);
            activeNode = node;

            continue;
        }

        if (activeNode && lineText.trim().length > 0) {
            activeNode.endLine = lineNumber;
            activeNode.endOffset = lineEnd;
            activeNode.text = `${activeNode.text}\n${lineText.trim()}`.trim();
        }
    }

    const lastLineIdx = rawLines.length;
    closeNode(activeNode, lastLineIdx, lineStarts, content);
    closeNode(currentClause, lastLineIdx, lineStarts, content);
    closeNode(currentArticle, lastLineIdx, lineStarts, content);

    for (const node of nodes) {
        if (node.level !== "ARTICLE" || !node.title || !GLOSSARY_TITLE.test(node.title)) {
            continue;
        }

        const articleSlice = content.slice(node.startOffset, node.endOffset);
        extractDefinedTerms(
            articleSlice,
            definedTerms,
            definedTermDetails,
            definedTermEntries,
            node.startOffset,
            lineStarts,
            nodes,
        );
    }

    extractInlineDefinedTerms(
        content,
        definedTerms,
        definedTermDetails,
        definedTermEntries,
        lineStarts,
        nodes,
    );

    return {
        content,
        lineStarts,
        nodes,
        definedTerms,
        definedTermDetails,
        definedTermEntries,
    };
}

export function findNodeAtOffset(nodes: readonly ParsedNode[], offset: number): ParsedNode | null {
    let best: ParsedNode | null = null;

    for (const node of nodes) {
        if (offset >= node.startOffset && offset <= node.endOffset) {
            if (!best || (node.endOffset - node.startOffset) <= (best.endOffset - best.startOffset)) {
                best = node;
            }
        }
    }

    return best;
}

export function buildArticleAddressMap(nodes: readonly ParsedNode[]): Map<string, ParsedNode> {
    const map = new Map<string, ParsedNode>();

    for (const node of nodes) {
        if (node.level === "ARTICLE" && node.articleNo) {
            map.set(`d:${node.articleNo}`, node);
        } else if (node.level === "CLAUSE" && node.articleNo && node.clauseNo) {
            map.set(`d:${node.articleNo}|k:${node.clauseNo}`, node);
        } else if (node.level === "POINT" && node.articleNo && node.pointNo) {
            if (node.clauseNo) {
                map.set(`d:${node.articleNo}|k:${node.clauseNo}|p:${node.pointNo}`, node);
            } else {
                map.set(`d:${node.articleNo}|p:${node.pointNo}`, node);
            }
        }
    }

    return map;
}

function createNode(input: {
    id: string;
    parentId: string | null;
    level: DraftNodeLevel;
    number: string;
    title: string | null;
    text: string;
    refLabel: string;
    lineNumber: number;
    lineStart: number;
    lineEnd: number;
    articleNo: string | null;
    clauseNo: string | null;
    pointNo: string | null;
}): ParsedNode {
    return {
        id: input.id,
        parentId: input.parentId,
        level: input.level,
        number: input.number,
        title: input.title,
        text: input.text,
        refLabel: input.refLabel,
        startLine: input.lineNumber,
        endLine: input.lineNumber,
        startOffset: input.lineStart,
        endOffset: input.lineEnd,
        articleNo: input.articleNo,
        clauseNo: input.clauseNo,
        pointNo: input.pointNo,
        diagnosticCounts: { error: 0, warning: 0, info: 0 },
    };
}

function closeNode(node: ParsedNode | null, nextLineIdx: number, lineStarts: readonly number[], content: string): void {
    if (!node) {
        return;
    }

    const endLine = Math.max(node.startLine, nextLineIdx);
    const endOffset = nextLineIdx < lineStarts.length ? Math.max(node.startOffset, lineStarts[nextLineIdx] - 1) : content.length;

    node.endLine = endLine;
    node.endOffset = endOffset;
}

function cleanTitle(raw: string | undefined): string | null {
    const trimmed = raw?.trim() ?? "";

    return trimmed.length > 0 ? trimmed : null;
}

export function extractDefinedTermsFromText(text: string): Map<string, string> {
    const terms = new Set<string>();
    const details = new Map<string, string>();
    extractDefinedTerms(text, terms, details);

    return details;
}

function extractDefinedTerms(
    text: string,
    outTerms: Set<string>,
    outDetails: Map<string, string>,
    outEntries?: Map<string, DefinedTermDetail>,
    baseOffset = 0,
    lineStarts?: readonly number[],
    nodes?: readonly ParsedNode[],
): void {
    const recordEntry = (rawTerm: string, definition: string, localOffset: number, length: number): void => {
        const normalized = normalizeLegalTerm(rawTerm);

        if (normalized.length < 2) {
            return;
        }

        outTerms.add(normalized);

        if (!outDetails.has(normalized)) {
            outDetails.set(normalized, definition);
        }

        if (outEntries && !outEntries.has(normalized)) {
            const absOffset = baseOffset + localOffset;
            const node = nodes ? findNodeAtOffset(nodes, absOffset) : null;
            const line = lineStarts ? positionAtOffset(lineStarts, absOffset).line : 1;

            outEntries.set(normalized, {
                term: rawTerm.trim(),
                normalizedTerm: normalized,
                definition,
                provisionRef: node?.refLabel ?? "Điều Giải thích từ ngữ",
                line,
                startOffset: absOffset,
                endOffset: absOffset + length,
            });
        }
    };

    for (const match of text.matchAll(DEFINED_TERM_PATTERN)) {
        const rawTerm = (match[1] ?? match[2] ?? "").trim();
        recordEntry(rawTerm, match[0].trim(), match.index ?? 0, match[0].length);
    }

    let cursor = 0;

    for (const line of text.split("\n")) {
        const trimmedLine = line.trim();

        if (!/^(?:Điều|Chương|Mục)\s+/iu.test(trimmedLine) && !/^Trong\s+(?:Luật|Bộ\s+luật|Nghị\s+định|Thông\s+tư)\s+này,?\s+các\s+từ\s+ngữ/iu.test(trimmedLine)) {
            const unquotedMatch = UNQUOTED_TERM_PATTERN.exec(line);

            if (unquotedMatch) {
                const rawTerm = (unquotedMatch[1] ?? unquotedMatch[3] ?? "").trim();

                if (rawTerm && !/^(?:các\s+từ\s+ngữ|từ\s+ngữ\s+dưới\s+đây)/iu.test(rawTerm)) {
                    recordEntry(rawTerm, trimmedLine, cursor, line.length);
                }
            }

            const colonMatch = COLON_TERM_PATTERN.exec(line);

            if (colonMatch && !/:\s*$/u.test(trimmedLine) && !/\bsau\s*$/iu.test(colonMatch[1])) {
                recordEntry(colonMatch[1], trimmedLine, cursor, line.length);
            }
        }

        cursor += line.length + 1;
    }
}

function extractInlineDefinedTerms(
    content: string,
    outTerms: Set<string>,
    outDetails: Map<string, string>,
    outEntries: Map<string, DefinedTermDetail>,
    lineStarts: readonly number[],
    nodes: readonly ParsedNode[],
): void {
    const recordEntry = (rawTerm: string, definition: string, absOffset: number, length: number): void => {
        const normalized = normalizeLegalTerm(rawTerm);

        if (normalized.length < 2) {
            return;
        }

        outTerms.add(normalized);

        if (!outDetails.has(normalized)) {
            outDetails.set(normalized, definition);
        }

        if (!outEntries.has(normalized)) {
            const node = findNodeAtOffset(nodes, absOffset);
            const line = positionAtOffset(lineStarts, absOffset).line;

            outEntries.set(normalized, {
                term: rawTerm.trim(),
                normalizedTerm: normalized,
                definition,
                provisionRef: node?.refLabel ?? "Dự thảo",
                line,
                startOffset: absOffset,
                endOffset: absOffset + length,
            });
        }
    };

    for (const match of content.matchAll(DEFINED_TERM_PATTERN)) {
        const rawTerm = (match[1] ?? match[2] ?? "").trim();
        recordEntry(rawTerm, match[0].trim(), match.index ?? 0, match[0].length);
    }

    let cursor = 0;

    for (const line of content.split("\n")) {
        const trimmedLine = line.trim();

        if (!/^(?:Điều|Chương|Mục)\s+/iu.test(trimmedLine)) {
            const explicitMatch = INLINE_EXPLICIT_DEF_PATTERN.exec(line);

            if (explicitMatch) {
                const rawTerm = (explicitMatch[1] ?? explicitMatch[2] ?? explicitMatch[3] ?? "").trim();

                if (rawTerm && !/^(?:các\s+từ\s+ngữ|từ\s+ngữ\s+dưới\s+đây)/iu.test(rawTerm)) {
                    recordEntry(rawTerm, trimmedLine, cursor, line.length);
                }
            }
        }

        cursor += line.length + 1;
    }
}

const DOC_NUM_IN_TEXT = /\b(\d{1,4}\/\d{4}\/[A-ZĐ0-9\-]+)\b/u;
const ISSUED_DATE_VN = /ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})/iu;
const EFFECTIVE_DATE_VN = /có hiệu lực(?:\s+thi hành)?\s+(?:kể\s+)?từ\s+ngày\s+(\d{1,2})\s*(?:tháng|\/)\s*(\d{1,2})\s*(?:năm|\/)\s*(\d{4})/iu;

export function extractDocumentMetadata(content: string, fallbackPath?: string): ExtractedDocMetadata {
    const head = content.slice(0, 1500);
    const preBasis = head.split(/^\s*Căn\s+cứ\b/im)[0] ?? head;
    const numMatch = DOC_NUM_IN_TEXT.exec(head) ?? (fallbackPath ? DOC_NUM_IN_TEXT.exec(fallbackPath.replace(/-/g, "/")) : null);
    const documentNumber = numMatch?.[1]?.toUpperCase() ?? null;

    let documentType: string | null = null;
    let hierarchyRank = 9;

    if (documentNumber && /\/NQ-QH/i.test(documentNumber)) {
        documentType = "Nghị quyết";
        hierarchyRank = 2;
    } else if (documentNumber && /\/NQ-/i.test(documentNumber)) {
        documentType = "Nghị quyết";
        hierarchyRank = 4;
    } else if (documentNumber && /\/NĐ-CP$/i.test(documentNumber)) {
        documentType = "Nghị định";
        hierarchyRank = 5;
    } else if (documentNumber && /\/TT-/i.test(documentNumber)) {
        documentType = "Thông tư";
        hierarchyRank = 7;
    } else if (/\bBộ luật\b/iu.test(preBasis)) {
        documentType = "Bộ luật";
        hierarchyRank = 2;
    } else if (/\bNghị quyết\b/iu.test(preBasis)) {
        documentType = "Nghị quyết";
        hierarchyRank = 4;
    } else if (/\bLuật\b/iu.test(preBasis) || (documentNumber && /\/QH\d+$/i.test(documentNumber))) {
        documentType = "Luật";
        hierarchyRank = 2;
    } else if (/\bPháp lệnh\b/iu.test(preBasis)) {
        documentType = "Pháp lệnh";
        hierarchyRank = 3;
    } else if (/\bNghị định\b/iu.test(preBasis) || (documentNumber && /\/NĐ-CP$/i.test(documentNumber))) {
        documentType = "Nghị định";
        hierarchyRank = 5;
    } else if (/\bQuyết định\b/iu.test(preBasis)) {
        documentType = "Quyết định";
        hierarchyRank = 6;
    } else if (/\bThông tư\b/iu.test(preBasis) || (documentNumber && /\/TT-/i.test(documentNumber))) {
        documentType = "Thông tư";
        hierarchyRank = 7;
    } else if (/\bHiến pháp\b/iu.test(preBasis)) {
        documentType = "Hiến pháp";
        hierarchyRank = 1;
    }

    const issuedMatch = ISSUED_DATE_VN.exec(head);
    const issuedDate = issuedMatch ? toIsoDate(issuedMatch[3], issuedMatch[2], issuedMatch[1]) : null;
    const effMatch = EFFECTIVE_DATE_VN.exec(content);
    const effectiveDate = effMatch ? toIsoDate(effMatch[3], effMatch[2], effMatch[1]) : null;

    return {
        documentNumber,
        documentType,
        hierarchyRank,
        issuedDate,
        effectiveDate,
    };
}

function toIsoDate(year: string, month: string, day: string): string {
    return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}
