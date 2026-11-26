import type { DraftNode, DraftNodeLevel, TextRange } from "./ide.types";

export type ParsedNode = DraftNode & {
    articleNo: string | null;
    clauseNo: string | null;
    pointNo: string | null;
};

export type ParsedDraft = {
    content: string;
    lineStarts: number[];
    nodes: ParsedNode[];
    definedTerms: Set<string>;
    definedTermDetails: Map<string, string>;
};

const CHAPTER_LINE = /^\s*Chương\s+([IVXLCDM]+|\d+)\b(?:\s*[:.\-–—]?\s*(.*))?$/iu;
const ARTICLE_LINE = /^\s*Điều\s+(\d+[a-zđ]?)\s*(?:[.:–—-]\s*(.*))?$/iu;
const CLAUSE_LINE = /^\s*(\d+)\.\s+(.*)$/;
const POINT_LINE = /^\s*([a-zđ])\)\s+(.*)$/u;
const GLOSSARY_TITLE = /giải thích từ ngữ/iu;
const DEFINED_TERM_PATTERN = /(?:“([^”]{2,80})”|"([^"]{2,80})")\s*(?:là|được hiểu là|bao gồm)\s+([^\n]+)/giu;
const UNQUOTED_TERM_PATTERN = /^\s*(?:\d+\.|[a-zđ]\))\s*([A-ZÀ-Ỹa-zà-ỹ0-9\s/-]{2,60}?)\s+(?:là|được hiểu là|bao gồm)\s+(.+)$/iu;
const COLON_TERM_PATTERN = /^\s*(?:\d+\.|[a-zđ]\))\s*([^:]{2,50}):\s+(.+)$/iu;

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
        extractDefinedTerms(articleSlice, definedTerms, definedTermDetails);
    }

    return {
        content,
        lineStarts,
        nodes,
        definedTerms,
        definedTermDetails,
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

function extractDefinedTerms(text: string, outTerms: Set<string>, outDetails: Map<string, string>): void {
    for (const match of text.matchAll(DEFINED_TERM_PATTERN)) {
        const rawTerm = (match[1] ?? match[2] ?? "").trim();
        const normalized = normalizeLegalTerm(rawTerm);

        if (normalized.length >= 2) {
            outTerms.add(normalized);
            outDetails.set(normalized, match[0].trim());
        }
    }

    for (const line of text.split("\n")) {
        const unquotedMatch = UNQUOTED_TERM_PATTERN.exec(line);

        if (unquotedMatch) {
            const normalized = normalizeLegalTerm(unquotedMatch[1]);

            if (normalized.length >= 2 && !outTerms.has(normalized)) {
                outTerms.add(normalized);
                outDetails.set(normalized, line.trim());
            }
        }

        const colonMatch = COLON_TERM_PATTERN.exec(line);

        if (colonMatch) {
            const normalized = normalizeLegalTerm(colonMatch[1]);

            if (normalized.length >= 2 && !outTerms.has(normalized)) {
                outTerms.add(normalized);
                outDetails.set(normalized, line.trim());
            }
        }
    }
}
