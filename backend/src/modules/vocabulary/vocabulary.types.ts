export const VOCAB_TYPES = [
    "ACTION",
    "SUBJECT",
    "VEHICLE",
    "TARGET",
    "LOCATION",
    "CONDITION",
    "EXCEPTION",
] as const;

export type VocabType = (typeof VOCAB_TYPES)[number];

export function isVocabType(value: unknown): value is VocabType {
    if (typeof value !== "string") {
        return false;
    }

    return (VOCAB_TYPES as readonly string[]).includes(value);
}

export interface VocabEntryRecord {
    id: string;
    canonical_id: string;
    type: VocabType;
    canonical_label: string;
    aliases: string;
    definition: string | null;
    evidence: string | null;
    source_provision_id: string | null;
    source_document_id: string | null;
    created_at: string;
    updated_at: string;
    vocabulary_version: number;
}

export interface CreateVocabEntryInput {
    id?: string;
    canonical_id: string;
    type: VocabType;
    canonical_label: string;
    aliases?: string[];
    definition?: string | null;
    evidence?: string | null;
    source_provision_id?: string | null;
    source_document_id?: string | null;
}

export interface VocabSnapshotEntry {
    canonical_id: string;
    type: VocabType;
    canonical_label: string;
    aliases: string[];
    definition?: string | null;
}

export type VocabSnapshotStatus = "OK" | "NOT_MODIFIED";

export interface VocabSnapshotResponse {
    status: VocabSnapshotStatus;
    not_modified: boolean;
    vocabulary_version: number;
    entries: VocabSnapshotEntry[];
}

export type AddVocabStatus = "EXISTING" | "CREATED" | "AMBIGUOUS" | "STALE_VERSION";

export interface AddVocabInput {
    type: VocabType;
    canonical_label: string;
    aliases?: string[];
    definition?: string | null;
    evidence: string;
    source_provision_id: string;
    base_vocabulary_version: number;
    source_document_id?: string | null;
}

export interface AddVocabResponse {
    status: AddVocabStatus;
    vocabulary_version: number;
    canonical_id?: string;
    entry?: VocabSnapshotEntry;
    existing_entries?: VocabSnapshotEntry[];
    conflicts?: string[];
    message?: string;
}

