export type WorkspaceSummary = {
    id: string;
    ownerUserId: string;
    name: string;
    description: string | null;
    domain: string;
    createdAt: string;
    updatedAt: string;
    stats: {
        documentCount: number;
        provisionCount: number;
        relationCount: number;
        sanctionChangeCount: number;
    };
};

export type CreateWorkspaceInput = {
    name: string;
    description?: string | null;
    domain?: string;
    seedSample?: boolean;
};

export type UpdateWorkspaceInput = {
    name?: string;
    description?: string | null;
    domain?: string;
};

export type WorkspaceAccessResult =
    | { ok: true; workspaceId: string; userId: string | null }
    | { ok: false; status: 401 | 403 | 404; message: string };
