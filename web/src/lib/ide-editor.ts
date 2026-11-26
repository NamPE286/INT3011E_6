import type { DiagnosticCategory, DiagnosticSeverity, DraftNode, LegalDiagnostic, QuickFix, TermOccurrence } from "./api/ide";

export type LineSegment = {
    text: string;
    diagnostic: LegalDiagnostic | null;
    termOccurrence?: TermOccurrence | null;
    isSelected: boolean;
};

export type DecoratedLine = {
    lineNumber: number;
    startOffset: number;
    endOffset: number;
    gutterSeverity: DiagnosticSeverity | null;
    gutterCategory: DiagnosticCategory | null;
    lineDiagnostics: LegalDiagnostic[];
    segments: LineSegment[];
};

const SEVERITY_RANK: Record<DiagnosticSeverity, number> = {
    error: 3,
    warning: 2,
    info: 1,
};

export function buildLineDecorations(
    content: string,
    diagnostics: readonly LegalDiagnostic[],
    selectedDiagnosticId: string | null,
    termOccurrences: readonly TermOccurrence[] = [],
): DecoratedLine[] {
    const rawLines = content.split("\n");
    const decorated: DecoratedLine[] = [];
    let cursor = 0;

    for (let idx = 0; idx < rawLines.length; idx += 1) {
        const lineText = rawLines[idx];
        const lineStart = cursor;
        const lineEnd = lineStart + lineText.length;
        const lineNumber = idx + 1;

        const overlapping = diagnostics.filter(
            (diag) => diag.range.startOffset < lineEnd && diag.range.endOffset > lineStart,
        );
        const overlappingTerms = termOccurrences.filter(
            (term) => term.startOffset < lineEnd && term.endOffset > lineStart,
        );

        let topDiag: LegalDiagnostic | null = null;

        for (const diag of overlapping) {
            if (!topDiag || SEVERITY_RANK[diag.severity] > SEVERITY_RANK[topDiag.severity]) {
                topDiag = diag;
            }
        }

        decorated.push({
            lineNumber,
            startOffset: lineStart,
            endOffset: lineEnd,
            gutterSeverity: topDiag?.severity ?? null,
            gutterCategory: topDiag?.category ?? null,
            lineDiagnostics: overlapping,
            segments: sliceLineSegments(lineText, lineStart, overlapping, selectedDiagnosticId, overlappingTerms),
        });

        cursor = lineEnd + 1;
    }

    return decorated;
}

export function applyQuickFix(content: string, fix: QuickFix): string {
    const start = Math.max(0, Math.min(fix.startOffset, content.length));
    const end = Math.max(start, Math.min(fix.endOffset, content.length));

    return content.slice(0, start) + fix.replacement + content.slice(end);
}

export function cursorPosition(content: string, offset: number): { line: number; col: number } {
    const clamped = Math.max(0, Math.min(offset, content.length));
    const before = content.slice(0, clamped);
    const lines = before.split("\n");

    return {
        line: lines.length,
        col: lines[lines.length - 1].length + 1,
    };
}

export function offsetForLine(content: string, targetLine: number): number {
    if (targetLine <= 1) {
        return 0;
    }

    let line = 1;

    for (let idx = 0; idx < content.length; idx += 1) {
        if (content[idx] === "\n") {
            line += 1;

            if (line === targetLine) {
                return idx + 1;
            }
        }
    }

    return content.length;
}

export function activeProvisionAtLine(outline: readonly DraftNode[], line: number): DraftNode | null {
    let best: DraftNode | null = null;

    for (const node of outline) {
        if (line >= node.startLine && line <= node.endLine) {
            if (!best || (node.endLine - node.startLine) <= (best.endLine - best.startLine)) {
                best = node;
            }
        }
    }

    return best;
}

export function findDiagnosticAtOffset(
    diagnostics: readonly LegalDiagnostic[],
    offset: number,
): LegalDiagnostic | null {
    let best: LegalDiagnostic | null = null;
    let bestSpan = Infinity;

    for (const diag of diagnostics) {
        if (offset < diag.range.startOffset || offset > diag.range.endOffset) {
            continue;
        }

        const span = diag.range.endOffset - diag.range.startOffset;

        if (
            !best
            || span < bestSpan
            || (span === bestSpan && SEVERITY_RANK[diag.severity] > SEVERITY_RANK[best.severity])
        ) {
            best = diag;
            bestSpan = span;
        }
    }

    return best;
}

function sliceLineSegments(
    lineText: string,
    lineStart: number,
    lineDiagnostics: readonly LegalDiagnostic[],
    selectedDiagnosticId: string | null,
    lineTerms: readonly TermOccurrence[] = [],
): LineSegment[] {
    if (lineText.length === 0) {
        return [{ text: "", diagnostic: null, termOccurrence: null, isSelected: false }];
    }

    if (lineDiagnostics.length === 0 && lineTerms.length === 0) {
        return [{ text: lineText, diagnostic: null, termOccurrence: null, isSelected: false }];
    }

    const boundaries = new Set<number>([0, lineText.length]);

    for (const diag of lineDiagnostics) {
        const localStart = Math.max(0, diag.range.startOffset - lineStart);
        const localEnd = Math.min(lineText.length, diag.range.endOffset - lineStart);

        if (localEnd > localStart) {
            boundaries.add(localStart);
            boundaries.add(localEnd);
        }
    }

    for (const term of lineTerms) {
        const localStart = Math.max(0, term.startOffset - lineStart);
        const localEnd = Math.min(lineText.length, term.endOffset - lineStart);

        if (localEnd > localStart) {
            boundaries.add(localStart);
            boundaries.add(localEnd);
        }
    }

    const points = [...boundaries].sort((left, right) => left - right);
    const segments: LineSegment[] = [];

    for (let idx = 0; idx < points.length - 1; idx += 1) {
        const start = points[idx];
        const end = points[idx + 1];
        const absStart = lineStart + start;
        const absEnd = lineStart + end;

        let chosen: LegalDiagnostic | null = null;

        for (const diag of lineDiagnostics) {
            if (diag.range.startOffset < absEnd && diag.range.endOffset > absStart) {
                if (diag.id === selectedDiagnosticId) {
                    chosen = diag;

                    break;
                }

                if (!chosen || SEVERITY_RANK[diag.severity] > SEVERITY_RANK[chosen.severity]) {
                    chosen = diag;
                }
            }
        }

        const chosenTerm = lineTerms.find(
            (term) => term.startOffset < absEnd && term.endOffset > absStart,
        ) ?? null;

        segments.push({
            text: lineText.slice(start, end),
            diagnostic: chosen,
            termOccurrence: chosenTerm,
            isSelected: chosen !== null && chosen.id === selectedDiagnosticId,
        });
    }

    return segments;
}
