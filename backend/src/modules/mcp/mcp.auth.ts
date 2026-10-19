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
