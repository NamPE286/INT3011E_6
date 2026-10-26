import { PUBLIC_BACKEND_URL } from "$env/static/public";
import { parseAskAnswer, type AskAnswer } from "./ask";
import { parseDocumentRelations, parseDocumentSearch, parseDocumentView, type DocumentRelations, type DocumentSearch, type DocumentView } from "./documents";
import { invalidResponse, requestJson } from "./http";
import {
    parseViolationHistory,
    parseViolationRulesAsOf,
    parseViolationSearch,
    parseViolationSummary,
    type ViolationHistory,
    type ViolationRulesAsOf,
    type ViolationSummary,
} from "./violations";

type Fetcher = typeof fetch;

async function getParsed<T>(fetcher: Fetcher, path: string, parse: (value: unknown) => T | null): Promise<T> {
    const body = await requestJson(PUBLIC_BACKEND_URL, path, {}, fetcher);
    const parsed = parse(body);

    if (parsed === null) {
        throw invalidResponse();
    }

    return parsed;
}

function encodeQuery(parameters: Record<string, string | null>): string {
    const search = new URLSearchParams();

    for (const [key, value] of Object.entries(parameters)) {
        if (value) {
            search.set(key, value);
        }
    }

    const text = search.toString();

    return text ? `?${text}` : "";
}

export function searchDocuments(fetcher: Fetcher, query: string, documentType: string | null): Promise<DocumentSearch> {
    return getParsed(fetcher, `/api/documents${encodeQuery({ q: query.trim(), document_type: documentType })}`, parseDocumentSearch);
}

export function getDocument(fetcher: Fetcher, documentId: string): Promise<DocumentView> {
    return getParsed(fetcher, `/api/documents/${encodeURIComponent(documentId)}`, parseDocumentView);
}

export function getDocumentRelations(fetcher: Fetcher, documentId: string): Promise<DocumentRelations> {
    return getParsed(fetcher, `/api/documents/${encodeURIComponent(documentId)}/relations`, parseDocumentRelations);
}

export function searchViolations(fetcher: Fetcher, query: string): Promise<ViolationSummary[]> {
    return getParsed(fetcher, `/api/violations${encodeQuery({ q: query.trim() })}`, parseViolationSearch);
}

export function getViolation(fetcher: Fetcher, violationId: string): Promise<ViolationSummary> {
    return getParsed(fetcher, `/api/violations/${encodeURIComponent(violationId)}`, parseViolationSummary);
}

export function getViolationRulesAsOf(fetcher: Fetcher, violationId: string, asOf: string): Promise<ViolationRulesAsOf> {
    return getParsed(fetcher, `/api/violations/${encodeURIComponent(violationId)}/rules${encodeQuery({ as_of: asOf })}`, parseViolationRulesAsOf);
}

export function getViolationHistory(fetcher: Fetcher, violationId: string): Promise<ViolationHistory> {
    return getParsed(fetcher, `/api/violations/${encodeURIComponent(violationId)}/history`, parseViolationHistory);
}

export async function askQuestion(question: string, asOf: string, fetcher: Fetcher = fetch): Promise<AskAnswer> {
    const body = await requestJson(
        PUBLIC_BACKEND_URL,
        "/api/ask",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question, as_of: asOf }),
        },
        fetcher,
    );
    const answer = parseAskAnswer(body);

    if (answer === null) {
        throw invalidResponse();
    }

    return answer;
}
