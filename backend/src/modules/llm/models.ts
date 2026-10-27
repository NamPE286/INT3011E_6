import { DEFAULT_OPENAI_MODEL } from "../processing/legal-llm.service";

export type SelectableModel = {
    id: string;
    label: string;
};

export const SELECTABLE_MODELS: readonly SelectableModel[] = [
    { id: DEFAULT_OPENAI_MODEL, label: "GPT 5.4" },
    { id: "gpt-6-luna", label: "GPT 6 Luna" },
];

export type ModelChoice = { ok: true; model: string } | { ok: false };

/**
 * A model asked for by a client must be one of SELECTABLE_MODELS. Without a request the deployment's
 * configured model (OPENAI_MODEL) applies, then the built-in default.
 */
export function resolveModel(requested: string | undefined, configured: string | undefined): ModelChoice {
    const requestedId = requested?.trim();

    if (requestedId) {
        return SELECTABLE_MODELS.some((model) => model.id === requestedId) ? { ok: true, model: requestedId } : { ok: false };
    }

    return { ok: true, model: configured?.trim() || DEFAULT_OPENAI_MODEL };
}
