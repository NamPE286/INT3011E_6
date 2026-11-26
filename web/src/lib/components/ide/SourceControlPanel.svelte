<script lang="ts">
    import { computeLineDiff } from "$lib/ide-scm";
    import { Check, FileDiff, GitCommitHorizontal, RotateCcw } from "@lucide/svelte";

    export type DraftCommit = {
        id: string;
        message: string;
        timestamp: string;
        content: string;
        added: number;
        removed: number;
    };

    type Props = {
        title: string;
        documentNumber: string;
        baseContent: string;
        currentContent: string;
        commits: DraftCommit[];
        isDirty: boolean;
        saving: boolean;
        activeDiffId: string | null;
        onCommit: (message: string) => void;
        onRestoreCommit: (commit: DraftCommit) => void;
        onOpenWorkingDiff: () => void;
        onOpenCommitDiff: (commit: DraftCommit) => void;
        onDiscardChanges: () => void;
    };

    let {
        title,
        documentNumber,
        baseContent,
        currentContent,
        commits,
        isDirty,
        saving,
        activeDiffId,
        onCommit,
        onRestoreCommit,
        onOpenWorkingDiff,
        onOpenCommitDiff,
        onDiscardChanges,
    }: Props = $props();

    let commitMessage = $state("");

    const diff = $derived(computeLineDiff(baseContent, currentContent));
    const hasChanges = $derived(isDirty || diff.added > 0 || diff.removed > 0);

    function submitCommit(event: SubmitEvent): void {
        event.preventDefault();
        const msg = commitMessage.trim() || `Cập nhật ${title}`;
        onCommit(msg);
        commitMessage = "";
    }
</script>

<div class="flex h-full flex-col bg-[var(--ide-panel)] text-xs select-none">
    <div class="flex h-9 shrink-0 items-center justify-between border-b px-3">
        <span class="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Source Control</span>
        <span class="font-mono text-[10px] text-muted-foreground">
            {hasChanges ? `+${diff.added} -${diff.removed}` : "Clean"}
        </span>
    </div>

    <form onsubmit={submitCommit} class="flex flex-col gap-2 border-b p-2.5">
        <input
            type="text"
            bind:value={commitMessage}
            placeholder="Thông điệp commit (ví dụ: Vá kẽ hở LP003)..."
            aria-label="Thông điệp commit"
            class="h-7 w-full rounded-[2px] border border-input bg-background px-2 text-xs focus:border-ring focus:outline-none"
        />
        <button
            type="submit"
            disabled={saving}
            class="flex h-7 w-full items-center justify-center gap-1.5 rounded-[2px] bg-primary font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
            <Check class="size-3.5" aria-hidden="true" />
            <span>{saving ? "Đang lưu..." : "Commit & Lưu phiên bản"}</span>
        </button>
    </form>

    <div class="ide-scroll flex-1 overflow-y-auto p-2.5">
        <section class="mb-4">
            <div class="mb-1.5 flex items-center justify-between">
                <span class="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                    Thay đổi (Changes)
                </span>
                <span class="font-mono text-[10px] text-muted-foreground">{hasChanges ? 1 : 0}</span>
            </div>

            {#if !hasChanges}
                <p class="rounded-[2px] border bg-background/50 p-2 text-muted-foreground">
                    Không có tệp nào thay đổi.
                </p>
            {:else}
                <div
                    class={`group flex items-center gap-1 rounded-[2px] border px-1.5 py-1.5 ${
                        activeDiffId === "working-tree"
                            ? "border-primary/60 bg-accent text-accent-foreground"
                            : "bg-background/70 hover:bg-accent/50"
                    }`}
                >
                    <button
                        type="button"
                        onclick={onOpenWorkingDiff}
                        title="Bấm để xem Diff thay đổi"
                        class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    >
                        <FileDiff class="size-3.5 shrink-0 text-[var(--diag-ambiguity)]" aria-hidden="true" />
                        <div class="min-w-0 flex-1">
                            <p class="truncate font-medium text-foreground">{title}</p>
                            <p class="truncate font-mono text-[10px] text-muted-foreground">
                                {documentNumber || "Dự thảo đang mở"} · +{diff.added} -{diff.removed}
                            </p>
                        </div>
                        <span class="shrink-0 font-mono text-[10px] font-bold text-[var(--diag-ambiguity)]">M</span>
                    </button>

                    <button
                        type="button"
                        onclick={onDiscardChanges}
                        title="Hoàn tác thay đổi về bản gốc"
                        class="shrink-0 rounded-[2px] p-1 text-muted-foreground hover:bg-background hover:text-destructive"
                    >
                        <RotateCcw class="size-3" aria-hidden="true" />
                    </button>
                </div>
            {/if}
        </section>

        <section>
            <p class="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                Lịch sử phiên bản ({commits.length})
            </p>
            {#if commits.length === 0}
                <p class="text-muted-foreground">Chưa có commit nào trong phiên làm việc này.</p>
            {:else}
                <ul class="flex flex-col gap-1.5">
                    {#each commits as commit (commit.id)}
                        <li
                            class={`rounded-[2px] border p-2 ${
                                activeDiffId === commit.id
                                    ? "border-primary/60 bg-accent text-accent-foreground"
                                    : "bg-background/60 hover:bg-accent/40"
                            }`}
                        >
                            <div class="flex items-start justify-between gap-2">
                                <button
                                    type="button"
                                    onclick={() => onOpenCommitDiff(commit)}
                                    title="Bấm để so sánh bản commit này với hiện tại"
                                    class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                                >
                                    <GitCommitHorizontal class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                                    <span class="truncate font-medium text-foreground">{commit.message}</span>
                                </button>
                                <button
                                    type="button"
                                    onclick={() => onRestoreCommit(commit)}
                                    title="Khôi phục phiên bản này"
                                    class="shrink-0 rounded-[2px] p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                                >
                                    <RotateCcw class="size-3" aria-hidden="true" />
                                </button>
                            </div>
                            <p class="mt-1 font-mono text-[10px] text-muted-foreground">
                                {new Date(commit.timestamp).toLocaleTimeString("vi-VN")} · +{commit.added} -{commit.removed}
                            </p>
                        </li>
                    {/each}
                </ul>
            {/if}
        </section>
    </div>
</div>
