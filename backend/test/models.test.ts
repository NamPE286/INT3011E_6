import { describe, expect, it } from "bun:test";
import { app } from "../src/app";
import { SELECTABLE_MODELS, resolveModel } from "../src/modules/llm/models";
import { createTestD1Database } from "./d1-test-db";
import { createMockEnv, withEnv } from "./mocks";

describe("resolveModel", () => {
    it("offers Gemini 4 Hydrogen next to the default model", () => {
        expect(SELECTABLE_MODELS.map((model) => model.id)).toContain("gemini-4-hydrogen");
    });

    it("uses the requested model when it is selectable", () => {
        expect(resolveModel("gemini-4-hydrogen", "gemini-3.5-flash-lite")).toEqual({ ok: true, model: "gemini-4-hydrogen" });
    });

    it("falls back to the configured model, then to the built-in default", () => {
        expect(resolveModel(undefined, "custom-model")).toEqual({ ok: true, model: "custom-model" });
        expect(resolveModel("  ", undefined)).toEqual({ ok: true, model: "gemini-3.5-flash-lite" });
    });

    it("rejects a model that is not selectable", () => {
        expect(resolveModel("gpt-0-evil", undefined)).toEqual({ ok: false });
    });
});

describe("model switcher API", () => {
    it("lists the selectable models and the default", async () => {
        const env = createMockEnv();
        const response = await app.fetch(withEnv(new Request("http://localhost/api/models"), env));
        const body = (await response.json()) as { default: string; models: { id: string }[] };

        expect(response.status).toBe(200);
        expect(body.default).toBe("gemini-3.5-flash-lite");
        expect(body.models.map((model) => model.id)).toContain("gemini-4-hydrogen");
    });

    it("rejects an unknown model on /api/ask", async () => {
        const env = createMockEnv({ DB: createTestD1Database({ seedSampleDocument: false }) });
        const response = await app.fetch(
            withEnv(
                new Request("http://localhost/api/ask", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ question: "Vượt đèn đỏ phạt bao nhiêu?", model: "gpt-0-evil" }),
                }),
                env
            )
        );

        expect(response.status).toBe(400);
    });
});
