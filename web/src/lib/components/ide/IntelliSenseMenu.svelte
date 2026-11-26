<script lang="ts">
    import type { CompletionItem, CompletionKind, CompletionMenuState } from "$lib/ide-intellisense";

    type Props = {
        state: CompletionMenuState;
        activeIndex: number;
        position: { top: number; left: number; flipUp: boolean };
        onSelect: (item: CompletionItem) => void;
        onHover: (index: number) => void;
    };

    let { state: menuState, activeIndex, position, onSelect, onHover }: Props = $props();

    let listEl = $state<HTMLUListElement | null>(null);

    const activeItem = $derived(menuState.items[activeIndex] ?? menuState.items[0] ?? null);

    $effect(() => {
        if (!listEl) {
            return;
        }

        const activeRow = listEl.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
        activeRow?.scrollIntoView({ block: "nearest" });
    });

    function kindTag(kind: CompletionKind): { short: string; cls: string } {
        if (kind === "BASIS") {
            return { short: "CC", cls: "bg-[var(--diag-ok-bg)] text-[var(--diag-ok)]" };
        }

        if (kind === "ARTICLE") {
            return { short: "Đ", cls: "bg-primary/20 text-[var(--syn-article)]" };
        }

        if (kind === "CLAUSE") {
            return { short: "K", cls: "bg-[var(--diag-loophole-bg)] text-[var(--diag-loophole)]" };
        }

        if (kind === "POINT") {
            return { short: "•", cls: "bg-[var(--diag-ambiguity-bg)] text-[var(--diag-ambiguity)]" };
        }

        return { short: "↗", cls: "bg-purple-500/20 text-[var(--syn-chapter)]" };
    }
</script>

<div
    role="listbox"
    aria-label={menuState.triggerLabel}
    style:top={`${position.top}px`}
    style:left={`${position.left}px`}
    style:transform={position.flipUp ? "translateY(calc(-100% - 28px))" : "none"}
    class="absolute z-30 flex w-[440px] max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-[3px] border border-[var(--ide-widget-border)] bg-[var(--ide-widget-bg)] text-popover-foreground shadow-2xl"
>
    <div class="flex items-center justify-between border-b border-[var(--ide-widget-border)] px-2.5 py-1 text-[11px]">
        <span class="font-semibold">{menuState.triggerLabel}</span>
        <span class="font-mono text-[10px] text-muted-foreground">Tab chấp nhận · ↑↓ chọn · Esc</span>
    </div>

    {#if menuState.items.length === 0}
        <p class="p-3 text-xs leading-relaxed text-muted-foreground">
            {menuState.emptyMessage ?? "Không có gợi ý phù hợp trong workspace."}
        </p>
    {:else}
        <ul bind:this={listEl} class="ide-scroll max-h-52 overflow-y-auto py-0.5 text-xs">
            {#each menuState.items as item, idx (item.id)}
                {@const isSelected = idx === activeIndex}
                {@const tag = kindTag(item.kind)}
                <li data-index={idx}>
                    <button
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onmousedown={(event) => {
                            event.preventDefault();
                            onSelect(item);
                        }}
                        onmouseenter={() => onHover(idx)}
                        class={`flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left ${
                            isSelected
                                ? "bg-[var(--ide-widget-selected)] text-[var(--ide-widget-selected-fg)]"
                                : "hover:bg-accent/60"
                        }`}
                    >
                        <span class="flex min-w-0 flex-1 items-center gap-2">
                            <span class={`flex size-4 shrink-0 items-center justify-center rounded-[2px] font-mono text-[10px] font-bold ${tag.cls}`}>
                                {tag.short}
                            </span>
                            <span class="truncate font-medium">{item.label}</span>
                        </span>
                        <span class={`shrink-0 font-mono text-[10px] ${isSelected ? "text-white/80" : "text-muted-foreground"}`}>
                            {item.detail}
                        </span>
                    </button>
                </li>
            {/each}
        </ul>

        {#if activeItem}
            <div class="border-t border-[var(--ide-widget-border)] bg-background/40 px-2.5 py-1.5 text-[11px]">
                <p class="text-muted-foreground">{activeItem.documentation}</p>
                <p class="mt-0.5 truncate font-mono text-[10px] text-foreground/85">
                    ↳ {activeItem.insertText.replace(/\n/g, " ↵ ")}
                </p>
            </div>
        {/if}
    {/if}
</div>
