import { getBackendUrl } from "./client";
import { requestJson } from "./http";

export type WorkspaceStats = {
    documentCount: number;
    provisionCount: number;
    relationCount: number;
    sanctionChangeCount: number;
};

export type WorkspaceSummary = {
    id: string;
    ownerUserId: string;
    name: string;
    description: string | null;
    domain: string;
    createdAt: string;
    updatedAt: string;
    stats: WorkspaceStats;
};

export type ManualProvisionLevel = "CHAPTER" | "SECTION" | "ARTICLE" | "CLAUSE" | "POINT";

export async function listWorkspaces(fetcher: typeof fetch = fetch): Promise<WorkspaceSummary[]> {
    const body = (await requestJson(getBackendUrl(), "/api/workspaces", {}, fetcher)) as {
        workspaces: WorkspaceSummary[];
    };

    return body.workspaces;
}

export async function createWorkspaceApi(
    input: { name: string; description?: string | null; domain?: string; seedSample?: boolean },
    fetcher: typeof fetch = fetch,
): Promise<WorkspaceSummary> {
    const body = (await requestJson(
        getBackendUrl(),
        "/api/workspaces",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        },
        fetcher,
    )) as { workspace: WorkspaceSummary };

    return body.workspace;
}

export async function updateWorkspaceApi(
    workspaceId: string,
    input: { name?: string; description?: string | null; domain?: string },
    fetcher: typeof fetch = fetch,
): Promise<WorkspaceSummary> {
    const body = (await requestJson(
        getBackendUrl(),
        `/api/workspaces/${encodeURIComponent(workspaceId)}`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        },
        fetcher,
    )) as { workspace: WorkspaceSummary };

    return body.workspace;
}

export async function deleteWorkspaceApi(workspaceId: string, fetcher: typeof fetch = fetch): Promise<void> {
    await requestJson(
        getBackendUrl(),
        `/api/workspaces/${encodeURIComponent(workspaceId)}`,
        { method: "DELETE" },
        fetcher,
    );
}

export async function createManualDocumentApi(
    input: {
        title: string;
        documentNumber: string;
        documentType?: string | null;
        agency?: string | null;
        issuedAt?: string | null;
        effectiveFrom?: string | null;
    },
    fetcher: typeof fetch = fetch,
): Promise<{ id: string }> {
    const body = (await requestJson(
        getBackendUrl(),
        "/api/manual/documents",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        },
        fetcher,
    )) as { document: { id: string } };

    return body.document;
}

export async function updateManualDocumentApi(
    documentId: string,
    input: {
        title?: string;
        documentNumber?: string | null;
        documentType?: string | null;
        agency?: string | null;
        issuedAt?: string | null;
        effectiveFrom?: string | null;
    },
    fetcher: typeof fetch = fetch,
): Promise<void> {
    await requestJson(
        getBackendUrl(),
        `/api/manual/documents/${encodeURIComponent(documentId)}`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        },
        fetcher,
    );
}

export async function deleteManualDocumentApi(documentId: string, fetcher: typeof fetch = fetch): Promise<void> {
    await requestJson(
        getBackendUrl(),
        `/api/manual/documents/${encodeURIComponent(documentId)}`,
        { method: "DELETE" },
        fetcher,
    );
}

export async function insertManualProvisionApi(
    documentId: string,
    input: {
        parentId?: string | null;
        level: ManualProvisionLevel;
        number: string;
        title?: string | null;
        text?: string | null;
    },
    fetcher: typeof fetch = fetch,
): Promise<void> {
    await requestJson(
        getBackendUrl(),
        `/api/manual/documents/${encodeURIComponent(documentId)}/provisions`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        },
        fetcher,
    );
}

export async function updateManualProvisionApi(
    documentId: string,
    provisionId: string,
    input: {
        level?: ManualProvisionLevel;
        number?: string;
        title?: string | null;
        text?: string | null;
    },
    fetcher: typeof fetch = fetch,
): Promise<void> {
    await requestJson(
        getBackendUrl(),
        `/api/manual/documents/${encodeURIComponent(documentId)}/provisions/${encodeURIComponent(provisionId)}`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        },
        fetcher,
    );
}

export async function deleteManualProvisionApi(
    documentId: string,
    provisionId: string,
    fetcher: typeof fetch = fetch,
): Promise<void> {
    await requestJson(
        getBackendUrl(),
        `/api/manual/documents/${encodeURIComponent(documentId)}/provisions/${encodeURIComponent(provisionId)}`,
        { method: "DELETE" },
        fetcher,
    );
}

export async function createManualDocumentRelationApi(
    input: {
        fromDocumentId: string;
        toDocumentId: string;
        relationType: string;
        scope?: string;
        note?: string | null;
    },
    fetcher: typeof fetch = fetch,
): Promise<void> {
    await requestJson(
        getBackendUrl(),
        "/api/manual/graph/document-relations",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        },
        fetcher,
    );
}

export async function deleteManualDocumentRelationApi(relationId: string, fetcher: typeof fetch = fetch): Promise<void> {
    await requestJson(
        getBackendUrl(),
        `/api/manual/graph/document-relations/${encodeURIComponent(relationId)}`,
        { method: "DELETE" },
        fetcher,
    );
}

export async function createManualSanctionEdgeApi(
    input: {
        fromDocumentId: string;
        toDocumentId: string;
        fromProvisionId?: string | null;
        toProvisionId?: string | null;
        behaviorSummary: string;
        changeType: string;
        oldPenaltyText?: string | null;
        newPenaltyText?: string | null;
        oldFineMin?: number | null;
        oldFineMax?: number | null;
        newFineMin?: number | null;
        newFineMax?: number | null;
        note?: string | null;
    },
    fetcher: typeof fetch = fetch,
): Promise<void> {
    await requestJson(
        getBackendUrl(),
        "/api/manual/graph/sanction-edges",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        },
        fetcher,
    );
}

export async function deleteManualSanctionEdgeApi(edgeId: string, fetcher: typeof fetch = fetch): Promise<void> {
    await requestJson(
        getBackendUrl(),
        `/api/manual/graph/sanction-edges/${encodeURIComponent(edgeId)}`,
        { method: "DELETE" },
        fetcher,
    );
}
