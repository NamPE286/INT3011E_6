import { isRecord, readRows, readString } from "./read";

export type ModelOption = {
    id: string;
    label: string;
};

export type ModelOptions = {
    defaultModel: string;
    models: ModelOption[];
};

export function parseModelOptions(value: unknown): ModelOptions | null {
    if (!isRecord(value)) {
        return null;
    }

    const models = readRows(value, "models", parseModelOption);
    const configuredDefault = readString(value, "default");

    if (configuredDefault && !models.some((model) => model.id === configuredDefault)) {
        // The deployment's model is not one a client may request: an empty id sends no model, so the server uses it.
        return { defaultModel: "", models: [{ id: "", label: `Mặc định (${configuredDefault})` }, ...models] };
    }

    return { defaultModel: configuredDefault ?? models[0]?.id ?? "", models };
}

function parseModelOption(row: Record<string, unknown>): ModelOption | null {
    const id = readString(row, "id");

    return id ? { id, label: readString(row, "label") ?? id } : null;
}
