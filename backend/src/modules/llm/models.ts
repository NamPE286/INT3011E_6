export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

export type SelectableModel = {
    id: string;
    label: string;
};

export const SELECTABLE_MODELS: readonly SelectableModel[] = [
    { id: DEFAULT_GEMINI_MODEL, label: "Gemini 3.5 Flash-Lite (Free)" },
    { id: "gemini-4-hydrogen", label: "Gemini 4 Hydrogen (Free)" },
    { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite (Free)" },
];

export type ModelChoice = { ok: true; model: string } | { ok: false };

/**
 * A model asked for by a client must be one of SELECTABLE_MODELS. Without a request the deployment's
 * configured model (GEMINI_MODEL) applies, then the built-in default.
 */
export function resolveModel(requested: string | undefined, configured: string | undefined): ModelChoice {
    const requestedId = requested?.trim();

    if (requestedId) {
        return SELECTABLE_MODELS.some((model) => model.id === requestedId) ? { ok: true, model: requestedId } : { ok: false };
    }

    return { ok: true, model: configured?.trim() || DEFAULT_GEMINI_MODEL };
}
