import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createDatabase } from "../../db/client";
import { account, session, user, verification } from "../../db/schema";
import type { Env } from "../../types/env";

const DEV_FALLBACK_SECRET = "dev-only-better-auth-secret-please-set-in-prod-32chars";
const DEFAULT_TRUSTED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://localhost:8787",
    "http://127.0.0.1:8787",
];

function resolveBaseUrl(env: Env, requestUrl?: string): string {
    const configured = env.BETTER_AUTH_URL?.trim();

    if (configured) {
        return configured.replace(/\/+$/, "");
    }

    if (requestUrl) {
        try {
            return new URL(requestUrl).origin;
        } catch {
            // Fall back to default local worker origin below.
        }
    }

    return "http://localhost:8787";
}

function resolveTrustedOrigins(env: Env, requestUrl?: string): string[] {
    const origins = new Set<string>(DEFAULT_TRUSTED_ORIGINS);
    const configured = env.TRUSTED_ORIGINS?.trim();

    if (configured) {
        for (const origin of configured.split(",")) {
            const trimmed = origin.trim();

            if (trimmed) {
                origins.add(trimmed.replace(/\/+$/, ""));
            }
        }
    }

    if (requestUrl) {
        try {
            origins.add(new URL(requestUrl).origin);
        } catch {
            // Ignore malformed request URLs.
        }
    }

    return [...origins];
}

/** Creates a per-request Better Auth instance backed by the Worker's D1 binding via Drizzle. */
export function createAuth(env: Env, requestUrl?: string) {
    const db = createDatabase(env.DB);
    const baseURL = resolveBaseUrl(env, requestUrl);
    const isHttps = baseURL.startsWith("https://");

    return betterAuth({
        database: drizzleAdapter(db, {
            provider: "sqlite",
            schema: {
                user,
                session,
                account,
                verification,
            },
        }),
        secret: env.BETTER_AUTH_SECRET?.trim() || DEV_FALLBACK_SECRET,
        baseURL,
        basePath: "/api/auth",
        trustedOrigins: resolveTrustedOrigins(env, requestUrl),
        emailAndPassword: {
            enabled: true,
            autoSignIn: true,
            minPasswordLength: 6,
        },
        advanced: {
            defaultCookieAttributes: {
                sameSite: isHttps ? "none" : "lax",
                secure: isHttps,
                httpOnly: true,
                path: "/",
            },
        },
    });
}
