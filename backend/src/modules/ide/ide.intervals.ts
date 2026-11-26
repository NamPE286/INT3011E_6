import type { NumericIntervalItem, NumericIntervalStatus } from "./ide.types";
import { findNodeAtOffset, positionAtOffset, type ParsedDraft } from "./ide.parser";

export type ExtractedFineRange = {
    min: number;
    max: number;
    minRaw: string;
    maxRaw: string;
    startOffset: number;
    endOffset: number;
    provisionRef: string | null;
    subject: "INDIVIDUAL" | "ORGANIZATION" | null;
};

export type ExtractedThreshold = {
    metric: string;
    unit: string;
    min: number | null;
    max: number | null;
    minInclusive: boolean;
    maxInclusive: boolean;
    fineMin: number | null;
    fineMax: number | null;
    articleNo: string | null;
    provisionRef: string | null;
    line: number;
    startOffset: number;
    endOffset: number;
    excerpt: string;
    status: NumericIntervalStatus;
    overlapWith: ExtractedThreshold | null;
    gapFrom: ExtractedThreshold | null;
};

const MONEY = "(\\d{1,3}(?:[.,]\\d{3})+|\\d+)\\s*đồng";
const FINE_RANGE = new RegExp(`từ\\s+${MONEY}\\s+đến\\s+${MONEY}`, "giu");
const SUBJECT_AFTER = /^\s*(?:đối\s+với\s+)?(cá nhân|tổ chức)/iu;

const METRIC_RANGE = /từ\s+(\d+(?:[.,]\d+)?)\s*(km\/h|mg\/100\s*ml|mg\/lít|tấn|kg|%)\s+đến\s+(dưới\s+)?(\d+(?:[.,]\d+)?)\s*(km\/h|mg\/100\s*ml|mg\/lít|tấn|kg|%)/giu;
const METRIC_ABOVE = /(trên|vượt\s+quá|từ\s+trên)\s+(\d+(?:[.,]\d+)?)\s*(km\/h|mg\/100\s*ml|mg\/lít|tấn|kg|%)/giu;

export function extractFineRanges(draft: ParsedDraft): ExtractedFineRange[] {
    const results: ExtractedFineRange[] = [];

    for (const match of draft.content.matchAll(FINE_RANGE)) {
        const startOffset = match.index;
        const endOffset = startOffset + match[0].length;
        const minRaw = match[1];
        const maxRaw = match[2];
        const min = Number(minRaw.replace(/[.,]/g, ""));
        const max = Number(maxRaw.replace(/[.,]/g, ""));
        const after = draft.content.slice(endOffset, endOffset + 40);
        const subjectMatch = SUBJECT_AFTER.exec(after)?.[1]?.toLowerCase();
        const node = findNodeAtOffset(draft.nodes, startOffset);

        results.push({
            min,
            max,
            minRaw,
            maxRaw,
            startOffset,
            endOffset,
            provisionRef: node?.refLabel ?? null,
            subject: subjectMatch === "cá nhân" ? "INDIVIDUAL" : subjectMatch === "tổ chức" ? "ORGANIZATION" : null,
        });
    }

    return results;
}

