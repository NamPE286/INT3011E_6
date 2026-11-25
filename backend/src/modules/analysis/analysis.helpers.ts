import type { AnalysisDocument, AnalysisProvision } from "./analysis.types";

const EXTERNAL_DOC_NUMBER_REGEX =
    /\b(\d{1,4}\/\d{4}\/[A-ZĐ]{1,6}(?:-[A-ZĐ0-9]{1,8})*|\d{1,4}\/[A-ZĐ]{2,6})\b/giu;

const FINE_RANGE_REGEX =
    /phạt\s+tiền\s+từ\s+([\d.,]+)\s*(triệu\s+)?đồng\s+đến\s+([\d.,]+)\s*(triệu\s+)?đồng/giu;

const POINT_DEDUCTION_REGEX = /trừ\s+(-?\d+)\s+điểm\s+giấy\s+phép\s+lái\s+xe/giu;

const AMENDMENT_VERB_REGEX =
    /\b(sửa\s+đổi|bổ\s+sung|bãi\s+bỏ|thay\s+thế|đình\s+chỉ\s+hiệu\s+lực|hết\s+hiệu\s+lực)\b/iu;

const STOPWORDS = new Set([
    "phat",
    "tien",
    "tu",
    "den",
    "dong",
    "doi",
    "voi",
    "hanh",
    "vi",
    "pham",
    "sau",
    "day",
    "cua",
    "nguoi",
    "dieu",
    "khien",
    "thuc",
    "hien",
    "mot",
    "trong",
    "cac",
    "va",
    "hoac",
    "tru",
    "diem",
    "giay",
    "phep",
    "lai",
    "xe",
    "quy",
    "dinh",
]);

export const AFFECTING_RELATION_TYPES = new Set([
    "AMENDS",
    "SUPPLEMENTS",
    "AMENDS_OR_SUPPLEMENTS",
    "REPLACES",
    "PARTIALLY_REPLACES",
    "FULLY_REPLACES",
    "REPEALS",
    "PARTIALLY_REPEALS",
    "FULLY_REPEALS",
    "CORRECTS",
    "SUSPENDS",
]);

export const TERMINATING_RELATION_TYPES = new Set([
    "REPEALS",
    "FULLY_REPEALS",
    "REPLACES",
    "FULLY_REPLACES",
]);

export const DEPENDENCY_RELATION_TYPES = new Set([
    "GUIDES",
    "DETAILS",
    "EXPLAINS",
    "LEGAL_BASIS",
    "REFERENCES",
    "AMENDS",
    "SUPPLEMENTS",
    "AMENDS_OR_SUPPLEMENTS",
]);

export function normalizeText(raw: string): string {
    return raw
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/đ/g, "d")
        .replace(/Đ/g, "D")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

export function normalizeDocNumber(raw: string): string {
    return normalizeText(raw).toUpperCase();
}

export function documentLabelOf(doc: Pick<AnalysisDocument, "id" | "documentNumber" | "title">): string {
    if (doc.documentNumber && doc.documentNumber.trim()) {
        return doc.documentNumber.trim();
    }

    if (doc.title && doc.title.trim()) {
        return doc.title.trim();
    }

    return doc.id;
}

export function provisionLabelOf(prov: Pick<AnalysisProvision, "level" | "number" | "articleNo" | "paragraphNo" | "pointNo">): string {
    const parts: string[] = [];

    if (prov.level === "POINT" && prov.pointNo) {
        parts.push(`Điểm ${prov.pointNo}`);
    }

    if ((prov.level === "CLAUSE" || prov.level === "POINT") && prov.paragraphNo) {
        parts.push(`Khoản ${prov.paragraphNo}`);
    }

    if (prov.articleNo) {
        parts.push(`Điều ${prov.articleNo}`);
    }

    if (parts.length > 0) {
        return parts.join(" ");
    }

    const levelNames: Record<string, string> = {
        CHAPTER: "Chương",
        SECTION: "Mục",
        ARTICLE: "Điều",
        CLAUSE: "Khoản",
        POINT: "Điểm",
        PREAMBLE: "Căn cứ",
    };

    return `${levelNames[prov.level] ?? prov.level} ${prov.number}`;
}

export function extractExternalDocumentNumbers(text: string): string[] {
    const matches = new Set<string>();
    let match: RegExpExecArray | null;
    const regex = new RegExp(EXTERNAL_DOC_NUMBER_REGEX.source, EXTERNAL_DOC_NUMBER_REGEX.flags);

    while ((match = regex.exec(text)) !== null) {
        const value = match[1]?.trim();

        if (value) {
            matches.add(value);
        }
    }

    return [...matches];
}

export function parseFineRanges(text: string): { min: number; max: number; raw: string }[] {
    const results: { min: number; max: number; raw: string }[] = [];
    const regex = new RegExp(FINE_RANGE_REGEX.source, FINE_RANGE_REGEX.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
        const min = parseVietnameseAmount(match[1] ?? "", Boolean(match[2]));
        const max = parseVietnameseAmount(match[3] ?? "", Boolean(match[4]));

        if (min !== null && max !== null) {
            results.push({ min, max, raw: match[0] });
        }
    }

    return results;
}

function parseVietnameseAmount(digits: string, inMillions: boolean): number | null {
    const cleaned = digits.replace(/\./g, "").replace(/,/g, ".");
    const parsed = Number(cleaned);

    if (!Number.isFinite(parsed)) {
        return null;
    }

    return inMillions ? Math.round(parsed * 1_000_000) : Math.round(parsed);
}

export function parsePointDeductions(text: string): { points: number; raw: string }[] {
    const results: { points: number; raw: string }[] = [];
    const regex = new RegExp(POINT_DEDUCTION_REGEX.source, POINT_DEDUCTION_REGEX.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
        const points = Number(match[1]);

        if (Number.isFinite(points)) {
            results.push({ points, raw: match[0] });
        }
    }

    return results;
}

export function hasAmendmentLanguage(text: string): boolean {
    return AMENDMENT_VERB_REGEX.test(text);
}

export function extractBehaviorTokens(text: string): Set<string> {
    const stripped = normalizeText(text)
        .replace(/phat tien tu [\d.,\s]+(trieu )?dong den [\d.,\s]+(trieu )?dong/g, " ")
        .replace(/tru -?\d+ diem giay phep lai xe/g, " ")
        .replace(/[^a-z0-9\s]/g, " ");

    const tokens = stripped
        .split(/\s+/)
        .filter((token) => token.length >= 2 && !/^\d+$/.test(token) && !STOPWORDS.has(token));

    return new Set(tokens);
}

export function computeJaccardSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) {
        return 0;
    }

    let intersection = 0;

    for (const token of a) {
        if (b.has(token)) {
            intersection += 1;
        }
    }

    const union = a.size + b.size - intersection;

    return union === 0 ? 0 : intersection / union;
}

export function isValidIsoDate(value: string | null): value is string {
    if (!value) {
        return false;
    }

    return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}
