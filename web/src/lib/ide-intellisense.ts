import type { DraftNode, WorkspaceContext } from "./api/ide";
import {
    VIETNAMESE_POINT_ALPHABET,
    shiftAfterLineInsert,
    shiftSubsequentClauses,
    shiftSubsequentPoints,
} from "./ide-numbering";

export type CompletionKind = "BASIS" | "ARTICLE" | "CLAUSE" | "POINT" | "REFERENCE";

export type CompletionItem = {
    id: string;
    label: string;
    detail: string;
    documentation: string;
    kind: CompletionKind;
    insertText: string;
    cursorOffsetInInsert?: number;
};

export type CompletionMenuState = {
    triggerLabel: string;
    replaceStart: number;
    replaceEnd: number;
    items: CompletionItem[];
    emptyMessage?: string;
};

export type CompletionInput = {
    content: string;
    cursorOffset: number;
    outline: readonly DraftNode[];
    workspaceContext: WorkspaceContext | null;
    manualTrigger?: boolean;
};

const BASIS_TRIGGER = /^(\s*)(?:Căn\s+cứ(?:\s+(.*))?|Căn\s+c|Theo\s+đề\s+nghị(?:\s+(.*))?)$/iu;
const ARTICLE_COLON_TRIGGER = /^(\s*)Điều\s+(\d+[a-zđ]?)\s*[:.]\s*(.*)$/iu;
const ARTICLE_START_TRIGGER = /^(\s*)Điều\s*$/iu;
const CLAUSE_TRIGGER = /^(\s*)(\d+)\.\s+(.*)$/;
const POINT_TRIGGER = /^(\s*)([a-zđ])\)\s+(.*)$/u;
const DASH_BULLET_TRIGGER = /^(\s*)[-*•]\s*(.*)$/;
const REF_TRIGGER = /(?:tại|theo|từ)\s+(điểm|khoản|Điều)\s*([^\n.;,]{0,20})$/iu;

export function nextArticleNumber(outline: readonly DraftNode[]): number {
    let maxNum = 0;

    for (const node of outline) {
        if (node.level !== "ARTICLE") {
            continue;
        }

        const parsed = /^(\d+)/.exec(node.number);

        if (parsed) {
            const num = Number(parsed[1]);

            if (num > maxNum) {
                maxNum = num;
            }
        }
    }

    return maxNum + 1;
}

export function nextVietnamesePointLetter(content: string, cursorOffset: number): string {
    const before = content.slice(0, cursorOffset);
    const lines = before.split("\n");
    let lastLetter: string | null = null;

    for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
        const line = lines[idx];

        if (/^\s*(?:Chương|Điều|\d+\.)/iu.test(line)) {
            break;
        }

        const pointMatch = /^\s*([a-zđ])\)\s+/u.exec(line);

        if (pointMatch) {
            lastLetter = pointMatch[1].toLowerCase();

            break;
        }
    }

    if (!lastLetter) {
        return "a";
    }

    const index = (VIETNAMESE_POINT_ALPHABET as readonly string[]).indexOf(lastLetter);

    if (index === -1 || index + 1 >= VIETNAMESE_POINT_ALPHABET.length) {
        return "a";
    }

    return VIETNAMESE_POINT_ALPHABET[index + 1];
}

