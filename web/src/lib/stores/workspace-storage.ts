const STORAGE_KEY = "soanluat.activeWorkspaceId";

export function readStoredWorkspaceId(): string | null {
    if (typeof window === "undefined") {
        return null;
    }

    try {
        const value = window.localStorage.getItem(STORAGE_KEY)?.trim() ?? "";

        return value.length > 0 ? value : null;
    } catch {
        return null;
    }
}

export function writeStoredWorkspaceId(workspaceId: string | null): void {
    if (typeof window === "undefined") {
        return;
    }

    try {
        if (!workspaceId) {
            window.localStorage.removeItem(STORAGE_KEY);
        } else {
            window.localStorage.setItem(STORAGE_KEY, workspaceId);
        }
    } catch {
        // Ignore storage quota or private mode errors.
    }
}
