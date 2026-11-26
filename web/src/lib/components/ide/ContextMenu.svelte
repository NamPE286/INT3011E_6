<script lang="ts">
    export type ContextMenuItem = {
        id: string;
        label?: string;
        shortcut?: string;
        danger?: boolean;
        separator?: boolean;
        disabled?: boolean;
        onSelect?: () => void;
    };

    type Props = {
        x: number;
        y: number;
        items: ContextMenuItem[];
        onClose: () => void;
    };

    let { x, y, items, onClose }: Props = $props();

    const pos = $derived.by(() => {
        if (typeof window === "undefined") {
            return { left: x, top: y };
        }

        const estimatedHeight = items.length * 28 + 16;

        return {
            left: Math.max(8, Math.min(x, window.innerWidth - 240)),
            top: Math.max(8, Math.min(y, window.innerHeight - estimatedHeight)),
        };
    });

    function handleKeydown(event: KeyboardEvent): void {
        if (event.key === "Escape") {
            onClose();
        }
    }
</script>

<svelte:window onkeydown={handleKeydown} />

<button
    type="button"
    aria-label="Đóng menu ngữ cảnh"
    onclick={onClose}
    oncontextmenu={(event) => {
        event.preventDefault();
        onClose();
    }}
    class="fixed inset-0 z-50 cursor-default bg-transparent"
></button>

<div
    role="menu"
    style="left: {pos.left}px; top: {pos.top}px;"
    class="fixed z-50 min-w-[220px] rounded-[3px] border border-border bg-[var(--ide-panel)] p-1 text-xs shadow-2xl select-none"
>
    {#each items as item (item.id)}
        {#if item.separator}
            <div class="my-1 h-px bg-border"></div>
        {:else}
            <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onclick={() => {
                    onClose();
                    item.onSelect?.();
                }}
                class={`flex w-full items-center justify-between gap-4 rounded-[2px] px-2.5 py-1.5 text-left text-[11px] disabled:opacity-40 ${
                    item.danger
                        ? "text-destructive hover:bg-destructive/15"
                        : "text-foreground hover:bg-accent"
                }`}
            >
                <span>{item.label}</span>
                {#if item.shortcut}
                    <span class="font-mono text-[10px] text-muted-foreground">{item.shortcut}</span>
                {/if}
            </button>
        {/if}
    {/each}
</div>
