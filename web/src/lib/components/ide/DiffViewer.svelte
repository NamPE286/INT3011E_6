<script lang="ts">
    import { buildSplitDiffRows, computeLineDiff } from "$lib/ide-scm";
    import { Columns2, FileDiff, Rows2, Undo2, X } from "@lucide/svelte";

    type Props = {
        title: string;
        documentNumber: string;
        leftLabel: string;
        rightLabel: string;
        baseContent: string;
        currentContent: string;
        onClose: () => void;
        onRevertToBase?: () => void;
    };

    let {
        title,
        documentNumber,
        leftLabel,
        rightLabel,
        baseContent,
        currentContent,
        onClose,
        onRevertToBase,
    }: Props = $props();

    let mode = $state<"split" | "inline">("split");

    const diff = $derived(computeLineDiff(baseContent, currentContent));
    const splitRows = $derived(buildSplitDiffRows(diff.rows));

    function handleKeydown(event: KeyboardEvent): void {
        if (event.key === "Escape") {
            onClose();
        }
    }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex h-full flex-col bg-background text-xs">
    <div class="flex h-9 shrink-0 items-center justify-between gap-2 border-b bg-[var(--ide-chrome)] px-3 select-none">
        <div class="flex min-w-0 items-center gap-2">
            <FileDiff class="size-3.5 shrink-0 text-[var(--diag-ambiguity)]" aria-hidden="true" />
            <span class="truncate font-medium text-foreground">{title}</span>
            {#if documentNumber}
                <span class="hidden rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
                    {documentNumber}
                </span>
            {/if}
            <span class="font-mono text-[11px] text-[var(--diag-ok)]">+{diff.added}</span>
            <span class="font-mono text-[11px] text-[var(--diag-logic)]">-{diff.removed}</span>
        </div>

        <div class="flex shrink-0 items-center gap-1">
            <button
                type="button"
                onclick={() => (mode = mode === "split" ? "inline" : "split")}
                class="flex h-6 items-center gap-1 rounded-[2px] border border-border bg-background/70 px-2 text-[11px] text-foreground hover:bg-accent"
            >
                {#if mode === "split"}
                    <Rows2 class="size-3" aria-hidden="true" />
                    <span>Gộp dòng</span>
                {:else}
                    <Columns2 class="size-3" aria-hidden="true" />
                    <span>Chia đôi</span>
                {/if}
            </button>

            {#if onRevertToBase && (diff.added > 0 || diff.removed > 0)}
                <button
                    type="button"
                    onclick={onRevertToBase}
                    title="Hoàn tác toàn bộ thay đổi về bản gốc"
                    class="flex h-6 items-center gap-1 rounded-[2px] border border-border bg-background/70 px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                    <Undo2 class="size-3" aria-hidden="true" />
                    <span>Hoàn tác</span>
                </button>
            {/if}

            <button
                type="button"
                onclick={onClose}
                title="Đóng Diff và quay lại trình soạn thảo (Esc)"
                class="flex h-6 items-center gap-1 rounded-[2px] border border-border bg-background/70 px-2 text-[11px] text-foreground hover:bg-accent"
            >
                <X class="size-3" aria-hidden="true" />
                <span>Đóng Diff</span>
            </button>
        </div>
    </div>

    {#if mode === "split"}
        <div class="grid shrink-0 grid-cols-2 border-b bg-[var(--ide-panel)] text-[11px] text-muted-foreground select-none">
            <div class="truncate border-r px-3 py-1 font-medium">{leftLabel}</div>
            <div class="truncate px-3 py-1 font-medium">{rightLabel}</div>
        </div>

        <div class="ide-scroll flex-1 overflow-auto font-mono text-[12px] leading-5">
            {#if diff.added === 0 && diff.removed === 0}
                <div class="p-6 text-center text-xs text-muted-foreground">
                    Không có khác biệt nào giữa hai phiên bản.
                </div>
            {:else}
                <div class="min-w-[680px]">
                    {#each splitRows as pair, idx (idx)}
                        <div class="grid grid-cols-2 border-b border-border/30">
                            <div
                                class={`flex min-w-0 border-r border-border/60 ${
                                    pair.left?.type === "del"
                                        ? "bg-[var(--diag-logic-bg)] text-[var(--diag-logic)]"
                                        : pair.left === null
                                          ? "bg-muted/20"
                                          : "text-foreground"
                                }`}
                            >
                                <span class="w-10 shrink-0 select-none border-r border-border/40 px-1.5 text-right text-[11px] text-muted-foreground">
                                    {pair.left ? pair.left.line : ""}
                                </span>
                                <span class="w-4 shrink-0 select-none text-center font-bold">
                                    {pair.left?.type === "del" ? "-" : ""}
                                </span>
                                <pre class="min-w-0 flex-1 whitespace-pre-wrap break-words pr-2 font-mono">{pair.left?.text ?? ""}</pre>
                            </div>

                            <div
                                class={`flex min-w-0 ${
                                    pair.right?.type === "add"
                                        ? "bg-[var(--diag-ok-bg)] text-[var(--diag-ok)]"
                                        : pair.right === null
                                          ? "bg-muted/20"
                                          : "text-foreground"
                                }`}
                            >
                                <span class="w-10 shrink-0 select-none border-r border-border/40 px-1.5 text-right text-[11px] text-muted-foreground">
                                    {pair.right ? pair.right.line : ""}
                                </span>
                                <span class="w-4 shrink-0 select-none text-center font-bold">
                                    {pair.right?.type === "add" ? "+" : ""}
                                </span>
                                <pre class="min-w-0 flex-1 whitespace-pre-wrap break-words pr-2 font-mono">{pair.right?.text ?? ""}</pre>
                            </div>
                        </div>
                    {/each}
                </div>
            {/if}
        </div>
    {:else}
        <div class="shrink-0 border-b bg-[var(--ide-panel)] px-3 py-1 text-[11px] text-muted-foreground select-none">
            {leftLabel} → {rightLabel}
        </div>

        <div class="ide-scroll flex-1 overflow-auto font-mono text-[12px] leading-5">
            {#if diff.added === 0 && diff.removed === 0}
                <div class="p-6 text-center text-xs text-muted-foreground">
                    Không có khác biệt nào giữa hai phiên bản.
                </div>
            {:else}
                {#each diff.rows as row, idx (idx)}
                    <div
                        class={`flex border-b border-border/30 ${
                            row.type === "add"
                                ? "bg-[var(--diag-ok-bg)] text-[var(--diag-ok)]"
                                : row.type === "del"
                                  ? "bg-[var(--diag-logic-bg)] text-[var(--diag-logic)]"
                                  : "text-foreground"
                        }`}
                    >
                        <span class="w-9 shrink-0 select-none border-r border-border/40 px-1 text-right text-[11px] text-muted-foreground">
                            {row.oldLine ?? ""}
                        </span>
                        <span class="w-9 shrink-0 select-none border-r border-border/40 px-1 text-right text-[11px] text-muted-foreground">
                            {row.newLine ?? ""}
                        </span>
                        <span class="w-5 shrink-0 select-none text-center font-bold">
                            {row.type === "add" ? "+" : row.type === "del" ? "-" : " "}
                        </span>
                        <pre class="min-w-0 flex-1 whitespace-pre-wrap break-words pr-3 font-mono">{row.text}</pre>
                    </div>
                {/each}
            {/if}
        </div>
    {/if}
</div>
