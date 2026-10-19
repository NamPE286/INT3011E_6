import type { Env } from "../../types/env";

export type McpAccess =
    | { authorized: true; canWrite: boolean }
    | { authorized: false; reason: string };

/**
 * One token per role: INTERNAL_MCP_TOKEN may call read tools, INTERNAL_MCP_WRITE_TOKEN may also call add_vocab.
 * Both fail closed: no read token means no access, no write token means nobody can write.
 */
export function resolveMcpAccess(request: Request, env: Env | undefined): McpAccess {
    const readToken = env?.INTERNAL_MCP_TOKEN?.trim();

    if (!readToken) {
        return { authorized: false, reason: "Unauthorized: Internal MCP token is not configured (fail closed)" };
    }

    const presentedToken = readPresentedToken(request);

    if (!presentedToken) {
        return { authorized: false, reason: "Unauthorized: Invalid or missing internal MCP token" };
    }

    const writeToken = env?.INTERNAL_MCP_WRITE_TOKEN?.trim();

    if (writeToken && constantTimeEqual(presentedToken, writeToken)) {
        return { authorized: true, canWrite: true };
    }

    if (constantTimeEqual(presentedToken, readToken)) {
        return { authorized: true, canWrite: false };
    }

    return { authorized: false, reason: "Unauthorized: Invalid or missing internal MCP token" };
}

function readPresentedToken(request: Request): string | null {
    const authorization = request.headers.get("authorization");

    if (authorization?.startsWith("Bearer ")) {
        return authorization.slice("Bearer ".length).trim() || null;
    }

    return request.headers.get("x-internal-mcp-token")?.trim() || null;
}

function constantTimeEqual(presented: string, expected: string): boolean {
    const presentedBytes = new TextEncoder().encode(presented);
    const expectedBytes = new TextEncoder().encode(expected);
    let difference = presentedBytes.length ^ expectedBytes.length;

    for (let index = 0; index < expectedBytes.length; index++) {
        difference |= (presentedBytes[index] ?? 0) ^ expectedBytes[index];
    }

    return difference === 0;
}
