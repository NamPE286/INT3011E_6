import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { VocabularyService } from "../vocabulary/vocabulary.service";
import type { DocumentService } from "../documents/document.service";

export const getVocabSnapshotSchema = {
    version: z
        .number()
        .optional()
        .describe(
            "Optional cached vocabulary version. If provided and matches the current vocabulary version, empty entries are returned."
        ),
};

export const addVocabSchema = {
    type: z
        .enum([
            "ACTION",
            "SUBJECT",
            "VEHICLE",
            "TARGET",
            "LOCATION",
            "CONDITION",
            "EXCEPTION",
        ])
        .describe("Legal vocabulary entry type"),
    canonical_label: z
        .string()
        .min(1)
        .describe("Canonical label for the vocabulary entry"),
    aliases: z
        .array(z.string())
        .optional()
        .describe("Optional aliases/synonyms for the vocabulary entry"),
    definition: z
        .string()
        .optional()
        .nullable()
        .describe("Optional definition of the vocabulary entry"),
    evidence: z
        .string()
        .min(1)
        .describe("Legal text evidence supporting this entry"),
    source_provision_id: z
        .string()
        .min(1)
        .describe("Stable legal provision reference (e.g. 'Điều 5, Khoản 1' or 'doc_id:dieu_5_khoan_1')"),
    source_document_id: z
        .string()
        .optional()
        .nullable()
        .describe("Optional source document identifier to disambiguate identical article numbers across laws"),
    base_vocabulary_version: z
        .number()
        .int()
        .min(1)
        .describe("Vocabulary version the client based this proposed addition on"),
};

export const searchLegalDocumentsSchema = {
    query: z
        .string()
        .min(1)
        .describe("Search query, document mention, or legal keywords"),
    document_number: z
        .string()
        .optional()
        .nullable()
        .describe("Optional legal document number (e.g. '100/2019/NĐ-CP')"),
    document_type: z
        .string()
        .optional()
        .nullable()
        .describe("Optional document type filter (e.g. 'Nghị định', 'Luật', 'Thông tư')"),
    agency: z
        .string()
        .optional()
        .nullable()
        .describe("Optional issuing agency filter (e.g. 'Chính phủ', 'Bộ Giao thông vận tải')"),
    issued_from: z
        .string()
        .optional()
        .nullable()
        .describe("Optional lower bound for issuance date (YYYY-MM-DD)"),
    issued_to: z
        .string()
        .optional()
        .nullable()
        .describe("Optional upper bound for issuance date (YYYY-MM-DD)"),
    limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .nullable()
        .describe("Maximum number of document candidates to return (1-50, default: 10)"),
};

export type LegalMcpServerOptions = {
    canWrite: boolean;
};

type ToolResult = {
    isError?: boolean;
    content: { type: "text"; text: string }[];
};

function toolResult(payload: unknown): ToolResult {
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function toolError(error: string, message: string): ToolResult {
    return { isError: true, content: [{ type: "text", text: JSON.stringify({ error, message }) }] };
}

async function runTool(action: () => Promise<unknown>, fallbackMessage: string): Promise<ToolResult> {
    try {
        return toolResult(await action());
    } catch (error: unknown) {
        return toolError("INVALID_INPUT", error instanceof Error ? error.message : fallbackMessage);
    }
}

export function createLegalMcpServer(
    vocabularyService: VocabularyService,
    documentService: DocumentService,
    options: LegalMcpServerOptions,
): McpServer {
    const server = new McpServer({
        name: "legal-mcp-server",
        version: "1.0.0",
    });

    server.tool(
        "get_vocab_snapshot",
        "Retrieve the complete compact legal vocabulary snapshot with deterministic ordering and versioning.",
        getVocabSnapshotSchema,
        async ({ version }) => runTool(() => vocabularyService.getSnapshot(version), "Failed to load vocabulary"),
    );

    server.tool(
        "add_vocab",
        "Add a new legal vocabulary entry candidate with duplicate resolution, provenance, and atomic versioning.",
        addVocabSchema,
        async (args) => {
            if (!options.canWrite) {
                return toolError("FORBIDDEN", "Forbidden: add_vocab requires the internal MCP write token");
            }

            return runTool(() => vocabularyService.addVocab(args), "Failed to add vocabulary");
        },
    );

    server.tool(
        "search_legal_documents",
        "Search for legal document candidates in the internal corpus to support document discovery without canonicalization.",
        searchLegalDocumentsSchema,
        async (args) => runTool(() => documentService.searchLegalDocuments(args), "Failed to search legal documents"),
    );

    return server;
}
