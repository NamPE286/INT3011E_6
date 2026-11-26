<script lang="ts">
    import type { AnalysisResult, LegalDiagnostic, QuickFix } from "$lib/api/ide";
    import { Badge } from "$lib/components/ui/badge";
    import { Button } from "$lib/components/ui/button";
    import {
        AlertTriangle,
        CheckCircle2,
        ChevronLeft,
        ChevronRight,
        GitCompare,
        Loader,
        ShieldAlert,
        ShieldCheck,
        Sparkles,
        Zap,
    } from "@lucide/svelte";

    type Props = {
        analysis: AnalysisResult | null;
        selectedDiagnosticId: string | null;
        fixingDiagnosticId?: string | null;
        onSelectDiagnostic: (diag: LegalDiagnostic) => void;
        onJumpToLine: (line: number, offset?: number) => void;
        onApplyQuickFix: (fix: QuickFix) => void;
        onAiFixDiagnostic?: (diag: LegalDiagnostic) => void;
    };

    let {
        analysis,
        selectedDiagnosticId,
        fixingDiagnosticId = null,
        onSelectDiagnostic,
        onJumpToLine,
        onApplyQuickFix,
        onAiFixDiagnostic,
    }: Props = $props();

    let tab = $state<"inspector" | "matrix">("inspector");

    const diagnostics = $derived(analysis?.diagnostics ?? []);
    const selectedIndex = $derived(diagnostics.findIndex((item) => item.id === selectedDiagnosticId));
    const selected = $derived(selectedIndex >= 0 ? diagnostics[selectedIndex] : (diagnostics[0] ?? null));
    const metrics = $derived(analysis?.metrics ?? null);

    function stepIssue(delta: number): void {
        if (diagnostics.length === 0) {
            return;
        }

        const base = selectedIndex >= 0 ? selectedIndex : 0;
        const nextIdx = (base + delta + diagnostics.length) % diagnostics.length;
        onSelectDiagnostic(diagnostics[nextIdx]);
    }

    function formatFine(min: number | null, max: number | null): string {
        if (min === null || max === null) {
            return "—";
        }

        return `${min.toLocaleString("vi-VN")} – ${max.toLocaleString("vi-VN")}đ`;
    }

    function scoreColor(score: number): string {
        if (score >= 80) {
            return "text-[var(--diag-ok)]";
        }

        if (score >= 55) {
            return "text-[var(--diag-loophole)]";
        }

        return "text-[var(--diag-logic)]";
    }
</script>

