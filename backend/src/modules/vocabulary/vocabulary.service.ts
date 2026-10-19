import { VocabularyRepository } from "./vocabulary.repository";
import {
    splitQualifiedProvisionId,
    validateEvidenceAndProvenance,
    verifyProvisionInLegalDocuments,
} from "./vocabulary.provenance";
import { calculateSimilarity, generateCanonicalId, normalizeText } from "./vocabulary.similarity";
import {
    isVocabType,
    type AddVocabInput,
    type AddVocabResponse,
    type VocabEntryRecord,
    type VocabSnapshotEntry,
    type VocabSnapshotResponse,
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

    public async addVocab(input: AddVocabInput): Promise<AddVocabResponse> {
        // 1. Strict validation of input types and presence
        if (!isVocabType(input.type)) {
            throw new Error(`Invalid vocabulary type: ${String(input.type)}`);
        }

        if (
            !input.canonical_label ||
            typeof input.canonical_label !== "string" ||
            input.canonical_label.trim().length === 0
        ) {
            throw new Error("Invalid canonical_label: must be a non-empty string");
        }

        if (
            typeof input.base_vocabulary_version !== "number" ||
            !Number.isInteger(input.base_vocabulary_version) ||
            input.base_vocabulary_version < 1
        ) {
            throw new Error(
                "Invalid base_vocabulary_version: must be a positive integer greater than or equal to 1"
            );
        }

        // Validate provenance and legal evidence format
        validateEvidenceAndProvenance(input.evidence, input.source_provision_id);

        // Verify that provision exists in legal documents and evidence matches source text
        const documentFilter = input.source_document_id?.trim()
            || splitQualifiedProvisionId(input.source_provision_id).documentId;
        const legalDocs = await this.repository.getLegalDocuments(documentFilter);
        const provVerification = verifyProvisionInLegalDocuments(
            legalDocs,
            input.source_provision_id,
            input.evidence,
            input.source_document_id
        );

        if (!provVerification.verified) {
            throw new Error(`Invalid provenance: ${provVerification.reason}`);
        }

        const cleanLabel = input.canonical_label.trim();
        const cleanAliases: string[] = [];

        if (Array.isArray(input.aliases)) {
            for (const alias of input.aliases) {
                if (typeof alias === "string" && alias.trim().length > 0) {
                    const trimmed = alias.trim();
                    if (!cleanAliases.includes(trimmed)) {
                        cleanAliases.push(trimmed);
                    }
                }
            }
        }

        const currentVersion = await this.repository.getCurrentVersion();
        const existingRecords = await this.repository.getEntriesByType(input.type);
        const existingEntries = existingRecords.map((r) => this.mapRecordToSnapshotEntry(r));

        const normCandLabel = normalizeText(cleanLabel);
        const normCandAliases = cleanAliases.map(normalizeText);

        // 2. Check for exact duplicate or alias match
        const exactMatches: VocabSnapshotEntry[] = [];
        const aliasConflicts: { entry: VocabSnapshotEntry; reason: string }[] = [];

        for (const existing of existingEntries) {
            const normExistingLabel = normalizeText(existing.canonical_label);
            const normExistingAliases = existing.aliases.map(normalizeText);

            const isLabelMatch = normCandLabel === normExistingLabel;
            const isCandLabelInExistingAliases = normExistingAliases.includes(normCandLabel);
            const isExistingLabelInCandAliases = normCandAliases.includes(normExistingLabel);

            if (isLabelMatch || isCandLabelInExistingAliases || isExistingLabelInCandAliases) {
                exactMatches.push(existing);
                continue;
            }

            // Check if any candidate alias collides with an existing alias
            for (const candAlias of normCandAliases) {
                if (normExistingAliases.includes(candAlias)) {
                    aliasConflicts.push({
                        entry: existing,
                        reason: `Candidate alias '${candAlias}' is already registered for '${existing.canonical_label}' (${existing.canonical_id})`,
                    });
                }
            }
        }

        // If multiple distinct entries are matched by label or alias, it is ambiguous
        if (exactMatches.length > 1) {
            const result: AddVocabResponse = {
                status: "AMBIGUOUS",
                vocabulary_version: currentVersion,
                existing_entries: exactMatches,
                conflicts: exactMatches.map(
                    (m) => `Matches existing entry '${m.canonical_label}' (${m.canonical_id})`
                ),
                message: "Proposed vocabulary matches multiple existing canonical entries",
            };
            this.logAddVocabResult(input, result);
            return result;
        }

        if (exactMatches.length === 1) {
            const matched = exactMatches[0];
            // If there are also conflicting aliases pointing to other entries, it's ambiguous
            if (aliasConflicts.length > 0) {
                const result: AddVocabResponse = {
                    status: "AMBIGUOUS",
                    vocabulary_version: currentVersion,
                    existing_entries: [matched, ...aliasConflicts.map((c) => c.entry)],
                    conflicts: aliasConflicts.map((c) => c.reason),
                    message: "Proposed vocabulary creates conflicting alias associations with other entries",
                };
                this.logAddVocabResult(input, result);
                return result;
            }

            const result: AddVocabResponse = {
                status: "EXISTING",
                vocabulary_version: currentVersion,
                canonical_id: matched.canonical_id,
                entry: matched,
                existing_entries: [matched],
                message: `Vocabulary entry already exists as '${matched.canonical_label}' (${matched.canonical_id})`,
            };
            this.logAddVocabResult(input, result);
            return result;
        }

        // If candidate alias conflicts with existing entries without matching label
        if (aliasConflicts.length > 0) {
            const result: AddVocabResponse = {
                status: "AMBIGUOUS",
                vocabulary_version: currentVersion,
                existing_entries: aliasConflicts.map((c) => c.entry),
                conflicts: aliasConflicts.map((c) => c.reason),
                message: "Proposed alias collides with existing vocabulary entry",
            };
            this.logAddVocabResult(input, result);
            return result;
        }

        // 3. Stale version check: cannot add new entry against outdated client version
        if (input.base_vocabulary_version !== currentVersion) {
            const result: AddVocabResponse = {
                status: "STALE_VERSION",
                vocabulary_version: currentVersion,
                message: `Base vocabulary version ${input.base_vocabulary_version} is stale. Current version is ${currentVersion}. Please reload snapshot.`,
            };
            this.logAddVocabResult(input, result);
            return result;
        }

        // 4. Similarity resolution (near-duplicate detection)
        const similarEntries: { entry: VocabSnapshotEntry; score: number }[] = [];

        for (const existing of existingEntries) {
            const score = calculateSimilarity(cleanLabel, existing.canonical_label);
            if (score >= 0.75) {
                similarEntries.push({ entry: existing, score });
                continue;
            }

            for (const alias of existing.aliases) {
                const aliasScore = calculateSimilarity(cleanLabel, alias);
                if (aliasScore >= 0.8) {
                    similarEntries.push({ entry: existing, score: aliasScore });
                    break;
                }
            }
        }

        if (similarEntries.length > 0) {
            similarEntries.sort((a, b) => b.score - a.score);
            const result: AddVocabResponse = {
                status: "AMBIGUOUS",
                vocabulary_version: currentVersion,
                existing_entries: similarEntries.map((s) => s.entry),
                conflicts: similarEntries.map(
                    (s) =>
                        `High textual similarity (${Math.round(s.score * 100)}%) with '${s.entry.canonical_label}' (${s.entry.canonical_id})`
                ),
                message: "Proposed vocabulary is ambiguous with existing entries. Consider using existing vocabulary or clarifying aliases.",
            };
            this.logAddVocabResult(input, result);
            return result;
        }

        // 5. Atomic insertion & version increment
        const baseCanonicalId = generateCanonicalId(input.type, cleanLabel);
        let finalCanonicalId = baseCanonicalId;
        let suffix = 2;

        while (await this.repository.getEntryByCanonicalId(finalCanonicalId)) {
            finalCanonicalId = `${baseCanonicalId}_${suffix}`;
            suffix++;
        }

        try {
            const { record, newVersion } = await this.repository.insertEntryAtomic(
                {
                    canonical_id: finalCanonicalId,
                    type: input.type,
                    canonical_label: cleanLabel,
                    aliases: cleanAliases,
                    definition: input.definition?.trim() || null,
                    evidence: input.evidence.trim(),
                    source_provision_id: input.source_provision_id.trim(),
                    source_document_id:
                        input.source_document_id?.trim() ||
                        provVerification.matchedDocumentId ||
                        null,
                },
                input.base_vocabulary_version
            );

            const createdEntry = this.mapRecordToSnapshotEntry(record);

            const result: AddVocabResponse = {
                status: "CREATED",
                vocabulary_version: newVersion,
                canonical_id: record.canonical_id,
                entry: createdEntry,
                message: `Vocabulary entry '${record.canonical_label}' created successfully with version ${newVersion}`,
            };

            this.logAddVocabResult(input, result);
            return result;
        } catch (error) {
            // Concurrent race condition: another concurrent write inserted the entry or updated version
            const latestRecords = await this.repository.getEntriesByType(input.type);
            const latestEntries = latestRecords.map((r) => this.mapRecordToSnapshotEntry(r));
            const latestVersion = await this.repository.getCurrentVersion();

            const existingMatch = latestEntries.find(
                (e) =>
                    normalizeText(e.canonical_label) === normCandLabel ||
                    e.canonical_id === finalCanonicalId ||
                    e.aliases.map(normalizeText).includes(normCandLabel)
            );

            if (existingMatch) {
                const result: AddVocabResponse = {
                    status: "EXISTING",
                    vocabulary_version: latestVersion,
                    canonical_id: existingMatch.canonical_id,
                    entry: existingMatch,
                    existing_entries: [existingMatch],
                    message: `Vocabulary entry already exists as '${existingMatch.canonical_label}' (${existingMatch.canonical_id})`,
                };
                this.logAddVocabResult(input, result);
                return result;
            }

            if (latestVersion !== input.base_vocabulary_version) {
                const result: AddVocabResponse = {
                    status: "STALE_VERSION",
                    vocabulary_version: latestVersion,
                    message: `Base vocabulary version ${input.base_vocabulary_version} is stale. Current version is ${latestVersion}. Please reload snapshot.`,
                };
                this.logAddVocabResult(input, result);
                return result;
            }

            throw error;
        }
    }

    public mapRecordToSnapshotEntry(record: VocabEntryRecord): VocabSnapshotEntry {
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

    private logAddVocabResult(input: AddVocabInput, result: AddVocabResponse): void {
        console.log(
            JSON.stringify({
                level: "info",
                module: "vocabulary",
                action: "add_vocab",
                type: input.type,
                canonical_label: input.canonical_label,
                source_provision_id: input.source_provision_id,
                base_vocabulary_version: input.base_vocabulary_version,
                status: result.status,
                canonical_id: result.canonical_id,
                vocabulary_version: result.vocabulary_version,
                conflicts: result.conflicts,
            })
        );
    }
}
