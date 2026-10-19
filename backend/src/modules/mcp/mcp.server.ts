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

export function createLegalMcpServer(vocabularyService: VocabularyService): McpServer {
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

    return server;
}
