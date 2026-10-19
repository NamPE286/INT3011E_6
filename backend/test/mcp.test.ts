import { beforeEach, describe, expect, it } from "bun:test";
import type { D1Database } from "@cloudflare/workers-types";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { app } from "../src/app";
import { VocabularyRepository } from "../src/modules/vocabulary/vocabulary.repository";
import type { SearchLegalDocumentsResponse } from "../src/modules/documents/document.types";
import type { AddVocabResponse, VocabSnapshotResponse } from "../src/modules/vocabulary/vocabulary.types";
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
            const addVocabTool = tools.find((t) => t.name === "add_vocab");
            const searchDocsTool = tools.find((t) => t.name === "search_legal_documents");

            expect(snapshotTool).toBeDefined();
            expect(snapshotTool?.description).toContain("vocabulary snapshot");

            expect(addVocabTool).toBeDefined();
            expect(addVocabTool?.description).toContain("vocabulary entry");

            expect(searchDocsTool).toBeDefined();
            expect(searchDocsTool?.description).toContain("legal document candidates");
            expect(searchDocsTool?.inputSchema.properties).toHaveProperty("query");
            expect(searchDocsTool?.inputSchema.properties).toHaveProperty("document_number");
            expect(searchDocsTool?.inputSchema.properties).toHaveProperty("document_type");
            expect(searchDocsTool?.inputSchema.properties).toHaveProperty("agency");
            expect(searchDocsTool?.inputSchema.properties).toHaveProperty("issued_from");
            expect(searchDocsTool?.inputSchema.properties).toHaveProperty("issued_to");
            expect(searchDocsTool?.inputSchema.properties).toHaveProperty("limit");
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

        it("executes tools/call for add_vocab returning status CREATED and bumping version", async () => {
            const req = createMcpRequest(
                {
                    jsonrpc: "2.0",
                    id: 50,
                    method: "tools/call",
                    params: {
                        name: "add_vocab",
                        arguments: {
                            type: "ACTION",
                            canonical_label: "dừng xe trái phép",
                            aliases: ["dừng xe sai quy định"],
                            definition: "Hành vi dừng xe không đúng nơi quy định",
                            evidence: "Người điều khiển xe dừng xe không đúng nơi quy định",
                            source_provision_id: "dieu_5_khoan_2_diem_d",
                            base_vocabulary_version: 1,
                        },
                    },
                },
                { "X-Internal-MCP-Token": TEST_MCP_TOKEN }
            );

            const res = await app.handle(req);
            expect(res.status).toBe(200);

            const body = (await res.json()) as {
                result?: {
                    isError?: boolean;
                    content: Array<{ type: string; text: string }>;
                };
            };

            expect(body.result?.isError).toBeFalsy();
            const text = body.result?.content?.[0]?.text;
            expect(text).toBeDefined();

            const parsed = JSON.parse(text!) as AddVocabResponse;
            expect(parsed.status).toBe("CREATED");
            expect(parsed.vocabulary_version).toBe(2);
            expect(parsed.canonical_id).toContain("ACT_");
            expect(parsed.entry?.canonical_label).toBe("dừng xe trái phép");
        });

        it("executes tools/call for add_vocab returning status EXISTING on duplicate", async () => {
            await repository.insertEntry({
                canonical_id: "VEH_001",
                type: "VEHICLE",
                canonical_label: "xe ô tô",
                aliases: ["ô tô"],
            });

            const req = createMcpRequest(
                {
                    jsonrpc: "2.0",
                    id: 51,
                    method: "tools/call",
                    params: {
                        name: "add_vocab",
                        arguments: {
                            type: "VEHICLE",
                            canonical_label: "Xe Ô Tô",
                            evidence: "Phương tiện giao thông cơ giới đường bộ gồm xe ô tô và các loại xe tương tự",
                            source_provision_id: "dieu_3_khoan_1",
                            base_vocabulary_version: 1,
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

            const text = body.result?.content?.[0]?.text;
            const parsed = JSON.parse(text!) as AddVocabResponse;
            expect(parsed.status).toBe("EXISTING");
            expect(parsed.entry?.canonical_label).toBe("xe ô tô");
        });

        it("executes tools/call for add_vocab returning status AMBIGUOUS on collision", async () => {
            await repository.insertEntry({
                canonical_id: "ACT_001",
                type: "ACTION",
                canonical_label: "không chấp hành hiệu lệnh",
                aliases: ["không tuân thủ hiệu lệnh"],
            });

            const req = createMcpRequest(
                {
                    jsonrpc: "2.0",
                    id: 52,
                    method: "tools/call",
                    params: {
                        name: "add_vocab",
                        arguments: {
                            type: "ACTION",
                            canonical_label: "không chấp hành hiệu lệnh người điều khiển",
                            evidence: "Không chấp hành hiệu lệnh của người điều khiển giao thông",
                            source_provision_id: "dieu_5_khoan_4_diem_b",
                            base_vocabulary_version: 1,
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

            const text = body.result?.content?.[0]?.text;
            const parsed = JSON.parse(text!) as AddVocabResponse;
            expect(parsed.status).toBe("AMBIGUOUS");
            expect(parsed.existing_entries?.length).toBeGreaterThan(0);
        });

        it("executes tools/call for add_vocab returning status STALE_VERSION on outdated base_version", async () => {
            await repository.setPersistedVersion(4);

            const req = createMcpRequest(
                {
                    jsonrpc: "2.0",
                    id: 53,
                    method: "tools/call",
                    params: {
                        name: "add_vocab",
                        arguments: {
                            type: "LOCATION",
                            canonical_label: "đường cao tốc",
                            evidence: "Đường cao tốc là đường dành cho xe cơ giới chạy tốc độ cao",
                            source_provision_id: "dieu_26_khoan_1",
                            base_vocabulary_version: 1, // outdated!
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

            const text = body.result?.content?.[0]?.text;
            const parsed = JSON.parse(text!) as AddVocabResponse;
            expect(parsed.status).toBe("STALE_VERSION");
            expect(parsed.vocabulary_version).toBe(4);
        });

        it("returns isError for add_vocab with invalid evidence or Job ID", async () => {
            const req = createMcpRequest(
                {
                    jsonrpc: "2.0",
                    id: 54,
                    method: "tools/call",
                    params: {
                        name: "add_vocab",
                        arguments: {
                            type: "ACTION",
                            canonical_label: "vi phạm",
                            evidence: "Người điều khiển vi phạm",
                            source_provision_id: "job-bad-id-12345", // Job ID instead of provision!
                            base_vocabulary_version: 1,
                        },
                    },
                },
                { "X-Internal-MCP-Token": TEST_MCP_TOKEN }
            );

            const res = await app.handle(req);
            expect(res.status).toBe(200);

            const body = (await res.json()) as {
                result?: {
                    isError?: boolean;
                    content: Array<{ type: string; text: string }>;
                };
            };

            expect(body.result?.isError).toBe(true);
            const text = body.result?.content?.[0]?.text;
            expect(text).toContain("Job ID or Snapshot ID cannot be used as stable Provision ID");
        });
    });

    describe("Document Discovery Tool (search_legal_documents)", () => {
        it("executes tools/call for search_legal_documents and returns candidates with identity invariants", async () => {
            const req = createMcpRequest(
                {
                    jsonrpc: "2.0",
                    id: 55,
                    method: "tools/call",
                    params: {
                        name: "search_legal_documents",
                        arguments: {
                            query: "100/2019/NĐ-CP",
                            document_number: "100/2019/NĐ-CP",
                        },
                    },
                },
                { "X-Internal-MCP-Token": TEST_MCP_TOKEN }
            );

            const res = await app.handle(req);
            expect(res.status).toBe(200);

            const body = (await res.json()) as {
                result?: {
                    isError?: boolean;
                    content: Array<{ type: string; text: string }>;
                };
            };

            expect(body.result?.isError).toBeFalsy();
            const text = body.result?.content?.[0]?.text;
            expect(text).toBeDefined();

            const parsed = JSON.parse(text!) as SearchLegalDocumentsResponse;
            expect(parsed.status).toBe("OK");
            expect(parsed.candidates.length).toBeGreaterThan(0);

            const candidate = parsed.candidates[0];
            expect(candidate.document_number).toBe("100/2019/NĐ-CP");
            expect(candidate.identity_type).toBe("CORPUS_DOCUMENT");
            expect(candidate.canonical_document_id).toBeNull();
            expect(candidate.source_provenance.job_id).toBe("job-seed-nd100");
            expect(candidate.source_provenance.pdf_sha256).toBe("dummy-sha256");
            expect(candidate.availability.has_json_content).toBe(true);
            expect(candidate.availability.has_pdf_snapshot).toBe(true);
        });

        it("returns isError for search_legal_documents when query is empty or limit is negative", async () => {
            const req = createMcpRequest(
                {
                    jsonrpc: "2.0",
                    id: 56,
                    method: "tools/call",
                    params: {
                        name: "search_legal_documents",
                        arguments: {
                            query: "   ",
                        },
                    },
                },
                { "X-Internal-MCP-Token": TEST_MCP_TOKEN }
            );

            const res = await app.handle(req);
            expect(res.status).toBe(200);

            const body = (await res.json()) as {
                result?: {
                    isError?: boolean;
                    content: Array<{ type: string; text: string }>;
                };
            };

            expect(body.result?.isError).toBe(true);
            const text = body.result?.content?.[0]?.text;
            expect(text).toContain("Search query string is required");
        });
    });

    describe("Write Tool Authorization (add_vocab)", () => {
        it("denies add_vocab when client has explicit read-only scope, but permits get_vocab_snapshot", async () => {
            const writeReq = createMcpRequest(
                {
                    jsonrpc: "2.0",
                    id: 60,
                    method: "tools/call",
                    params: {
                        name: "add_vocab",
                        arguments: {
                            type: "ACTION",
                            canonical_label: "quay đầu sai",
                            evidence: "Quay đầu xe không đúng nơi quy định",
                            source_provision_id: "dieu_15",
                            base_vocabulary_version: 1,
                        },
                    },
                },
                {
                    "X-Internal-MCP-Token": TEST_MCP_TOKEN,
                    "X-MCP-Role": "read", // Explicit read-only role!
                }
            );

            const writeRes = await app.handle(writeReq);
            expect(writeRes.status).toBe(200);

            const writeBody = (await writeRes.json()) as {
                result?: {
                    isError?: boolean;
                    content: Array<{ type: string; text: string }>;
                };
            };

            expect(writeBody.result?.isError).toBe(true);
            expect(writeBody.result?.content?.[0]?.text).toContain("Forbidden");

            // But read tool still succeeds for read-only role
            const readReq = createMcpRequest(
                {
                    jsonrpc: "2.0",
                    id: 61,
                    method: "tools/call",
                    params: {
                        name: "get_vocab_snapshot",
                        arguments: {},
                    },
                },
                {
                    "X-Internal-MCP-Token": TEST_MCP_TOKEN,
                    "X-MCP-Role": "read",
                }
            );

            const readRes = await app.handle(readReq);
            expect(readRes.status).toBe(200);

            const readBody = (await readRes.json()) as {
                result?: {
                    isError?: boolean;
                    content: Array<{ type: string; text: string }>;
                };
            };

            expect(readBody.result?.isError).toBeFalsy();

            // search_legal_documents also succeeds for read-only role
            const searchReq = createMcpRequest(
                {
                    jsonrpc: "2.0",
                    id: 62,
                    method: "tools/call",
                    params: {
                        name: "search_legal_documents",
                        arguments: {
                            query: "100/2019/NĐ-CP",
                        },
                    },
                },
                {
                    "X-Internal-MCP-Token": TEST_MCP_TOKEN,
                    "X-MCP-Role": "read",
                }
            );

            const searchRes = await app.handle(searchReq);
            expect(searchRes.status).toBe(200);
            const searchBody = (await searchRes.json()) as {
                result?: { isError?: boolean; content: Array<{ type: string; text: string }> };
            };
            expect(searchBody.result?.isError).toBeFalsy();
        });

        it("enforces dedicated INTERNAL_MCP_WRITE_TOKEN when configured", async () => {
            const WRITE_TOKEN = "dedicated-secret-write-token-999";
            const envWithWriteToken: Env = {
                ...mockEnv,
                INTERNAL_MCP_WRITE_TOKEN: WRITE_TOKEN,
            };

            // Call with general token only -> rejected for write
            const deniedReq = createMcpRequest(
                {
                    jsonrpc: "2.0",
                    id: 70,
                    method: "tools/call",
                    params: {
                        name: "add_vocab",
                        arguments: {
                            type: "ACTION",
                            canonical_label: "đi lùi",
                            evidence: "Đi lùi xe trên đường một chiều",
                            source_provision_id: "dieu_16",
                            base_vocabulary_version: 1,
                        },
                    },
                },
                { "X-Internal-MCP-Token": TEST_MCP_TOKEN },
                envWithWriteToken
            );

            const deniedRes = await app.handle(deniedReq);
            const deniedBody = (await deniedRes.json()) as {
                result?: { isError?: boolean; content: Array<{ type: string; text: string }> };
            };
            expect(deniedBody.result?.isError).toBe(true);
            expect(deniedBody.result?.content?.[0]?.text).toContain("Forbidden");

            // Call with dedicated write token -> accepted
            const allowedReq = createMcpRequest(
                {
                    jsonrpc: "2.0",
                    id: 71,
                    method: "tools/call",
                    params: {
                        name: "add_vocab",
                        arguments: {
                            type: "ACTION",
                            canonical_label: "đi lùi",
                            evidence: "Đi lùi xe trên đường một chiều",
                            source_provision_id: "dieu_16",
                            base_vocabulary_version: 1,
                        },
                    },
                },
                {
                    "X-Internal-MCP-Token": TEST_MCP_TOKEN,
                    "X-Internal-MCP-Write-Token": WRITE_TOKEN,
                },
                envWithWriteToken
            );

            const allowedRes = await app.handle(allowedReq);
            const allowedBody = (await allowedRes.json()) as {
                result?: { isError?: boolean; content: Array<{ type: string; text: string }> };
            };
            expect(allowedBody.result?.isError).toBeFalsy();
            const resData = JSON.parse(allowedBody.result?.content?.[0]?.text!) as AddVocabResponse;
            expect(resData.status).toBe("CREATED");
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
            expect(toolNames).toContain("add_vocab");
            expect(toolNames).toContain("search_legal_documents");

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

        it("invokes add_vocab via official MCP Client SDK and reflects changes in snapshot", async () => {
            const client = new Client(
                { name: "official-sdk-test-client-2", version: "1.0.0" },
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

            const addResult = await client.callTool({
                name: "add_vocab",
                arguments: {
                    type: "VEHICLE",
                    canonical_label: "xe xích lô",
                    aliases: ["xích lô"],
                    evidence: "Phương tiện giao thông thô sơ đường bộ bao gồm xe xích lô",
                    source_provision_id: "dieu_3_khoan_19",
                    base_vocabulary_version: 1,
                },
            });

            expect(addResult.isError).toBeFalsy();
            const addContents = addResult.content as Array<{ type: string; text?: string }>;
            const addText = addContents[0]?.text;
            expect(addText).toBeDefined();

            const parsedAdd = JSON.parse(addText!) as AddVocabResponse;
            expect(parsedAdd.status).toBe("CREATED");
            expect(parsedAdd.vocabulary_version).toBe(2);
            expect(parsedAdd.canonical_id).toContain("VEH_");

            // Query snapshot with version 2
            const snapshotResult = await client.callTool({
                name: "get_vocab_snapshot",
                arguments: {},
            });

            const snapContents = snapshotResult.content as Array<{ type: string; text?: string }>;
            const snapText = snapContents[0]?.text;
            const parsedSnap = JSON.parse(snapText!) as VocabSnapshotResponse;
            expect(parsedSnap.vocabulary_version).toBe(2);
            expect(parsedSnap.entries.length).toBe(1);
            expect(parsedSnap.entries[0].canonical_label).toBe("xe xích lô");

            await client.close();
        });

        it("invokes search_legal_documents via official MCP Client SDK", async () => {
            const client = new Client(
                { name: "official-sdk-test-client-3", version: "1.0.0" },
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

            const searchResult = await client.callTool({
                name: "search_legal_documents",
                arguments: {
                    query: "100/2019/NĐ-CP",
                    document_number: "100/2019/NĐ-CP",
                },
            });

            expect(searchResult.isError).toBeFalsy();
            const contents = searchResult.content as Array<{ type: string; text?: string }>;
            const firstContent = contents[0];
            expect(firstContent?.type).toBe("text");

            const parsed = JSON.parse(firstContent!.text!) as SearchLegalDocumentsResponse;
            expect(parsed.status).toBe("OK");
            expect(parsed.candidates.length).toBeGreaterThan(0);

            const candidate = parsed.candidates[0];
            expect(candidate.document_number).toBe("100/2019/NĐ-CP");
            expect(candidate.identity_type).toBe("CORPUS_DOCUMENT");
            expect(candidate.canonical_document_id).toBeNull();
            expect(candidate.source_provenance.job_id).toBe("job-seed-nd100");
            expect(candidate.availability.has_json_content).toBe(true);

            await client.close();
        });
    });
});
