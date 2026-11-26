<script lang="ts">
    import type { WorkspaceBehaviorSummary } from "$lib/engine/workspace-behaviors";
    import { BookOpen, ChevronDown, ChevronRight, Gavel, History, Scale, Search } from "@lucide/svelte";

    type Props = {
        summary: WorkspaceBehaviorSummary;
        highlightedBehaviorKey?: string | null;
        highlightedBehaviorNonce?: number;
        onJumpToFileLine: (path: string, line: number) => void;
    };

    let {
        summary,
        highlightedBehaviorKey = null,
        highlightedBehaviorNonce = 0,
        onJumpToFileLine,
    }: Props = $props();

    let query = $state("");
    let filter = $state<"ALL" | "SANCTION_HISTORY" | "DEFINITION_HISTORY" | "REPLACED">("ALL");
    let expandedKeys = $state<Record<string, boolean>>({});
    let listEl = $state<HTMLDivElement | null>(null);

    $effect(() => {
        const key = highlightedBehaviorKey;
        const _nonce = highlightedBehaviorNonce;

        if (!key) {
            return;
        }

        filter = "ALL";
        query = "";
        expandedKeys = { ...expandedKeys, [key]: true };

        queueMicrotask(() => {
            if (!listEl) {
                return;
            }

            const cards = listEl.querySelectorAll<HTMLElement>("[data-behavior-key]");

            for (const card of cards) {
                if (card.dataset.behaviorKey === key) {
                    card.scrollIntoView({ behavior: "smooth", block: "center" });

                    break;
                }
            }
        });
    });

    const filteredGroups = $derived(
        summary.groups.filter((group) => {
            if (filter === "SANCTION_HISTORY" && !group.hasSanctionHistory) {
                return false;
            }

            if (filter === "DEFINITION_HISTORY" && !group.hasDefinitionHistory) {
                return false;
            }

            if (filter === "REPLACED" && !group.hasReplacedVersion) {
                return false;
            }

            const q = query.trim().toLowerCase();

            if (q.length > 0) {
                const hay = `${group.behaviorTitle} ${group.vehicleOrSubject} ${group.latestVersion.documentNumber ?? ""}`.toLowerCase();

                return hay.includes(q);
            }

            return true;
        }),
    );

    function toggleExpand(key: string): void {
        expandedKeys = { ...expandedKeys, [key]: !expandedKeys[key] };
    }
</script>