<aside class="flex h-full flex-col bg-[var(--ide-panel)] text-xs">
    <div class="flex h-9 shrink-0 border-b">
        <button
            type="button"
            onclick={() => (tab = "inspector")}
            class={`flex flex-1 items-center justify-center gap-1.5 border-b-2 text-[11px] font-medium transition-colors ${
                tab === "inspector" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
        >
            <ShieldAlert class="size-3.5" aria-hidden="true" />
            <span>Chi tiết kiểm định</span>
        </button>

        <button
            type="button"
            onclick={() => (tab = "matrix")}
            class={`flex flex-1 items-center justify-center gap-1.5 border-b-2 text-[11px] font-medium transition-colors ${
                tab === "matrix" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
        >
            <GitCompare class="size-3.5" aria-hidden="true" />
            <span>Logic & Khung phạt</span>
        </button>
    </div>

    <div class="ide-scroll flex-1 overflow-y-auto p-3">
        {#if analysis}
            <div class="mb-3 flex items-center justify-between gap-2 rounded-[2px] border bg-background/50 px-2.5 py-1.5 text-[11px]">
                <span class="flex items-center gap-1.5 text-muted-foreground">
                    <ShieldCheck class="size-3.5 text-[var(--diag-ok)]" aria-hidden="true" />
                    <span>Chỉ dữ liệu workspace</span>
                </span>
                <span class="font-mono text-[10px] text-muted-foreground">
                    {analysis.workspaceScope.corpusDocumentCount} kho · {analysis.workspaceScope.savedDraftCount} dự thảo
                </span>
            </div>
        {/if}

        {#if tab === "inspector"}
            <div class="flex flex-col gap-3">
                {#if metrics}
                    <section class="rounded-[2px] border bg-background/60 p-3">
                        <div class="flex items-center justify-between">
                            <div>
                                <p class="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Chỉ số chất lượng</p>
                                <p class="mt-0.5 text-[11px] text-muted-foreground">
                                    {metrics.articleCount} Điều · {metrics.clauseCount} Khoản · {metrics.fineRuleCount} khung phạt
                                </p>
                            </div>
                            <span class={`font-mono text-2xl font-bold ${scoreColor(metrics.overallScore)}`}>
                                {metrics.overallScore}<span class="text-xs font-normal text-muted-foreground">/100</span>
                            </span>
                        </div>

                        <div class="mt-2.5 flex flex-col gap-1.5">
                            <div>
                                <div class="mb-0.5 flex justify-between text-[11px]">
                                    <span>Chống kẽ hở (Loophole)</span>
                                    <span class="font-mono">{metrics.loopholeScore}%</span>
                                </div>
                                <div class="h-1.5 overflow-hidden rounded-full bg-muted">
                                    <div class="h-full bg-[var(--diag-loophole)]" style:width={`${metrics.loopholeScore}%`}></div>
                                </div>
                            </div>

                            <div>
                                <div class="mb-0.5 flex justify-between text-[11px]">
                                    <span>Độ rõ ràng ngôn từ</span>
                                    <span class="font-mono">{metrics.clarityScore}%</span>
                                </div>
                                <div class="h-1.5 overflow-hidden rounded-full bg-muted">
                                    <div class="h-full bg-[var(--diag-ambiguity)]" style:width={`${metrics.clarityScore}%`}></div>
                                </div>
                            </div>

                            <div>
                                <div class="mb-0.5 flex justify-between text-[11px]">
                                    <span>Tính nhất quán Logic</span>
                                    <span class="font-mono">{metrics.logicScore}%</span>
                                </div>
                                <div class="h-1.5 overflow-hidden rounded-full bg-muted">
                                    <div class="h-full bg-[var(--diag-logic)]" style:width={`${metrics.logicScore}%`}></div>
                                </div>
                            </div>
                        </div>
                    </section>
                {/if}

                {#if analysis?.aiStatus.error}
                    <div class="rounded-[2px] border border-[var(--diag-loophole)]/40 bg-[var(--diag-loophole-bg)] p-2 text-[11px]">
                        {analysis.aiStatus.error}
                    </div>
                {/if}

                {#if selected}
                    <section class="flex flex-col gap-2.5 rounded-[2px] border bg-background/60 p-3">
                        <div class="flex items-center justify-between gap-2 border-b pb-2">
                            <div class="flex items-center gap-1.5">
                                <Badge variant={selected.severity === "error" ? "destructive" : "outline"}>
                                    {selected.code}
                                </Badge>
                                <span class="text-[11px] font-medium text-muted-foreground">
                                    {selected.source === "AI" ? "Thẩm định AI" : selected.source === "CORPUS" ? "Workspace" : "Lean 4 / Tĩnh"}
                                </span>
                            </div>

                            <div class="flex items-center gap-1">
                                <button type="button" onclick={() => stepIssue(-1)} title="Vấn đề trước" class="rounded-[2px] p-1 hover:bg-accent">
                                    <ChevronLeft class="size-3.5" aria-hidden="true" />
                                </button>
                                <span class="font-mono text-[11px] text-muted-foreground">
                                    {selectedIndex >= 0 ? selectedIndex + 1 : 1}/{diagnostics.length}
                                </span>
                                <button type="button" onclick={() => stepIssue(1)} title="Vấn đề tiếp theo" class="rounded-[2px] p-1 hover:bg-accent">
                                    <ChevronRight class="size-3.5" aria-hidden="true" />
                                </button>
                            </div>
                        </div>

                        <div>
                            <h3 class="text-sm font-semibold text-foreground">{selected.title}</h3>
                            <p class="mt-0.5 text-[11px] text-muted-foreground">
                                {selected.provisionRef ?? "Toàn văn"} · Dòng {selected.range.startLine}
                            </p>
                        </div>

                        <div class="rounded-[2px] border bg-muted/60 px-2.5 py-1.5 font-mono text-[11px] break-words">
                            “{selected.excerpt}”
                        </div>

                        {#if selected.leanTheorem}
                            <div class="rounded-[2px] border border-primary/30 bg-primary/10 px-2.5 py-1.5 font-mono text-[11px]">
                                <span class="font-semibold text-primary">Lean 4:</span> {selected.leanTheorem}
                                {#if selected.counterexample}
                                    <span class="mt-0.5 block text-[var(--diag-logic)]">↳ {selected.counterexample}</span>
                                {/if}
                            </div>
                        {/if}

                        <div>
                            <p class="font-semibold text-foreground">Phân tích</p>
                            <p class="mt-0.5 leading-relaxed text-muted-foreground">{selected.message}</p>
                        </div>

                        <div class="rounded-[2px] border border-[var(--diag-loophole)]/30 bg-[var(--diag-loophole-bg)] p-2">
                            <p class="flex items-center gap-1.5 font-semibold text-[var(--diag-loophole)]">
                                <AlertTriangle class="size-3.5" aria-hidden="true" />
                                <span>Kịch bản lách luật / Hệ quả</span>
                            </p>
                            <p class="mt-1 leading-relaxed text-foreground/90">{selected.exploitScenario}</p>
                        </div>

                        <div>
                            <p class="font-semibold text-foreground">Đề xuất sửa đổi</p>
                            <p class="mt-0.5 leading-relaxed text-muted-foreground">{selected.suggestion}</p>
                        </div>

                        <div class="flex flex-col gap-1.5">
                            {#if selected.quickFix}
                                <Button
                                    type="button"
                                    size="sm"
                                    onclick={() => selected.quickFix && onApplyQuickFix(selected.quickFix)}
                                    class="h-auto w-full gap-1.5 rounded-[2px] py-1.5 text-left whitespace-normal"
                                >
                                    <Zap class="size-3.5" aria-hidden="true" />
                                    <span>Áp dụng sửa nhanh: {selected.quickFix.label}</span>
                                </Button>
                            {/if}

                            {#if onAiFixDiagnostic}
                                {@const isFixing = fixingDiagnosticId === selected.id}
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={fixingDiagnosticId !== null}
                                    onclick={() => onAiFixDiagnostic(selected)}
                                    class="h-auto w-full gap-1.5 rounded-[2px] border-primary/40 bg-primary/10 py-1.5 text-left whitespace-normal text-primary hover:bg-primary/20"
                                >
                                    {#if isFixing}
                                        <Loader class="size-3.5 animate-spin" aria-hidden="true" />
                                        <span>AI đang phân tích và sửa...</span>
                                    {:else}
                                        <Sparkles class="size-3.5" aria-hidden="true" />
                                        <span>Sửa bằng AI</span>
                                    {/if}
                                </Button>
                            {/if}
                        </div>
                    </section>
                {:else}
                    <div class="flex flex-col items-center gap-2 rounded-[2px] border bg-background/60 p-6 text-center">
                        <CheckCircle2 class="size-8 text-[var(--diag-ok)]" aria-hidden="true" />
                        <p class="font-medium">Không phát hiện lỗ hổng hay mơ hồ nào</p>
                        <p class="text-muted-foreground">Dự thảo đạt chuẩn kiểm định Lean 4 hiện tại.</p>
                    </div>
                {/if}
            </div>
        {:else}
            <div class="flex flex-col gap-4">
                <section>
                    <h3 class="mb-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                        Thuật ngữ & Văn bản định nghĩa ({analysis?.terms.length ?? 0})
                    </h3>
                    {#if !analysis || analysis.terms.length === 0}
                        <p class="rounded-[2px] border bg-background/60 p-2.5 text-muted-foreground">
                            Chưa phát hiện thuật ngữ chuyên ngành cần đối chiếu định nghĩa.
                        </p>
                    {:else}
                        <ul class="flex flex-col gap-1.5">
                            {#each analysis.terms as term (term.normalizedTerm)}
                                <li>
                                    <button
                                        type="button"
                                        onclick={() => onJumpToLine(term.line, term.startOffset)}
                                        class="flex w-full flex-col gap-1 rounded-[2px] border bg-background/60 p-2 text-left hover:border-primary/50"
                                    >
                                        <div class="flex items-center justify-between gap-2">
                                            <span class="font-medium text-foreground">{term.term}</span>
                                            <span
                                                class={`rounded-[2px] px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                                                    term.status === "UNDEFINED"
                                                        ? "bg-[var(--diag-loophole-bg)] text-[var(--diag-loophole)]"
                                                        : "bg-[var(--diag-ok-bg)] text-[var(--diag-ok)]"
                                                }`}
                                            >
                                                {term.status === "UNDEFINED"
                                                    ? "CHƯA ĐỊNH NGHĨA"
                                                    : term.status === "DEFINED_IN_DRAFT"
                                                      ? "TRONG DỰ THẢO"
                                                      : "TRONG WORKSPACE"}
                                            </span>
                                        </div>
                                        <p class="text-[11px] text-muted-foreground">
                                            {term.definedBy
                                                ? `Nguồn: ${term.definedBy}`
                                                : `Dòng ${term.line} — Cần văn bản định nghĩa trong Library/Workspace`}
                                        </p>
                                    </button>
                                </li>
                            {/each}
                        </ul>
                    {/if}
                </section>

                <section>
                    <h3 class="mb-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                        Ma trận ngưỡng định lượng ({analysis?.intervals.length ?? 0})
                    </h3>
                    {#if !analysis || analysis.intervals.length === 0}
                        <p class="rounded-[2px] border bg-background/60 p-2.5 text-muted-foreground">
                            Chưa phát hiện dải ngưỡng định lượng (km/h, mg/100ml, tấn, %).
                        </p>
                    {:else}
                        <ul class="flex flex-col gap-1.5">
                            {#each analysis.intervals as interval (interval.id)}
                                <li>
                                    <button
                                        type="button"
                                        onclick={() => onJumpToLine(interval.line, interval.startOffset)}
                                        class="flex w-full flex-col gap-1 rounded-[2px] border bg-background/60 p-2 text-left hover:border-primary/50"
                                    >
                                        <div class="flex items-center justify-between gap-2">
                                            <span class="font-medium">
                                                {interval.metric}: {interval.min ?? "?"} – {interval.max ?? "∞"} {interval.unit}
                                            </span>
                                            <span
                                                class={`rounded-[2px] px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                                                    interval.status === "OK"
                                                        ? "bg-[var(--diag-ok-bg)] text-[var(--diag-ok)]"
                                                        : interval.status === "GAP_BEFORE"
                                                          ? "bg-[var(--diag-loophole-bg)] text-[var(--diag-loophole)]"
                                                          : "bg-[var(--diag-logic-bg)] text-[var(--diag-logic)]"
                                                }`}
                                            >
                                                {interval.status === "OK"
                                                    ? "HỢP LỆ"
                                                    : interval.status === "GAP_BEFORE"
                                                      ? "KHOẢNG TRỐNG"
                                                      : interval.status === "OVERLAP"
                                                        ? "CHỒNG CHÉO"
                                                        : "ĐẢO NGƯỢC"}
                                            </span>
                                        </div>
                                        <div class="flex items-center justify-between text-[11px] text-muted-foreground">
                                            <span>{interval.provisionRef ?? `Dòng ${interval.line}`}</span>
                                            <span class="font-mono">{formatFine(interval.fineMin, interval.fineMax)}</span>
                                        </div>
                                    </button>
                                </li>
                            {/each}
                        </ul>
                    {/if}
                </section>

                <section>
                    <h3 class="mb-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                        Bản đồ dẫn chiếu nội bộ ({analysis?.references.length ?? 0})
                    </h3>
                    {#if !analysis || analysis.references.length === 0}
                        <p class="rounded-[2px] border bg-background/60 p-2.5 text-muted-foreground">
                            Chưa có dẫn chiếu nội bộ (Điều/Khoản/Điểm).
                        </p>
                    {:else}
                        <ul class="flex flex-col gap-1.5">
                            {#each analysis.references as ref (ref.id)}
                                <li>
                                    <button
                                        type="button"
                                        onclick={() => onJumpToLine(ref.line, ref.startOffset)}
                                        class="flex w-full flex-col gap-1 rounded-[2px] border bg-background/60 p-2 text-left hover:border-primary/50"
                                    >
                                        <div class="flex items-center justify-between gap-2">
                                            <span class="font-medium">{ref.targetRef}</span>
                                            <span
                                                class={`rounded-[2px] px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                                                    ref.status === "VALID"
                                                        ? "bg-[var(--diag-ok-bg)] text-[var(--diag-ok)]"
                                                        : "bg-[var(--diag-logic-bg)] text-[var(--diag-logic)]"
                                                }`}
                                            >
                                                {ref.status === "VALID"
                                                    ? "HỢP LỆ"
                                                    : ref.status === "BROKEN"
                                                      ? "GÃY DẪN CHIẾU"
                                                      : ref.status === "SELF_REFERENCE"
                                                        ? "TỰ DẪN CHIẾU"
                                                        : "TRỎ ĐÃ BÃI BỎ"}
                                            </span>
                                        </div>
                                        <p class="text-[11px] text-muted-foreground">
                                            Từ {ref.fromRef ?? `Dòng ${ref.line}`} · “{ref.rawText}”
                                        </p>
                                    </button>
                                </li>
                            {/each}
                        </ul>
                    {/if}
                </section>
            </div>
        {/if}
    </div>
</aside>
