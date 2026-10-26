/** SRS §4.7 effect taxonomy. Procedural holds (tạm giữ) are never effects. */
export type SanctionEffectType = "LICENSE_SUSPENSION" | "LICENSE_POINT_DEDUCTION" | "VEHICLE_CONFISCATION" | "OTHER";

export type DurationUnit = "MONTH" | "DAY";

export type ParsedEffect = {
    effectType: SanctionEffectType;
    durationMin: number | null;
    durationMax: number | null;
    durationUnit: DurationUnit | null;
    points: number | null;
    rawText: string;
};

/** One fine range and who it applies to; a clause may set different ranges for individuals and organizations. */
export type FineRange = {
    min: number;
    max: number;
    subject: "INDIVIDUAL" | "ORGANIZATION" | null;
};

const MONEY = "(\\d{1,3}(?:[.,]\\d{3})+|\\d+)\\s*đồng";
const FINE_RANGE = new RegExp(`từ\\s+${MONEY}\\s+đến\\s+${MONEY}`, "giu");
const SINGLE_FINE = new RegExp(`phạt\\s+tiền\\s+${MONEY}`, "iu");
const FINE_INTRO = /phạt\s+tiền/iu;
const SUBJECT_AFTER_RANGE = /^\s*(?:đối\s+với\s+)?(cá nhân|tổ chức)/iu;
const WARNING = /phạt\s+cảnh\s+cáo/iu;
const LICENSE_SUSPENSION = /tước\s+quyền\s+sử\s+dụng\s+(?:giấy\s+phép|chứng\s+chỉ)[^.;]*?(?:từ\s+(\d{1,2})\s+tháng\s+đến\s+(\d{1,2})\s+tháng|(\d{1,2})\s+tháng)/iu;
const LICENSE_SUSPENSION_NO_DURATION = /tước\s+quyền\s+sử\s+dụng\s+(?:giấy\s+phép|chứng\s+chỉ)/iu;
const POINT_DEDUCTION = /trừ\s+(?:điểm\s+giấy\s+phép\s+lái\s+xe\s+(\d{1,2})\s+điểm|(\d{1,2})\s+điểm\s+giấy\s+phép\s+lái\s+xe)/iu;
const VEHICLE_CONFISCATION = /tịch\s+thu\s+phương\s+tiện/iu;
const EXHIBIT_CONFISCATION = /tịch\s+thu\s+tang\s+vật/iu;
const REMEDIAL = /(?<![\p{L}])buộc\s+[^.;]+/giu;
const SENTENCE_END = /;|\.(?=\s|$)/gu;

/** Reads the fine ranges of a clause ("Phạt tiền từ 400.000 đồng đến 600.000 đồng …"); empty when it sets none. */
export function parseFines(text: string): FineRange[] {
    if (!FINE_INTRO.test(text)) {
        return [];
    }

    const ranges: FineRange[] = [];

    for (const match of text.matchAll(FINE_RANGE)) {
        const after = text.slice(match.index + match[0].length);
        const subject = SUBJECT_AFTER_RANGE.exec(after)?.[1]?.toLowerCase();

        ranges.push({
            min: toAmount(match[1]),
            max: toAmount(match[2]),
            subject: subject === "cá nhân" ? "INDIVIDUAL" : subject === "tổ chức" ? "ORGANIZATION" : null,
        });
    }

    if (ranges.length > 0) {
        return ranges;
    }

    const single = SINGLE_FINE.exec(text);

    if (!single) {
        return [];
    }

    const amount = toAmount(single[1]);

    return [{ min: amount, max: amount, subject: null }];
}

export function allowsWarning(text: string): boolean {
    return WARNING.test(text);
}

/** Typed additional sanctions named in a text (FR-09); a "tạm giữ" sentence is procedural and yields nothing. */
export function parseEffects(text: string): ParsedEffect[] {
    const effects: ParsedEffect[] = [];
    const suspension = LICENSE_SUSPENSION.exec(text);

    if (suspension) {
        const min = Number(suspension[1] ?? suspension[3]);
        const max = Number(suspension[2] ?? suspension[3]);

        effects.push({ effectType: "LICENSE_SUSPENSION", durationMin: min, durationMax: max, durationUnit: "MONTH", points: null, rawText: suspension[0].trim() });
    } else if (LICENSE_SUSPENSION_NO_DURATION.test(text)) {
        effects.push({ effectType: "LICENSE_SUSPENSION", durationMin: null, durationMax: null, durationUnit: null, points: null, rawText: sentenceAround(text, LICENSE_SUSPENSION_NO_DURATION) });
    }

    const deduction = POINT_DEDUCTION.exec(text);

    if (deduction) {
        effects.push({
            effectType: "LICENSE_POINT_DEDUCTION",
            durationMin: null,
            durationMax: null,
            durationUnit: null,
            points: Number(deduction[1] ?? deduction[2]),
            rawText: deduction[0].trim(),
        });
    }

    // "tạm giữ phương tiện" is a procedural hold and never matches "tịch thu".
    if (VEHICLE_CONFISCATION.test(text)) {
        effects.push({ effectType: "VEHICLE_CONFISCATION", durationMin: null, durationMax: null, durationUnit: null, points: null, rawText: sentenceAround(text, VEHICLE_CONFISCATION) });
    }

    if (EXHIBIT_CONFISCATION.test(text)) {
        effects.push({ effectType: "OTHER", durationMin: null, durationMax: null, durationUnit: null, points: null, rawText: sentenceAround(text, EXHIBIT_CONFISCATION) });
    }

    return effects;
}

/** Remedial measures ("buộc khôi phục lại tình trạng ban đầu …"), kept as their legal wording. */
export function parseRemedialMeasures(text: string): string[] {
    return [...text.matchAll(REMEDIAL)].map((match) => match[0].trim());
}

function sentenceAround(text: string, pattern: RegExp): string {
    const match = pattern.exec(text);

    if (!match) {
        return text.trim();
    }

    const start = Math.max(text.lastIndexOf(";", match.index), text.lastIndexOf(":", match.index)) + 1;
    let end = text.length;

    for (const boundary of text.matchAll(SENTENCE_END)) {
        if (boundary.index >= match.index + match[0].length) {
            end = boundary.index;

            break;
        }
    }

    return text.slice(start, end).trim();
}

function toAmount(raw: string): number {
    return Number(raw.replace(/[.,]/g, ""));
}