export function computeCompletions(input: CompletionInput): CompletionMenuState | null {
    const safeOffset = Math.max(0, Math.min(input.cursorOffset, input.content.length));
    const lineStart = input.content.lastIndexOf("\n", safeOffset - 1) + 1;
    const linePrefix = input.content.slice(lineStart, safeOffset);

    const basisMatch = BASIS_TRIGGER.exec(linePrefix);

    if (basisMatch) {
        const indent = basisMatch[1] ?? "";
        const query = (basisMatch[2] ?? basisMatch[3] ?? "").trim();

        return buildBasisSuggestions(lineStart + indent.length, safeOffset, query, input.content, input.workspaceContext);
    }

    const articleColonMatch = ARTICLE_COLON_TRIGGER.exec(linePrefix);

    if (articleColonMatch) {
        const indent = articleColonMatch[1] ?? "";
        const artNo = articleColonMatch[2];
        const query = (articleColonMatch[3] ?? "").trim();

        return buildArticleSuggestions(lineStart + indent.length, safeOffset, artNo, query, input.outline, input.workspaceContext);
    }

    const articleStartMatch = ARTICLE_START_TRIGGER.exec(linePrefix);

    if (articleStartMatch) {
        const indent = articleStartMatch[1] ?? "";
        const nextNum = String(previousArticleNumber(input.content, lineStart));

        return buildArticleSuggestions(lineStart + indent.length, safeOffset, nextNum, "", input.outline, input.workspaceContext);
    }

    const dashMatch = DASH_BULLET_TRIGGER.exec(linePrefix);

    if (dashMatch) {
        const indent = dashMatch[1] ?? "";
        const query = (dashMatch[2] ?? "").trim();
        const nextLetter = nextVietnamesePointLetter(input.content, lineStart);

        return buildPointSuggestions(lineStart + indent.length, safeOffset, nextLetter, query, true, input.workspaceContext);
    }

    const pointMatch = POINT_TRIGGER.exec(linePrefix);

    if (pointMatch && pointMatch[3].length <= 28) {
        const indent = pointMatch[1] ?? "";
        const letter = pointMatch[2].toLowerCase();
        const query = pointMatch[3].trim();

        return buildPointSuggestions(lineStart + indent.length, safeOffset, letter, query, false, input.workspaceContext);
    }

    const clauseMatch = CLAUSE_TRIGGER.exec(linePrefix);

    if (clauseMatch && clauseMatch[3].length <= 28) {
        const indent = clauseMatch[1] ?? "";
        const clauseNum = clauseMatch[2];
        const query = clauseMatch[3].trim();

        return buildClauseSuggestions(lineStart + indent.length, safeOffset, clauseNum, query, input.workspaceContext);
    }

    const refMatch = REF_TRIGGER.exec(linePrefix);

    if (refMatch) {
        const keywordLen = refMatch[0].search(/(điểm|khoản|Điều)/iu);
        const queryStart = keywordLen >= 0
            ? safeOffset - refMatch[0].length + keywordLen
            : safeOffset - (refMatch[2]?.length ?? 0);
        const query = `${refMatch[1] ?? ""} ${refMatch[2] ?? ""}`.trim();

        return buildReferenceSuggestions(queryStart, safeOffset, query, input.outline, input.workspaceContext);
    }

    if (input.manualTrigger) {
        return buildManualStarterSuggestions(safeOffset, input.outline, input.content);
    }

    return null;
}

export type InlineAutofill = {
    insertText: string;
    kind: "ARTICLE" | "CLAUSE" | "POINT";
    label: string;
};

export type EnterAutofillResult = {
    content: string;
    cursorOffset: number;
};

function previousArticleNumber(content: string, offset: number): number {
    const before = content.slice(0, offset);
    let lastNum = 0;

    for (const match of before.matchAll(/^\s*Điều\s+(\d+)[a-zđ]?\b/gim)) {
        const parsed = Number.parseInt(match[1], 10);

        if (Number.isFinite(parsed)) {
            lastNum = parsed;
        }
    }

    return lastNum + 1;
}

function analyzeLineContext(content: string, lineStart: number): {
    blankLinesAbove: number;
    prevNonEmptyLine: string | null;
    enclosingArticleLineIdx: number | null;
    lastClauseNumber: number | null;
} {
    const before = content.slice(0, lineStart);
    const lines = before.split("\n");

    if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
    }

    let blankLinesAbove = 0;
    let prevNonEmptyLine: string | null = null;

    for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
        const trimmed = lines[idx].trim();

        if (trimmed.length === 0) {
            if (prevNonEmptyLine === null) {
                blankLinesAbove += 1;
            }
        } else if (prevNonEmptyLine === null) {
            prevNonEmptyLine = trimmed;
            break;
        }
    }

    let enclosingArticleLineIdx: number | null = null;
    let lastClauseNumber: number | null = null;

    for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
        const line = lines[idx];

        if (/^\s*Chương\s+/iu.test(line)) {
            break;
        }

        if (lastClauseNumber === null) {
            const clauseMatch = /^\s*(\d+)\.\s+/u.exec(line);

            if (clauseMatch) {
                lastClauseNumber = Number.parseInt(clauseMatch[1], 10);
            }
        }

        if (/^\s*Điều\s+\d+[a-zđ]?\b/iu.test(line)) {
            enclosingArticleLineIdx = idx;
            break;
        }
    }

    return {
        blankLinesAbove,
        prevNonEmptyLine,
        enclosingArticleLineIdx,
        lastClauseNumber,
    };
}

