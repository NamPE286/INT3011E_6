<script lang="ts">
    import { findMatches, replaceAllMatches, type SearchMatch } from "$lib/ide-scm";
    import { Replace, ReplaceAll, Search } from "@lucide/svelte";

    type Props = {
        content: string;
        onChangeContent: (next: string) => void;
        onJumpToOffset: (line: number, offset: number) => void;
    };

    let { content, onChangeContent, onJumpToOffset }: Props = $props();

    let query = $state("");
    let replacement = $state("");
    let caseSensitive = $state(false);
    let wholeWord = $state(false);
    let statusMessage = $state<string | null>(null);

    const matches = $derived(findMatches(content, query, { caseSensitive, wholeWord }));

    function replaceFirst(match: SearchMatch): void {
        const next = content.slice(0, match.startOffset) + replacement + content.slice(match.endOffset);
        onChangeContent(next);
        statusMessage = `Đã thay thế tại dòng ${match.line}`;
    }

    function replaceAll(): void {
        const res = replaceAllMatches(content, query, replacement, { caseSensitive, wholeWord });

        if (res.count === 0) {
            return;
        }

        onChangeContent(res.content);
        statusMessage = `Đã thay thế ${res.count} vị trí`;
    }
</script>

<div class="flex h-full flex-col bg-[var(--ide-panel)] text-xs select-none">
    <div class="flex h-9 shrink-0 items-center justify-between border-b px-3">
        <span class="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Find and Replace</span>
        {#if query}
            <span class="font-mono text-[10px] text-muted-foreground">{matches.length} kết quả</span>
        {/if}
    </div>

    <div class="flex flex-col gap-2 border-b p-2.5">
        <div class="relative flex items-center">
            <Search class="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" aria-hidden="true" />
            <input
                type="search"
                bind:value={query}
                placeholder="Tìm kiếm trong dự thảo..."
                aria-label="Tìm kiếm"
                class="h-7 w-full rounded-[2px] border border-input bg-background pr-14 pl-7 text-xs focus:border-ring focus:outline-none"
            />
            <div class="absolute right-1 flex items-center gap-0.5">
                <button
                    type="button"
                    onclick={() => (caseSensitive = !caseSensitive)}
                    title="Phân biệt chữ hoa/thường (Aa)"
                    class={`rounded-[2px] px-1 py-0.5 font-mono text-[10px] ${
                        caseSensitive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                    }`}
                >
                    Aa
                </button>
                <button
                    type="button"
                    onclick={() => (wholeWord = !wholeWord)}
                    title="Khớp nguyên từ"
                    class={`rounded-[2px] px-1 py-0.5 font-mono text-[10px] ${
                        wholeWord ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                    }`}
                >
                    ab
                </button>
            </div>
        </div>

        <div class="flex items-center gap-1">
            <input
                type="text"
                bind:value={replacement}
                placeholder="Thay thế bằng..."
                aria-label="Thay thế bằng"
                class="h-7 min-w-0 flex-1 rounded-[2px] border border-input bg-background px-2 text-xs focus:border-ring focus:outline-none"
            />
            <button
                type="button"
                onclick={() => matches[0] && replaceFirst(matches[0])}
                disabled={matches.length === 0}
                title="Thay thế kết quả đầu tiên"
                class="flex size-7 items-center justify-center rounded-[2px] border border-border bg-secondary text-secondary-foreground hover:bg-accent disabled:opacity-40"
            >
                <Replace class="size-3.5" aria-hidden="true" />
            </button>
            <button
                type="button"
                onclick={replaceAll}
                disabled={matches.length === 0}
                title="Thay thế tất cả"
                class="flex size-7 items-center justify-center rounded-[2px] border border-border bg-secondary text-secondary-foreground hover:bg-accent disabled:opacity-40"
            >
                <ReplaceAll class="size-3.5" aria-hidden="true" />
            </button>
        </div>

        {#if statusMessage}
            <p class="text-[11px] text-[var(--diag-ok)]">{statusMessage}</p>
        {/if}
    </div>

    <div class="ide-scroll flex-1 overflow-y-auto p-1.5">
        {#if !query}
            <p class="p-3 text-muted-foreground">Nhập từ khóa (ví dụ: `cá nhân`, `nghiêm cấm`, `km/h`) để tìm nhanh và thay thế hàng loạt.</p>
        {:else if matches.length === 0}
            <p class="p-3 text-muted-foreground">Không tìm thấy kết quả phù hợp.</p>
        {:else}
            <ul class="flex flex-col gap-0.5">
                {#each matches as match, idx (idx)}
                    <li>
                        <button
                            type="button"
                            onclick={() => onJumpToOffset(match.line, match.startOffset)}
                            class="flex w-full items-start gap-2 rounded-[2px] px-2 py-1 text-left hover:bg-accent"
                        >
                            <span class="shrink-0 font-mono text-[10px] text-primary">:{match.line}</span>
                            <span class="min-w-0 flex-1 truncate text-foreground">{match.preview}</span>
                        </button>
                    </li>
                {/each}
            </ul>
        {/if}
    </div>
</div>
