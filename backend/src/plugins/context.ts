import { Elysia } from "elysia";
import type { Env } from "../types/env";

function isEnv(value: unknown): value is Env {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return (
        "DB" in candidate &&
        "FILE_STORAGE" in candidate &&
        "PROCESSING_QUEUE" in candidate
    );
}

export function extractEnvFromRequest(request: Request): Env | undefined {
    const customRequest = request as unknown as { env?: unknown };
    if (isEnv(customRequest.env)) {
        return customRequest.env;
    }
    return undefined;
}

export const contextPlugin = new Elysia({ name: "context" })
    .derive({ as: "scoped" }, ({ request }) => {
        const env = extractEnvFromRequest(request);
        return {
            env,
        };
    });

