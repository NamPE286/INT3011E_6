<script lang="ts" module>
    export type SessionTokenUsage = {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        lastRunTokens: number;
        savedPercent: number | null;
    };
</script>

<script lang="ts">
    import type { AnalysisResult } from "$lib/api/ide";
    import { AlertTriangle, CheckCircle2, Cpu, HelpCircle, Loader, ShieldCheck, Sparkles, XCircle } from "@lucide/svelte";

    type Props = {
        analysis: AnalysisResult | null;
        cursorLine: number;
        cursorCol: number;
        activeRef: string | null;
        analyzing: boolean;
        aiAuditing?: boolean;
        aiPhaseLabel?: string | null;
        tokenUsage?: SessionTokenUsage;
    };

    let {
        analysis,
        cursorLine,
        cursorCol,
        activeRef,
        analyzing,
        aiAuditing = false,
        aiPhaseLabel = null,
        tokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, lastRunTokens: 0, savedPercent: null },
    }: Props = $props();
</script>

<footer
    class="flex h-6 shrink-0 items-center justify-between gap-3 bg-[var(--ide-statusbar)] px-3 font-mono text-[11px] text-[var(--ide-statusbar-fg)] select-none"
>
    <div class="flex items-center gap-3">
        <span class="flex items-center gap-1 font-semibold">
            <ShieldCheck class="size-3.5" aria-hidden="true" />
            <span class="hidden sm:inline">Workspace</span>
        </span>

        {#if aiAuditing}
            <span class="flex items-center gap-1.5 rounded-[2px] bg-white/15 px-1.5 py-0.5 font-medium">
                <Loader class="size-3 animate-spin" aria-hidden="true" />
                <Sparkles class="size-3 animate-pulse" aria-hidden="true" />
                <span>{aiPhaseLabel ?? "AI Analyzer đang phân tích..."}</span>
            </span>
        {:else if analyzing}
            <span>Đang biên dịch Lean 4...</span>
        {:else if analysis?.lean}
            <span class="flex items-center gap-1">
                <CheckCircle2 class="size-3" aria-hidden="true" />
                Lean 4: {analysis.lean.provedCount}✓ {analysis.lean.refutedCount}✗
            </span>
        {/if}

        {#if analysis}
            <span class="flex items-center gap-1" title="Lỗ hổng logic">
                <XCircle class="size-3" aria-hidden="true" />
                {analysis.metrics.countsByCategory.LOGIC}
            </span>
            <span class="flex items-center gap-1" title="Kẽ hở pháp lý">
                <AlertTriangle class="size-3" aria-hidden="true" />
                {analysis.metrics.countsByCategory.LOOPHOLE}
            </span>
            <span class="hidden items-center gap-1 sm:flex" title="Mơ hồ ngôn từ">
                <HelpCircle class="size-3" aria-hidden="true" />
                {analysis.metrics.countsByCategory.AMBIGUITY}
            </span>
        {/if}
    </div>

    <div class="flex items-center gap-3">
        {#if activeRef}
            <span class="hidden truncate font-sans md:inline">{activeRef}</span>
        {/if}
        <span
            class="flex items-center gap-1"
            title={`Tổng token phiên: ${tokenUsage.totalTokens.toLocaleString("vi-VN")} (${tokenUsage.inputTokens.toLocaleString("vi-VN")} input / ${tokenUsage.outputTokens.toLocaleString("vi-VN")} output) · Lần chạy gần nhất: ${tokenUsage.lastRunTokens.toLocaleString("vi-VN")}${tokenUsage.savedPercent !== null ? ` · Tiết kiệm ${tokenUsage.savedPercent}%` : ""}`}
        >
            <Cpu class="size-3" aria-hidden="true" />
            <span>
                Tokens: {tokenUsage.totalTokens.toLocaleString("vi-VN")}{#if tokenUsage.inputTokens > 0 || tokenUsage.outputTokens > 0} ({tokenUsage.inputTokens.toLocaleString("vi-VN")} in / {tokenUsage.outputTokens.toLocaleString("vi-VN")} out){/if}{#if tokenUsage.savedPercent !== null && analysis?.lean} · Tiết kiệm {tokenUsage.savedPercent}%{/if}
            </span>
        </span>
        <span>Ln {cursorLine}, Col {cursorCol}</span>
        <span class="hidden lg:inline">F5 Chạy thử · Ctrl+Space Gợi ý · Tab Chấp nhận</span>
    </div>
</footer>
