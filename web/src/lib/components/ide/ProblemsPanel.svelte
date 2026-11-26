<script lang="ts">
    import type { DiagnosticCategory, DiagnosticSeverity, LeanVerificationReport, LegalDiagnostic, QuickFix } from "$lib/api/ide";
    import { AlertTriangle, Check, CheckCircle2, Copy, Info, Loader, Search, Sparkles, Terminal, XCircle, Zap } from "@lucide/svelte";

    type CategoryFilter = "ALL" | DiagnosticCategory;

    type Props = {
        diagnostics: LegalDiagnostic[];
        lean: LeanVerificationReport | null;
        selectedDiagnosticId: string | null;
        fixingDiagnosticId?: string | null;
        onSelectDiagnostic: (diag: LegalDiagnostic) => void;
        onJumpToLine: (line: number) => void;
        onApplyQuickFix: (fix: QuickFix) => void;
        onAiFixDiagnostic?: (diag: LegalDiagnostic) => void;
    };

    let {
        diagnostics,
        lean,
        selectedDiagnosticId,
        fixingDiagnosticId = null,
        onSelectDiagnostic,
        onJumpToLine,
        onApplyQuickFix,
        onAiFixDiagnostic,
    }: Props = $props();

    let panelTab = $state<"problems" | "lean">("problems");
    let categoryFilter = $state<CategoryFilter>("ALL");
    let severityFilter = $state<"ALL" | DiagnosticSeverity>("ALL");
    let search = $state("");
    let copied = $state(false);

    const counts = $derived({
        ALL: diagnostics.length,
        LOOPHOLE: diagnostics.filter((item) => item.category === "LOOPHOLE").length,
        AMBIGUITY: diagnostics.filter((item) => item.category === "AMBIGUITY").length,
        LOGIC: diagnostics.filter((item) => item.category === "LOGIC").length,
    });

    const filtered = $derived(
        diagnostics.filter((item) => {
            if (categoryFilter !== "ALL" && item.category !== categoryFilter) {
                return false;
            }

            if (severityFilter !== "ALL" && item.severity !== severityFilter) {
                return false;
            }

            const q = search.trim().toLowerCase();

            if (q.length > 0) {
                const haystack = `${item.code} ${item.title} ${item.message} ${item.provisionRef ?? ""}`.toLowerCase();

                return haystack.includes(q);
            }

            return true;
        }),
    );

    const CATEGORY_TABS: { id: CategoryFilter; label: string; dotClass?: string }[] = [
        { id: "ALL", label: "Tất cả" },
        { id: "LOOPHOLE", label: "Kẽ hở (Loophole)", dotClass: "bg-[var(--diag-loophole)]" },
        { id: "AMBIGUITY", label: "Mơ hồ", dotClass: "bg-[var(--diag-ambiguity)]" },
        { id: "LOGIC", label: "Lỗ hổng logic", dotClass: "bg-[var(--diag-logic)]" },
    ];

    async function copyLeanCode(): Promise<void> {
        if (!lean?.leanCode) {
            return;
        }

        await navigator.clipboard.writeText(lean.leanCode);
        copied = true;
        setTimeout(() => {
            copied = false;
        }, 1500);
    }
</script>

