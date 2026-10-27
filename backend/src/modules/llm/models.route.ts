import { Elysia } from "elysia";
import { extractEnvFromRequest } from "../../plugins/context";
import { SELECTABLE_MODELS, resolveModel } from "./models";

export const modelsModule = new Elysia({ prefix: "/api" }).get("/models", ({ request }) => {
    const defaultChoice = resolveModel(undefined, extractEnvFromRequest(request)?.OPENAI_MODEL);

    return { default: defaultChoice.ok ? defaultChoice.model : null, models: SELECTABLE_MODELS };
});
