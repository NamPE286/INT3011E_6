export type SearchMatch = {
    startOffset: number;
    endOffset: number;
    line: number;
    preview: string;
};

export type SearchOptions = {
    caseSensitive: boolean;
    wholeWord: boolean;
};

export type DiffHunkLine = {
    type: "add" | "del" | "ctx";
    line: number;
    text: string;
};

export type DiffRow = {
    type: "ctx" | "add" | "del";
    oldLine: number | null;
    newLine: number | null;
    text: string;
};

export type SplitDiffRow = {
    left: { line: number; text: string; type: "ctx" | "del" } | null;
    right: { line: number; text: string; type: "ctx" | "add" } | null;
};

export type LineDiffSummary = {
    added: number;
    removed: number;
    hunks: DiffHunkLine[];
    rows: DiffRow[];
};

const MAX_LCS_CELLS = 250_000;

export function findMatches(content: string, query: string, options: SearchOptions): SearchMatch[] {
    if (!query) {
        return [];
    }

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patternText = options.wholeWord ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])` : escaped;
    const flags = options.caseSensitive ? "gu" : "giu";
    const regex = new RegExp(patternText, flags);
    const lines = content.split("\n");
    const matches: SearchMatch[] = [];

    for (const match of content.matchAll(regex)) {
        const startOffset = match.index;
        const endOffset = startOffset + match[0].length;
        const line = content.slice(0, startOffset).split("\n").length;
        const lineText = lines[line - 1] ?? "";

        matches.push({
            startOffset,
            endOffset,
            line,
            preview: lineText.trim().slice(0, 90),
        });

        if (matches.length >= 200) {
            break;
        }
    }

    return matches;
}

export function replaceAllMatches(
    content: string,
    query: string,
    replacement: string,
    options: SearchOptions,
): { content: string; count: number } {
    const matches = findMatches(content, query, options);

    if (matches.length === 0) {
        return { content, count: 0 };
    }

    let updated = content;

    for (let idx = matches.length - 1; idx >= 0; idx -= 1) {
        const match = matches[idx];
        updated = updated.slice(0, match.startOffset) + replacement + updated.slice(match.endOffset);
    }

    return { content: updated, count: matches.length };
}

export function computeLineDiff(baseContent: string, currentContent: string): LineDiffSummary {
    const baseLines = baseContent.split("\n");
    const curLines = currentContent.split("\n");

    if (baseLines.length * curLines.length > MAX_LCS_CELLS) {
        return computePositionalDiff(baseLines, curLines);
    }

    const m = baseLines.length;
    const n = curLines.length;
    const dp = new Uint32Array((m + 1) * (n + 1));
    const cols = n + 1;

    for (let i = m - 1; i >= 0; i -= 1) {
        const baseLine = baseLines[i];

        for (let j = n - 1; j >= 0; j -= 1) {
            if (baseLine === curLines[j]) {
                dp[i * cols + j] = dp[(i + 1) * cols + (j + 1)] + 1;
            } else {
                const down = dp[(i + 1) * cols + j];
                const right = dp[i * cols + (j + 1)];
                dp[i * cols + j] = down >= right ? down : right;
            }
        }
    }

    const rows: DiffRow[] = [];
    const hunks: DiffHunkLine[] = [];
    let added = 0;
    let removed = 0;
    let i = 0;
    let j = 0;

    while (i < m && j < n) {
        if (baseLines[i] === curLines[j]) {
            rows.push({ type: "ctx", oldLine: i + 1, newLine: j + 1, text: baseLines[i] });
            i += 1;
            j += 1;
        } else if (dp[(i + 1) * cols + j] >= dp[i * cols + (j + 1)]) {
            removed += 1;
            rows.push({ type: "del", oldLine: i + 1, newLine: null, text: baseLines[i] });
            hunks.push({ type: "del", line: i + 1, text: baseLines[i] });
            i += 1;
        } else {
            added += 1;
            rows.push({ type: "add", oldLine: null, newLine: j + 1, text: curLines[j] });
            hunks.push({ type: "add", line: j + 1, text: curLines[j] });
            j += 1;
        }
    }

    while (i < m) {
        removed += 1;
        rows.push({ type: "del", oldLine: i + 1, newLine: null, text: baseLines[i] });
        hunks.push({ type: "del", line: i + 1, text: baseLines[i] });
        i += 1;
    }

    while (j < n) {
        added += 1;
        rows.push({ type: "add", oldLine: null, newLine: j + 1, text: curLines[j] });
        hunks.push({ type: "add", line: j + 1, text: curLines[j] });
        j += 1;
    }

    return {
        added,
        removed,
        hunks: hunks.slice(0, 80),
        rows,
    };
}

function computePositionalDiff(baseLines: readonly string[], curLines: readonly string[]): LineDiffSummary {
    const maxLen = Math.max(baseLines.length, curLines.length);
    const rows: DiffRow[] = [];
    const hunks: DiffHunkLine[] = [];
    let added = 0;
    let removed = 0;

    for (let idx = 0; idx < maxLen; idx += 1) {
        const baseLine = baseLines[idx];
        const curLine = curLines[idx];

        if (baseLine === curLine) {
            if (baseLine !== undefined) {
                rows.push({ type: "ctx", oldLine: idx + 1, newLine: idx + 1, text: baseLine });
            }

            continue;
        }

        if (baseLine !== undefined) {
            removed += 1;
            rows.push({ type: "del", oldLine: idx + 1, newLine: null, text: baseLine });
            hunks.push({ type: "del", line: idx + 1, text: baseLine });
        }

        if (curLine !== undefined) {
            added += 1;
            rows.push({ type: "add", oldLine: null, newLine: idx + 1, text: curLine });
            hunks.push({ type: "add", line: idx + 1, text: curLine });
        }
    }

    return { added, removed, hunks: hunks.slice(0, 80), rows };
}

export function buildSplitDiffRows(rows: readonly DiffRow[]): SplitDiffRow[] {
    const split: SplitDiffRow[] = [];
    let idx = 0;

    while (idx < rows.length) {
        const row = rows[idx];

        if (row.type === "ctx") {
            split.push({
                left: { line: row.oldLine ?? 0, text: row.text, type: "ctx" },
                right: { line: row.newLine ?? 0, text: row.text, type: "ctx" },
            });
            idx += 1;
            continue;
        }

        const dels: DiffRow[] = [];
        const adds: DiffRow[] = [];

        while (idx < rows.length && rows[idx].type === "del") {
            dels.push(rows[idx]);
            idx += 1;
        }

        while (idx < rows.length && rows[idx].type === "add") {
            adds.push(rows[idx]);
            idx += 1;
        }

        const pairCount = Math.max(dels.length, adds.length);

        for (let k = 0; k < pairCount; k += 1) {
            const delRow = dels[k];
            const addRow = adds[k];
            split.push({
                left: delRow ? { line: delRow.oldLine ?? 0, text: delRow.text, type: "del" } : null,
                right: addRow ? { line: addRow.newLine ?? 0, text: addRow.text, type: "add" } : null,
            });
        }
    }

    return split;
}
