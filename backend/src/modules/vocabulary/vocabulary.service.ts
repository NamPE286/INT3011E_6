import { VocabularyRepository } from "./vocabulary.repository";
import type {
    VocabEntryRecord,
    VocabSnapshotEntry,
    VocabSnapshotResponse,
} from "./vocabulary.types";

export class VocabularyService {
    private readonly repository: VocabularyRepository;

    constructor(repository: VocabularyRepository) {
        this.repository = repository;
    }

    public async getSnapshot(clientVersion?: number): Promise<VocabSnapshotResponse> {
        const currentVersion = await this.repository.getCurrentVersion();

        if (clientVersion !== undefined && clientVersion === currentVersion) {
            return {
                status: "NOT_MODIFIED",
                not_modified: true,
                vocabulary_version: currentVersion,
                entries: [],
            };
        }

        const records = await this.repository.getAllEntries();
        const entries = records.map((record) => this.mapRecordToSnapshotEntry(record));

        return {
            status: "OK",
            not_modified: false,
            vocabulary_version: currentVersion,
            entries,
        };
    }

    private mapRecordToSnapshotEntry(record: VocabEntryRecord): VocabSnapshotEntry {
        let parsedAliases: string[] = [];

        try {
            const parsed = JSON.parse(record.aliases);
            if (Array.isArray(parsed)) {
                parsedAliases = parsed.filter(
                    (alias): alias is string => typeof alias === "string"
                );
            }
        } catch {
            parsedAliases = [];
        }

        parsedAliases.sort((first, second) => first.localeCompare(second));

        const entry: VocabSnapshotEntry = {
            canonical_id: record.canonical_id,
            type: record.type,
            canonical_label: record.canonical_label,
            aliases: parsedAliases,
        };

        if (record.definition) {
            entry.definition = record.definition;
        }

        return entry;
    }
}