/**
 * Computes context-aware inline ghost autofill when the cursor is on an empty line:
 * - Outside an Article (or after a blank line ending the previous Article): suggests `Điều N. `
 * - Inside an Article: suggests `1. `, `2. `, or `a) `..`đ) ` based on the preceding line.
 */
export function computeInlineAutofill(
    content: string,
    cursorOffset: number,
    outline: readonly DraftNode[],
): InlineAutofill | null {
    const safeOffset = Math.max(0, Math.min(cursorOffset, content.length));
    const lineStart = content.lastIndexOf("\n", safeOffset - 1) + 1;
    const nextNewline = content.indexOf("\n", safeOffset);
    const lineEnd = nextNewline === -1 ? content.length : nextNewline;

    if (safeOffset !== lineEnd) {
        return null;
    }

    const currentLine = content.slice(lineStart, lineEnd);

    if (currentLine.trim().length > 0) {
        return null;
    }

    const ctx = analyzeLineContext(content, lineStart);
    const nextArt = previousArticleNumber(content, lineStart);

    if (ctx.enclosingArticleLineIdx === null) {
        return {
            insertText: `Điều ${nextArt}. `,
            kind: "ARTICLE",
            label: "Điều kế tiếp",
        };
    }

    const prevIsPoint = ctx.prevNonEmptyLine !== null && /^\s*[a-zđ]\)\s+/u.test(ctx.prevNonEmptyLine);

    if (ctx.blankLinesAbove >= 2 || (ctx.blankLinesAbove >= 1 && !prevIsPoint)) {
        return {
            insertText: `Điều ${nextArt}. `,
            kind: "ARTICLE",
            label: "Điều mới",
        };
    }

    if (ctx.blankLinesAbove === 1 && prevIsPoint) {
        return {
            insertText: `${(ctx.lastClauseNumber ?? 1) + 1}. `,
            kind: "CLAUSE",
            label: "Khoản kế tiếp",
        };
    }

    if (ctx.prevNonEmptyLine && /^\s*Điều\s+\d+/iu.test(ctx.prevNonEmptyLine)) {
        return {
            insertText: "1. ",
            kind: "CLAUSE",
            label: "Khoản 1",
        };
    }

    if (ctx.prevNonEmptyLine && /^\s*\d+\.\s+.*:\s*$/u.test(ctx.prevNonEmptyLine)) {
        return {
            insertText: "a) ",
            kind: "POINT",
            label: "Điểm a)",
        };
    }

    if (prevIsPoint) {
        return {
            insertText: `${nextVietnamesePointLetter(content, lineStart)}) `,
            kind: "POINT",
            label: "Điểm kế tiếp",
        };
    }

    if (ctx.lastClauseNumber !== null) {
        return {
            insertText: `${ctx.lastClauseNumber + 1}. `,
            kind: "CLAUSE",
            label: "Khoản kế tiếp",
        };
    }

    return {
        insertText: "1. ",
        kind: "CLAUSE",
        label: "Khoản 1",
    };
}

/**
 * Handles Enter key inside an Article to auto-continue Khoản (`1. `, `2. `) or Điểm (`a) `, `b) `...),
 * and exits the list level cleanly when pressing Enter on an empty bullet.
 */
