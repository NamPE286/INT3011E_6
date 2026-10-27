import { describe, expect, test } from "bun:test";
import { parseModelOptions } from "./models";

describe("parseModelOptions", () => {
    test("reads the default model and the selectable models", () => {
        const parsed = parseModelOptions({
            default: "gpt-5.4",
            models: [
                { id: "gpt-5.4", label: "GPT 5.4" },
                { id: "gpt-6-luna", label: "GPT 6 Luna" },
            ],
        });

        expect(parsed).toEqual({
            defaultModel: "gpt-5.4",
            models: [
                { id: "gpt-5.4", label: "GPT 5.4" },
                { id: "gpt-6-luna", label: "GPT 6 Luna" },
            ],
        });
    });

    test("skips malformed models and falls back to the first one when the default is not listed", () => {
        const parsed = parseModelOptions({ default: "custom", models: [{ id: "gpt-6-luna", label: "GPT 6 Luna" }, { id: 5 }, "x"] });

        expect(parsed).toEqual({ defaultModel: "gpt-6-luna", models: [{ id: "gpt-6-luna", label: "GPT 6 Luna" }] });
    });

    test("rejects a response that is not an object", () => {
        expect(parseModelOptions(null)).toBeNull();
        expect(parseModelOptions([])).toBeNull();
    });
});
