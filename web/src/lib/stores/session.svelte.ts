import { createAuthClient } from "better-auth/client";
import { getBackendUrl } from "$lib/api/client";
import {
    createWorkspaceApi,
    deleteWorkspaceApi,
    listWorkspaces,
    updateWorkspaceApi,
    type WorkspaceSummary,
} from "$lib/api/workspaces";
import { readStoredWorkspaceId, writeStoredWorkspaceId } from "./workspace-storage";

export type SessionUser = {
    id: string;
    email: string;
    name: string;
};

function getAuthClient() {
    return createAuthClient({
        baseURL: getBackendUrl(),
        fetchOptions: {
            credentials: "include",
        },
    });
}

class SessionStore {
    user = $state<SessionUser | null>(null);
    workspaces = $state<WorkspaceSummary[]>([]);
    activeWorkspaceId = $state<string | null>(null);
    loading = $state(false);
    initialized = $state(false);

    get activeWorkspace(): WorkspaceSummary | null {
        return this.workspaces.find((ws) => ws.id === this.activeWorkspaceId) ?? this.workspaces[0] ?? null;
    }

    async init(): Promise<void> {
        if (typeof window === "undefined") {
            return;
        }

        this.loading = true;

        try {
            const client = getAuthClient();
            const result = await client.getSession();
            const foundUser = result.data?.user;

            if (foundUser) {
                this.user = {
                    id: foundUser.id,
                    email: foundUser.email,
                    name: foundUser.name,
                };
                await this.refreshWorkspaces();
            } else {
                this.user = null;
                this.workspaces = [];
                this.activeWorkspaceId = null;
                writeStoredWorkspaceId(null);
            }
        } catch {
            this.user = null;
            this.workspaces = [];
        } finally {
            this.loading = false;
            this.initialized = true;
        }
    }

    async refreshWorkspaces(): Promise<void> {
        if (!this.user) {
            return;
        }

        const list = await listWorkspaces();
        this.workspaces = list;

        const stored = readStoredWorkspaceId();
        const validStored = list.find((ws) => ws.id === stored);

        if (validStored) {
            this.activeWorkspaceId = validStored.id;
        } else if (list.length > 0) {
            this.activeWorkspaceId = list[0].id;
            writeStoredWorkspaceId(list[0].id);
        } else {
            this.activeWorkspaceId = null;
            writeStoredWorkspaceId(null);
        }
    }

    selectWorkspace(workspaceId: string): void {
        if (!this.workspaces.some((ws) => ws.id === workspaceId)) {
            return;
        }

        this.activeWorkspaceId = workspaceId;
        writeStoredWorkspaceId(workspaceId);
    }

    async signIn(email: string, password: string): Promise<{ ok: true } | { ok: false; message: string }> {
        const client = getAuthClient();
        const result = await client.signIn.email({
            email: email.trim(),
            password,
        });

        if (result.error) {
            return { ok: false, message: result.error.message || "Email hoặc mật khẩu không đúng" };
        }

        await this.init();

        return { ok: true };
    }

    async signUp(name: string, email: string, password: string): Promise<{ ok: true } | { ok: false; message: string }> {
        const client = getAuthClient();
        const result = await client.signUp.email({
            name: name.trim(),
            email: email.trim(),
            password,
        });

        if (result.error) {
            return { ok: false, message: result.error.message || "Không thể đăng ký tài khoản" };
        }

        await this.init();

        return { ok: true };
    }

    async signOut(): Promise<void> {
        const client = getAuthClient();
        await client.signOut();
        this.user = null;
        this.workspaces = [];
        this.activeWorkspaceId = null;
        writeStoredWorkspaceId(null);
    }

    async createWorkspace(input: {
        name: string;
        description?: string | null;
        domain?: string;
        seedSample?: boolean;
    }): Promise<WorkspaceSummary> {
        const created = await createWorkspaceApi(input);
        this.workspaces = [...this.workspaces, created];
        this.selectWorkspace(created.id);

        return created;
    }

    async updateWorkspace(
        workspaceId: string,
        input: { name?: string; description?: string | null; domain?: string },
    ): Promise<void> {
        const updated = await updateWorkspaceApi(workspaceId, input);
        this.workspaces = this.workspaces.map((ws) => (ws.id === workspaceId ? updated : ws));
    }

    async deleteWorkspace(workspaceId: string): Promise<void> {
        await deleteWorkspaceApi(workspaceId);
        this.workspaces = this.workspaces.filter((ws) => ws.id !== workspaceId);

        if (this.activeWorkspaceId === workspaceId) {
            const nextId = this.workspaces[0]?.id ?? null;
            this.activeWorkspaceId = nextId;
            writeStoredWorkspaceId(nextId);
        }
    }
}

export const sessionStore = new SessionStore();
