import { beforeEach, describe, expect, it } from "bun:test";
import type { D1Database } from "@cloudflare/workers-types";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { app } from "../src/app";
import { VocabularyRepository } from "../src/modules/vocabulary/vocabulary.repository";
import type { VocabSnapshotResponse } from "../src/modules/vocabulary/vocabulary.types";
import type { Env } from "../src/types/env";
import { createTestD1Database } from "./d1-test-db";
import { createMockEnv } from "./mocks";

const TEST_MCP_TOKEN = "secret-mcp-token-test-12345";

describe("MCP Streamable HTTP /mcp route", () => {
    let testDb: D1Database;
    let repository: VocabularyRepository;
    let mockEnv: Env;

    beforeEach(() => {
        testDb = createTestD1Database();
        repository = new VocabularyRepository(testDb);

        const baseMock = createMockEnv();
        mockEnv = {
            ...baseMock,
            DB: testDb,
            INTERNAL_MCP_TOKEN: TEST_MCP_TOKEN,
        };
    });

    function createMcpRequest(
        body: Record<string, unknown> | null,
        headers: Record<string, string> = {},
        envOverride?: Env
    ): Request {
        const reqHeaders = new Headers({
            "Content-Type": "application/json",
            ...headers,
        });

        const req = new Request("http://localhost/mcp", {
            method: body ? "POST" : "GET",
            headers: reqHeaders,
            body: body ? JSON.stringify(body) : undefined,
        });

        (req as unknown as { env: unknown }).env = envOverride ?? mockEnv;

        return req;
    }

    describe("Authentication (Fail Closed)", () => {
        it("rejects with 401 when INTERNAL_MCP_TOKEN is not configured in env (fail closed)", async () => {
            const envWithoutToken: Env = {
                ...mockEnv,
                INTERNAL_MCP_TOKEN: undefined,
            };

            const req = createMcpRequest(
                { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
                { "X-Internal-MCP-Token": TEST_MCP_TOKEN },
                envWithoutToken
            );

            const res = await app.handle(req);
            expect(res.status).toBe(401);

            const body = (await res.json()) as { error?: { message: string } };
            expect(body.error?.message).toContain("fail closed");
        });

        it("rejects with 401 when no token header is provided", async () => {
            const req = createMcpRequest({
                jsonrpc: "2.0",
                id: 1,
                method: "tools/list",
                params: {},
            });

            const res = await app.handle(req);
            expect(res.status).toBe(401);
        });

        it("rejects with 401 when token header has incorrect value", async () => {
            const req = createMcpRequest(
                { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
                { "X-Internal-MCP-Token": "invalid-token" }
            );

            const res = await app.handle(req);
            expect(res.status).toBe(401);
        });

        it("rejects with 401 when Bearer token is invalid", async () => {
            const req = createMcpRequest(
                { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
                { Authorization: "Bearer wrong-token" }
            );

            const res = await app.handle(req);
            expect(res.status).toBe(401);
        });

        it("accepts request with valid X-Internal-MCP-Token header", async () => {
            const req = createMcpRequest(
                { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
                { "X-Internal-MCP-Token": TEST_MCP_TOKEN }
            );

            const res = await app.handle(req);
            expect(res.status).toBe(200);
        });

        it("accepts request with valid X-Internal-Token header (legacy fallback)", async () => {
            const req = createMcpRequest(
                { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
                { "X-Internal-Token": TEST_MCP_TOKEN }
            );

            const res = await app.handle(req);
            expect(res.status).toBe(200);
        });

        it("accepts request with valid Authorization Bearer header", async () => {
            const req = createMcpRequest(
                { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
                { Authorization: `Bearer ${TEST_MCP_TOKEN}` }
            );

            const res = await app.handle(req);
            expect(res.status).toBe(200);
        });
    });

    describe("Database Availability", () => {
        it("returns 503 when D1 database is missing from env", async () => {
            const envWithoutDb = {
                ...mockEnv,
                DB: undefined as unknown as D1Database,
            };

            const req = createMcpRequest(
                { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
                { "X-Internal-MCP-Token": TEST_MCP_TOKEN },
                envWithoutDb
            );

            const res = await app.handle(req);
            expect(res.status).toBe(503);

            const body = (await res.json()) as { error?: { message: string } };
            expect(body.error?.message).toContain("Database is unavailable");
        });
    });

    describe("MCP Protocol Methods (JSON-RPC 2.0)", () => {
        it("handles MCP initialize method", async () => {
            const req = createMcpRequest(
                {
                    jsonrpc: "2.0",
                    id: 10,
                    method: "initialize",
                    params: {
                        protocolVersion: "2024-11-05",
                        capabilities: {},
                        clientInfo: { name: "test-client", version: "1.0.0" },
                    },
                },
                { "X-Internal-MCP-Token": TEST_MCP_TOKEN }
            );

            const res = await app.handle(req);
            expect(res.status).toBe(200);

            const body = (await res.json()) as {
                result?: {
                    protocolVersion: string;
                    serverInfo: { name: string; version: string };
                };
            };

            expect(body.result?.serverInfo?.name).toBe("legal-mcp-server");
            expect(body.result?.protocolVersion).toBe("2024-11-05");
        });

        it("handles tools/list method and includes get_vocab_snapshot", async () => {
            const req = createMcpRequest(
                {
                    jsonrpc: "2.0",
                    id: 20,
                    method: "tools/list",
                    params: {},
                },
                { "X-Internal-MCP-Token": TEST_MCP_TOKEN }
            );

            const res = await app.handle(req);
            expect(res.status).toBe(200);

            const body = (await res.json()) as {
                result?: {
                    tools: Array<{
                        name: string;
                        description: string;
                        inputSchema: Record<string, unknown>;
                    }>;
                };
            };

            const tools = body.result?.tools ?? [];
            const snapshotTool = tools.find((t) => t.name === "get_vocab_snapshot");

            expect(snapshotTool).toBeDefined();
            expect(snapshotTool?.description).toContain("vocabulary snapshot");
        });

        it("executes tools/call for get_vocab_snapshot and returns full snapshot with status OK", async () => {
            await repository.insertEntry({
                canonical_id: "ACT_001",
                type: "ACTION",
                canonical_label: "vượt tốc độ",
                aliases: ["chạy quá tốc độ"],
            });

            await repository.insertEntry({
                canonical_id: "VEH_001",
                type: "VEHICLE",
                canonical_label: "xe máy",
                aliases: ["mô tô"],
            });

            const req = createMcpRequest(
                {
                    jsonrpc: "2.0",
                    id: 30,
                    method: "tools/call",
                    params: {
                        name: "get_vocab_snapshot",
                        arguments: {},
                    },
                },
                { "X-Internal-MCP-Token": TEST_MCP_TOKEN }
            );

            const res = await app.handle(req);
            expect(res.status).toBe(200);

            const body = (await res.json()) as {
                result?: {
                    content: Array<{ type: string; text: string }>;
                };
            };

            const contentText = body.result?.content?.[0]?.text;
            expect(contentText).toBeDefined();

            const parsed = JSON.parse(contentText!) as VocabSnapshotResponse;

            expect(parsed.status).toBe("OK");
            expect(parsed.not_modified).toBe(false);
            expect(parsed.vocabulary_version).toBe(1);
            expect(parsed.entries.length).toBe(2);
            expect(parsed.entries[0].canonical_id).toBe("ACT_001");
            expect(parsed.entries[1].canonical_id).toBe("VEH_001");
        });

        it("executes tools/call with matching version and returns status NOT_MODIFIED and empty entries (cache hit)", async () => {
            await repository.insertEntry({
                canonical_id: "ACT_001",
                type: "ACTION",
                canonical_label: "dừng xe trái phép",
                aliases: [],
            });

            const req = createMcpRequest(
                {
                    jsonrpc: "2.0",
                    id: 31,
                    method: "tools/call",
                    params: {
                        name: "get_vocab_snapshot",
                        arguments: {
                            version: 1,
                        },
                    },
                },
                { "X-Internal-MCP-Token": TEST_MCP_TOKEN }
            );

            const res = await app.handle(req);
            expect(res.status).toBe(200);

            const body = (await res.json()) as {
                result?: {
                    content: Array<{ type: string; text: string }>;
                };
            };

            const contentText = body.result?.content?.[0]?.text;
            const parsed = JSON.parse(contentText!) as VocabSnapshotResponse;

            expect(parsed.status).toBe("NOT_MODIFIED");
            expect(parsed.not_modified).toBe(true);
            expect(parsed.vocabulary_version).toBe(1);
            expect(parsed.entries).toEqual([]);
        });

        it("returns error for unknown tool call", async () => {
            const req = createMcpRequest(
                {
                    jsonrpc: "2.0",
                    id: 40,
                    method: "tools/call",
                    params: {
                        name: "unknown_tool",
                        arguments: {},
                    },
                },
                { "X-Internal-MCP-Token": TEST_MCP_TOKEN }
            );

            const res = await app.handle(req);
            expect(res.status).toBe(200);

            const body = (await res.json()) as {
                result?: {
                    isError?: boolean;
                };
                error?: {
                    message: string;
                };
            };

            const isErrorResult = body.result?.isError === true || body.error !== undefined;
            expect(isErrorResult).toBe(true);
        });
    });

    describe("Official MCP Client SDK Protocol Integration", () => {
        it("connects via official StreamableHTTPClientTransport, lists tools, and invokes get_vocab_snapshot", async () => {
            await repository.insertEntry({
                canonical_id: "SUB_001",
                type: "SUBJECT",
                canonical_label: "người điều khiển phương tiện",
                aliases: ["tài xế", "người lái xe"],
            });

            const client = new Client(
                { name: "official-sdk-test-client", version: "1.0.0" },
                { capabilities: {} }
            );

            const transport = new StreamableHTTPClientTransport(
                new URL("http://localhost/mcp"),
                {
                    requestInit: {
                        headers: {
                            "X-Internal-MCP-Token": TEST_MCP_TOKEN,
                        },
                    },
                    fetch: async (url, init) => {
                        const req = new Request(url, init);
                        (req as unknown as { env: unknown }).env = mockEnv;
                        return app.handle(req);
                    },
                }
            );

            await client.connect(transport);

            const toolsList = await client.listTools();
            const toolNames = toolsList.tools.map((t) => t.name);
            expect(toolNames).toContain("get_vocab_snapshot");

            const toolResult = await client.callTool({
                name: "get_vocab_snapshot",
                arguments: {},
            });

            expect(toolResult.isError).toBeFalsy();
            const contents = toolResult.content as Array<{ type: string; text?: string }>;
            const firstContent = contents[0];
            expect(firstContent?.type).toBe("text");

            if (firstContent?.type === "text" && typeof firstContent.text === "string") {
                const snapshot = JSON.parse(firstContent.text) as VocabSnapshotResponse;
                expect(snapshot.status).toBe("OK");
                expect(snapshot.not_modified).toBe(false);
                expect(snapshot.entries.length).toBe(1);
                expect(snapshot.entries[0].canonical_id).toBe("SUB_001");
                expect(snapshot.entries[0].aliases).toEqual(["người lái xe", "tài xế"]);
            }

            const cachedResult = await client.callTool({
                name: "get_vocab_snapshot",
                arguments: {
                    version: 1,
                },
            });

            const cachedContents = cachedResult.content as Array<{ type: string; text?: string }>;
            const cachedContent = cachedContents[0];
            if (cachedContent?.type === "text" && typeof cachedContent.text === "string") {
                const cachedSnapshot = JSON.parse(cachedContent.text) as VocabSnapshotResponse;
                expect(cachedSnapshot.status).toBe("NOT_MODIFIED");
                expect(cachedSnapshot.not_modified).toBe(true);
                expect(cachedSnapshot.entries).toEqual([]);
            }

            await client.close();
        });
    });
});