export function computeEnterAutofill(content: string, cursorOffset: number): EnterAutofillResult | null {
    const safeOffset = Math.max(0, Math.min(cursorOffset, content.length));
    const lineStart = content.lastIndexOf("\n", safeOffset - 1) + 1;
    const nextNewline = content.indexOf("\n", safeOffset);
    const lineEnd = nextNewline === -1 ? content.length : nextNewline;
    const afterCursor = content.slice(safeOffset, lineEnd);

    if (afterCursor.trim().length > 0) {
        return null;
    }

    const lineText = content.slice(lineStart, safeOffset);
    const currentLineIdx = content.slice(0, lineStart).split("\n").length - 1;

    // Empty Điểm bullet -> promote to next Khoản if inside a clause, otherwise clear line
    const emptyPoint = /^(\s*)([a-zđ])\)\s*$/u.exec(lineText);

    if (emptyPoint) {
        const ctx = analyzeLineContext(content, lineStart);
        const nextClauseNum = ctx.lastClauseNumber !== null ? ctx.lastClauseNumber + 1 : null;
        const replacement = nextClauseNum !== null ? `${nextClauseNum}. ` : "";
        let updated = content.slice(0, lineStart) + replacement + content.slice(lineEnd);
        updated = shiftSubsequentPoints(updated, currentLineIdx, emptyPoint[2], -1);

        if (nextClauseNum !== null) {
            updated = shiftSubsequentClauses(updated, currentLineIdx, nextClauseNum, 1);
        }

        return {
            content: updated,
            cursorOffset: lineStart + replacement.length,
        };
    }

    // Empty Khoản bullet -> clear line to exit list and pull subsequent clauses back
    const emptyClause = /^\s*(\d+)\.\s*$/u.exec(lineText);

    if (emptyClause) {
        const clearedNum = Number.parseInt(emptyClause[1], 10);
        const updated = shiftSubsequentClauses(
            content.slice(0, lineStart) + content.slice(lineEnd),
            currentLineIdx,
            clearedNum,
            -1,
        );

        return {
            content: updated,
            cursorOffset: lineStart,
        };
    }

    // Article header with title -> start Khoản 1
    if (/^\s*Điều\s+\d+[a-zđ]?\s*[.:–—-]\s*\S+/iu.test(lineText)) {
        const insert = "\n1. ";
        const updated = shiftAfterLineInsert(
            content.slice(0, safeOffset) + insert + content.slice(safeOffset),
            currentLineIdx + 1,
        );

        return {
            content: updated,
            cursorOffset: safeOffset + insert.length,
        };
    }

    // Khoản with content -> if ends with ":" start Điểm a), else next Khoản
    const clauseMatch = /^(\s*)(\d+)\.\s+\S+/u.exec(lineText);

    if (clauseMatch) {
        const indent = clauseMatch[1] ?? "";
        const num = Number.parseInt(clauseMatch[2], 10);
        const insert = /:\s*$/u.test(lineText) ? `\n${indent}a) ` : `\n${indent}${num + 1}. `;
        const updated = shiftAfterLineInsert(
            content.slice(0, safeOffset) + insert + content.slice(safeOffset),
            currentLineIdx + 1,
        );

        return {
            content: updated,
            cursorOffset: safeOffset + insert.length,
        };
    }

    // Điểm with content -> next Điểm
    const pointMatch = /^(\s*)([a-zđ])\)\s+\S+/u.exec(lineText);

    if (pointMatch) {
        const indent = pointMatch[1] ?? "";
        const nextLetter = nextVietnamesePointLetter(content, safeOffset);
        const insert = `\n${indent}${nextLetter}) `;
        const updated = shiftAfterLineInsert(
            content.slice(0, safeOffset) + insert + content.slice(safeOffset),
            currentLineIdx + 1,
        );

        return {
            content: updated,
            cursorOffset: safeOffset + insert.length,
        };
    }

    return null;
}

export function applyCompletion(
    content: string,
    state: CompletionMenuState,
    item: CompletionItem,
): { content: string; cursorOffset: number } {
    const start = Math.max(0, Math.min(state.replaceStart, content.length));
    const end = Math.max(start, Math.min(state.replaceEnd, content.length));
    let nextContent = content.slice(0, start) + item.insertText + content.slice(end);
    const localCursor = item.cursorOffsetInInsert ?? item.insertText.length;

    if (item.kind === "ARTICLE" || item.kind === "CLAUSE" || item.kind === "POINT") {
        const insertedLineIdx = nextContent.slice(0, start).split("\n").length - 1;
        nextContent = shiftAfterLineInsert(nextContent, insertedLineIdx);
    }

    return {
        content: nextContent,
        cursorOffset: start + localCursor,
    };
}

function buildBasisSuggestions(
    replaceStart: number,
    replaceEnd: number,
    query: string,
    content: string,
    workspaceContext: WorkspaceContext | null,
): CompletionMenuState {
    const items: CompletionItem[] = [];
    const seen = new Set<string>();

    if (workspaceContext) {
        for (const base of workspaceContext.bases) {
            const key = base.insertText.toLowerCase();

            if (!seen.has(key)) {
                seen.add(key);
                items.push({
                    id: base.id,
                    label: base.label,
                    detail: base.sourceLabel,
                    documentation: base.documentation,
                    kind: "BASIS",
                    insertText: base.insertText,
                });
            }
        }
    }

    for (const line of content.split("\n")) {
        const trimmed = line.trim();

        if (/^Căn\s+cứ\s+.{8,}/iu.test(trimmed) && !seen.has(trimmed.toLowerCase())) {
            seen.add(trimmed.toLowerCase());
            items.push({
                id: `draft-basis-${items.length}`,
                label: trimmed.slice(0, 80),
                detail: "Dự thảo hiện tại",
                documentation: "Dòng căn cứ đã có trong dự thảo đang soạn.",
                kind: "BASIS",
                insertText: trimmed.endsWith(";") ? trimmed : `${trimmed};`,
            });
        }
    }

    const filtered = filterItems(items, query);

    return {
        triggerLabel: "Căn cứ pháp lý (Workspace)",
        replaceStart,
        replaceEnd,
        items: filtered,
        emptyMessage: filtered.length === 0
            ? "Chưa có văn bản khớp trong workspace — hãy nhập PDF vào kho hoặc lưu dự thảo để gợi ý căn cứ."
            : undefined,
    };
}

