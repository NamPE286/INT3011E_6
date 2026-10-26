import type { D1Database } from "@cloudflare/workers-types";
import { buildChangesAfterExtraction } from "../changes/change.service";
import { buildGraphAfterExtraction } from "../documents/document-graph.service";
import { resolveIdentitiesAfterExtraction } from "../identity/identity.service";
import { analyzeAfterExtraction } from "../provisions/provision.service";
import { extractRulesAfterExtraction } from "../violations/violation.service";

export type PreprocessingOptions = {
    apiKey?: string;
    model: string;
    fetcher?: typeof fetch;
};

/**
 * Runs the preprocessing stages after a legal document is saved (docs/preprocessing.md). The document is
 * already stored when this runs, so a failure is logged and repaired through each stage's rebuild
 * endpoint; it never turns a finished job into a failed one.
 */
export async function runPreprocessing(db: D1Database, documentId: string, options: PreprocessingOptions): Promise<void> {
    try {
        await analyzeAfterExtraction(db, documentId);
        await buildGraphAfterExtraction(db, documentId);
        await buildChangesAfterExtraction(db, documentId);

        const ruleDocuments = await extractRulesAfterExtraction(db, documentId, options);

        await resolveIdentitiesAfterExtraction(db, ruleDocuments, options);
    } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : "Unknown preprocessing error";

        console.error(`[Preprocessing] Stopped for ${documentId}`, detail);
    }
}
