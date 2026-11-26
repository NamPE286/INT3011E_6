import { findNodeAtOffset, positionAtOffset, type ParsedDraft } from "./parser";
import type { NonMonetarySanctionKind } from "./types";

export type ExtractedNonMonetarySanction = {
    kind: NonMonetarySanctionKind;
    label: string;
    minMonths: number | null;
    maxMonths: number | null;
    inverted: boolean;
    startOffset: number;
    endOffset: number;
    line: number;
    provisionRef: string | null;
};

const PRISON_RANGE = /phạt\s+tù\s+từ\s+(\d+)\s+(năm|tháng)\s+đến\s+(\d+)\s+(năm|tháng)/giu;
const LIFE_PRISON = /\btù\s+chung\s+thân\b/giu;
const DEATH_PENALTY = /\btử\s+hình\b/giu;
const NON_CUSTODIAL = /cải\s+tạo\s+không\s+giam\s+giữ(?:\s+từ\s+\d+\s+(?:tháng|năm))?(?:\s+đến\s+(\d+)\s+(năm|tháng))?/giu;
const CONFISCATION = /tịch\s+thu\s+(?:tang\s+vật(?:,\s*phương\s+tiện)?|phương\s+tiện|sung\s+quỹ)/giu;
const SUSPENSION = /(?:đình\s+chỉ\s+hoạt\s+động(?:\s+từ\s+\d+\s+(?:tháng|năm)\s+đến\s+\d+\s+(?:tháng|năm))?|cấm\s+(?:đảm\s+nhiệm\s+chức\s+vụ|hành\s+nghề)(?:\s+từ\s+\d+\s+(?:tháng|năm)\s+đến\s+\d+\s+(?:tháng|năm))?)/giu;
const WARNING_SANCTION = /\bphạt\s+cảnh\s+cáo\b/giu;

function toMonths(value: number, unit: string): number {
    return unit.toLowerCase() === "năm" ? value * 12 : value;
}

/**
 * Extracts criminal and non-monetary sanctions (imprisonment ranges, life sentence,
 * death penalty, non-custodial reform, confiscation, suspension, warning) with inverted-bound checks.
 */
export function extractNonMonetarySanctions(draft: ParsedDraft): ExtractedNonMonetarySanction[] {
    const results: ExtractedNonMonetarySanction[] = [];

    for (const match of draft.content.matchAll(PRISON_RANGE)) {
        const startOffset = match.index;
        const endOffset = startOffset + match[0].length;
        const minMonths = toMonths(Number(match[1]), match[2]);
        const maxMonths = toMonths(Number(match[3]), match[4]);
        const node = findNodeAtOffset(draft.nodes, startOffset);
        const line = positionAtOffset(draft.lineStarts, startOffset).line;

        results.push({
            kind: "IMPRISONMENT",
            label: match[0].trim(),
            minMonths,
            maxMonths,
            inverted: minMonths > maxMonths,
            startOffset,
            endOffset,
            line,
            provisionRef: node?.refLabel ?? null,
        });
    }

    const simplePatterns: readonly { kind: NonMonetarySanctionKind; regex: RegExp }[] = [
        { kind: "LIFE_IMPRISONMENT", regex: LIFE_PRISON },
        { kind: "DEATH_PENALTY", regex: DEATH_PENALTY },
        { kind: "CONFISCATION", regex: CONFISCATION },
        { kind: "SUSPENSION", regex: SUSPENSION },
        { kind: "WARNING", regex: WARNING_SANCTION },
    ];

    for (const entry of simplePatterns) {
        for (const match of draft.content.matchAll(entry.regex)) {
            const startOffset = match.index;
            const endOffset = startOffset + match[0].length;
            const node = findNodeAtOffset(draft.nodes, startOffset);
            const line = positionAtOffset(draft.lineStarts, startOffset).line;

            results.push({
                kind: entry.kind,
                label: match[0].trim(),
                minMonths: null,
                maxMonths: null,
                inverted: false,
                startOffset,
                endOffset,
                line,
                provisionRef: node?.refLabel ?? null,
            });
        }
    }

    for (const match of draft.content.matchAll(NON_CUSTODIAL)) {
        const startOffset = match.index;
        const endOffset = startOffset + match[0].length;
        const maxMonths = match[1] && match[2] ? toMonths(Number(match[1]), match[2]) : null;
        const node = findNodeAtOffset(draft.nodes, startOffset);
        const line = positionAtOffset(draft.lineStarts, startOffset).line;

        results.push({
            kind: "NON_CUSTODIAL_REFORM",
            label: match[0].trim(),
            minMonths: maxMonths !== null ? 0 : null,
            maxMonths,
            inverted: false,
            startOffset,
            endOffset,
            line,
            provisionRef: node?.refLabel ?? null,
        });
    }

    results.sort((a, b) => a.startOffset - b.startOffset);

    return results;
}
