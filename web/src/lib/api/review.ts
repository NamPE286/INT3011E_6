import { isRecord, readNumber, readRows, readString } from "./read";

export type ReviewStatus = "ACCEPTED" | "REVIEW_REQUIRED";
export type ReadQuality = "GOOD" | "PARTIAL" | "UNREADABLE";

export type ReviewIssue = {
    severity: "ERROR" | "WARNING";
    code: string;
    message: string;
    page: number | null;
};

export type ReviewArticle = {
    number: string;
    title: string | null;
    clauseCount: number;
    pageStart: number | null;
    quality: ReadQuality;
};

export type JobDocument = {
    jobId: string;
    reviewStatus: ReviewStatus;
    title: string | null;
    model: string | null;
    pageCount: number | null;
    issues: ReviewIssue[];
    articles: ReviewArticle[];
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
        articles: collectArticles(document),
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

/** Articles can sit under parts, chapters and sections; grouped articles come before the document's own. */
function collectArticles(container: Record<string, unknown>): ReviewArticle[] {
    const articles: ReviewArticle[] = [];

    for (const key of ["parts", "chapters", "sections"]) {
        for (const child of readRows(container, key, (row) => row)) {
            articles.push(...collectArticles(child));
        }
    }

    articles.push(...readRows(container, "articles", parseArticle));

    return articles;
}

function parseArticle(row: Record<string, unknown>): ReviewArticle | null {
    const number = readString(row, "number");

    if (!number) {
        return null;
    }

    const locator = isRecord(row.source_locator) ? row.source_locator : {};
    const quality = readString(locator, "quality");

    return {
        number,
        title: readString(row, "title"),
        clauseCount: Array.isArray(row.clauses) ? row.clauses.length : 0,
        pageStart: readNumber(locator, "page_start"),
        quality: quality === "PARTIAL" || quality === "UNREADABLE" ? quality : "GOOD",
    };
}
