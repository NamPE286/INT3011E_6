import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { VocabularyService } from "../vocabulary/vocabulary.service";

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

export interface LegalMcpServerOptions {
    canWrite?: boolean;
    writeAuthReason?: string;
}

export function createLegalMcpServer(
    vocabularyService: VocabularyService,
    options: LegalMcpServerOptions = { canWrite: true }
): McpServer {
    const server = new McpServer({
        name: "legal-mcp-server",
        version: "1.0.0",
    });

    server.tool(
        "get_vocab_snapshot",
        "Retrieve the complete compact legal vocabulary snapshot with deterministic ordering and versioning.",
        getVocabSnapshotSchema,
        async ({ version }) => {
            const snapshot = await vocabularyService.getSnapshot(version);

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(snapshot),
                    },
                ],
            };
        }
    );

    server.tool(
        "add_vocab",
        "Add a new legal vocabulary entry candidate with duplicate resolution, provenance, and atomic versioning.",
        addVocabSchema,
        async (args) => {
            if (options.canWrite === false) {
                return {
                    isError: true,
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                error: "FORBIDDEN",
                                message:
                                    options.writeAuthReason ??
                                    "Unauthorized: Write permission required for add_vocab",
                            }),
                        },
                    ],
                };
            }

            try {
                const result = await vocabularyService.addVocab({
                    type: args.type,
                    canonical_label: args.canonical_label,
                    aliases: args.aliases,
                    definition: args.definition,
                    evidence: args.evidence,
                    source_provision_id: args.source_provision_id,
                    source_document_id: args.source_document_id,
                    base_vocabulary_version: args.base_vocabulary_version,
                });

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result),
                        },
                    ],
                };
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : "Failed to add vocabulary";
                return {
                    isError: true,
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                error: "INVALID_INPUT",
                                message,
                            }),
                        },
                    ],
                };
            }
        }
    );

    return server;
}
