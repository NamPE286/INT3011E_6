import type { NumericIntervalItem, NumericIntervalStatus } from "./types";
import { findNodeAtOffset, positionAtOffset, type ParsedDraft } from "./parser";

export type ExtractedFineRange = {
    min: number;
    max: number;
    minRaw: string;
    maxRaw: string;
    startOffset: number;
    endOffset: number;
    provisionRef: string | null;
    subject: "INDIVIDUAL" | "ORGANIZATION" | "BOTH" | null;
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

const MONEY_AMOUNT = "(\\d{1,3}(?:[.,]\\d{3})+|\\d+(?:[.,]\\d+)?)\\s*(triệu\\s+đồng|tỷ\\s+đồng|đồng)";
const FINE_RANGE = new RegExp(`phạt\\s+tiền\\s+từ\\s+${MONEY_AMOUNT}\\s+đến\\s+${MONEY_AMOUNT}|từ\\s+(\\d{1,3}(?:[.,]\\d{3})+|\\d+)\\s*đồng\\s+đến\\s+(\\d{1,3}(?:[.,]\\d{3})+|\\d+)\\s*đồng`, "giu");
const SUBJECT_BOTH_AFTER = /^\s*(?:đối\s+với\s+)?(?:(?:cá\s+nhân\s+(?:hoặc|và)\s+tổ\s+chức)|(?:tổ\s+chức\s+(?:hoặc|và)\s+cá\s+nhân))/iu;
const SUBJECT_AFTER = /^\s*(?:đối\s+với\s+)?(cá nhân|tổ chức)/iu;

export const UNIT_PATTERN = "(km\\/h|mg\\/100\\s*ml|mg\\/lít|miligam\\/100\\s*mililít\\s*máu|miligam\\/1\\s*lít\\s*khí\\s*thở|triệu\\s+đồng|tỷ\\s+đồng|kilôgam|kg|gam|tấn|tạ|gigabyte\\s*\\(GB\\)|gigabyte|GB|megabyte|MB|đơn\\s+vị|giấy\\s+tờ\\s+giả|ảnh|mét\\s+vuông|m2|m²|mét\\s+khối|m3|m³|mét|lít|mililít|hecta|ha|nụ\\s+xuỳ|ống\\s+nổ|giờ|ngày|tầng|%)";
const METRIC_RANGE = new RegExp(`từ\\s+(trên\\s+)?(\\d+(?:[.,]\\d+)*)(?:\\s*${UNIT_PATTERN})?\\s+đến\\s+(dưới\\s+)?(\\d+(?:[.,]\\d+)*)\\s*${UNIT_PATTERN}`, "giu");
const METRIC_ABOVE = new RegExp(`(trên|vượt\\s+quá|từ\\s+trên|quá)\\s+(\\d+(?:[.,]\\d+)*)\\s*${UNIT_PATTERN}`, "giu");
const METRIC_AT_LEAST = new RegExp(`(\\d+(?:[.,]\\d+)*)\\s*${UNIT_PATTERN}\\s+trở\\s+lên`, "giu");

const NON_THRESHOLD_PREFIX = /(?:phạt\s+tiền|phạt\s+tù|tước\s+quyền|đình\s+chỉ|cấm\s+hành\s+nghề|cấm\s+đảm\s+nhiệm|cải\s+tạo\s+không\s+giam\s+giữ|bồi\s+thường|mức\s+phạt|trong\s+thời\s+hạn|kể\s+từ\s+ngày|tối\s+đa\s+là|không\s+quá\s+thời\s+hạn)\s*$/iu;

function parseMoneyValue(rawNum: string, rawUnit: string): number {
    const unitLower = rawUnit.toLowerCase().replace(/\s+/g, " ").trim();

    if (unitLower === "triệu đồng") {
        return Math.round(parseDecimal(rawNum) * 1_000_000);
    }

    if (unitLower === "tỷ đồng") {
        return Math.round(parseDecimal(rawNum) * 1_000_000_000);
    }

    return Number(rawNum.replace(/[.,]/g, ""));
}

export function extractFineRanges(draft: ParsedDraft): ExtractedFineRange[] {
    const results: ExtractedFineRange[] = [];

    for (const match of draft.content.matchAll(FINE_RANGE)) {
        const isPrefixedMoney = Boolean(match[1]);
        const fullMatch = match[0];
        const prefixLen = isPrefixedMoney ? fullMatch.search(/từ\s+/iu) : 0;
        const startOffset = match.index + Math.max(0, prefixLen);
        const endOffset = match.index + fullMatch.length;

        const minRaw = isPrefixedMoney ? `${match[1]} ${match[2]}` : match[5];
        const maxRaw = isPrefixedMoney ? `${match[3]} ${match[4]}` : match[6];
        const min = isPrefixedMoney ? parseMoneyValue(match[1], match[2]) : Number(match[5].replace(/[.,]/g, ""));
        const max = isPrefixedMoney ? parseMoneyValue(match[3], match[4]) : Number(match[6].replace(/[.,]/g, ""));

        const after = draft.content.slice(endOffset, endOffset + 64);
        const node = findNodeAtOffset(draft.nodes, startOffset);

        let subject: ExtractedFineRange["subject"] = null;

        if (SUBJECT_BOTH_AFTER.test(after)) {
            subject = "BOTH";
        } else {
            const subjectMatch = SUBJECT_AFTER.exec(after)?.[1]?.toLowerCase();

            if (subjectMatch === "cá nhân") {
                subject = "INDIVIDUAL";
            } else if (subjectMatch === "tổ chức") {
                subject = "ORGANIZATION";
            }
        }

        results.push({
            min,
            max,
            minRaw: isPrefixedMoney ? minRaw.replace(/\s*đồng$/iu, "").trim() : minRaw,
            maxRaw: isPrefixedMoney ? maxRaw.replace(/\s*đồng$/iu, "").trim() : maxRaw,
            startOffset,
            endOffset,
            provisionRef: node?.refLabel ?? null,
            subject,
        });
    }

    return results;
}

function isPenaltyOrProceduralDuration(content: string, startOffset: number, unit: string): boolean {
    const prefix = content.slice(Math.max(0, startOffset - 48), startOffset);

    if (unit === "triệu đồng" && /(?:phạt\s+tiền|mức\s+phạt)\s*$/iu.test(prefix)) {
        return true;
    }

    if ((unit === "ngày" || unit === "giờ") && NON_THRESHOLD_PREFIX.test(prefix)) {
        return true;
    }

    if ((unit === "ngày" || unit === "giờ") && /(?:hiệu\s+lực|ban\s+hành|ký\s+kết|bàn\s+giao|công\s+bố|niêm\s+yết|khiếu\s+nại|thông\s+báo|giải\s+quyết|thẩm\s+định)\s*[^.\n]{0,25}$/iu.test(prefix)) {
        return true;
    }

    return false;
}

function normalizeThresholdValue(rawVal: number, rawUnit: string): { value: number; unit: string } {
    const unit = normalizeUnit(rawUnit);

    if (unit === "tỷ đồng") {
        return { value: rawVal * 1000, unit: "triệu đồng" };
    }

    return { value: rawVal, unit };
}

export function extractNumericThresholds(draft: ParsedDraft, fineRanges: readonly ExtractedFineRange[]): ExtractedThreshold[] {
    const raw: ExtractedThreshold[] = [];

    for (const match of draft.content.matchAll(METRIC_RANGE)) {
        const startOffset = match.index;
        const endOffset = startOffset + match[0].length;
        const minExclusive = Boolean(match[1]);
        const rawMin = parseDecimal(match[2]);
        const rawMax = parseDecimal(match[5]);
        const maxNorm = normalizeThresholdValue(rawMax, match[6]);
        const minNorm = match[3]
            ? normalizeThresholdValue(rawMin, match[3])
            : { value: match[6].toLowerCase().includes("tỷ") ? rawMin * 1000 : rawMin, unit: maxNorm.unit };

        if (minNorm.unit !== maxNorm.unit) {
            continue;
        }

        const unit = maxNorm.unit;

        if (isPenaltyOrProceduralDuration(draft.content, startOffset, unit)) {
            continue;
        }

        const min = minNorm.value;
        const max = maxNorm.value;
        const maxExclusive = Boolean(match[4]);
        const node = findNodeAtOffset(draft.nodes, startOffset);
        const line = positionAtOffset(draft.lineStarts, startOffset).line;
        const fine = nearestFineForNode(draft, fineRanges, startOffset);

        raw.push({
            metric: metricNameForUnit(unit),
            unit,
            min,
            max,
            minInclusive: !minExclusive,
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

    for (const match of draft.content.matchAll(METRIC_AT_LEAST)) {
        const startOffset = match.index;
        const endOffset = startOffset + match[0].length;

        if (overlapsExisting(raw, startOffset, endOffset)) {
            continue;
        }

        const norm = normalizeThresholdValue(parseDecimal(match[1]), match[2]);

        if (isPenaltyOrProceduralDuration(draft.content, startOffset, norm.unit)) {
            continue;
        }

        const node = findNodeAtOffset(draft.nodes, startOffset);
        const line = positionAtOffset(draft.lineStarts, startOffset).line;
        const fine = nearestFineForNode(draft, fineRanges, startOffset);

        raw.push({
            metric: metricNameForUnit(norm.unit),
            unit: norm.unit,
            min: norm.value,
            max: null,
            minInclusive: true,
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

    for (const match of draft.content.matchAll(METRIC_ABOVE)) {
        const startOffset = match.index;
        const endOffset = startOffset + match[0].length;

        if (overlapsExisting(raw, startOffset, endOffset)) {
            continue;
        }

        const norm = normalizeThresholdValue(parseDecimal(match[2]), match[3]);

        if (isPenaltyOrProceduralDuration(draft.content, startOffset, norm.unit)) {
            continue;
        }

        const node = findNodeAtOffset(draft.nodes, startOffset);
        const line = positionAtOffset(draft.lineStarts, startOffset).line;
        const fine = nearestFineForNode(draft, fineRanges, startOffset);

        raw.push({
            metric: metricNameForUnit(norm.unit),
            unit: norm.unit,
            min: norm.value,
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

const DISCRETE_INTEGER_UNITS = new Set([
    "đơn vị",
    "giấy tờ giả",
    "ảnh",
    "nụ xuỳ",
    "ống nổ",
    "%",
    "tầng",
]);

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
                const isDiscreteAdjacent = DISCRETE_INTEGER_UNITS.has(curr.unit)
                    && prev.maxInclusive
                    && curr.minInclusive
                    && curr.min === prev.max + 1;

                if (!isDiscreteAdjacent) {
                    curr.status = "GAP_BEFORE";
                    curr.gapFrom = prev;
                }
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

export function parseDecimal(raw: string): number {
    if (/^\d{1,3}(?:\.\d{3})+$/.test(raw)) {
        return Number(raw.replace(/\./g, ""));
    }

    return Number(raw.replace(",", "."));
}

export function normalizeUnit(unit: string): string {
    const compact = unit.toLowerCase().replace(/\s+/g, "");

    if (compact.includes("miligam/100mililít")) {
        return "mg/100ml";
    }

    if (compact.includes("miligam/1lítkhíthở")) {
        return "mg/lít";
    }

    if (compact === "triệuđồng") {
        return "triệu đồng";
    }

    if (compact === "tỷđồng") {
        return "tỷ đồng";
    }

    if (compact === "kilôgam") {
        return "kg";
    }

    if (compact.startsWith("gigabyte") || compact === "gb") {
        return "gb";
    }

    if (compact === "megabyte" || compact === "mb") {
        return "mb";
    }

    if (compact === "đơnvị") {
        return "đơn vị";
    }

    if (compact === "giấytờgiả") {
        return "giấy tờ giả";
    }

    if (compact === "nụxuỳ") {
        return "nụ xuỳ";
    }

    if (compact === "ốngnổ") {
        return "ống nổ";
    }

    if (compact === "métvuông" || compact === "m2" || compact === "m²") {
        return "m2";
    }

    if (compact === "métkhối" || compact === "m3" || compact === "m³") {
        return "m3";
    }

    if (compact === "hecta" || compact === "ha") {
        return "ha";
    }

    return compact;
}

function metricNameForUnit(unit: string): string {
    if (unit === "km/h") {
        return "Tốc độ vượt mức";
    }

    if (unit.startsWith("mg/")) {
        return "Nồng độ cồn";
    }

    if (unit === "triệu đồng" || unit === "tỷ đồng") {
        return "Giá trị tài chính";
    }

    if (unit === "ngày" || unit === "giờ") {
        return "Thời lượng vi phạm";
    }

    if (unit === "tấn" || unit === "tạ" || unit === "kg" || unit === "gam") {
        return "Khối lượng / Trọng tải";
    }

    if (unit === "gb" || unit === "mb") {
        return "Dung lượng dữ liệu";
    }

    if (unit === "đơn vị" || unit === "giấy tờ giả" || unit === "ảnh" || unit === "nụ xuỳ" || unit === "ống nổ") {
        return "Số lượng";
    }

    return "Định lượng";
}
