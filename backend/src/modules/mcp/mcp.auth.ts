import type { Env } from "../../types/env";

export interface AuthValidationResult {
    authorized: boolean;
    reason?: string;
}

export function validateInternalMcpAuth(
    request: Request,
    configuredToken?: string
): AuthValidationResult {
    if (!configuredToken || configuredToken.trim() === "") {
        return {
            authorized: false,
            reason: "Unauthorized: Internal MCP token is not configured (fail closed)",
        };
    }

    const expectedToken = configuredToken.trim();

    const internalMcpHeader = request.headers.get("x-internal-mcp-token");
    if (internalMcpHeader && internalMcpHeader.trim() === expectedToken) {
        return { authorized: true };
    }

    const legacyInternalHeader = request.headers.get("x-internal-token");
    if (legacyInternalHeader && legacyInternalHeader.trim() === expectedToken) {
        return { authorized: true };
    }

    const authHeader = request.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
        const bearerToken = authHeader.slice(7).trim();
        if (bearerToken === expectedToken) {
            return { authorized: true };
        }
    }

    return {
        authorized: false,
        reason: "Unauthorized: Invalid or missing internal MCP token",
    };
}

export function validateInternalMcpWriteAuth(
    request: Request,
    env?: Env
): AuthValidationResult {
    // 1. Explicit read-only role or scope header always denies write
    const roleHeader = request.headers.get("x-mcp-role")?.toLowerCase();
    const scopeHeader = request.headers.get("x-mcp-scope")?.toLowerCase();

    if (
        roleHeader === "read" ||
        roleHeader === "readonly" ||
        roleHeader === "read-only" ||
        scopeHeader === "read" ||
        scopeHeader === "readonly" ||
        scopeHeader === "read-only"
    ) {
        return {
            authorized: false,
            reason: "Forbidden: Read-only scope is not permitted to execute write tool (add_vocab)",
        };
    }

    // 2. If a dedicated INTERNAL_MCP_WRITE_TOKEN is configured in env
    if (env?.INTERNAL_MCP_WRITE_TOKEN && env.INTERNAL_MCP_WRITE_TOKEN.trim() !== "") {
        const expectedWriteToken = env.INTERNAL_MCP_WRITE_TOKEN.trim();

        const writeHeader = request.headers.get("x-internal-mcp-write-token");
        if (writeHeader && writeHeader.trim() === expectedWriteToken) {
            return { authorized: true };
        }

        const generalHeader = request.headers.get("x-internal-mcp-token");
        if (generalHeader && generalHeader.trim() === expectedWriteToken) {
            return { authorized: true };
        }

        const authHeader = request.headers.get("authorization");
        if (authHeader && authHeader.startsWith("Bearer ")) {
            const bearerToken = authHeader.slice(7).trim();
            if (bearerToken === expectedWriteToken) {
                return { authorized: true };
            }
        }

        return {
            authorized: false,
            reason: "Forbidden: Invalid or missing write token for add_vocab",
        };
    }

    // 3. Fallback to general internal MCP token validation
    return validateInternalMcpAuth(request, env?.INTERNAL_MCP_TOKEN);
}
