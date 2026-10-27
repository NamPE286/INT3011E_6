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
    const defaultModel = models.find((model) => model.id === configuredDefault)?.id ?? models[0]?.id ?? "";

    return { defaultModel, models };
}

function parseModelOption(row: Record<string, unknown>): ModelOption | null {
    const id = readString(row, "id");

    return id ? { id, label: readString(row, "label") ?? id } : null;
}
