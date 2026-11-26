<script lang="ts">
    import type { LegalDiagnostic, QuickFix, TermOccurrence } from "$lib/api/ide";
    import type { BehaviorLineIndicator } from "$lib/engine/workspace-behaviors";
    import { AlertTriangle, BookOpen, ExternalLink, HelpCircle, Loader, Scale, ShieldAlert, Sparkles, XCircle, Zap } from "@lucide/svelte";

    type Props = {
        diagnostics: LegalDiagnostic[];
        hoveredTerm?: TermOccurrence | null;
        hoveredBehavior?: BehaviorLineIndicator | null;
        fixingDiagnosticId?: string | null;
        position: { top: number; left: number; flipUp: boolean };
        onApplyQuickFix: (fix: QuickFix) => void;
        onAiFixDiagnostic?: (diag: LegalDiagnostic) => void;
        onInspect: (diag: LegalDiagnostic) => void;
        onJumpToDefinition?: (term: TermOccurrence) => void;
        onOpenBehaviorsPanel?: () => void;
        onMouseEnter: () => void;
        onMouseLeave: () => void;
    };

    let {
        diagnostics,
        hoveredTerm = null,
        hoveredBehavior = null,
        fixingDiagnosticId = null,
        position,
        onApplyQuickFix,
        onAiFixDiagnostic,
        onInspect,
        onJumpToDefinition,
        onOpenBehaviorsPanel,
        onMouseEnter,
        onMouseLeave,
    }: Props = $props();

    function categoryLabel(category: LegalDiagnostic["category"]): string {
        if (category === "LOOPHOLE") {
            return "Kẽ hở pháp lý";
        }

        if (category === "AMBIGUITY") {
            return "Mơ hồ ngôn từ";
        }

        return "Lỗ hổng logic";
    }
</script>

<div
    role="tooltip"
    onmouseenter={onMouseEnter}
    onmouseleave={onMouseLeave}
    style:top={`${position.top}px`}
    style:left={`${position.left}px`}
    style:transform={position.flipUp ? "translateY(calc(-100% - 26px))" : "none"}
    class="ide-scroll absolute z-40 max-h-80 w-[440px] max-w-[calc(100%-24px)] overflow-y-auto rounded-[3px] border border-[var(--ide-widget-border)] bg-[var(--ide-widget-bg)] text-xs text-popover-foreground shadow-2xl"
