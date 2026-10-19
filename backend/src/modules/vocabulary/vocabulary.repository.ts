import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type {
    CreateVocabEntryInput,
    VocabEntryRecord,
} from "./vocabulary.types";

export class VocabularyRepository {
    private readonly db: D1Database;

    constructor(db: D1Database) {
        this.db = db;
    }

    public async getCurrentVersion(): Promise<number> {
        const metadataRow = await this.db
            .prepare("SELECT value FROM vocab_metadata WHERE key = ?")
            .bind("vocabulary_version")
            .first<{ value: string }>();

        if (metadataRow && metadataRow.value) {
            const parsed = parseInt(metadataRow.value, 10);
            if (!Number.isNaN(parsed)) {
                return parsed;
            }
        }

        const maxVersionRow = await this.db
            .prepare("SELECT MAX(vocabulary_version) AS max_version FROM vocab_entries")
            .first<{ max_version: number | null }>();

        if (maxVersionRow && maxVersionRow.max_version !== null && maxVersionRow.max_version !== undefined) {
            return maxVersionRow.max_version;
        }

        return 1;
    }

    public async setPersistedVersion(version: number): Promise<void> {
        const now = new Date().toISOString();

        await this.db
            .prepare(`
                INSERT INTO vocab_metadata (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
            `)
            .bind("vocabulary_version", version.toString(), now)
            .run();
    }

    public async incrementVersion(): Promise<number> {
        const now = new Date().toISOString();

        await this.db
            .prepare(`
                UPDATE vocab_metadata
                SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT),
                    updated_at = ?
                WHERE key = 'vocabulary_version'
            `)
            .bind(now)
            .run();

        return this.getCurrentVersion();
    }

    public createIncrementVersionStatement(): D1PreparedStatement {
        const now = new Date().toISOString();

        return this.db
            .prepare(`
                UPDATE vocab_metadata
                SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT),
                    updated_at = ?
                WHERE key = 'vocabulary_version'
            `)
            .bind(now);
    }

    public async getAllEntries(): Promise<VocabEntryRecord[]> {
        const result = await this.db
            .prepare(`
                SELECT
                    id,
                    canonical_id,
                    type,
                    canonical_label,
                    aliases,
                    definition,
                    evidence,
                    source_provision_id,
                    source_document_id,
                    created_at,
                    updated_at,
                    vocabulary_version
                FROM vocab_entries
                ORDER BY type ASC, canonical_id ASC
            `)
            .all<VocabEntryRecord>();

        return result.results;
    }

    public async insertEntry(input: CreateVocabEntryInput): Promise<VocabEntryRecord> {
        const id = input.id ?? crypto.randomUUID();
        const now = new Date().toISOString();
        const version = input.vocabulary_version ?? (await this.getCurrentVersion());

        let aliasesJson = "[]";
        if (typeof input.aliases === "string") {
            aliasesJson = input.aliases;
        } else if (Array.isArray(input.aliases)) {
            aliasesJson = JSON.stringify(input.aliases);
        }

        const record: VocabEntryRecord = {
            id,
            canonical_id: input.canonical_id,
            type: input.type,
            canonical_label: input.canonical_label,
            aliases: aliasesJson,
            definition: input.definition ?? null,
            evidence: input.evidence ?? null,
            source_provision_id: input.source_provision_id ?? null,
            source_document_id: input.source_document_id ?? null,
            created_at: now,
            updated_at: now,
            vocabulary_version: version,
        };

        await this.db
            .prepare(`
                INSERT INTO vocab_entries (
                    id,
                    canonical_id,
                    type,
                    canonical_label,
                    aliases,
                    definition,
                    evidence,
                    source_provision_id,
                    source_document_id,
                    created_at,
                    updated_at,
                    vocabulary_version
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
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
                record.vocabulary_version
            )
            .run();

        return record;
    }
}
