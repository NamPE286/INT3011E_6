import type { ReadQuality } from "../processing/legal-types";

export const ROLE_METHOD = "RULE";
export const ROLE_VERSION = "provision-roles-v1";

export type ProvisionLevel = "PREAMBLE" | "PART" | "CHAPTER" | "SECTION" | "ARTICLE" | "CLAUSE" | "POINT";

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
    flags: ProvisionFlag[];
};

export type Provision = ProvisionDraft & {
    contentRole: ContentRole;
    relevance: Relevance;
    /** The instruction that opened the quote this provision sits in; null when it is not quoted text. */
    containerProvisionId: string | null;
    /** Text found between quotation marks in this provision (for "Thay cụm từ “A” bằng “B”": ["A", "B"]). */
    quotedSegments: string[];
};

export type ProvisionSummary = {
    total: number;
    byContentRole: Partial<Record<ContentRole, number>>;
    byRelevance: Partial<Record<Relevance, number>>;
    flagged: number;
};
