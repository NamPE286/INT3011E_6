import { env } from "$env/dynamic/public";
import {
    parseImpactScopeReport,
    parseLogicAuditReport,
    parseWorkspaceAuditOverview,
    type ImpactScopeReport,
    type LogicAuditReport,
    type WorkspaceAuditOverview,
} from "./analysis";
import { parseAskAnswer, type AskAnswer } from "./ask";
import {
    parseDocumentDependents,
    parseDocumentRelations,
    parseDocumentSearch,
    parseDocumentView,
    type DocumentDependents,
    type DocumentRelations,
    type DocumentSearch,
    type DocumentView,
} from "./documents";
import {
    parseAnalysisResult,
    parseDebugSimulationResult,
    parseDraftListResponse,
    parseDraftWithAnalysis,
    parseWorkspaceContext,
    type AnalysisResult,
    type DebugSimulationResult,
    type DraftListResponse,
    type DraftWithAnalysis,
    type WorkspaceContext,
} from "./ide";
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

export function getDocumentDependents(fetcher: Fetcher, documentId: string): Promise<DocumentDependents> {
    return getParsed(fetcher, `/api/documents/${encodeURIComponent(documentId)}/dependents`, parseDocumentDependents);
}

/** Deletes a leaf document with its relations; the backend refuses (409) while another document acts on it. */
export async function deleteDocument(fetcher: Fetcher, documentId: string): Promise<void> {
    await requestJson(getBackendUrl(), `/api/documents/${encodeURIComponent(documentId)}`, { method: "DELETE" }, fetcher);
}

export function getDocumentAudit(documentId: string, fetcher: Fetcher = fetch): Promise<LogicAuditReport> {
    return getParsed(fetcher, `/api/documents/${encodeURIComponent(documentId)}/audit`, parseLogicAuditReport);
}

export function getDocumentImpact(documentId: string, maxDepth = 3, fetcher: Fetcher = fetch): Promise<ImpactScopeReport> {
    return getParsed(
        fetcher,
        `/api/documents/${encodeURIComponent(documentId)}/impact${encodeQuery({ max_depth: String(maxDepth) })}`,
        parseImpactScopeReport,
    );
}

export function getWorkspaceAuditOverviewApi(fetcher: Fetcher = fetch): Promise<WorkspaceAuditOverview> {
    return getParsed(fetcher, "/api/workspace/audit-summary", parseWorkspaceAuditOverview);
}

export function listIdeDrafts(fetcher: Fetcher): Promise<DraftListResponse> {
    return getParsed(fetcher, "/api/ide/drafts", parseDraftListResponse);
}

export function getIdeDraft(fetcher: Fetcher, id: string): Promise<DraftWithAnalysis> {
    return getParsed(fetcher, `/api/ide/drafts/${encodeURIComponent(id)}`, parseDraftWithAnalysis);
}

export async function createIdeDraft(
    fetcher: Fetcher,
    payload: {
        title?: string;
        documentNumber?: string | null;
        documentType?: string | null;
        agency?: string | null;
        content?: string;
        templateId?: string;
        sourceDocumentId?: string;
    },
): Promise<DraftWithAnalysis> {
    const body = await requestJson(
        getBackendUrl(),
        "/api/ide/drafts",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        },
        fetcher,
    );
    const parsed = parseDraftWithAnalysis(body);

    if (parsed === null) {
        throw invalidResponse();
    }

    return parsed;
}

export async function updateIdeDraft(
    fetcher: Fetcher,
    id: string,
    payload: {
        title?: string;
        documentNumber?: string | null;
        content?: string;
    },
): Promise<DraftWithAnalysis> {
    const body = await requestJson(
        getBackendUrl(),
        `/api/ide/drafts/${encodeURIComponent(id)}`,
        {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        },
        fetcher,
    );
    const parsed = parseDraftWithAnalysis(body);

    if (parsed === null) {
        throw invalidResponse();
    }

    return parsed;
}

export async function deleteIdeDraft(fetcher: Fetcher, id: string): Promise<void> {
    await requestJson(getBackendUrl(), `/api/ide/drafts/${encodeURIComponent(id)}`, { method: "DELETE" }, fetcher);
}

export async function analyzeIdeDraft(
    fetcher: Fetcher,
    payload: { content: string; includeAi?: boolean; model?: string | null },
): Promise<AnalysisResult> {
    const body = await requestJson(
        getBackendUrl(),
        "/api/ide/analyze",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                content: payload.content,
                includeAi: payload.includeAi ?? false,
                model: payload.model || undefined,
            }),
        },
        fetcher,
    );
    const parsed = parseAnalysisResult(body);

    if (parsed === null) {
        throw invalidResponse();
    }

    return parsed;
}

