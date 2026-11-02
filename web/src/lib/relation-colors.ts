/** One hue per relation family, mid-tone so it reads on both the light and the dark background. */
const FAMILY_COLORS = {
    amend: "#3b82f6",
    supplement: "#16a34a",
    replace: "#ea580c",
    repeal: "#dc2626",
    basis: "#64748b",
    other: "#9333ea",
} as const;

const FAMILY_OF_TYPE: Record<string, keyof typeof FAMILY_COLORS> = {
    AMENDS: "amend",
    AMENDS_OR_SUPPLEMENTS: "amend",
    CORRECTS: "amend",
    SUPPLEMENTS: "supplement",
    REPLACES: "replace",
    PARTIALLY_REPLACES: "replace",
    FULLY_REPLACES: "replace",
    REPEALS: "repeal",
    PARTIALLY_REPEALS: "repeal",
    FULLY_REPEALS: "repeal",
    LEGAL_BASIS: "basis",
    REFERENCES: "basis",
    GUIDES: "basis",
    DETAILS: "basis",
    EXPLAINS: "basis",
};

export function relationColor(relationType: string): string {
    return FAMILY_COLORS[FAMILY_OF_TYPE[relationType] ?? "other"];
}
