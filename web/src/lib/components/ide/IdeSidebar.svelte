<script lang="ts">
    import type { DebugSimulationResult, DraftNode, WorkspaceContext } from "$lib/api/ide";
    import type { LocalWorkspaceFile } from "$lib/engine/local-workspace";
    import type { WorkspaceBehaviorSummary } from "$lib/engine/workspace-behaviors";
    import type { WorkspaceRelationGraph } from "$lib/engine/workspace-relations";
    import { ideUi } from "$lib/ide-ui.svelte";
    import { BookOpen, ChevronDown, ChevronRight, FilePlus2, FileText, FolderOpen, Pencil, Sparkles, Trash2 } from "@lucide/svelte";
    import BehaviorsPanel from "./BehaviorsPanel.svelte";
    import DebugPanel from "./DebugPanel.svelte";
    import LibraryPanel from "./LibraryPanel.svelte";
    import RelationGraphPanel from "./RelationGraphPanel.svelte";
    import SearchReplacePanel from "./SearchReplacePanel.svelte";
    import SourceControlPanel, { type DraftCommit } from "./SourceControlPanel.svelte";

    type Props = {
        folderName: string | null;
        folderMode: "disk" | "virtual";
        pendingRestoreFolderName: string | null;
        workspaceFiles: LocalWorkspaceFile[];
        workspaceContext: WorkspaceContext | null;
        outline: DraftNode[];
        activeFilePath: string;
        activeLine: number;
        title: string;
        documentNumber: string;
        content: string;
        baseContent: string;
        commits: DraftCommit[];
        isDirty: boolean;
        saving: boolean;
        activeDiffId: string | null;
        renamingPath: string | null;
        debugResult: DebugSimulationResult | null;
        debugging: boolean;
        ambiguityOverrides: Record<string, boolean>;
        importingLibrary: boolean;
        libraryNotice: string | null;
        relationGraph: WorkspaceRelationGraph;
        behaviorSummary: WorkspaceBehaviorSummary;
        onJumpToFileLine: (path: string, line: number) => void;
        onPickFolder: () => void;
        onRestoreSavedFolder: () => void;
        onCreateNewFile: () => void;
        onSeedSampleFile: () => void;
        onSelectFile: (path: string) => void;
        onDeleteFile: (path: string) => void;
        onStartRename: (path: string) => void;
        onCommitRename: (oldPath: string, newName: string) => void;
        onCancelRename: () => void;
        onFileContextMenu: (event: MouseEvent, path: string) => void;
        onExplorerContextMenu: (event: MouseEvent) => void;
        onForkBaseLaw: (path: string) => void;
        onJumpToLine: (line: number, offset?: number) => void;
        onChangeContent: (next: string) => void;
        onCommit: (message: string) => void;
        onRestoreCommit: (commit: DraftCommit) => void;
        onOpenWorkingDiff: () => void;
        onOpenCommitDiff: (commit: DraftCommit) => void;
        onDiscardChanges: () => void;
        onRunDebug: (scenario: string, useAi: boolean) => void;
        onChangeOverride: (id: string, value: boolean) => void;
        onImportLibrary: (payload: { title: string; documentNumber: string; documentType: string; content: string }) => void;
        onImportLibraryBatch: (laws: { title: string; documentNumber: string; documentType: string; content: string }[]) => void;
        onImportLibraryZip: (file: File) => void;
        onDownloadSampleZip: () => void;
        onDeleteLibrary: (path: string) => void;
        onInsertBasis: (basisLine: string) => void;
    };

    let {
        folderName,
        folderMode,
        pendingRestoreFolderName,
        workspaceFiles,
        workspaceContext,
        outline,
        activeFilePath,
        activeLine,
        title,
        documentNumber,
        content,
        baseContent,
        commits,
        isDirty,
        saving,
        activeDiffId,
        renamingPath,
        debugResult,
        debugging,
        ambiguityOverrides,
        importingLibrary,
        libraryNotice,
        relationGraph,
        behaviorSummary,
        onJumpToFileLine,
        onPickFolder,
        onRestoreSavedFolder,
        onCreateNewFile,
        onSeedSampleFile,
        onSelectFile,
        onDeleteFile,
        onStartRename,
        onCommitRename,
        onCancelRename,
        onFileContextMenu,
        onExplorerContextMenu,
        onForkBaseLaw,
        onJumpToLine,
        onChangeContent,
        onCommit,
        onRestoreCommit,
        onOpenWorkingDiff,
        onOpenCommitDiff,
        onDiscardChanges,
        onRunDebug,
        onChangeOverride,
        onImportLibrary,
        onImportLibraryBatch,
        onImportLibraryZip,
        onDownloadSampleZip,
        onDeleteLibrary,
        onInsertBasis,
    }: Props = $props();

    let openFiles = $state(true);
    let openOutline = $state(true);
    let renameDraftName = $state("");
    let renameHandled = $state(false);

    const draftFiles = $derived(workspaceFiles.filter((file) => !file.isLibrary));
    const libraryFiles = $derived(workspaceFiles.filter((file) => file.isLibrary));

    $effect(() => {
        if (renamingPath) {
            const target = workspaceFiles.find((file) => file.path === renamingPath);
            renameDraftName = target?.name ?? renamingPath.split("/").pop() ?? "";
            renameHandled = false;
        }
    });

    function submitRenameOnce(oldPath: string): void {
        if (renameHandled || renamingPath !== oldPath) {
            return;
        }

        renameHandled = true;
        onCommitRename(oldPath, renameDraftName);
    }

    function cancelRenameOnce(): void {
        if (renameHandled) {
            return;
        }

        renameHandled = true;
        onCancelRename();
    }

    function autoFocusRename(node: HTMLInputElement): void {
        queueMicrotask(() => {
            node.focus();
            const dotIdx = node.value.lastIndexOf(".");
            node.setSelectionRange(0, dotIdx > 0 ? dotIdx : node.value.length);
        });
    }

    function indentClass(level: DraftNode["level"]): string {
        if (level === "CHAPTER") {
            return "pl-2 font-medium text-foreground";
        }

        if (level === "ARTICLE") {
            return "pl-3 text-foreground";
        }

        if (level === "CLAUSE") {
            return "pl-6 text-muted-foreground";
        }

        return "pl-9 text-muted-foreground";
    }
