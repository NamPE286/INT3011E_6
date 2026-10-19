import type { D1Database } from "@cloudflare/workers-types";
import type { VocabType } from "../src/modules/vocabulary/vocabulary.types";

export type VocabFixture = {
    canonical_id: string;
    type: VocabType;
    canonical_label: string;
    aliases?: string[] | string;
    definition?: string | null;
    evidence?: string | null;
    source_provision_id?: string | null;
    source_document_id?: string | null;
    vocabulary_version?: number;
};

/** Seeds a vocabulary row directly, bypassing add_vocab, to set up registry state for a test. */
export async function insertVocabEntry(db: D1Database, entry: VocabFixture): Promise<void> {
    const now = new Date().toISOString();
    const aliases = typeof entry.aliases === "string" ? entry.aliases : JSON.stringify(entry.aliases ?? []);

    await db
        .prepare(
            `INSERT INTO vocab_entries (id, canonical_id, type, canonical_label, aliases, definition, evidence,
                source_provision_id, source_document_id, created_at, updated_at, vocabulary_version)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
            crypto.randomUUID(),
            entry.canonical_id,
            entry.type,
            entry.canonical_label,
            aliases,
            entry.definition ?? null,
            entry.evidence ?? null,
            entry.source_provision_id ?? null,
            entry.source_document_id ?? null,
            now,
            now,
            entry.vocabulary_version ?? 1,
        )
        .run();
}

export async function setVocabularyVersion(db: D1Database, version: number): Promise<void> {
    await db
        .prepare("UPDATE vocab_metadata SET value = ?, updated_at = ? WHERE key = 'vocabulary_version'")
        .bind(String(version), new Date().toISOString())
        .run();
}
