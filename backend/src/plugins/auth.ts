import { Elysia } from "elysia";
import { createAuth } from "../modules/auth/auth";
import type { Env } from "../types/env";

export type AuthenticatedUser = {
    id: string;
    email: string;
    name: string;
};

export type SessionContext = {
    user: AuthenticatedUser;
    sessionId: string;
};

/** Resolves the current Better Auth session from request cookies/headers, or null when unauthenticated. */
export async function getAuthSession(env: Env, request: Request): Promise<SessionContext | null> {
    try {
        const auth = createAuth(env, request.url);
        const result = await auth.api.getSession({
            headers: request.headers,
        });

        if (!result?.user || !result?.session) {
            return null;
        }

        return {
            user: {
                id: result.user.id,
                email: result.user.email,
                name: result.user.name,
            },
            sessionId: result.session.id,
        };
    } catch {
        return null;
    }
}

export const authPlugin = new Elysia({ name: "auth" }).derive({ as: "scoped" }, () => {
    return {
        user: null as AuthenticatedUser | null,
    };
});
