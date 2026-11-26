<script lang="ts">
    import type { DebugSimulationResult } from "$lib/api/ide";
    import { AlertTriangle, CheckCircle2, Cpu, Gavel, Loader, Play, Quote, Scale, ShieldAlert, XCircle } from "@lucide/svelte";

    type Props = {
        result: DebugSimulationResult | null;
        running: boolean;
        ambiguityOverrides: Record<string, boolean>;
        onRunDebug: (scenario: string, useAi: boolean) => void;
        onChangeOverride: (id: string, value: boolean) => void;
        onJumpToLine: (line: number) => void;
    };

    let { result, running, ambiguityOverrides, onRunDebug, onChangeOverride, onJumpToLine }: Props = $props();

    const SAMPLE_SCENARIOS = [
        {
            label: "Quá tốc độ 12 km/h (Kẽ hở)",
            text: "Anh A lái xe tự hành chạy quá tốc độ 12 km/h trên đường bộ.",
        },
        {
            label: "Quá tốc độ 20 km/h (Chồng chéo)",
            text: "Người điều khiển xe chạy quá tốc độ 20 km/h.",
        },
        {
            label: "Quá tốc độ 25 km/h (Mơ hồ 'nghiêm trọng')",
            text: "Anh C chạy quá tốc độ 25 km/h gây va quẹt, cần xác định mức độ nghiêm trọng.",
        },
        {
            label: "Tắt giám sát — lý do đặc biệt",
            text: "Tài xế tắt thiết bị giám sát hành trình trên cao tốc và viện dẫn trường hợp đặc biệt.",
        },
        {
            label: "Dừng xe cấm dừng (Trừ điểm)",
            text: "Anh B dừng xe tại nơi có biển cấm dừng.",
        },
    ];

    let scenario = $state(SAMPLE_SCENARIOS[0].text);
    let useAi = $state(false);

    let isAbstained = $derived(result?.verdict.outcome === "CONFLICT_AMBIGUOUS");

    let sanctionItems = $derived.by(() => {
        if (!result) {
            return [] as { label: string; provisionRef: string | null }[];
        }

        const structured = result.verdict.nonMonetarySanctions ?? [];
        const items: { label: string; provisionRef: string | null }[] = [];
        const seen = new Set<string>();

        for (const item of structured) {
            const key = item.label.trim().toLowerCase();

            if (!key || seen.has(key)) {
                continue;
            }

            seen.add(key);
            items.push({ label: item.label, provisionRef: item.provisionRef });
        }

        for (const label of result.verdict.additionalSanctions) {
            const key = label.trim().toLowerCase();

            if (!key || seen.has(key)) {
                continue;
            }

            seen.add(key);
            items.push({ label, provisionRef: null });
        }

        return items;
    });

    let citations = $derived(result?.verdict.citations ?? []);

    function submit(event: SubmitEvent): void {
        event.preventDefault();

        if (scenario.trim().length < 3 || running) {
            return;
        }

        onRunDebug(scenario.trim(), useAi);
    }

    function outcomeBadgeClass(outcome: DebugSimulationResult["verdict"]["outcome"]): string {
        if (outcome === "GUILTY_SANCTIONED") {
            return "bg-[var(--diag-ok-bg)] text-[var(--diag-ok)] border-[var(--diag-ok)]/40";
        }

        if (outcome === "PARTIALLY_ENFORCEABLE") {
            return "bg-[var(--diag-loophole-bg)] text-[var(--diag-loophole)] border-[var(--diag-loophole)]/40";
        }

        return "bg-[var(--diag-logic-bg)] text-[var(--diag-logic)] border-[var(--diag-logic)]/40";
    }
</script>

