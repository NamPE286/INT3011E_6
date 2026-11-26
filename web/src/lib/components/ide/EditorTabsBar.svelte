<script lang="ts">
    import { BookOpen, FileDiff, FileText, X } from "@lucide/svelte";

    export type OpenTabView = {
        path: string;
        title: string;
        name: string;
        isLibrary: boolean;
        isDirty: boolean;
    };

    type Props = {
        tabs: OpenTabView[];
        activePath: string | null;
        diffTab: { id: string; label: string } | null;
        activeDiffOpen: boolean;
        onSelectTab: (path: string) => void;
        onCloseTab: (path: string) => void;
        onSelectDiffTab: () => void;
        onCloseDiffTab: () => void;
        onTabContextMenu: (event: MouseEvent, path: string) => void;
    };

    let {
        tabs,
        activePath,
        diffTab,
        activeDiffOpen,
        onSelectTab,
        onCloseTab,
        onSelectDiffTab,
        onCloseDiffTab,
        onTabContextMenu,
    }: Props = $props();
</script>

<div class="ide-scroll flex h-9 shrink-0 items-center overflow-x-auto border-b bg-[var(--ide-chrome)] select-none">
    {#each tabs as tab (tab.path)}
        {@const isActive = !activeDiffOpen && activePath === tab.path}
        <div
            role="tab"
            tabindex="0"
            aria-selected={isActive}
            title={`${tab.title} (${tab.path})`}
            onauxclick={(event) => {
                if (event.button === 1) {
                    event.preventDefault();
                    onCloseTab(tab.path);
                }
            }}
            oncontextmenu={(event) => {
                event.preventDefault();
                onTabContextMenu(event, tab.path);
            }}
            class={`group flex h-full shrink-0 items-center gap-1.5 border-r pr-1.5 pl-2.5 text-xs transition-colors ${
                isActive
                    ? "border-t-2 border-t-primary bg-[var(--ide-editor)] text-foreground"
                    : "border-t-2 border-t-transparent text-muted-foreground hover:bg-background/30 hover:text-foreground"
            }`}
        >
            <button
                type="button"
                onclick={() => onSelectTab(tab.path)}
                class="flex h-full items-center gap-1.5 text-left"
            >
                {#if tab.isLibrary}
                    <BookOpen class="size-3.5 shrink-0 text-[var(--syn-article)]" aria-hidden="true" />
                {:else}
                    <FileText class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                {/if}
                <span class="max-w-[180px] truncate font-medium">{tab.title}</span>
            </button>

            <button
                type="button"
                onclick={(event) => {
                    event.stopPropagation();
                    onCloseTab(tab.path);
                }}
                title="Đóng tab"
                class="flex size-4 shrink-0 items-center justify-center rounded-[2px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
                {#if tab.isDirty}
                    <span class="size-2 rounded-full bg-foreground/80 group-hover:hidden"></span>
                    <X class="hidden size-3 group-hover:block" aria-hidden="true" />
                {:else}
                    <X class="size-3 opacity-60 group-hover:opacity-100" aria-hidden="true" />
                {/if}
            </button>
        </div>
    {/each}

    {#if diffTab}
        <div
            role="tab"
            tabindex="0"
            aria-selected={activeDiffOpen}
            class={`group flex h-full shrink-0 items-center gap-1.5 border-r pr-1.5 pl-2.5 text-xs ${
                activeDiffOpen
                    ? "border-t-2 border-t-[var(--diag-ambiguity)] bg-[var(--ide-editor)] text-foreground"
                    : "border-t-2 border-t-transparent text-muted-foreground hover:bg-background/30 hover:text-foreground"
            }`}
        >
            <button
                type="button"
                onclick={onSelectDiffTab}
                class="flex h-full items-center gap-1.5 text-left"
            >
                <FileDiff class="size-3.5 shrink-0 text-[var(--diag-ambiguity)]" aria-hidden="true" />
                <span class="max-w-[190px] truncate font-medium">Diff: {diffTab.label}</span>
            </button>
            <button
                type="button"
                onclick={onCloseDiffTab}
                title="Đóng tab Diff"
                class="flex size-4 shrink-0 items-center justify-center rounded-[2px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
                <X class="size-3" aria-hidden="true" />
            </button>
        </div>
    {/if}
</div>