<div class="flex h-full flex-col bg-[var(--ide-panel)] text-xs">
    <div class="flex h-9 shrink-0 items-center justify-between border-b px-2.5 select-none">
        <span class="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            <Scale class="size-3.5 text-primary" aria-hidden="true" />
            <span>Hành vi ({summary.totalBehaviors})</span>
        </span>
        <span class="font-mono text-[10px] text-muted-foreground">
            {summary.withHistoryCount} có lịch sử
        </span>
    </div>

    <div class="space-y-1.5 border-b p-2">
        <div class="relative">
            <Search class="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
                type="search"
                bind:value={query}
                placeholder="Tìm hành vi, phương tiện..."
                class="h-7 w-full rounded-[2px] border border-input bg-background pr-2 pl-6 text-[11px] focus:border-ring focus:outline-none"
            />
        </div>

        <div class="flex flex-wrap gap-1">
            {#each [
                { id: "ALL", label: `Tất cả (${summary.totalBehaviors})` },
                { id: "SANCTION_HISTORY", label: `Đổi mức xử lý (${summary.sanctionHistoryCount})` },
                { id: "DEFINITION_HISTORY", label: `Đổi định nghĩa (${summary.definitionHistoryCount})` },
                { id: "REPLACED", label: `Đã thay thế (${summary.replacedCount})` },
            ] as pill (pill.id)}
                <button
                    type="button"
                    onclick={() => (filter = pill.id as typeof filter)}
                    class={`rounded-[2px] px-1.5 py-0.5 text-[10px] transition-colors ${
                        filter === pill.id
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary text-muted-foreground hover:text-foreground"
                    }`}
                >
                    {pill.label}
                </button>
            {/each}
        </div>
    </div>

    <div bind:this={listEl} class="ide-scroll flex-1 space-y-1.5 overflow-y-auto p-2">
        {#if filteredGroups.length === 0}
            <p class="rounded-[2px] border bg-background/60 p-3 text-center text-[11px] text-muted-foreground">
                Không tìm thấy hành vi nào khớp bộ lọc.
            </p>
        {:else}
            {#each filteredGroups as group (group.canonicalKey)}
                {@const isExpanded = Boolean(expandedKeys[group.canonicalKey])}
                {@const isHighlighted = group.canonicalKey === highlightedBehaviorKey}
                <div
                    data-behavior-key={group.canonicalKey}
                    class={`rounded-[2px] border transition-colors ${
                        isHighlighted
                            ? "border-primary bg-primary/10 ring-1 ring-primary"
                            : "bg-background/60"
                    }`}
                >
                    <button
                        type="button"
                        onclick={() => toggleExpand(group.canonicalKey)}
                        class="flex w-full items-start gap-1.5 p-2 text-left hover:bg-accent/40"
                    >
                        {#if isExpanded}
                            <ChevronDown class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        {:else}
                            <ChevronRight class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        {/if}

                        <div class="min-w-0 flex-1">
                            <p class="line-clamp-2 text-[11px] font-medium text-foreground">
                                {group.behaviorTitle}
                            </p>
                            <div class="mt-1 flex flex-wrap items-center gap-1">
                                <span class="rounded-[2px] bg-secondary px-1 py-0.5 text-[9px] text-muted-foreground">
                                    {group.vehicleOrSubject}
                                </span>
                                {#if group.latestSanctionVersion}
                                    <span class="font-mono text-[10px] text-[var(--diag-ok)]">
                                        {group.latestSanctionVersion.fineLabel}
                                    </span>
                                {:else}
                                    <span class="rounded-[2px] bg-secondary px-1 py-0.5 font-mono text-[9px] text-muted-foreground">
                                        Định nghĩa hành vi
                                    </span>
                                {/if}
                                {#if group.latestVersion.lifecycleStatus === "DRAFT"}
                                    <span class="rounded-[2px] bg-primary/20 px-1 py-0.5 font-mono text-[9px] font-semibold text-primary">
                                        DỰ THẢO
                                    </span>
                                {/if}
                                {#if group.hasHistory}
                                    <span class="flex items-center gap-0.5 rounded-[2px] bg-primary/15 px-1 py-0.5 font-mono text-[9px] text-primary">
                                        <History class="size-2.5" aria-hidden="true" />
                                        {group.sanctionHistory.length} xử lý · {group.definitionHistory.length} định nghĩa
                                    </span>
                                {/if}
                            </div>
                        </div>
                    </button>

                    {#if isExpanded}
                        <div class="space-y-3 border-t border-border/60 bg-background/40 px-2.5 py-2">
                            <section>
                                <p class="mb-1.5 flex items-center gap-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                                    <Gavel class="size-3 text-[var(--diag-ok)]" aria-hidden="true" />
                                    <span>Thay đổi mức xử lý ({group.sanctionHistory.length})</span>
                                </p>
                                {#if group.sanctionHistory.length === 0}
                                    <p class="text-[10px] text-muted-foreground">
                                        Chưa có điều khoản quy định mức xử phạt cụ thể.
                                    </p>
                                {:else}
                                    <ul class="space-y-2 border-l border-border pl-2.5">
                                        {#each group.sanctionHistory as ver (ver.id)}
                                            <li>
                                                <button
                                                    type="button"
                                                    onclick={() => onJumpToFileLine(ver.sourcePath, ver.line)}
                                                    class="flex w-full flex-col gap-0.5 rounded-[2px] p-1 text-left hover:bg-accent/50"
                                                >
                                                    <div class="flex items-center justify-between gap-1">
                                                        <span class={`font-mono text-[10px] font-semibold ${
                                                            ver.lifecycleStatus === "REPLACED" || ver.lifecycleStatus === "REPEALED"
                                                                ? "text-muted-foreground line-through"
                                                                : "text-foreground"
                                                        }`}>
                                                            {ver.documentNumber ?? ver.documentTitle} · {ver.provisionRef}
                                                        </span>
                                                        <span class="font-mono text-[9px] text-muted-foreground">
                                                            {ver.effectiveDate ?? `L${ver.line}`}
                                                        </span>
                                                    </div>
                                                    <p class="font-mono text-[10px] text-foreground/90">
                                                        {ver.fineLabel}
                                                        {#if ver.pointsDeducted}
                                                            · Trừ {ver.pointsDeducted} điểm GPLX
                                                        {/if}
                                                    </p>
                                                    {#if ver.sanctionChangeSummary}
                                                        <p class="text-[10px] text-primary">{ver.sanctionChangeSummary}</p>
                                                    {/if}
                                                </button>
                                            </li>
                                        {/each}
                                    </ul>
                                {/if}
                            </section>

                            <section>
                                <p class="mb-1.5 flex items-center gap-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                                    <BookOpen class="size-3 text-primary" aria-hidden="true" />
                                    <span>Thay đổi định nghĩa ({group.definitionHistory.length})</span>
                                </p>
                                {#if group.definitionHistory.length === 0}
                                    <p class="text-[10px] text-muted-foreground">
                                        Chưa có điều khoản định nghĩa riêng.
                                    </p>
                                {:else}
                                    <ul class="space-y-2 border-l border-border pl-2.5">
                                        {#each group.definitionHistory as ver (ver.id)}
                                            <li>
                                                <button
                                                    type="button"
                                                    onclick={() => onJumpToFileLine(ver.sourcePath, ver.line)}
                                                    class="flex w-full flex-col gap-0.5 rounded-[2px] p-1 text-left hover:bg-accent/50"
                                                >
                                                    <div class="flex items-center justify-between gap-1">
                                                        <span class={`font-mono text-[10px] font-semibold ${
                                                            ver.lifecycleStatus === "REPLACED" || ver.lifecycleStatus === "REPEALED"
                                                                ? "text-muted-foreground line-through"
                                                                : "text-foreground"
                                                        }`}>
                                                            {ver.documentNumber ?? ver.documentTitle} · {ver.provisionRef}
                                                        </span>
                                                        <span class="font-mono text-[9px] text-muted-foreground">
                                                            {ver.effectiveDate ?? `L${ver.line}`}
                                                        </span>
                                                    </div>
                                                    <p class="line-clamp-2 text-[10px] text-foreground/90">
                                                        {ver.definitionText ?? ver.excerpt}
                                                    </p>
                                                    {#if ver.definitionChangeSummary}
                                                        <p class="text-[10px] text-primary">{ver.definitionChangeSummary}</p>
                                                    {/if}
                                                </button>
                                            </li>
                                        {/each}
                                    </ul>
                                {/if}
                            </section>
                        </div>
                    {/if}
                </div>
            {/each}
        {/if}
    </div>
</div>
