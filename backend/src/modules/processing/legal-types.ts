/**
 * Legal JSON contract v1 (issue #33) and the intermediate LLM transcription format.
 * The LLM never generates IDs, hashes or snapshot references; the backend attaches them.
 */
export const LEGAL_SCHEMA_VERSION = "legal-json-v1";

export type ReadQuality = "GOOD" | "PARTIAL" | "UNREADABLE";

export type SourceRegion = {
    page: number;
    bbox: [number, number, number, number];
};

export type SourceLocator = {
    page_start: number;
    page_end: number;
    regions: SourceRegion[];
    source_quote: string | null;
    method: "LLM";
    quality: ReadQuality;
};

export type NodeBase = {
    number: string;
    title: string | null;
    content: string | null;
    source_locator: SourceLocator;
};

export type Point = NodeBase;

export type Clause = NodeBase & {
    points: Point[];
};

export type Article = NodeBase & {
    clauses: Clause[];
};

export type Section = NodeBase & {
    articles: Article[];
};

export type Chapter = NodeBase & {
    sections: Section[];
    articles: Article[];
};

export type Part = NodeBase & {
    chapters: Chapter[];
    sections: Section[];
    articles: Article[];
};

export type LegalDocument = {
    document_title: string | null;
    content: string | null;
    source: {
        snapshot_id: string;
        pdf_sha256: string;
        part_index: number;
    };
    parts: Part[];
    chapters: Chapter[];
    sections: Section[];
    articles: Article[];
};

export const BLOCK_KINDS = [
    "title",
    "text",
    "part",
    "chapter",
    "section",
    "article",
    "clause",
    "point",
    "closing",
] as const;

export type BlockKind = (typeof BLOCK_KINDS)[number];

/**
 * One reading-order block transcribed by the LLM. `marker` is the literal heading/numbering prefix
 * ("Điều 6.", "Chương II", "h)"); `kind` and `number` of structural blocks are derived from it by the
 * backend, not taken from the model. Page numbers are absolute (1-based in the snapshot).
 */
export type TranscribedBlock = {
    kind: BlockKind;
    marker: string | null;
    number: string | null;
    title: string | null;
    text: string | null;
    page_start: number;
    page_end: number;
    continues_previous: boolean;
    quality: ReadQuality;
};

export type PageReport = {
    page: number;
    quality: ReadQuality;
    note: string | null;
};

/** Checkpoint artifact for one page range; stored in R2 so retries resume instead of re-calling the LLM. */
export type ChunkTranscription = {
    page_start: number;
    page_end: number;
    pages: PageReport[];
    blocks: TranscribedBlock[];
    error: string | null;
};

/** ERROR blocks publication (the job needs review); WARNING records a deterministic repair or note. */
export type IssueSeverity = "ERROR" | "WARNING";

export type ValidationIssue = {
    severity: IssueSeverity;
    code: string;
    message: string;
    page: number | null;
};

/** Permanent problem with the input or its result: do not retry, surface it for review. */
export class NeedsReviewError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "NeedsReviewError";
    }
}
