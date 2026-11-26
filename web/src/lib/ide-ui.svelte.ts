export type ActivityView = "explorer" | "search" | "scm" | "debug" | "library" | "relations" | "behaviors";

class IdeUiStore {
    activeView = $state<ActivityView>("explorer");
    sidebarOpen = $state<boolean>(true);
    scmBadgeCount = $state<number>(0);
    relationViolationCount = $state<number>(0);
    behaviorCount = $state<number>(0);
    highlightedBehaviorKey = $state<string | null>(null);
    highlightedBehaviorNonce = $state<number>(0);
    settingsOpen = $state<boolean>(false);

    selectView(view: ActivityView): void {
        if (this.activeView === view && this.sidebarOpen) {
            this.sidebarOpen = false;

            return;
        }

        this.activeView = view;
        this.sidebarOpen = true;
    }

    openView(view: ActivityView): void {
        this.activeView = view;
        this.sidebarOpen = true;
    }

    focusBehavior(canonicalKey: string): void {
        this.activeView = "behaviors";
        this.sidebarOpen = true;
        this.highlightedBehaviorKey = canonicalKey;
        this.highlightedBehaviorNonce += 1;
    }

    openSettings(): void {
        this.settingsOpen = true;
    }

    closeSettings(): void {
        this.settingsOpen = false;
    }
}

export const ideUi = new IdeUiStore();