<section aria-label="Bảng vấn đề và Lean 4 Compiler" class="flex h-full flex-col bg-[var(--ide-panel)] text-xs">
    <div class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3">
        <div class="flex items-center gap-4">
            <button
                type="button"
                onclick={() => (panelTab = "problems")}
                class={`flex items-center gap-1.5 border-b-2 py-2 text-[11px] font-semibold tracking-wider uppercase transition-colors ${
                    panelTab === "problems" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
            >
                <span>Vấn đề</span>
                <span class="rounded-full bg-muted px-1.5 font-mono text-[10px]">{diagnostics.length}</span>
            </button>

            <button
                type="button"
                onclick={() => (panelTab = "lean")}
                class={`flex items-center gap-1.5 border-b-2 py-2 text-[11px] font-semibold tracking-wider uppercase transition-colors ${
                    panelTab === "lean" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
            >
                <Terminal class="size-3.5" aria-hidden="true" />
                <span>Lean 4 Compiler</span>
                {#if lean}
                    <span class="rounded-full bg-[var(--diag-ok-bg)] px-1.5 font-mono text-[10px] text-[var(--diag-ok)]">
                        {lean.provedCount}✓
                    </span>
                    {#if lean.refutedCount > 0}
                        <span class="rounded-full bg-[var(--diag-logic-bg)] px-1.5 font-mono text-[10px] text-[var(--diag-logic)]">
                            {lean.refutedCount}✗
                        </span>
                    {/if}
                {/if}
            </button>
        </div>

        {#if panelTab === "problems"}
            <div class="flex flex-wrap items-center gap-1.5 py-1">
                <div class="flex items-center gap-1" role="tablist" aria-label="Lọc theo nhóm lỗi">
                    {#each CATEGORY_TABS as tab (tab.id)}
                        <button
                            type="button"
                            role="tab"
                            aria-selected={categoryFilter === tab.id}
                            onclick={() => (categoryFilter = tab.id)}
                            class={`flex items-center gap-1 rounded-[2px] px-2 py-0.5 text-[11px] transition-colors ${
                                categoryFilter === tab.id
                                    ? "bg-accent text-accent-foreground"
                                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                            }`}
                        >
                            {#if tab.dotClass}
                                <span class={`size-1.5 rounded-full ${tab.dotClass}`} aria-hidden="true"></span>
                            {/if}
                            <span>{tab.label}</span>
                            <span class="font-mono text-[10px] text-muted-foreground">{counts[tab.id]}</span>
                        </button>
                    {/each}
                </div>

                <select
                    bind:value={severityFilter}
                    aria-label="Lọc theo mức độ"
                    class="h-6 rounded-[2px] border border-input bg-background px-1.5 text-[11px] text-foreground"
                >
                    <option value="ALL">Mọi mức độ</option>
                    <option value="error">Lỗi</option>
                    <option value="warning">Cảnh báo</option>
                    <option value="info">Lưu ý</option>
                </select>

                <div class="relative">
                    <Search class="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <input
                        type="search"
                        bind:value={search}
                        placeholder="Lọc..."
                        class="h-6 w-32 rounded-[2px] border border-input bg-background pr-2 pl-6 text-[11px] focus:border-ring focus:outline-none"
                    />
                </div>
            </div>
        {:else if lean}
            <div class="flex items-center gap-2 py-1 text-[11px]">
                <span class="rounded-[2px] bg-[var(--diag-ok-bg)] px-2 py-0.5 font-mono text-[10px] text-[var(--diag-ok)]">
                    {lean.tokenStats.actualAiTokens} token · Tiết kiệm {lean.tokenStats.savedPercent}%
                </span>
                <button
                    type="button"
                    onclick={() => void copyLeanCode()}
                    class="flex items-center gap-1 rounded-[2px] border bg-secondary px-2 py-0.5 text-[11px] hover:bg-accent"
                >
                    {#if copied}
                        <Check class="size-3 text-[var(--diag-ok)]" aria-hidden="true" />
                        <span>Đã chép</span>
                    {:else}
                        <Copy class="size-3" aria-hidden="true" />
                        <span>Sao chép .lean</span>
                    {/if}
                </button>
            </div>
        {/if}
    </div>

    {#if panelTab === "problems"}
        <div class="ide-scroll flex-1 overflow-y-auto">
            {#if filtered.length === 0}
                <p class="p-4 text-center text-muted-foreground">Không có cảnh báo nào khớp bộ lọc hiện tại.</p>
            {:else}
                <ul class="divide-y divide-border/60">
                    {#each filtered as item (item.id)}
                        {@const selected = item.id === selectedDiagnosticId}
                        <li
                            class={`flex items-center justify-between gap-3 px-3 py-1.5 transition-colors ${
                                selected ? "bg-[var(--ide-widget-selected)]/40" : "hover:bg-accent/50"
                            }`}
                        >
                            <button
                                type="button"
                                onclick={() => onSelectDiagnostic(item)}
                                class="flex min-w-0 flex-1 items-center gap-2 text-left"
                            >
                                {#if item.severity === "error"}
                                    <XCircle class="size-3.5 shrink-0 text-[var(--diag-logic)]" aria-hidden="true" />
                                {:else if item.severity === "warning"}
                                    <AlertTriangle class="size-3.5 shrink-0 text-[var(--diag-loophole)]" aria-hidden="true" />
                                {:else}
                                    <Info class="size-3.5 shrink-0 text-[var(--diag-ambiguity)]" aria-hidden="true" />
                                {/if}

                                <span class="shrink-0 font-mono text-[10px] font-semibold text-muted-foreground">
                                    {item.code}
                                </span>

                                <span class="min-w-0 flex-1 truncate text-foreground">{item.title}</span>

                                <span class="hidden shrink-0 text-muted-foreground lg:inline">
                                    {item.provisionRef ?? "Toàn văn"}
                                </span>

                                <span class="shrink-0 font-mono text-[11px] text-muted-foreground">
                                    Ln {item.range.startLine}
                                </span>
                            </button>

                            <div class="flex shrink-0 items-center gap-1">
                                {#if item.quickFix}
                                    <button
                                        type="button"
                                        onclick={() => item.quickFix && onApplyQuickFix(item.quickFix)}
                                        title={item.quickFix.label}
                                        class="flex shrink-0 items-center gap-1 rounded-[2px] bg-primary/20 px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/30"
                                    >
                                        <Zap class="size-3" aria-hidden="true" />
                                        <span>Sửa nhanh</span>
                                    </button>
                                {/if}
                                {#if onAiFixDiagnostic}
                                    {@const isFixing = fixingDiagnosticId === item.id}
                                    <button
                                        type="button"
                                        disabled={fixingDiagnosticId !== null}
                                        onclick={() => onAiFixDiagnostic(item)}
                                        title="Nhờ AI tự động đề xuất và áp dụng bản sửa cho lỗi này"
                                        class="flex shrink-0 items-center gap-1 rounded-[2px] border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {#if isFixing}
                                            <Loader class="size-3 animate-spin" aria-hidden="true" />
                                            <span>Đang sửa...</span>
                                        {:else}
                                            <Sparkles class="size-3" aria-hidden="true" />
                                            <span>Sửa bằng AI</span>
                                        {/if}
                                    </button>
                                {/if}
                            </div>
                        </li>
                    {/each}
                </ul>
            {/if}
        </div>
    {:else if lean}
        <div class="grid min-h-0 flex-1 grid-cols-1 divide-y md:grid-cols-2 md:divide-x md:divide-y-0">
            <div class="ide-scroll overflow-y-auto p-2">
                <p class="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                    Mệnh đề chứng minh ({lean.obligations.length}) · {lean.tokenStats.strategy}
                </p>
                <ul class="flex flex-col gap-1">
                    {#each lean.obligations as ob (ob.id)}
                        <li>
                            <button
                                type="button"
                                onclick={() => onJumpToLine(ob.line)}
                                class="flex w-full flex-col gap-0.5 rounded-[2px] border bg-background/60 px-2 py-1.5 text-left hover:border-primary/50"
                            >
                                <div class="flex items-center justify-between gap-2">
                                    <span class="flex items-center gap-1.5 font-mono text-[11px] font-semibold">
                                        {#if ob.status === "PROVED"}
                                            <CheckCircle2 class="size-3.5 text-[var(--diag-ok)]" aria-hidden="true" />
                                        {:else}
                                            <XCircle class="size-3.5 text-[var(--diag-logic)]" aria-hidden="true" />
                                        {/if}
                                        <span>{ob.theoremName}</span>
                                    </span>
                                    <span class="font-mono text-[10px] text-muted-foreground">by {ob.tactic} · L{ob.line}</span>
                                </div>
                                {#if ob.counterexample}
                                    <span class="font-mono text-[10px] text-[var(--diag-logic)]">
                                        Phản ví dụ: {ob.counterexample}
                                    </span>
                                {/if}
                            </button>
                        </li>
                    {/each}
                </ul>
            </div>

            <div class="ide-scroll overflow-y-auto bg-[var(--ide-editor)] p-2.5">
                <pre class="font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-[var(--syn-index)]">{lean.leanCode}</pre>
            </div>
        </div>
    {:else}
        <p class="p-4 text-center text-muted-foreground">Chưa có dữ liệu biên dịch Lean 4.</p>
    {/if}
</section>
