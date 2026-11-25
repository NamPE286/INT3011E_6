import { Elysia } from "elysia";
import { extractEnvFromRequest } from "../../plugins/context";
import { resolveWorkspaceAccess } from "../workspaces/workspace.service";
import { getRelationGraph } from "./graph.service";

export const graphModule = new Elysia({ prefix: "/api" }).get("/graph", async ({ set, request }) => {
    const env = extractEnvFromRequest(request);

    if (!env?.DB) {
        set.status = 503;

        return { message: "Database service unavailable" };
    }

    const access = await resolveWorkspaceAccess(env, request);

    if (!access.ok) {
        set.status = access.status;

        return { message: access.message };
    }

    return getRelationGraph(env.DB, access.workspaceId);
});
