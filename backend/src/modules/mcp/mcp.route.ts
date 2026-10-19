import { Elysia } from "elysia";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { extractEnvFromRequest } from "../../plugins/context";
import { DocumentRepository } from "../documents/document.repository";
import { DocumentService } from "../documents/document.service";
import { VocabularyRepository } from "../vocabulary/vocabulary.repository";
import { VocabularyService } from "../vocabulary/vocabulary.service";
import { validateInternalMcpAuth, validateInternalMcpWriteAuth } from "./mcp.auth";
import { createLegalMcpServer } from "./mcp.server";

export const mcpModule = new Elysia({ name: "mcp" })
    .all("/mcp", async ({ request, body, set }) => {
        const env = extractEnvFromRequest(request);

        const authResult = validateInternalMcpAuth(request, env?.INTERNAL_MCP_TOKEN);
        if (!authResult.authorized) {
            set.status = 401;
            return {
                jsonrpc: "2.0",
                error: {
                    code: -32000,
                    message: authResult.reason ?? "Unauthorized",
                },
                id: null,
            };
        }

        if (!env?.DB) {
            set.status = 503;
            return {
                jsonrpc: "2.0",
                error: {
                    code: -32000,
                    message: "Database is unavailable",
                },
                id: null,
            };
        }

        const writeAuthResult = validateInternalMcpWriteAuth(request, env);

        const repository = new VocabularyRepository(env.DB);
        const service = new VocabularyService(repository);
        const documentRepository = new DocumentRepository(env.DB);
        const documentService = new DocumentService(documentRepository);

        const server = createLegalMcpServer(
            service,
            documentService,
            {
                canWrite: writeAuthResult.authorized,
                writeAuthReason: writeAuthResult.reason,
            }
        );

        const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        });

        await server.connect(transport);

        const headers = new Headers(request.headers);
        const currentAccept = headers.get("accept");
        if (!currentAccept || !currentAccept.includes("text/event-stream")) {
            headers.set("accept", "application/json, text/event-stream");
        }

        const adaptedRequest = new Request(request.url, {
            method: request.method,
            headers,
        });

        const isBodyless = request.method === "GET" || request.method === "HEAD";
        const handleOptions = isBodyless ? undefined : { parsedBody: body };

        const response = await transport.handleRequest(adaptedRequest, handleOptions);

        return response;
    });