</script>

<aside class="flex h-full flex-col bg-[var(--ide-panel)] text-xs">
    {#if ideUi.activeView === "search"}
        <SearchReplacePanel
            {content}
            {onChangeContent}
            onJumpToOffset={(line, offset) => onJumpToLine(line, offset)}
        />
    {:else if ideUi.activeView === "scm"}
        <SourceControlPanel
            {title}
            {documentNumber}
            {baseContent}
            currentContent={content}
            {commits}
            {isDirty}
            {saving}
            {activeDiffId}
            {onCommit}
            {onRestoreCommit}
            {onOpenWorkingDiff}
            {onOpenCommitDiff}
            {onDiscardChanges}
        />
    {:else if ideUi.activeView === "debug"}
        <DebugPanel
            result={debugResult}
            running={debugging}
            {ambiguityOverrides}
            {onRunDebug}
            {onChangeOverride}
            onJumpToLine={(line) => onJumpToLine(line)}
        />
    {:else if ideUi.activeView === "library"}
        <LibraryPanel
            {libraryFiles}
            {workspaceContext}
            importing={importingLibrary}
            lastImportMessage={libraryNotice}
            {onImportLibrary}
            {onImportLibraryBatch}
            {onImportLibraryZip}
            {onDownloadSampleZip}
            {onDeleteLibrary}
            {onForkBaseLaw}
            {onInsertBasis}
        />
    {:else if ideUi.activeView === "relations"}
        <RelationGraphPanel graph={relationGraph} {onJumpToFileLine} />
    {:else if ideUi.activeView === "behaviors"}
        <BehaviorsPanel
            summary={behaviorSummary}
            highlightedBehaviorKey={ideUi.highlightedBehaviorKey}
            highlightedBehaviorNonce={ideUi.highlightedBehaviorNonce}
            {onJumpToFileLine}
        />
    {:else}
        <div class="flex h-9 shrink-0 items-center justify-between border-b px-2.5 select-none">
            <span class="truncate text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                {folderMode === "disk" && folderName ? folderName : "Explorer (Local)"}
            </span>
            <div class="flex items-center gap-0.5">
                <button
                    type="button"
                    onclick={onPickFolder}
                    title="Chọn thư mục trên máy"
                    class="rounded-[2px] p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                    <FolderOpen class="size-3.5" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    onclick={onCreateNewFile}
                    title="Tạo tệp dự thảo mới"
                    class="rounded-[2px] p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                    <FilePlus2 class="size-3.5" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    onclick={onSeedSampleFile}
                    title="Nạp bộ dự thảo mẫu (10 tệp)"
                    class="rounded-[2px] p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                    <Sparkles class="size-3.5" aria-hidden="true" />
                </button>
            </div>
        </div>

        {#if pendingRestoreFolderName}
            <div class="flex items-center justify-between gap-2 border-b bg-primary/10 px-2.5 py-1.5 text-[11px]">
                <span class="truncate text-foreground">Mở lại "{pendingRestoreFolderName}"?</span>
                <button
                    type="button"
                    onclick={onRestoreSavedFolder}
                    class="shrink-0 rounded-[2px] bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground hover:opacity-90"
                >
                    Cấp quyền
                </button>
            </div>
        {/if}

        <div
            role="region"
            aria-label="Danh sách tệp trong thư mục"
            class="ide-scroll flex-1 overflow-y-auto select-none"
            oncontextmenu={(event) => {
                event.preventDefault();
                onExplorerContextMenu(event);
            }}
        >
            <div class="border-b">
                <button
                    type="button"
                    onclick={() => (openFiles = !openFiles)}
                    class="flex w-full items-center gap-1 px-2 py-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase hover:bg-accent/50"
                >
                    {#if openFiles}
                        <ChevronDown class="size-3.5" aria-hidden="true" />
                    {:else}
                        <ChevronRight class="size-3.5" aria-hidden="true" />
                    {/if}
                    <span>Tệp trong thư mục ({workspaceFiles.length})</span>
                </button>

                {#if openFiles}
                    <div class="flex flex-col gap-2.5 px-1.5 pb-2.5">
                        {#if workspaceFiles.length === 0}
                            <div class="rounded-[2px] border bg-background/50 p-2.5 text-[11px] text-muted-foreground">
                                <p>Thư mục đang trống.</p>
                                <div class="mt-2 flex flex-wrap gap-1.5">
                                    <button
                                        type="button"
                                        onclick={onPickFolder}
                                        class="rounded-[2px] border bg-secondary px-2 py-1 text-[10px] text-foreground hover:bg-accent"
                                    >
                                        Chọn thư mục
                                    </button>
                                    <button
                                        type="button"
                                        onclick={onSeedSampleFile}
                                        class="rounded-[2px] bg-primary px-2 py-1 text-[10px] text-primary-foreground hover:opacity-90"
                                    >
                                        Nạp bộ dự thảo mẫu
                                    </button>
                                </div>
                            </div>
                        {:else}
                            {#if draftFiles.length > 0}
                                <div>
                                    <p class="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase">
                                        Dự thảo ({draftFiles.length})
                                    </p>
                                    <ul class="flex flex-col gap-0.5">
                                        {#each draftFiles as item (item.path)}
                                            {@const active = item.path === activeFilePath}
                                            <li
                                                class="group flex items-center gap-0.5"
                                                oncontextmenu={(event) => {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    onFileContextMenu(event, item.path);
                                                }}
                                            >
                                                {#if renamingPath === item.path}
                                                    <div class="flex min-w-0 flex-1 items-center gap-1 px-1.5 py-0.5">
                                                        <FileText class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                                                        <input
                                                            type="text"
                                                            use:autoFocusRename
                                                            bind:value={renameDraftName}
                                                            onkeydown={(event) => {
                                                                if (event.key === "Enter") {
                                                                    event.preventDefault();
                                                                    submitRenameOnce(item.path);
                                                                } else if (event.key === "Escape") {
                                                                    event.preventDefault();
                                                                    cancelRenameOnce();
                                                                }
                                                            }}
                                                            onblur={() => submitRenameOnce(item.path)}
                                                            aria-label="Đổi tên tệp"
                                                            class="h-6 min-w-0 flex-1 rounded-[2px] border border-primary bg-background px-1.5 font-mono text-[11px] text-foreground focus:outline-none"
                                                        />
                                                    </div>
                                                {:else}
                                                    <button
                                                        type="button"
                                                        onclick={() => onSelectFile(item.path)}
                                                        title={`${item.title}\n${item.path} (Chuột phải để đổi tên / thao tác)`}
                                                        class={`flex min-w-0 flex-1 items-center gap-1.5 rounded-[2px] px-2 py-1 text-left ${
                                                            active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                                                        }`}
                                                    >
                                                        <FileText class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                                                        <div class="min-w-0 flex-1">
                                                            <p class="truncate text-[11px] font-medium">{item.title}</p>
                                                            <p class="truncate font-mono text-[9px] text-muted-foreground">{item.name}</p>
                                                        </div>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onclick={() => onStartRename(item.path)}
                                                        title="Đổi tên tệp (F2)"
                                                        class="rounded-[2px] p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
                                                    >
                                                        <Pencil class="size-3" aria-hidden="true" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onclick={() => onDeleteFile(item.path)}
                                                        title="Xóa tệp khỏi thư mục"
                                                        class="rounded-[2px] p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
                                                    >
                                                        <Trash2 class="size-3" aria-hidden="true" />
                                                    </button>
                                                {/if}
                                            </li>
                                        {/each}
                                    </ul>
                                </div>
                            {/if}

                            {#if libraryFiles.length > 0}
                                <div>
                                    <p class="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase">
                                        Thư viện nền ({libraryFiles.length})
                                    </p>
                                    <ul class="flex flex-col gap-0.5">
                                        {#each libraryFiles as item (item.path)}
                                            {@const active = item.path === activeFilePath}
                                            <li
                                                class="group flex items-center gap-0.5"
                                                oncontextmenu={(event) => {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    onFileContextMenu(event, item.path);
                                                }}
                                            >
                                                {#if renamingPath === item.path}
                                                    <div class="flex min-w-0 flex-1 items-center gap-1 px-1.5 py-0.5">
                                                        <BookOpen class="size-3.5 shrink-0 text-[var(--syn-article)]" aria-hidden="true" />
                                                        <input
                                                            type="text"
                                                            use:autoFocusRename
                                                            bind:value={renameDraftName}
                                                            onkeydown={(event) => {
                                                                if (event.key === "Enter") {
                                                                    event.preventDefault();
                                                                    submitRenameOnce(item.path);
                                                                } else if (event.key === "Escape") {
                                                                    event.preventDefault();
                                                                    cancelRenameOnce();
                                                                }
                                                            }}
                                                            onblur={() => submitRenameOnce(item.path)}
                                                            aria-label="Đổi tên tệp thư viện"
                                                            class="h-6 min-w-0 flex-1 rounded-[2px] border border-primary bg-background px-1.5 font-mono text-[11px] text-foreground focus:outline-none"
                                                        />
                                                    </div>
                                                {:else}
                                                    <button
                                                        type="button"
                                                        onclick={() => onSelectFile(item.path)}
                                                        title={`${item.title}\n${item.path}`}
                                                        class={`flex min-w-0 flex-1 items-center gap-1.5 rounded-[2px] px-2 py-1 text-left ${
                                                            active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                                                        }`}
                                                    >
                                                        <BookOpen class="size-3.5 shrink-0 text-[var(--syn-article)]" aria-hidden="true" />
                                                        <div class="min-w-0 flex-1">
                                                            <p class="truncate text-[11px] font-medium">{item.title}</p>
                                                            <p class="truncate font-mono text-[9px] text-muted-foreground">{item.name}</p>
                                                        </div>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onclick={() => onStartRename(item.path)}
                                                        title="Đổi tên tệp"
                                                        class="rounded-[2px] p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
                                                    >
                                                        <Pencil class="size-3" aria-hidden="true" />
                                                    </button>
                                                {/if}
                                            </li>
                                        {/each}
                                    </ul>
                                </div>
                            {/if}
                        {/if}
                    </div>
                {/if}
            </div>

            <div>
                <button
                    type="button"
                    onclick={() => (openOutline = !openOutline)}
                    class="flex w-full items-center gap-1 px-2 py-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase hover:bg-accent/50"
                >
                    {#if openOutline}
                        <ChevronDown class="size-3.5" aria-hidden="true" />
                    {:else}
                        <ChevronRight class="size-3.5" aria-hidden="true" />
                    {/if}
                    <span>Outline ({outline.length})</span>
                </button>

                {#if openOutline}
                    {#if outline.length === 0}
                        <p class="px-3 py-2 text-muted-foreground">Chưa có Chương / Điều / Khoản.</p>
                    {:else}
                        <ul class="flex flex-col gap-0.5 px-1.5 pb-3">
                            {#each outline as node (node.id)}
                                {@const isActive = activeLine >= node.startLine && activeLine <= node.endLine}
                                <li>
                                    <button
                                        type="button"
                                        onclick={() => onJumpToLine(node.startLine)}
                                        class={`flex w-full items-center justify-between gap-1.5 rounded-[2px] py-1 pr-2 text-left ${indentClass(node.level)} ${
                                            isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                                        }`}
                                    >
                                        <span class="min-w-0 flex-1 truncate">
                                            {#if node.level === "CHAPTER"}
                                                Chương {node.number}{node.title ? ` · ${node.title}` : ""}
                                            {:else if node.level === "ARTICLE"}
                                                Điều {node.number}{node.title ? `. ${node.title}` : ""}
                                            {:else if node.level === "CLAUSE"}
                                                Khoản {node.number}
                                            {:else}
                                                Điểm {node.number})
                                            {/if}
                                        </span>

                                        {#if node.diagnosticCounts.error > 0 || node.diagnosticCounts.warning > 0}
                                            <span class="flex shrink-0 items-center gap-1 font-mono text-[10px]">
                                                {#if node.diagnosticCounts.error > 0}
                                                    <span class="text-[var(--diag-logic)]">{node.diagnosticCounts.error}</span>
                                                {/if}
                                                {#if node.diagnosticCounts.warning > 0}
                                                    <span class="text-[var(--diag-loophole)]">{node.diagnosticCounts.warning}</span>
                                                {/if}
                                            </span>
                                        {/if}
                                    </button>
                                </li>
                            {/each}
                        </ul>
                    {/if}
                {/if}
            </div>
        </div>
    {/if}
</aside>