function buildArticleSuggestions(
    replaceStart: number,
    replaceEnd: number,
    articleNo: string,
    query: string,
    outline: readonly DraftNode[],
    workspaceContext: WorkspaceContext | null,
): CompletionMenuState {
    const items: CompletionItem[] = [];
    const seen = new Set<string>();

    if (workspaceContext) {
        for (const pattern of workspaceContext.articlePatterns) {
            const key = pattern.label.toLowerCase();

            if (!seen.has(key)) {
                seen.add(key);
                items.push({
                    id: `${pattern.id}-${articleNo}`,
                    label: `Điều ${articleNo}. ${pattern.label}`,
                    detail: pattern.detail,
                    documentation: pattern.documentation,
                    kind: "ARTICLE",
                    insertText: `Điều ${articleNo}. ${pattern.label}\n${pattern.insertBody}`,
                });
            }
        }
    }

    for (const node of outline) {
        if (node.level === "ARTICLE" && node.title) {
            const key = node.title.toLowerCase();

            if (!seen.has(key)) {
                seen.add(key);
                items.push({
                    id: `cur-art-${node.id}-${articleNo}`,
                    label: `Điều ${articleNo}. ${node.title}`,
                    detail: "Dự thảo hiện tại",
                    documentation: `Lặp lại cấu trúc tiêu đề từ ${node.refLabel}.`,
                    kind: "ARTICLE",
                    insertText: `Điều ${articleNo}. ${node.title}\n1. `,
                });
            }
        }
    }

    items.push({
        id: `art-blank-${articleNo}`,
        label: `Điều ${articleNo}. [Tiêu đề điều mới]`,
        detail: "Cấu trúc chuẩn",
        documentation: "Chèn khung Điều và Khoản 1 trống theo đúng số thứ tự.",
        kind: "ARTICLE",
        insertText: `Điều ${articleNo}. \n1. `,
        cursorOffsetInInsert: `Điều ${articleNo}. `.length,
    });

    const filtered = filterItems(items, query);

    return {
        triggerLabel: `Mẫu Điều ${articleNo} (Workspace)`,
        replaceStart,
        replaceEnd,
        items: filtered,
        emptyMessage: filtered.length === 0 ? "Không tìm thấy mẫu Điều khớp trong workspace." : undefined,
    };
}

function buildClauseSuggestions(
    replaceStart: number,
    replaceEnd: number,
    clauseNum: string,
    query: string,
    workspaceContext: WorkspaceContext | null,
): CompletionMenuState | null {
    const items: CompletionItem[] = [];

    if (workspaceContext) {
        for (const pattern of workspaceContext.clausePatterns) {
            items.push({
                id: `${pattern.id}-${clauseNum}`,
                label: `${clauseNum}. ${pattern.label}`,
                detail: pattern.detail,
                documentation: pattern.documentation,
                kind: "CLAUSE",
                insertText: `${clauseNum}. ${pattern.insertBody}`,
            });
        }
    }

    const filtered = filterItems(items, query);

    if (filtered.length === 0) {
        return null;
    }

    return {
        triggerLabel: `Mẫu Khoản ${clauseNum} (Workspace)`,
        replaceStart,
        replaceEnd,
        items: filtered,
    };
}

