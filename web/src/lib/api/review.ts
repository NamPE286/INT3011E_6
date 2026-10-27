import { isRecord, readNumber, readRows, readString } from "./read";

export type ReviewStatus = "ACCEPTED" | "REVIEW_REQUIRED";
export type ReadQuality = "GOOD" | "PARTIAL" | "UNREADABLE";

export type ReviewIssue = {
    severity: "ERROR" | "WARNING";
    code: string;
    message: string;
    page: number | null;
};

export type NodeKind = "part" | "chapter" | "section" | "article" | "clause" | "point" | "text";

export type ReviewNode = {
    kind: NodeKind;
    number: string;
    title: string | null;
    content: string | null;
    pageStart: number | null;
    pageEnd: number | null;
    quality: ReadQuality;
    sourceQuote: string | null;
    /** Wording an amendment quotes; it is not part of the document's own numbering. */
    quoted: ReviewNode[];
    children: ReviewNode[];
};

export type DocumentSource = {
    snapshotId: string | null;
    pdfSha256: string | null;
    partIndex: number | null;
};

export type JobDocument = {
    jobId: string;
    reviewStatus: ReviewStatus;
    title: string | null;
    model: string | null;
    pageCount: number | null;
    issues: ReviewIssue[];
    content: string | null;
    source: DocumentSource;
    nodes: ReviewNode[];
    raw: unknown;
};

export function parseJobDocument(value: unknown): JobDocument | null {
    if (!isRecord(value)) {
        return null;
    }

    const jobId = readString(value, "jobId");
    const reviewStatus = readString(value, "reviewStatus");

    if (!jobId || (reviewStatus !== "ACCEPTED" && reviewStatus !== "REVIEW_REQUIRED")) {
        return null;
    }

    const extraction = isRecord(value.extraction) ? value.extraction : {};
    const document = isRecord(value.document) ? value.document : {};

    return {
        jobId,
        reviewStatus,
        title: readString(document, "document_title"),
        model: readString(extraction, "model"),
        pageCount: readNumber(extraction, "pageCount"),
        issues: readRows(value, "issues", parseIssue),
        content: readString(document, "content"),
        source: parseSource(document.source),
        nodes: parseChildren(document, ["parts", "chapters", "sections", "articles"]),
        raw: value.document ?? null,
    };
}

function parseIssue(row: Record<string, unknown>): ReviewIssue | null {
    const severity = readString(row, "severity");
    const code = readString(row, "code");
    const message = readString(row, "message");

    if ((severity !== "ERROR" && severity !== "WARNING") || !code || !message) {
        return null;
    }

    return { severity, code, message, page: readNumber(row, "page") };
}

function parseSource(value: unknown): DocumentSource {
    const source = isRecord(value) ? value : {};

    return {
        snapshotId: readString(source, "snapshot_id"),
        pdfSha256: readString(source, "pdf_sha256"),
        partIndex: readNumber(source, "part_index"),
    };
}

const CHILD_KEYS: { key: string; kind: NodeKind }[] = [
    { key: "parts", kind: "part" },
    { key: "chapters", kind: "chapter" },
    { key: "sections", kind: "section" },
    { key: "articles", kind: "article" },
    { key: "clauses", kind: "clause" },
    { key: "points", kind: "point" },
];

function parseChildren(container: Record<string, unknown>, keys: string[]): ReviewNode[] {
    const nodes: ReviewNode[] = [];

    for (const { key, kind } of CHILD_KEYS) {
        if (keys.includes(key)) {
            nodes.push(...readRows(container, key, (row) => parseNode(row, kind)));
        }
    }

    return nodes;
}

function parseNode(row: Record<string, unknown>, kind: NodeKind): ReviewNode | null {
    const number = readString(row, "number");

    if (number === null) {
        return null;
    }

    const locator = isRecord(row.source_locator) ? row.source_locator : {};
    const quality = readString(locator, "quality");
    const quoted = readRows(row, "quoted", (quotedRow) => parseNode(quotedRow, parseKind(readString(quotedRow, "kind"))));

    return {
        kind,
        number,
        title: readString(row, "title"),
        content: readString(row, "content"),
        pageStart: readNumber(locator, "page_start"),
        pageEnd: readNumber(locator, "page_end"),
        quality: quality === "PARTIAL" || quality === "UNREADABLE" ? quality : "GOOD",
        sourceQuote: readString(locator, "source_quote"),
        quoted,
        children: parseChildren(row, CHILD_KEYS.map((child) => child.key)),
    };
}

function parseKind(value: string | null): NodeKind {
    return CHILD_KEYS.find((child) => child.kind === value)?.kind ?? "text";
}

/** The action (hành vi vi phạm) a rule was read as, and the vocabulary entry it was matched to. */
export type DocumentAction = {
    ruleId: string;
    behaviorText: string;
    actionLabel: string | null;
    vocabId: string | null;
};

export function parseDocumentActions(value: unknown): DocumentAction[] | null {
    if (!isRecord(value) || !Array.isArray(value.rules)) {
        return null;
    }

    return readRows(value, "rules", parseDocumentAction);
}

function parseDocumentAction(row: Record<string, unknown>): DocumentAction | null {
    const ruleId = readString(row, "id");

    if (!ruleId) {
        return null;
    }

    const semantics = isRecord(row.semanticIr) ? row.semanticIr : {};
    const action = isRecord(semantics.action) ? semantics.action : {};

    return {
        ruleId,
        behaviorText: readString(row, "behaviorText") ?? "",
        actionLabel: readString(action, "label"),
        vocabId: readString(action, "vocabId"),
    };
}