export function extractNumericThresholds(draft: ParsedDraft, fineRanges: readonly ExtractedFineRange[]): ExtractedThreshold[] {
    const raw: ExtractedThreshold[] = [];

    for (const match of draft.content.matchAll(METRIC_RANGE)) {
        const startOffset = match.index;
        const endOffset = startOffset + match[0].length;
        const min = parseDecimal(match[1]);
        const unit = normalizeUnit(match[2]);
        const maxExclusive = Boolean(match[3]);
        const max = parseDecimal(match[4]);
        const unitEnd = normalizeUnit(match[5]);

        if (unit !== unitEnd) {
            continue;
        }

        const node = findNodeAtOffset(draft.nodes, startOffset);
        const line = positionAtOffset(draft.lineStarts, startOffset).line;
        const fine = nearestFineForNode(draft, fineRanges, startOffset);

        raw.push({
            metric: metricNameForUnit(unit),
            unit,
            min,
            max,
            minInclusive: true,
            maxInclusive: !maxExclusive,
            fineMin: fine?.min ?? null,
            fineMax: fine?.max ?? null,
            articleNo: node?.articleNo ?? null,
            provisionRef: node?.refLabel ?? null,
            line,
            startOffset,
            endOffset,
            excerpt: match[0],
            status: min > max ? "INVERTED" : "OK",
            overlapWith: null,
            gapFrom: null,
        });
    }

    for (const match of draft.content.matchAll(METRIC_ABOVE)) {
        const startOffset = match.index;
        const endOffset = startOffset + match[0].length;

        if (overlapsExisting(raw, startOffset, endOffset)) {
            continue;
        }

        const min = parseDecimal(match[2]);
        const unit = normalizeUnit(match[3]);
        const node = findNodeAtOffset(draft.nodes, startOffset);
        const line = positionAtOffset(draft.lineStarts, startOffset).line;
        const fine = nearestFineForNode(draft, fineRanges, startOffset);

        raw.push({
            metric: metricNameForUnit(unit),
            unit,
            min,
            max: null,
            minInclusive: false,
            maxInclusive: false,
            fineMin: fine?.min ?? null,
            fineMax: fine?.max ?? null,
            articleNo: node?.articleNo ?? null,
            provisionRef: node?.refLabel ?? null,
            line,
            startOffset,
            endOffset,
            excerpt: match[0],
            status: "OK",
            overlapWith: null,
            gapFrom: null,
        });
    }

    evaluateIntervalContinuity(raw);

    return raw;
}

export function toIntervalItems(thresholds: readonly ExtractedThreshold[]): NumericIntervalItem[] {
    return thresholds.map((item, idx) => ({
        id: `interval-${idx + 1}`,
        metric: item.metric,
        unit: item.unit,
        min: item.min,
        max: item.max,
        minInclusive: item.minInclusive,
        maxInclusive: item.maxInclusive,
        fineMin: item.fineMin,
        fineMax: item.fineMax,
        provisionRef: item.provisionRef,
        line: item.line,
        status: item.status,
        startOffset: item.startOffset,
        endOffset: item.endOffset,
    }));
}

function evaluateIntervalContinuity(thresholds: ExtractedThreshold[]): void {
    const groups = new Map<string, ExtractedThreshold[]>();

    for (const item of thresholds) {
        const key = `${item.articleNo ?? "global"}::${item.unit}`;
        const list = groups.get(key) ?? [];

        list.push(item);
        groups.set(key, list);
    }

    for (const group of groups.values()) {
        group.sort((left, right) => {
            const leftMin = left.min ?? -Infinity;
            const rightMin = right.min ?? -Infinity;

            return leftMin - rightMin;
        });

        for (let idx = 1; idx < group.length; idx += 1) {
            const prev = group[idx - 1];
            const curr = group[idx];

            if (prev.status === "INVERTED" || curr.status === "INVERTED") {
                continue;
            }

            if (prev.max === null || curr.min === null) {
                continue;
            }

            if (prev.max > curr.min || (prev.max === curr.min && prev.maxInclusive && curr.minInclusive)) {
                curr.status = "OVERLAP";
                curr.overlapWith = prev;
            } else if (prev.max < curr.min) {
                curr.status = "GAP_BEFORE";
                curr.gapFrom = prev;
            }
        }
    }
}

function nearestFineForNode(draft: ParsedDraft, fines: readonly ExtractedFineRange[], offset: number): ExtractedFineRange | null {
    const node = findNodeAtOffset(draft.nodes, offset);

    if (!node) {
        return null;
    }

    let best: ExtractedFineRange | null = null;

    for (const fine of fines) {
        if (fine.startOffset <= offset && offset - fine.startOffset < 400) {
            if (!best || fine.startOffset > best.startOffset) {
                best = fine;
            }
        }
    }

    return best;
}

function overlapsExisting(items: readonly ExtractedThreshold[], start: number, end: number): boolean {
    return items.some((item) => start < item.endOffset && end > item.startOffset);
}

function parseDecimal(raw: string): number {
    return Number(raw.replace(",", "."));
}

function normalizeUnit(unit: string): string {
    return unit.toLowerCase().replace(/\s+/g, "");
}

function metricNameForUnit(unit: string): string {
    if (unit === "km/h") {
        return "Tốc độ vượt mức";
    }

    if (unit.startsWith("mg/")) {
        return "Nồng độ cồn";
    }

    if (unit === "tấn" || unit === "kg") {
        return "Trọng tải";
    }

    return "Tỷ lệ";
}