<div class="flex h-full flex-col bg-[var(--ide-panel)] text-xs">
    <div class="flex h-9 shrink-0 items-center justify-between border-b px-3 select-none">
        <span class="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Run & Debug (Tòa án)</span>
        <span class="font-mono text-[10px] text-muted-foreground">F5</span>
    </div>

    <div class="ide-scroll flex-1 overflow-y-auto p-2.5">
        <form onsubmit={submit} class="flex flex-col gap-2 border-b pb-3">
            <label for="debug-scenario" class="text-[11px] font-medium text-muted-foreground">
                Mô tả tình huống đưa ra Tòa xét xử:
            </label>
            <textarea
                id="debug-scenario"
                bind:value={scenario}
                rows={3}
                placeholder="Ví dụ: Anh A điều khiển xe chạy quá tốc độ 12 km/h..."
                class="w-full resize-none rounded-[2px] border border-input bg-background p-2 text-xs leading-relaxed focus:border-ring focus:outline-none"
            ></textarea>

            <div class="flex flex-wrap gap-1">
                {#each SAMPLE_SCENARIOS as sample (sample.label)}
                    <button
                        type="button"
                        onclick={() => (scenario = sample.text)}
                        class="rounded-[2px] border bg-secondary/70 px-1.5 py-0.5 text-[10px] text-secondary-foreground hover:bg-accent"
                    >
                        {sample.label}
                    </button>
                {/each}
            </div>

            <label class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <input type="checkbox" bind:checked={useAi} class="size-3.5 accent-primary" />
                <span>Lập luận Thẩm phán AI (ITD Decision Gate · chỉ workspace)</span>
            </label>

            <button
                type="submit"
                disabled={running || scenario.trim().length < 3}
                class="flex h-7 w-full items-center justify-center gap-1.5 rounded-[2px] bg-[#388a34] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
                {#if running}
                    <Loader class="size-3.5 animate-spin" aria-hidden="true" />
                    <span>Đang xét xử...</span>
                {:else}
                    <Play class="size-3.5" aria-hidden="true" />
                    <span>Chạy Tòa án giả lập</span>
                {/if}
            </button>
        </form>

        {#if result}
            <div class="mt-3 flex flex-col gap-3">
                <section class="rounded-[2px] border bg-background p-2.5">
                    <div class="flex flex-wrap items-center justify-between gap-1.5">
                        <div class="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                            <Gavel class="size-3.5 text-primary" aria-hidden="true" />
                            <span>Phán quyết của Thẩm phán</span>
                        </div>

                        {#if isAbstained}
                            <span
                                class="inline-flex items-center gap-1 rounded-[2px] border border-[var(--diag-ambiguity)]/50 bg-[var(--diag-ambiguity-bg)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--diag-ambiguity)]"
                                title="Tòa từ chối suy đoán do xung đột quy phạm, mơ hồ hoặc thiếu dữ kiện định lượng"
                            >
                                <ShieldAlert class="size-3" aria-hidden="true" />
                                <span>ABSTAINED</span>
                            </span>
                        {/if}
                    </div>

                    <div class={`mt-2 rounded-[2px] border px-2 py-1.5 font-mono text-[11px] font-semibold ${outcomeBadgeClass(result.verdict.outcome)}`}>
                        {result.verdict.outcomeLabel}
                    </div>

                    <p class="mt-2 leading-relaxed text-foreground">{result.verdict.summary}</p>

                    {#if result.verdict.applicableFine}
                        <p class="mt-1.5 font-mono text-[11px] text-[var(--diag-ok)]">
                            Mức phạt: {result.verdict.applicableFine.min.toLocaleString("vi-VN")} – {result.verdict.applicableFine.max.toLocaleString("vi-VN")}đ
                        </p>
                    {/if}

                    {#if sanctionItems.length > 0}
                        <div class="mt-2 border-t pt-2">
                            <p class="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase">
                                <Scale class="size-3 text-primary" aria-hidden="true" />
                                <span>Chế tài phi tiền tệ / bổ sung ({sanctionItems.length})</span>
                            </p>
                            <ul class="mt-1 flex flex-wrap gap-1">
                                {#each sanctionItems as item (item.label)}
                                    <li class="inline-flex items-center gap-1 rounded-[2px] border border-[var(--diag-loophole)]/35 bg-[var(--diag-loophole-bg)] px-1.5 py-0.5 text-[10px] text-foreground">
                                        <span>{item.label}</span>
                                        {#if item.provisionRef}
                                            <span class="font-mono text-[9px] text-muted-foreground">({item.provisionRef})</span>
                                        {/if}
                                    </li>
                                {/each}
                            </ul>
                        </div>
                    {/if}

                    {#if citations.length > 0}
                        <div class="mt-2 border-t pt-2">
                            <div class="flex items-center justify-between gap-1">
                                <p class="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase">
                                    <Quote class="size-3 text-primary" aria-hidden="true" />
                                    <span>Trích dẫn nguyên văn ({citations.length})</span>
                                </p>
                                <span class="font-mono text-[9px] text-[var(--diag-ok)]">Nguyên văn ✓</span>
                            </div>
                            <ul class="mt-1.5 flex flex-col gap-1.5">
                                {#each citations as cit (`${cit.provisionRef}::${cit.verbatimQuote}`)}
                                    <li class="rounded-[2px] border-l-2 border-primary/60 bg-muted/40 px-2 py-1 text-[11px]">
                                        <div class="flex flex-wrap items-center gap-1.5 font-mono text-[10px] font-semibold text-foreground">
                                            <span>{cit.provisionRef}</span>
                                            {#if cit.sourceDocument}
                                                <span class="rounded-[2px] border bg-background px-1 py-0 text-[9px] font-normal text-muted-foreground">
                                                    {cit.sourceDocument}
                                                </span>
                                            {/if}
                                        </div>
                                        <p class="mt-0.5 leading-snug text-muted-foreground">“{cit.verbatimQuote}”</p>
                                    </li>
                                {/each}
                            </ul>
                        </div>
                    {/if}

                    {#if result.verdict.judicialReasoning.length > 0}
                        <div class="mt-2 border-t pt-2">
                            <p class="text-[10px] font-semibold text-muted-foreground uppercase">Nhận định của Tòa án</p>
                            <ul class="mt-1 flex flex-col gap-1 text-[11px] text-muted-foreground">
                                {#each result.verdict.judicialReasoning as reason, idx (idx)}
                                    <li>• {reason}</li>
                                {/each}
                            </ul>
                        </div>
                    {/if}

                    <div class="mt-2 rounded-[2px] bg-muted/60 p-2 text-[11px]">
                        <span class="font-semibold text-foreground">Khuyến nghị vá luật: </span>
                        <span class="text-muted-foreground">{result.verdict.lawmakerAction}</span>
                    </div>

                    <div class="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2 font-mono text-[10px] text-muted-foreground">
                        <span class="flex items-center gap-1">
                            <Cpu class="size-3" aria-hidden="true" />
                            <span>{result.method === "LEAN_PLUS_AI" ? "ITD Lean + AI" : "Lean 4 · 0 token"}</span>
                            <span>· {result.durationMs} ms</span>
                        </span>
                        {#if result.tokenUsage}
                            {@const decisionTok = result.tokenUsage.decisionInputTokens ?? 0}
                            <span
                                title={`Tổng token: ${result.tokenUsage.totalTokens} (in: ${result.tokenUsage.inputTokens}, out: ${result.tokenUsage.outputTokens}, gate: ${decisionTok}) · LLM calls: ${result.llmCalls ?? 0}`}
                            >
                                {result.tokenUsage.totalTokens.toLocaleString("vi-VN")} tok{#if result.tokenUsage.totalTokens > 0} ({result.tokenUsage.inputTokens}/{result.tokenUsage.outputTokens}{#if decisionTok > 0} · gate {decisionTok}{/if}){/if} · {result.llmCalls ?? 0} calls
                            </span>
                        {/if}
                    </div>
                </section>

                {#if result.ambiguities.length > 0}
                    <section class="rounded-[2px] border border-[var(--diag-ambiguity)]/40 bg-[var(--diag-ambiguity-bg)] p-2.5">
                        <p class="text-[10px] font-semibold tracking-wider text-[var(--diag-ambiguity)] uppercase">
                            Tinh chỉnh điểm mơ hồ ({result.ambiguities.length})
                        </p>
                        <p class="mt-0.5 text-[11px] text-muted-foreground">
                            Chọn giả định cho từng yếu tố mơ hồ để kiểm thử lại phán quyết của Thẩm phán:
                        </p>

                        <ul class="mt-2 flex flex-col gap-2">
                            {#each result.ambiguities as amb (amb.id)}
                                {@const chosen = Object.prototype.hasOwnProperty.call(ambiguityOverrides, amb.id)
                                    ? ambiguityOverrides[amb.id]
                                    : amb.selectedValue}
                                <li class="rounded-[2px] border border-border bg-background/85 p-2">
                                    <div class="flex items-center justify-between gap-1">
                                        <span class="font-mono text-[10px] font-semibold text-[var(--diag-ambiguity)]">
                                            {amb.code} · “{amb.term}”
                                        </span>
                                        <button
                                            type="button"
                                            onclick={() => onJumpToLine(amb.line)}
                                            class="font-mono text-[10px] text-muted-foreground hover:text-foreground hover:underline"
                                        >
                                            L{amb.line}
                                        </button>
                                    </div>
                                    <p class="mt-1 text-[11px] text-foreground">{amb.question}</p>
                                    <div class="mt-1.5 flex flex-col gap-1">
                                        <button
                                            type="button"
                                            onclick={() => onChangeOverride(amb.id, true)}
                                            class={`rounded-[2px] border px-2 py-1 text-left text-[10px] transition-colors ${
                                                chosen === true
                                                    ? "border-primary bg-primary text-primary-foreground font-medium"
                                                    : "border-border bg-secondary/60 hover:bg-accent"
                                            }`}
                                        >
                                            {amb.trueLabel}
                                        </button>
                                        <button
                                            type="button"
                                            onclick={() => onChangeOverride(amb.id, false)}
                                            class={`rounded-[2px] border px-2 py-1 text-left text-[10px] transition-colors ${
                                                chosen === false
                                                    ? "border-primary bg-primary text-primary-foreground font-medium"
                                                    : "border-border bg-secondary/60 hover:bg-accent"
                                            }`}
                                        >
                                            {amb.falseLabel}
                                        </button>
                                    </div>
                                </li>
                            {/each}
                        </ul>
                    </section>
                {/if}

                <section>
                    <p class="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                        Call Stack thực thi ({result.trace.length})
                    </p>
                    {#if result.trace.length === 0}
                        <p class="text-[11px] text-muted-foreground">Không khớp điều khoản nào trong dự thảo.</p>
                    {:else}
                        <ul class="flex flex-col gap-1.5">
                            {#each result.trace as step (step.stepNumber)}
                                <li>
                                    <button
                                        type="button"
                                        onclick={() => onJumpToLine(step.line)}
                                        class="flex w-full flex-col gap-1 rounded-[2px] border bg-background/70 p-2 text-left hover:border-primary/50"
                                    >
                                        <div class="flex items-center justify-between gap-1">
                                            <span class="flex items-center gap-1 font-medium text-foreground">
                                                {#if step.status === "MATCHED"}
                                                    <CheckCircle2 class="size-3.5 text-[var(--diag-ok)]" aria-hidden="true" />
                                                {:else if step.status === "CONFLICT_HIT"}
                                                    <XCircle class="size-3.5 text-[var(--diag-logic)]" aria-hidden="true" />
                                                {:else}
                                                    <AlertTriangle class="size-3.5 text-[var(--diag-loophole)]" aria-hidden="true" />
                                                {/if}
                                                <span>{step.provisionRef}</span>
                                            </span>
                                            <span class="font-mono text-[10px] text-muted-foreground">L{step.line}</span>
                                        </div>
                                        <p class="text-[11px] text-muted-foreground">{step.evaluation}</p>
                                        <code class="truncate font-mono text-[10px] text-primary">{step.leanCheck}</code>
                                    </button>
                                </li>
                            {/each}
                        </ul>
                    {/if}
                </section>
            </div>
        {/if}
    </div>
</div>
