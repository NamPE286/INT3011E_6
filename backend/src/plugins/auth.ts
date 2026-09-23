import { Elysia } from "elysia";

export const authPlugin = new Elysia({ name: "auth" })
    .derive({ as: "scoped" }, () => {
        // TODO: Implement real token/session verification here later (e.g., JWT or session lookup).
        return {
            user: null,
        };
    });