export function getIdeWorkspaceContext(fetcher: Fetcher): Promise<WorkspaceContext> {
    return getParsed(fetcher, "/api/ide/workspace-context", parseWorkspaceContext);
}

export async function runIdeDebug(
    fetcher: Fetcher,
    payload: {
        content: string;
        scenario: string;
        ambiguityOverrides?: Record<string, boolean>;
        useAi?: boolean;
        model?: string | null;
    },
): Promise<DebugSimulationResult> {
    const body = await requestJson(
        getBackendUrl(),
        "/api/ide/debug",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                content: payload.content,
                scenario: payload.scenario,
                ambiguityOverrides: payload.ambiguityOverrides,
                useAi: payload.useAi ?? false,
                model: payload.model || undefined,
            }),
        },
        fetcher,
    );
    const parsed = parseDebugSimulationResult(body);

    if (parsed === null) {
        throw invalidResponse();
    }

    return parsed;
}

export type ImportedLibraryItem = {
    id: string;
    title: string;
    documentNumber: string;
    provisionCount?: number;
    termCount: number;
};

export type LibraryImportPayload = {
    title: string;
    documentNumber: string;
    documentType?: string | null;
    agency?: string | null;
    content: string;
};

export async function importLibraryLaw(
    fetcher: Fetcher,
    payload: LibraryImportPayload,
): Promise<ImportedLibraryItem> {
    const body = await requestJson(
        getBackendUrl(),
        "/api/ide/library/import",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        },
        fetcher,
    );

    if (typeof body !== "object" || body === null || !("imported" in body)) {
        throw invalidResponse();
    }

    return (body as { imported: ImportedLibraryItem }).imported;
}

export async function importLibraryBatch(
    fetcher: Fetcher,
    laws: readonly LibraryImportPayload[],
): Promise<{ items: ImportedLibraryItem[]; count: number }> {
    const body = await requestJson(
        getBackendUrl(),
        "/api/ide/library/import",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ laws }),
        },
        fetcher,
    );

    if (typeof body !== "object" || body === null || !("items" in body) || !Array.isArray((body as { items: unknown }).items)) {
        throw invalidResponse();
    }

    const parsed = body as { items: ImportedLibraryItem[]; count?: number };

    return {
        items: parsed.items,
        count: typeof parsed.count === "number" ? parsed.count : parsed.items.length,
    };
}

export async function importLibraryZip(
    fetcher: Fetcher,
    file: File,
): Promise<{ items: ImportedLibraryItem[]; count: number; skipped: string[] }> {
    const formData = new FormData();
    formData.append("file", file);

    const body = await requestJson(
        getBackendUrl(),
        "/api/ide/library/import-zip",
        {
            method: "POST",
            body: formData,
        },
        fetcher,
    );

    if (typeof body !== "object" || body === null || !("items" in body) || !Array.isArray((body as { items: unknown }).items)) {
        throw invalidResponse();
    }

    const parsed = body as { items: ImportedLibraryItem[]; count?: number; skipped?: string[] };

    return {
        items: parsed.items,
        count: typeof parsed.count === "number" ? parsed.count : parsed.items.length,
        skipped: Array.isArray(parsed.skipped) ? parsed.skipped : [],
    };
}

export function getSampleLibraryZipUrl(): string {
    return `${getBackendUrl()}/api/ide/library/sample-zip`;
}

export async function deleteLibraryLaw(fetcher: Fetcher, id: string): Promise<void> {
    await requestJson(getBackendUrl(), `/api/ide/library/${encodeURIComponent(id)}`, { method: "DELETE" }, fetcher);
}

export type ExportDocumentPayload = {
    title: string;
    documentNumber?: string | null;
    documentType?: string | null;
    agency?: string | null;
    content: string;
};

export async function exportIdeDocx(fetcher: Fetcher, payload: ExportDocumentPayload): Promise<Blob> {
    const response = await fetcher(`${getBackendUrl()}/api/ide/export/docx`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error(`Xuất DOCX thất bại (${response.status})`);
    }

    return response.blob();
}

export async function exportIdePrintHtml(fetcher: Fetcher, payload: ExportDocumentPayload): Promise<string> {
    const response = await fetcher(`${getBackendUrl()}/api/ide/export/html`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error(`Xuất bản in thất bại (${response.status})`);
    }

    return response.text();
}
