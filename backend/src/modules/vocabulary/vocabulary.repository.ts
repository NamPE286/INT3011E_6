import type { D1Database } from "@cloudflare/workers-types";
import type { LegalDocumentSource } from "./vocabulary.provenance";
import type { CreateVocabEntryInput, VocabEntryRecord, VocabType } from "./vocabulary.types";

const VOCAB_COLUMNS = `id, canonical_id, type, canonical_label, aliases, definition, evidence,
    source_provision_id, source_document_id, created_at, updated_at, vocabulary_version`;

export class StaleVocabularyVersionError extends Error {
    constructor() {
        super("STALE_VERSION_CONFLICT");
        this.name = "StaleVocabularyVersionError";
    }
}

export class VocabularyRepository {
    constructor(private readonly db: D1Database) {}

    public async getCurrentVersion(): Promise<number> {
        const row = await this.db
            .prepare("SELECT value FROM vocab_metadata WHERE key = 'vocabulary_version'")
            .first<{ value: string }>();
        const version = Number.parseInt(row?.value ?? "", 10);

        return Number.isNaN(version) ? 1 : version;
    }

    public async getAllEntries(): Promise<VocabEntryRecord[]> {
        const result = await this.db
            .prepare(`SELECT ${VOCAB_COLUMNS} FROM vocab_entries ORDER BY type ASC, canonical_id ASC`)
            .all<VocabEntryRecord>();

        return result.results;
    }

    public async getEntriesByType(type: VocabType): Promise<VocabEntryRecord[]> {
        const result = await this.db
            .prepare(`SELECT ${VOCAB_COLUMNS} FROM vocab_entries WHERE type = ? ORDER BY canonical_id ASC`)
            .bind(type)
            .all<VocabEntryRecord>();

        return result.results;
    }

    public async getEntryByCanonicalId(canonicalId: string): Promise<VocabEntryRecord | null> {
        const row = await this.db
            .prepare(`SELECT ${VOCAB_COLUMNS} FROM vocab_entries WHERE canonical_id = ?`)
            .bind(canonicalId)
            .first<VocabEntryRecord>();

        return row ?? null;
    }

    /** Loads only the referenced document when its id is known, so add_vocab does not scan the whole corpus. */
    public async getLegalDocuments(documentId: string | null): Promise<LegalDocumentSource[]> {
        if (documentId) {
            const byId = await this.db
                .prepare("SELECT id, document_title, json_content FROM legal_documents WHERE id = ?")
                .bind(documentId)
                .all<LegalDocumentSource>();

            if (byId.results.length > 0) {
                return byId.results;
            }
        }

        const result = await this.db
            .prepare("SELECT id, document_title, json_content FROM legal_documents")
            .all<LegalDocumentSource>();

        return result.results;
    }

    /**
     * Inserts the entry and bumps the vocabulary version in one D1 batch (a single transaction).
     * If another writer changed the version first, the UPDATE matches no row, `changes()` is 0, the
     * INSERT gets a NULL version, the NOT NULL constraint aborts the batch and nothing is written.
     */
    public async insertEntryAtomic(
        input: CreateVocabEntryInput,
        expectedBaseVersion: number,
    ): Promise<{ record: VocabEntryRecord; newVersion: number }> {
        const now = new Date().toISOString();
        const newVersion = expectedBaseVersion + 1;
        const record: VocabEntryRecord = {
            id: input.id ?? crypto.randomUUID(),
            canonical_id: input.canonical_id,
            type: input.type,
            canonical_label: input.canonical_label,
            aliases: JSON.stringify(input.aliases ?? []),
            definition: input.definition ?? null,
            evidence: input.evidence ?? null,
            source_provision_id: input.source_provision_id ?? null,
            source_document_id: input.source_document_id ?? null,
            created_at: now,
            updated_at: now,
            vocabulary_version: newVersion,
        };

        const updateVersion = this.db
            .prepare(`UPDATE vocab_metadata SET value = ?, updated_at = ? WHERE key = 'vocabulary_version' AND value = ?`)
            .bind(String(newVersion), now, String(expectedBaseVersion));
        const insertEntry = this.db
            .prepare(`INSERT INTO vocab_entries (${VOCAB_COLUMNS})
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN changes() = 1 THEN ? ELSE NULL END)`)
            .bind(
                record.id,
                record.canonical_id,
                record.type,
                record.canonical_label,
                record.aliases,
                record.definition,
                record.evidence,
                record.source_provision_id,
                record.source_document_id,
                record.created_at,
                record.updated_at,
                record.vocabulary_version,
            );

        try {
            await this.db.batch([updateVersion, insertEntry]);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);

            if (message.includes("NOT NULL constraint failed") && message.includes("vocabulary_version")) {
                throw new StaleVocabularyVersionError();
            }

            throw error;
        }

        return { record, newVersion };
    }
}
