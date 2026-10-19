import { Elysia } from "elysia";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { extractEnvFromRequest } from "../../plugins/context";
import { DocumentRepository } from "../documents/document.repository";
import { DocumentService } from "../documents/document.service";
import { VocabularyRepository } from "../vocabulary/vocabulary.repository";
import { VocabularyService } from "../vocabulary/vocabulary.service";
import { resolveMcpAccess } from "./mcp.auth";
import { createLegalMcpServer } from "./mcp.server";

function jsonRpcError(message: string) {
    return {
        jsonrpc: "2.0",
        error: { code: -32000, message },
        id: null,
    };
}

/** Stateless Streamable HTTP endpoint: each request gets its own server bound to the caller's access level. */
export const mcpModule = new Elysia({ name: "mcp" })
    .all("/mcp", async ({ request, body, set }) => {
        const env = extractEnvFromRequest(request);
        const access = resolveMcpAccess(request, env);

        if (!access.authorized) {
            set.status = 401;

            return jsonRpcError(access.reason);
        }

        if (!env?.DB) {
            set.status = 503;

            return jsonRpcError("Database is unavailable");
        }

        const server = createLegalMcpServer(
            new VocabularyService(new VocabularyRepository(env.DB)),
            new DocumentService(new DocumentRepository(env.DB)),
            { canWrite: access.canWrite },
        );
        const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        });

        await server.connect(transport);

        // The transport requires clients to accept both JSON and SSE; plain JSON-RPC callers often omit it.
        const headers = new Headers(request.headers);

        if (!headers.get("accept")?.includes("text/event-stream")) {
            headers.set("accept", "application/json, text/event-stream");
        }

        const adaptedRequest = new Request(request.url, { method: request.method, headers });
        const isBodyless = request.method === "GET" || request.method === "HEAD";

        return transport.handleRequest(adaptedRequest, isBodyless ? undefined : { parsedBody: body });
    });
