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

    test("offers the deployment's own model first when it is not selectable, so the default is not silently swapped", () => {
        const parsed = parseModelOptions({ default: "gpt-5-mini", models: [{ id: "gpt-6-luna", label: "GPT 6 Luna" }, { id: 5 }, "x"] });

        expect(parsed).toEqual({
            defaultModel: "",
            models: [
                { id: "", label: "Mặc định (gpt-5-mini)" },
                { id: "gpt-6-luna", label: "GPT 6 Luna" },
            ],
        });
    });

    test("falls back to the first model when no default is configured", () => {
        expect(parseModelOptions({ models: [{ id: "gpt-6-luna", label: "GPT 6 Luna" }] })?.defaultModel).toBe("gpt-6-luna");
    });

    test("rejects a response that is not an object", () => {
        expect(parseModelOptions(null)).toBeNull();
        expect(parseModelOptions([])).toBeNull();
    });
});
