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

export function levenshteinDistance(a: string, b: string): number {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }

    return matrix[b.length][a.length];
}

export function tokenDiceSimilarity(a: string, b: string): number {
    const tokensA = normalizeText(a).split(" ").filter(Boolean);
    const tokensB = normalizeText(b).split(" ").filter(Boolean);

    if (tokensA.length === 0 || tokensB.length === 0) {
        return 0;
    }

    const setB = new Set(tokensB);
    let intersection = 0;

    for (const token of tokensA) {
        if (setB.has(token)) {
            intersection++;
        }
    }

    return (2 * intersection) / (tokensA.length + tokensB.length);
}

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

    const maxLen = Math.max(normA.length, normB.length);
    const levDistance = levenshteinDistance(normA, normB);
    const levSim = maxLen === 0 ? 1 : 1 - levDistance / maxLen;

    const tokenSim = tokenDiceSimilarity(normA, normB);
    const unaccentTokenSim = tokenDiceSimilarity(unaccentA, unaccentB);

    return Math.max(levSim, tokenSim, unaccentTokenSim);
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
