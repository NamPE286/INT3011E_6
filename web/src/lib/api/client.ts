import { env } from "$env/dynamic/public";
import { parseAskAnswer, type AskAnswer } from "./ask";
import { parseDocumentRelations, parseDocumentSearch, parseDocumentView, type DocumentRelations, type DocumentSearch, type DocumentView } from "./documents";
import { parseRelationGraph, type RelationGraph } from "./graph";
import { invalidResponse, requestJson, resolveBackendUrl } from "./http";
import { parseModelOptions, type ModelOptions } from "./models";
import {
    parseDocumentActions,
    parseJobDocument,
    parsePreprocessingChecklist,
    type DocumentAction,
    type JobDocument,
    type PreprocessingStage,
} from "./review";
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

/** Read at request time so one build can be deployed against any backend set as a Worker variable. */
export function getBackendUrl(): string {
    return resolveBackendUrl(env.PUBLIC_BACKEND_URL);
}

async function getParsed<T>(fetcher: Fetcher, path: string, parse: (value: unknown) => T | null): Promise<T> {
    const body = await requestJson(getBackendUrl(), path, {}, fetcher);
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

export function searchDocuments(fetcher: Fetcher, query: string, documentType: string | null, limit: number | null = null): Promise<DocumentSearch> {
    const parameters = { q: query.trim(), document_type: documentType, limit: limit === null ? null : String(limit) };

    return getParsed(fetcher, `/api/documents${encodeQuery(parameters)}`, parseDocumentSearch);
}

export function getDocument(fetcher: Fetcher, documentId: string): Promise<DocumentView> {
    return getParsed(fetcher, `/api/documents/${encodeURIComponent(documentId)}`, parseDocumentView);
}

export function getDocumentRelations(fetcher: Fetcher, documentId: string): Promise<DocumentRelations> {
    return getParsed(fetcher, `/api/documents/${encodeURIComponent(documentId)}/relations`, parseDocumentRelations);
}

export function getRelationGraph(fetcher: Fetcher): Promise<RelationGraph> {
    return getParsed(fetcher, "/api/graph", parseRelationGraph);
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

export function getModelOptions(fetcher: Fetcher): Promise<ModelOptions> {
    return getParsed(fetcher, "/api/models", parseModelOptions);
}

export async function askQuestion(question: string, asOf: string, model: string | null, fetcher: Fetcher = fetch): Promise<AskAnswer> {
    const body = await requestJson(
        getBackendUrl(),
        "/api/ask",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question, as_of: asOf, model: model || undefined }),
        },
        fetcher,
    );
    const answer = parseAskAnswer(body);

    if (answer === null) {
        throw invalidResponse();
    }

    return answer;
}

export function getJobDocument(fetcher: Fetcher, jobId: string): Promise<JobDocument> {
    return getParsed(fetcher, `/api/jobs/${encodeURIComponent(jobId)}/document`, parseJobDocument);
}

export function getDocumentActions(fetcher: Fetcher, documentId: string): Promise<DocumentAction[]> {
    return getParsed(fetcher, `/api/documents/${encodeURIComponent(documentId)}/violation-rules`, parseDocumentActions);
}

export function getPreprocessingChecklist(fetcher: Fetcher, jobId: string): Promise<PreprocessingStage[]> {
    return getParsed(fetcher, `/api/jobs/${encodeURIComponent(jobId)}/preprocessing`, parsePreprocessingChecklist);
}

/** Queues the checklist again from its first stage that is not done. */
export async function rerunMissingPreprocessing(fetcher: Fetcher, jobId: string): Promise<void> {
    await requestJson(getBackendUrl(), `/api/jobs/${encodeURIComponent(jobId)}/preprocessing`, { method: "POST" }, fetcher);
}

/** Publishes a document that was held for review; the backend then queues the preprocessing stages. */
export async function acceptJobDocument(fetcher: Fetcher, jobId: string): Promise<void> {
    const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "accept" }) };

    await requestJson(getBackendUrl(), `/api/jobs/${encodeURIComponent(jobId)}/review`, init, fetcher);
}
