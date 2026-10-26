import type { FineRange } from "./sanction.parser";
import type { SemanticIr, SemanticValue } from "./violation.types";

// Deterministic baseline for FR-08 dimensions. It only copies wording that is in the text; anything it
// cannot read stays null for the LLM step (or for review), it is never guessed.
const VEHICLE = /xe\s+(?:ô\s+tô|mô\s+tô|gắn\s+máy|máy\s+chuyên\s+dùng|đạp\s+máy|đạp|thô\s+sơ|cơ\s+giới|chở\s+người\s+bốn\s+bánh\s+có\s+gắn\s+động\s+cơ|chở\s+hàng\s+bốn\s+bánh\s+có\s+gắn\s+động\s+cơ)|tàu\s+hỏa|phương\s+tiện\s+giao\s+thông\s+đường\s+sắt/giu;
const SUBJECT = /người\s+điều\s+khiển(?:\s+phương\s+tiện)?|chủ\s+(?:phương\s+tiện|xe)|người\s+đi\s+bộ|người\s+ngồi\s+trên\s+xe|người\s+được\s+chở|người\s+dắt\s+(?:vật\s+nuôi|súc\s+vật)/iu;
const LOCATION = /(?:trên|tại|trong|vào)\s+(?:đường\s+cao\s+tốc|phần\s+đường[^,;.]*|làn\s+đường[^,;.]*|vỉa\s+hè|cầu|hầm\s+đường\s+bộ|đường\s+một\s+chiều|khu\s+vực[^,;.]*|nơi\s+[^,;.]*|đường\s+sắt|phạm\s+vi[^,;.]*)/iu;
const CONDITION = /(?:trong\s+trường\s+hợp|khi|mà)\s+[^,;.]+/giu;
const EXCEPTION = /trừ\s+(?:trường\s+hợp\s+)?[^;.]+/giu;
const CONSEQUENCE = /gây\s+tai\s+nạn\s+giao\s+thông|gây\s+(?:ách\s+tắc|cản\s+trở)\s+giao\s+thông/iu;
const OMISSION = /^\s*(?:không|chưa)\s/iu;

export function readHeuristicIr(
    behaviorText: string,
    articleTitle: string | null,
    fineText: string | null,
    subjectScope: FineRange["subject"],
): SemanticIr {
    const context = `${fineText ?? ""} ${articleTitle ?? ""}`;
    const action = trimClause(behaviorText);

    return {
        action: action ? { label: action, vocabId: null, evidence: action } : null,
        polarity: OMISSION.test(behaviorText) ? "OMISSION" : "ACT",
        subject: readSubject(behaviorText, context, subjectScope),
        vehicles: readVehicles(behaviorText, articleTitle),
        target: null,
        location: firstValue(behaviorText, LOCATION),
        conditions: allValues(behaviorText, CONDITION),
        exceptions: allValues(behaviorText, EXCEPTION),
        consequence: firstValue(behaviorText, CONSEQUENCE),
    };
}

/** Vehicles named by the behaviour itself win over the ones the article title covers. */
function readVehicles(behaviorText: string, articleTitle: string | null): SemanticValue[] {
    const own = allValues(behaviorText, VEHICLE);

    if (own.length > 0) {
        return own;
    }

    return allValues(articleTitle ?? "", VEHICLE);
}

function readSubject(behaviorText: string, context: string, subjectScope: FineRange["subject"]): SemanticValue | null {
    const named = firstValue(behaviorText, SUBJECT) ?? firstValue(context, SUBJECT);

    if (named) {
        return named;
    }

    if (subjectScope === "INDIVIDUAL") {
        return { label: "cá nhân", vocabId: null, evidence: "cá nhân" };
    }

    if (subjectScope === "ORGANIZATION") {
        return { label: "tổ chức", vocabId: null, evidence: "tổ chức" };
    }

    return null;
}

function firstValue(text: string, pattern: RegExp): SemanticValue | null {
    const match = new RegExp(pattern.source, pattern.flags.replace("g", "")).exec(text);

    if (!match) {
        return null;
    }

    const label = normalize(match[0]);

    return { label, vocabId: null, evidence: match[0].trim() };
}

function allValues(text: string, pattern: RegExp): SemanticValue[] {
    const values = new Map<string, SemanticValue>();

    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))) {
        const label = normalize(match[0]);

        if (!values.has(label)) {
            values.set(label, { label, vocabId: null, evidence: match[0].trim() });
        }
    }

    return [...values.values()];
}

function trimClause(text: string): string {
    return text.replace(/[;.:,\s]+$/u, "").trim();
}

function normalize(text: string): string {
    return text.replace(/\s+/g, " ").trim().toLowerCase();
}
