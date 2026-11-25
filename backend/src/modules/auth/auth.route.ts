import { Elysia } from "elysia";
import { extractEnvFromRequest } from "../../plugins/context";
import { createAuth } from "./auth";

function toAuthRequest(request: Request, parsedBody: unknown): Request {
    if (request.method === "GET" || request.method === "HEAD" || !request.bodyUsed) {
        return request;
    }

    const bodyText = typeof parsedBody === "string" ? parsedBody : JSON.stringify(parsedBody ?? {});
    const headers = new Headers(request.headers);

    if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
    }

    return new Request(request.url, {
        method: request.method,
        headers,
        body: bodyText,
    });
}

export const authModule = new Elysia({ name: "auth-routes" }).all(
    "/api/auth/*",
    async ({ request, body, set }) => {
        const env = extractEnvFromRequest(request);

        if (!env?.DB) {
            set.status = 503;

            return { message: "Database service unavailable" };
        }

        const auth = createAuth(env, request.url);
        const authRequest = toAuthRequest(request, body);

        return auth.handler(authRequest);
    },
);