>
    {#if hoveredTerm}
        <div class="flex flex-col gap-1.5 bg-background/40 p-2.5">
            <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-1.5">
                    <BookOpen class="size-3.5 shrink-0 text-[var(--syn-index)]" aria-hidden="true" />
                    <span class="font-semibold text-foreground">Thuật ngữ: “{hoveredTerm.term}”</span>
                </div>
                <span
                    class={`rounded-[2px] px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                        hoveredTerm.status === "UNDEFINED"
                            ? "bg-[var(--diag-loophole-bg)] text-[var(--diag-loophole)]"
                            : "bg-[var(--diag-ok-bg)] text-[var(--diag-ok)]"
                    }`}
                >
                    {hoveredTerm.status === "DEFINED_IN_DRAFT"
                        ? "Trong dự thảo"
                        : hoveredTerm.status === "DEFINED_IN_WORKSPACE"
                          ? "Trong Workspace"
                          : "Chưa định nghĩa"}
                </span>
            </div>

            {#if hoveredTerm.definedBy}
                <p class="font-mono text-[10px] text-[var(--syn-index)]">
                    Dẫn chiếu: {hoveredTerm.sourceProvisionRef ? `${hoveredTerm.sourceProvisionRef} · ` : ""}{hoveredTerm.definedBy}
                </p>
            {/if}

            {#if hoveredTerm.sourceDocumentReplacedBy}
                <p class="rounded-[2px] bg-[var(--diag-loophole-bg)] px-2 py-1 text-[10px] text-[var(--diag-loophole)]">
                    Lưu ý: Văn bản gốc đã bị thay thế bởi {hoveredTerm.sourceDocumentReplacedBy}.
                </p>
            {/if}

            {#if hoveredTerm.definition}
                <p class="rounded-[2px] border border-border/70 bg-background/70 px-2 py-1.5 text-[11px] leading-relaxed text-foreground/90">
                    {hoveredTerm.definition}
                </p>
            {/if}

            {#if hoveredTerm.status !== "UNDEFINED" && onJumpToDefinition}
                <button
                    type="button"
                    onclick={() => onJumpToDefinition(hoveredTerm)}
                    class="flex w-fit items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                >
                    <ExternalLink class="size-3" aria-hidden="true" />
                    <span>Mở điều khoản định nghĩa</span>
                </button>
            {/if}
        </div>
    {/if}

    {#if hoveredBehavior}
        <div class={`flex flex-col gap-1.5 bg-background/40 p-2.5 ${hoveredTerm ? "border-t border-[var(--ide-widget-border)]" : ""}`}>
            <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-1.5">
                    <Scale class="size-3.5 shrink-0 text-[var(--diag-ok)]" aria-hidden="true" />
                    <span class="font-semibold text-foreground">
                        {hoveredBehavior.isNew ? "Hành vi mới được định nghĩa" : `Cập nhật hành vi (${hoveredBehavior.versionCount} phiên bản)`}
                    </span>
                </div>
                <span
                    class={`rounded-[2px] px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                        hoveredBehavior.isNew
                            ? "bg-[var(--diag-ok-bg)] text-[var(--diag-ok)]"
                            : "bg-primary/20 text-primary"
                    }`}
                >
                    {hoveredBehavior.provisionRef}
                </span>
            </div>

            <p class="text-[11px] font-medium text-foreground">{hoveredBehavior.behaviorTitle}</p>

            <div class="flex flex-wrap items-center gap-1.5 text-[10px]">
                <span class="rounded-[2px] bg-secondary px-1.5 py-0.5 text-muted-foreground">
                    {hoveredBehavior.vehicleOrSubject}
                </span>
                <span class="rounded-[2px] bg-secondary px-1.5 py-0.5 text-muted-foreground">
                    {hoveredBehavior.modality === "PROHIBITED" ? "Nghiêm cấm" : "Chế tài"}
                </span>
                {#if hoveredBehavior.hasExplicitSanction}
                    <span class="font-mono font-semibold text-[var(--diag-ok)]">
                        {hoveredBehavior.fineLabel}
                    </span>
                {:else}
                    <span class="rounded-[2px] bg-secondary px-1.5 py-0.5 font-mono text-muted-foreground">
                        Định nghĩa hành vi
                    </span>
                {/if}
                {#if hoveredBehavior.pointsDeducted}
                    <span class="font-mono text-[var(--diag-loophole)]">· Trừ {hoveredBehavior.pointsDeducted} điểm GPLX</span>
                {/if}
                {#if hoveredBehavior.suspensionMonths}
                    <span class="font-mono text-muted-foreground">· Tước {hoveredBehavior.suspensionMonths}</span>
                {/if}
            </div>

            {#if !hoveredBehavior.hasExplicitSanction && hoveredBehavior.definitionText}
                <p class="rounded-[2px] border border-border/70 bg-background/60 px-2 py-1 text-[10px] text-foreground/90">
                    {hoveredBehavior.definitionText}
                </p>
            {/if}

            {#if hoveredBehavior.previousSanctions.length > 0}
                <div class="rounded-[2px] border border-border/70 bg-background/60 px-2 py-1 text-[10px]">
                    <p class="mb-0.5 font-semibold text-muted-foreground">Lịch sử mức xử lý:</p>
                    {#each hoveredBehavior.previousSanctions as prev, pIdx (pIdx)}
                        <p class="truncate font-mono text-muted-foreground">
                            • {prev.documentLabel} ({prev.provisionRef}): {prev.fineLabel}
                        </p>
                    {/each}
                </div>
            {/if}

            {#if hoveredBehavior.previousDefinitions.length > 0}
                <div class="rounded-[2px] border border-border/70 bg-background/60 px-2 py-1 text-[10px]">
                    <p class="mb-0.5 font-semibold text-muted-foreground">Lịch sử định nghĩa:</p>
                    {#each hoveredBehavior.previousDefinitions as prev, pIdx (pIdx)}
                        <p class="truncate text-muted-foreground">
                            • {prev.documentLabel} ({prev.provisionRef}): {prev.definitionText}
                        </p>
                    {/each}
                </div>
            {/if}

            {#if onOpenBehaviorsPanel}
                <button
                    type="button"
                    onclick={onOpenBehaviorsPanel}
                    class="flex w-fit items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                >
                    <ExternalLink class="size-3" aria-hidden="true" />
                    <span>Mở tab Hành vi</span>
                </button>
            {/if}
        </div>
    {/if}

    {#each diagnostics as diag, idx (diag.id)}
        <div class={`flex flex-col gap-1.5 p-2.5 ${idx > 0 || hoveredTerm || hoveredBehavior ? "border-t border-[var(--ide-widget-border)]" : ""}`}>
            <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-1.5">
                    {#if diag.category === "LOGIC"}
                        <XCircle class="size-3.5 shrink-0 text-[var(--diag-logic)]" aria-hidden="true" />
                    {:else if diag.category === "LOOPHOLE"}
                        <AlertTriangle class="size-3.5 shrink-0 text-[var(--diag-loophole)]" aria-hidden="true" />
                    {:else}
                        <HelpCircle class="size-3.5 shrink-0 text-[var(--diag-ambiguity)]" aria-hidden="true" />
                    {/if}
                    <span class="font-mono font-semibold text-foreground">{diag.code}</span>
                    <span class="rounded-[2px] bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {categoryLabel(diag.category)}
                    </span>
                </div>
                <span class="font-mono text-[10px] text-muted-foreground">Dòng {diag.range.startLine}</span>
            </div>

            <p class="font-semibold text-foreground">{diag.title}</p>
            <p class="leading-relaxed text-muted-foreground">{diag.message}</p>

            {#if diag.leanTheorem}
                <div class="rounded-[2px] border border-border bg-background/60 px-2 py-1 font-mono text-[10px]">
                    <span class="text-primary">Lean 4:</span> {diag.leanTheorem}
                    {#if diag.counterexample}
                        <span class="block text-[var(--diag-logic)]">↳ {diag.counterexample}</span>
                    {/if}
                </div>
            {/if}

            <p class="text-[11px] text-[var(--diag-loophole)]">
                <span class="font-semibold">Rủi ro lách luật:</span> {diag.exploitScenario}
            </p>

            <div class="flex flex-wrap items-center gap-3 border-t border-border/60 pt-1.5 text-[11px]">
                {#if diag.quickFix}
                    <button
                        type="button"
                        onclick={() => diag.quickFix && onApplyQuickFix(diag.quickFix)}
                        class="flex items-center gap-1 font-medium text-primary hover:underline"
                    >
                        <Zap class="size-3" aria-hidden="true" />
                        <span>{diag.quickFix.label}</span>
                    </button>
                {/if}
                {#if onAiFixDiagnostic}
                    {@const isFixing = fixingDiagnosticId === diag.id}
                    <button
                        type="button"
                        disabled={fixingDiagnosticId !== null}
                        onclick={() => onAiFixDiagnostic(diag)}
                        class="flex items-center gap-1 font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
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
                <button
                    type="button"
                    onclick={() => onInspect(diag)}
                    class="flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
                >
                    <ShieldAlert class="size-3" aria-hidden="true" />
                    <span>Xem chi tiết</span>
                </button>
            </div>
        </div>
    {/each}
</div>
