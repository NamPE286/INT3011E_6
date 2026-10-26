import type { ReadQuality, SourceRegion } from "../processing/legal-types";

export const ROLE_METHOD = "RULE";
export const ROLE_VERSION = "provision-roles-v1";

/** TEXT: an unnumbered paragraph of quoted wording. */
export type ProvisionLevel = "PREAMBLE" | "PART" | "CHAPTER" | "SECTION" | "ARTICLE" | "CLAUSE" | "POINT" | "TEXT";

/** What a piece of text does in the document (document-graph-build §5.2). */
export type ContentRole =
    | "OPERATIVE_INSTRUCTION"
    | "PREAMBLE_BASIS"
    | "QUOTED_NEW_TEXT"
    | "QUOTED_OLD_TEXT"
    | "HISTORICAL_DESCRIPTION"
    | "TITLE_REFERENCE"
    | "ORDINARY_TEXT";

/** How the provision matters for sanction intelligence (SRS FR-05). */
export type Relevance =
    | "SANCTION_RULE"
    | "VIOLATION_RULE"
    | "AMENDMENT_INSTRUCTION"
    | "REPEAL_INSTRUCTION"
    | "REFERENCE"
    | "IRRELEVANT"
    | "UNCERTAIN";

export type ProvisionFlag =
    | "DUPLICATE_ID"
    | "HAS_QUOTED_TEXT"
    | "LOW_READ_QUALITY"
    | "QUOTE_WITHOUT_INSTRUCTION"
    | "UNBALANCED_QUOTE"
    | "UNREADABLE";

export type ProvisionDraft = {
    id: string;
    documentId: string;
    parentId: string | null;
    ordinal: number;
    level: ProvisionLevel;
    number: string;
    title: string | null;
    text: string | null;
    articleNo: string | null;
    paragraphNo: string | null;
    pointNo: string | null;
    pageStart: number | null;
    pageEnd: number | null;
    sourceQuote: string | null;
    readQuality: ReadQuality | null;
    sourceRegions: SourceRegion[];
    flags: ProvisionFlag[];
    /** For quoted new wording (legal JSON `quoted`): the provision whose instruction quotes it. */
    quoteHostId: string | null;
};

export type Provision = ProvisionDraft & {
    contentRole: ContentRole;
    relevance: Relevance;
    /** The instruction that opened the quote this provision sits in; null when it is not quoted text. */
    containerProvisionId: string | null;
    /** Text found between quotation marks in this provision (for "Thay cụm từ “A” bằng “B”": ["A", "B"]). */
    quotedSegments: string[];
};

/** Where the provision text came from (FR-04): the snapshot, its PDF hash and how it was read. */
export type ProvisionSource = {
    sourceSnapshotId: string | null;
    pdfSha256: string | null;
    readMethod: string | null;
};

export type ProvisionSummary = {
    total: number;
    byContentRole: Partial<Record<ContentRole, number>>;
    byRelevance: Partial<Record<Relevance, number>>;
    flagged: number;
};