function buildPointSuggestions(
    replaceStart: number,
    replaceEnd: number,
    letter: string,
    query: string,
    fromDashBullet: boolean,
    workspaceContext: WorkspaceContext | null,
): CompletionMenuState | null {
    const items: CompletionItem[] = [];

    if (fromDashBullet) {
        items.push({
            id: `pt-convert-${letter}`,
            label: `${letter}) Chuyển thành Điểm ${letter}) chuẩn kỹ thuật lập pháp`,
            detail: "Chuẩn hóa bullet",
            documentation: `Đổi gạch đầu dòng sang điểm "${letter})" theo bảng chữ cái quy phạm (a, b, c, d, đ, e...).`,
            kind: "POINT",
            insertText: `${letter}) `,
        });
    }

    if (workspaceContext) {
        for (const pattern of workspaceContext.pointPatterns) {
            items.push({
                id: `${pattern.id}-${letter}`,
                label: `${letter}) ${pattern.label}`,
                detail: pattern.detail,
                documentation: pattern.documentation,
                kind: "POINT",
                insertText: `${letter}) ${pattern.insertBody}`,
            });
        }
    }

    const filtered = filterItems(items, query);

    if (filtered.length === 0) {
        return null;
    }

    return {
        triggerLabel: fromDashBullet ? `Chuẩn hóa bullet → Điểm ${letter})` : `Mẫu Điểm ${letter}) (Workspace)`,
        replaceStart,
        replaceEnd,
        items: filtered,
    };
}

function buildReferenceSuggestions(
    replaceStart: number,
    replaceEnd: number,
    query: string,
    outline: readonly DraftNode[],
    workspaceContext: WorkspaceContext | null,
): CompletionMenuState {
    const items: CompletionItem[] = [];

    for (const node of outline) {
        if (node.level === "CHAPTER") {
            continue;
        }

        const lowerRef = node.refLabel
            .replace(/^Điểm\s+/u, "điểm ")
            .replace(/^Khoản\s+/u, "khoản ")
            .replace(/Khoản\s+/u, "khoản ");

        items.push({
            id: `ref-cur-${node.id}`,
            label: node.refLabel,
            detail: node.title ?? `Dòng ${node.startLine}`,
            documentation: node.text.slice(0, 140),
            kind: "REFERENCE",
            insertText: lowerRef,
        });
    }

    if (workspaceContext) {
        for (const prov of workspaceContext.provisions) {
            const lowerRef = prov.refLabel
                .replace(/^Điểm\s+/u, "điểm ")
                .replace(/^Khoản\s+/u, "khoản ")
                .replace(/Khoản\s+/u, "khoản ");

            items.push({
                id: prov.id,
                label: `${prov.refLabel} (${prov.documentLabel})`,
                detail: `Kho: ${prov.documentLabel}`,
                documentation: prov.excerpt,
                kind: "REFERENCE",
                insertText: `${lowerRef} của ${prov.documentLabel}`,
            });
        }
    }

    const filtered = filterItems(items, query).slice(0, 12);

    return {
        triggerLabel: "Dẫn chiếu điều khoản (Workspace)",
        replaceStart,
        replaceEnd,
        items: filtered,
        emptyMessage: filtered.length === 0 ? "Chưa có điều khoản khớp trong dự thảo hoặc workspace." : undefined,
    };
}

function buildManualStarterSuggestions(
    offset: number,
    _outline: readonly DraftNode[],
    content: string,
): CompletionMenuState {
    const nextArt = previousArticleNumber(content, offset);
    const nextLetter = nextVietnamesePointLetter(content, offset);

    return {
        triggerLabel: "Cấu trúc quy phạm",
        replaceStart: offset,
        replaceEnd: offset,
        items: [
            {
                id: "starter-basis",
                label: "Căn cứ ...",
                detail: "Mở đầu",
                documentation: "Bắt đầu dòng căn cứ từ văn bản trong workspace.",
                kind: "BASIS",
                insertText: "Căn cứ ",
            },
            {
                id: "starter-article",
                label: `Điều ${nextArt}. [Tiêu đề]`,
                detail: "Điều kế tiếp",
                documentation: "Tạo Điều mới theo đúng số thứ tự kế tiếp.",
                kind: "ARTICLE",
                insertText: `Điều ${nextArt}. \n1. `,
                cursorOffsetInInsert: `Điều ${nextArt}. `.length,
            },
            {
                id: "starter-point",
                label: `${nextLetter}) Điểm mới`,
                detail: "Điểm kế tiếp",
                documentation: "Chèn điểm theo bảng chữ cái quy phạm Việt Nam.",
                kind: "POINT",
                insertText: `${nextLetter}) `,
            },
        ],
    };
}

function filterItems(items: readonly CompletionItem[], query: string): CompletionItem[] {
    if (!query) {
        return [...items];
    }

    const normalizedQuery = normalizeSearch(query);

    return items.filter((item) => {
        const haystack = normalizeSearch(`${item.label} ${item.detail} ${item.insertText}`);

        return haystack.includes(normalizedQuery);
    });
}

function normalizeSearch(text: string): string {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d");
}
