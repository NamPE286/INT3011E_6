import { getModelOptions } from "$lib/api/client";
import type { ModelOptions } from "$lib/api/models";
import type { PageLoad } from "./$types";

const NO_MODEL_OPTIONS: ModelOptions = { defaultModel: "", models: [] };

export const load: PageLoad = async ({ fetch }) => {
    try {
        return { modelOptions: await getModelOptions(fetch) };
    } catch {
        // The switcher is optional: without it the backend uses its configured model.
        return { modelOptions: NO_MODEL_OPTIONS };
    }
};
