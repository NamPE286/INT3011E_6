import type { VocabType } from "./vocabulary.types";

export function removeVietnameseAccents(str: string): string {
    return str
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/Đ/g, "D");
}

export function normalizeText(text: string): string {
    return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Length of the longest common subsequence of two token lists. */
function commonSubsequenceLength(tokensA: string[], tokensB: string[]): number {
    let previous: number[] = new Array(tokensB.length + 1).fill(0);

    for (const tokenA of tokensA) {
        const current: number[] = [0];

        for (let index = 0; index < tokensB.length; index++) {
            current.push(tokenA === tokensB[index] ? previous[index] + 1 : Math.max(previous[index + 1], current[index]));
        }

        previous = current;
    }

    return previous[tokensB.length];
}

/**
 * How likely two labels name the same thing. Vietnamese syllables carry meaning, so labels are compared
 * syllable by syllable without diacritics: a label that only adds or drops syllables ("chạy xe quá tốc
 * độ" / "chạy quá tốc độ") is a near duplicate, while replacing a syllable with another one ("xe mô tô" /
 * "xe ô tô") names something else, however few letters change, and scores at most half.
 */
export function calculateSimilarity(a: string, b: string): number {
    const normA = normalizeText(a);
    const normB = normalizeText(b);

    if (normA === normB) {
        return 1.0;
    }

    const unaccentA = removeVietnameseAccents(normA);
    const unaccentB = removeVietnameseAccents(normB);

    if (unaccentA === unaccentB) {
        return 0.95;
    }

    const tokensA = unaccentA.split(" ").filter(Boolean);
    const tokensB = unaccentB.split(" ").filter(Boolean);

    if (tokensA.length === 0 || tokensB.length === 0) {
        return 0;
    }

    const common = commonSubsequenceLength(tokensA, tokensB);
    const overlap = (2 * common) / (tokensA.length + tokensB.length);
    const replacesSyllable = common < tokensA.length && common < tokensB.length;

    return replacesSyllable ? overlap / 2 : overlap;
}

const TYPE_PREFIXES: Record<VocabType, string> = {
    ACTION: "ACT",
    SUBJECT: "SUB",
    VEHICLE: "VEH",
    TARGET: "TARGET",
    LOCATION: "LOC",
    CONDITION: "COND",
    EXCEPTION: "EXC",
};

export function generateCanonicalId(type: VocabType, label: string): string {
    const prefix = TYPE_PREFIXES[type] ?? "VOCAB";
    const slug = removeVietnameseAccents(label)
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 36);

    return `${prefix}_${slug || "ITEM"}`;
}
