import { Elysia } from "elysia";
import { extractEnvFromRequest } from "../../plugins/context";
import { getRelationGraph } from "./graph.service";

export const graphModule = new Elysia({ prefix: "/api" }).get("/graph", async ({ set, request }) => {
    const env = extractEnvFromRequest(request);

    if (!env?.DB) {
        set.status = 503;

        return { message: "Database service unavailable" };
    }

    return getRelationGraph(env.DB);
});
