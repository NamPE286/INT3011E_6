export const VIETNAMESE_POINT_ALPHABET = [
    "a", "b", "c", "d", "đ", "e", "g", "h", "i", "k", "l", "m",
    "n", "o", "p", "q", "r", "s", "t", "u", "v", "x", "y",
] as const;

const ARTICLE_LINE_REGEX = /^(\s*Điều\s+)(\d+)([.:–—\-\s].*|$)/iu;
const CLAUSE_LINE_REGEX = /^(\s*)(\d+)(\.(?:\s.*|\s*))$/u;
const POINT_LINE_REGEX = /^(\s*)([a-zđ])(\)(?:\s.*|\s*))$/u;
const QUOTED_AMENDMENT_START = /^[“"]/;

function isQuotedLine(line: string): boolean {
    return QUOTED_AMENDMENT_START.test(line.trimStart());
}

/**
 * Shifts subsequent `Điều N` headings by `delta` (+1 or -1) along a contiguous chain
 * starting at `insertedNum` (for +1) or `insertedNum + 1` (for -1).
 */
export function shiftSubsequentArticles(
    content: string,
    fromLineIndex: number,
    insertedNum: number,
    delta: 1 | -1 = 1,
): string {
    const lines = content.split("\n");
    let expected = delta === 1 ? insertedNum : insertedNum + 1;
    let changed = false;

    for (let idx = fromLineIndex + 1; idx < lines.length; idx += 1) {
        const line = lines[idx];

        if (isQuotedLine(line)) {
            continue;
        }

        const match = ARTICLE_LINE_REGEX.exec(line);

        if (!match) {
            continue;
        }

        const num = Number.parseInt(match[2], 10);

        if (num !== expected) {
            break;
        }

        const nextNum = num + delta;

        if (nextNum < 1) {
            break;
        }

        lines[idx] = `${match[1]}${nextNum}${match[3]}`;
        expected += 1;
        changed = true;
    }

    if (!changed) {
        return content;
    }

    return lines.join("\n");
}

/**
 * Shifts subsequent `N. ` clauses within the same Article by `delta` (+1 or -1).
 */
export function shiftSubsequentClauses(
    content: string,
    fromLineIndex: number,
    insertedNum: number,
    delta: 1 | -1 = 1,
): string {
    const lines = content.split("\n");
    let expected = delta === 1 ? insertedNum : insertedNum + 1;
    let changed = false;

    for (let idx = fromLineIndex + 1; idx < lines.length; idx += 1) {
        const line = lines[idx];

        if (/^\s*(?:Chương\s+|Điều\s+\d+)/iu.test(line)) {
            break;
        }

        if (isQuotedLine(line)) {
            continue;
        }

        const match = CLAUSE_LINE_REGEX.exec(line);

        if (!match) {
            continue;
        }

        const num = Number.parseInt(match[2], 10);

        if (num !== expected) {
            break;
        }

        const nextNum = num + delta;

        if (nextNum < 1) {
            break;
        }

        lines[idx] = `${match[1]}${nextNum}${match[3]}`;
        expected += 1;
        changed = true;
    }

    if (!changed) {
        return content;
    }

    return lines.join("\n");
}

/**
 * Shifts subsequent `a) `..`y) ` points within the same Clause by `delta` (+1 or -1)
 * using the Vietnamese legislative point alphabet (`a, b, c, d, đ, e...`).
 */
export function shiftSubsequentPoints(
    content: string,
    fromLineIndex: number,
    insertedLetter: string,
    delta: 1 | -1 = 1,
): string {
    const startIdx = VIETNAMESE_POINT_ALPHABET.indexOf(
        insertedLetter.toLowerCase() as (typeof VIETNAMESE_POINT_ALPHABET)[number],
    );

    if (startIdx === -1) {
        return content;
    }

    const lines = content.split("\n");
    let expectedIdx = delta === 1 ? startIdx : startIdx + 1;
    let changed = false;

    for (let idx = fromLineIndex + 1; idx < lines.length; idx += 1) {
        const line = lines[idx];

        if (/^\s*(?:Chương\s+|Điều\s+\d+|\d+\.(?:\s|$))/iu.test(line)) {
            break;
        }

        if (isQuotedLine(line)) {
            continue;
        }

        const match = POINT_LINE_REGEX.exec(line);

        if (!match) {
            continue;
        }

        const pIdx = VIETNAMESE_POINT_ALPHABET.indexOf(
            match[2].toLowerCase() as (typeof VIETNAMESE_POINT_ALPHABET)[number],
        );

        if (pIdx !== expectedIdx) {
            break;
        }

        const nextIdx = pIdx + delta;

        if (nextIdx < 0 || nextIdx >= VIETNAMESE_POINT_ALPHABET.length) {
            break;
        }

        lines[idx] = `${match[1]}${VIETNAMESE_POINT_ALPHABET[nextIdx]}${match[3]}`;
        expectedIdx += 1;
        changed = true;
    }

    if (!changed) {
        return content;
    }

    return lines.join("\n");
}

/**
 * Inspects `lines[lineIndex]` and shifts subsequent siblings if it starts with
 * `Điều N`, `N. `, or `a) `.
 */
export function shiftAfterLineInsert(content: string, lineIndex: number): string {
    const lines = content.split("\n");
    const line = lines[lineIndex];

    if (line === undefined || isQuotedLine(line)) {
        return content;
    }

    const artMatch = ARTICLE_LINE_REGEX.exec(line);

    if (artMatch) {
        return shiftSubsequentArticles(content, lineIndex, Number.parseInt(artMatch[2], 10), 1);
    }

    const clauseMatch = CLAUSE_LINE_REGEX.exec(line);

    if (clauseMatch) {
        return shiftSubsequentClauses(content, lineIndex, Number.parseInt(clauseMatch[2], 10), 1);
    }

    const pointMatch = POINT_LINE_REGEX.exec(line);

    if (pointMatch) {
        return shiftSubsequentPoints(content, lineIndex, pointMatch[2], 1);
    }

    return content;
}

/**
 * Automatically shifts subsequent sibling numbers when the user finishes typing
 * a structural prefix (`Điều N. `, `N. `, or `a) `) at the start of an empty/new line.
 */
export function autoShiftOnManualPrefix(
    prevContent: string,
    nextContent: string,
    cursorOffset: number,
): string {
    if (nextContent.length <= prevContent.length || nextContent.length - prevContent.length > 4) {
        return nextContent;
    }

    const safeOffset = Math.max(0, Math.min(cursorOffset, nextContent.length));
    const lineStart = nextContent.lastIndexOf("\n", safeOffset - 1) + 1;
    const nextNewline = nextContent.indexOf("\n", safeOffset);
    const lineEnd = nextNewline === -1 ? nextContent.length : nextNewline;

    if (nextContent.slice(safeOffset, lineEnd).trim().length > 0) {
        return nextContent;
    }

    const lineText = nextContent.slice(lineStart, safeOffset);

    if (isQuotedLine(lineText)) {
        return nextContent;
    }

    const lineIdx = nextContent.slice(0, lineStart).split("\n").length - 1;
    const prevLine = prevContent.split("\n")[lineIdx] ?? "";

    const artMatch = /^\s*Điều\s+(\d+)[.:]\s$/iu.exec(lineText);

    if (artMatch && !/^\s*Điều\s+\d+[.:]\s/iu.test(prevLine)) {
        return shiftSubsequentArticles(nextContent, lineIdx, Number.parseInt(artMatch[1], 10), 1);
    }

    const clauseMatch = /^\s*(\d+)\.\s$/u.exec(lineText);

    if (clauseMatch && !/^\s*\d+\.\s/u.test(prevLine)) {
        return shiftSubsequentClauses(nextContent, lineIdx, Number.parseInt(clauseMatch[1], 10), 1);
    }

    const pointMatch = /^\s*([a-zđ])\)\s$/u.exec(lineText);

    if (pointMatch && !/^\s*[a-zđ]\)\s/u.test(prevLine)) {
        return shiftSubsequentPoints(nextContent, lineIdx, pointMatch[1], 1);
    }

    return nextContent;
}
