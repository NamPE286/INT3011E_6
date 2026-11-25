<script lang="ts">
    import type { ImpactScopeReport } from "$lib/api/analysis";
    import { Badge } from "$lib/components/ui/badge";
    import { Button } from "$lib/components/ui/button";
    import { relationLabel, sanctionChangeLabel } from "$lib/labels";
    import {
        AlertCircle,
        ArrowRight,
        CheckSquare,
        FileWarning,
        GitBranch,
        Layers,
        Network,
        RefreshCw,
        TrendingUp,
        Users,
    } from "@lucide/svelte";

    type Props = {
        report: ImpactScopeReport | null;
        loading?: boolean;
        maxDepth?: number;
        onDepthChange?: (depth: number) => void;
        onRefresh?: () => void;
    };

    let { report, loading = false, maxDepth = 3, onDepthChange, onRefresh }: Props = $props();

    const RISK_BADGE: Record<string, { label: string; className: string }> = {
        LOW: {
            label: "Phạm vi tác động thấp",
            className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        },
        MEDIUM: {
            label: "Phạm vi tác động trung bình",
            className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        },
        HIGH: {
            label: "Phạm vi tác động rộng / rủi ro cao",
            className: "border-destructive/40 bg-destructive/10 text-destructive",
        },
    };

    const PRIORITY_LABEL: Record<string, string> = {
        HIGH: "Ưu tiên cao",
        MEDIUM: "Cần rà soát",
        LOW: "Bổ sung kho",
    };

    function handleDepthSelect(event: Event): void {
        const select = event.currentTarget as HTMLSelectElement;
        const parsed = Number(select.value);

        if (Number.isInteger(parsed) && onDepthChange) {
            onDepthChange(parsed);
        }
    }
</script>

<section class="flex flex-col gap-5" aria-label="Phân tích phạm vi tác động">
    {#if loading && !report}
        <p class="py-8 text-center text-sm text-muted-foreground">Đang tính toán phạm vi tác động trực tiếp và dây chuyền…</p>
    {:else if !report}
        <p class="py-8 text-center text-sm text-muted-foreground">Chọn một văn bản hoặc dự thảo để đánh giá phạm vi tác động pháp lý.</p>
    {:else}
        {@const riskMeta = RISK_BADGE[report.summary.riskLevel] ?? RISK_BADGE.MEDIUM}
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background p-4">
            <div class="flex flex-wrap items-center gap-3">
                <span class={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${riskMeta.className}`}>
                    <Layers class="size-3.5" aria-hidden="true" />
                    {riskMeta.label}
                </span>
                {#if report.effectiveFrom}
                    <span class="text-xs text-muted-foreground">Hiệu lực dự kiến: <strong class="text-foreground">{report.effectiveFrom}</strong></span>
                {/if}
            </div>

            <div class="flex flex-wrap items-center gap-2">
                {#if onDepthChange}
                    <label class="flex items-center gap-1.5 text-xs">
                        <span class="text-muted-foreground">Độ sâu lan truyền:</span>
                        <select value={String(maxDepth)} onchange={handleDepthSelect} class="h-8 rounded-md border bg-background px-2 text-xs">
                            <option value="1">1 tầng (trực tiếp)</option>
                            <option value="2">2 tầng (dây chuyền gần)</option>
                            <option value="3">3 tầng (mặc định)</option>
                            <option value="4">4 tầng</option>
                            <option value="5">5 tầng</option>
                        </select>
                    </label>
                {/if}

                <Button href={`/graph?document=${encodeURIComponent(report.documentId)}`} size="sm" variant="outline" class="gap-1.5">
                    <Network class="size-3.5" aria-hidden="true" />
                    Xem trên lược đồ
                </Button>

                {#if onRefresh}
                    <Button size="sm" variant="outline" onclick={onRefresh} disabled={loading} class="gap-1.5">
                        <RefreshCw class={`size-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
                        Cập nhật
                    </Button>
                {/if}
            </div>
        </div>

        <!-- Summary KPI grid -->
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div class="rounded-xl border bg-background p-3">
                <div class="text-xs text-muted-foreground">Tác động trực tiếp</div>
                <div class="mt-0.5 text-2xl font-semibold">{report.summary.directDocumentCount}</div>
                <div class="text-[11px] text-muted-foreground">văn bản (tầng 1)</div>
            </div>
            <div class="rounded-xl border bg-background p-3">
                <div class="text-xs text-muted-foreground">Tác động dây chuyền</div>
                <div class="mt-0.5 text-2xl font-semibold text-amber-700 dark:text-amber-300">{report.summary.indirectDocumentCount}</div>
                <div class="text-[11px] text-muted-foreground">văn bản (tầng 2–{report.maxDepth})</div>
            </div>
            <div class="rounded-xl border bg-background p-3">
                <div class="text-xs text-muted-foreground">Điều khoản bị tác động</div>
                <div class="mt-0.5 text-2xl font-semibold">{report.summary.affectedProvisionCount}</div>
                <div class="text-[11px] text-muted-foreground">cạnh Điều/Khoản/Điểm</div>
            </div>
            <div class="rounded-xl border bg-background p-3">
                <div class="text-xs text-muted-foreground">Biến động chế tài</div>
                <div class="mt-0.5 text-2xl font-semibold text-destructive">{report.summary.sanctionShiftCount}</div>
                <div class="text-[11px] text-muted-foreground">
                    +{report.summary.escalatedCount} tăng · -{report.summary.reducedCount} giảm
                </div>
            </div>
        </div>

        <!-- Affected Subjects -->
        {#if report.affectedSubjects.length > 0}
            <div class="flex flex-col gap-2 rounded-xl border bg-background p-4">
                <h3 class="flex items-center gap-1.5 text-sm font-semibold">
                    <Users class="size-4 text-primary" aria-hidden="true" />
                    Nhóm đối tượng / lĩnh vực chịu tác động
                </h3>
                <div class="flex flex-wrap gap-2">
                    {#each report.affectedSubjects as subject (subject)}
                        <Badge variant="secondary">{subject}</Badge>
                    {/each}
                </div>
            </div>
        {/if}

        <!-- Direct Impacts (Hop 1) -->
        <div class="flex flex-col gap-2.5 rounded-xl border bg-background p-4">
            <h3 class="flex items-center gap-1.5 text-sm font-semibold">
                <ArrowRight class="size-4 text-primary" aria-hidden="true" />
                1. Văn bản chịu tác động trực tiếp ({report.directImpacts.length})
            </h3>

            {#if report.directImpacts.length === 0}
                <p class="text-xs text-muted-foreground">
                    Chưa ghi nhận văn bản nào bị dự thảo này sửa đổi, bổ sung, thay thế hoặc bãi bỏ trực tiếp.
                </p>
            {:else}
                <ul class="flex flex-col gap-2">
                    {#each report.directImpacts as item (`${item.documentId}:${item.relationType}`)}
                        <li class="flex flex-col gap-1 rounded-lg border bg-card p-3 text-sm">
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <div class="flex flex-wrap items-center gap-2">
                                    <a href={`/documents/${encodeURIComponent(item.documentId)}`} class="font-semibold underline-offset-4 hover:underline">
                                        {item.documentNumber ?? item.title ?? item.documentId}
                                    </a>
                                    <Badge variant="default" class="text-[11px]">{relationLabel(item.relationType, "OUTGOING")}</Badge>
                                    <Badge variant="outline" class="text-[11px]">{item.scope === "FULL" ? "Toàn văn bản" : "Một phần"}</Badge>
                                </div>
                                <span class="text-xs text-muted-foreground">
                                    {item.affectedProvisionCount} điều khoản nối · {item.sourceMode === "MANUAL" ? "Thủ công" : "AI"}
                                </span>
                            </div>
                            {#if item.title && item.documentNumber}
                                <p class="text-xs text-muted-foreground">{item.title}</p>
                            {/if}
                            {#if item.note}
                                <p class="text-xs text-foreground/80">{item.note}</p>
                            {/if}
                        </li>
                    {/each}
                </ul>
            {/if}
        </div>

        <!-- Indirect / Cascading Impacts (Hop 2+) -->
        <div class="flex flex-col gap-2.5 rounded-xl border bg-background p-4">
            <h3 class="flex items-center gap-1.5 text-sm font-semibold">
                <GitBranch class="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                2. Tác động gián tiếp / dây chuyền ({report.indirectImpacts.length})
            </h3>

            {#if report.indirectImpacts.length === 0}
                <p class="text-xs text-muted-foreground">
                    Chưa phát hiện văn bản hướng dẫn, quy định chi tiết hoặc viện dẫn nào chịu tác động dây chuyền trong phạm vi Workspace.
                </p>
            {:else}
                <ul class="flex flex-col gap-2">
                    {#each report.indirectImpacts as item (item.documentId)}
                        <li class="flex flex-col gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <div class="flex flex-wrap items-center gap-2">
                                    <Badge variant="secondary" class="text-[11px]">Tầng {item.depth}</Badge>
                                    <a href={`/documents/${encodeURIComponent(item.documentId)}`} class="font-semibold underline-offset-4 hover:underline">
                                        {item.documentNumber ?? item.title ?? item.documentId}
                                    </a>
                                    {#if item.documentType}
                                        <Badge variant="outline" class="text-[11px]">{item.documentType}</Badge>
                                    {/if}
                                </div>
                                <Badge variant="outline" class="text-[11px]">{relationLabel(item.viaRelationType, "OUTGOING")}</Badge>
                            </div>

                            {#if item.impactPath.length > 0}
                                <p class="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                                    <span class="font-medium text-foreground">Chuỗi lan truyền:</span>
                                    {#each item.impactPath as step, index (`${step}-${index}`)}
                                        <span class="rounded bg-background px-1.5 py-0.5">{step}</span>
                                        {#if index < item.impactPath.length - 1}
                                            <ArrowRight class="size-3" aria-hidden="true" />
                                        {/if}
                                    {/each}
                                </p>
                            {/if}

                            <p class="text-xs text-foreground/85">{item.reason}</p>
                        </li>
                    {/each}
                </ul>
            {/if}
        </div>

        <!-- Affected Provisions -->
        {#if report.affectedProvisions.length > 0}
            <div class="flex flex-col gap-2.5 rounded-xl border bg-background p-4">
                <h3 class="text-sm font-semibold">3. Điều / Khoản / Điểm chịu tác động cụ thể ({report.affectedProvisions.length})</h3>
                <ul class="flex flex-col gap-2">
                    {#each report.affectedProvisions as item (item.relationId)}
                        <li class="flex flex-col gap-1 rounded-lg border bg-card p-3 text-xs">
                            <div class="flex flex-wrap items-center gap-1.5">
                                <span class="font-semibold text-foreground">{item.fromProvisionLabel}</span>
                                <Badge variant="secondary" class="text-[10px]">{relationLabel(item.relationType, "OUTGOING")}</Badge>
                                <a
                                    href={item.toProvisionId
                                        ? `/documents/${encodeURIComponent(item.toDocumentId)}#${encodeURIComponent(item.toProvisionId)}`
                                        : `/documents/${encodeURIComponent(item.toDocumentId)}`}
                                    class="font-semibold text-primary underline-offset-4 hover:underline"
                                >
                                    {item.toProvisionLabel ? `${item.toProvisionLabel} — ` : ""}{item.toDocumentLabel}
                                </a>
                            </div>
                            {#if item.evidenceText}
                                <p class="text-muted-foreground">{item.evidenceText}</p>
                            {/if}
                        </li>
                    {/each}
                </ul>
            </div>
        {/if}

        <!-- Sanction Shifts -->
        {#if report.sanctionShifts.length > 0}
            <div class="flex flex-col gap-2.5 rounded-xl border bg-background p-4">
                <h3 class="flex items-center gap-1.5 text-sm font-semibold">
                    <TrendingUp class="size-4 text-destructive" aria-hidden="true" />
                    4. Biến động khung chế tài & xử phạt ({report.sanctionShifts.length})
                </h3>
                <div class="grid gap-2.5 md:grid-cols-2">
                    {#each report.sanctionShifts as shift (shift.id)}
                        <div class="flex flex-col gap-1.5 rounded-lg border bg-card p-3 text-xs">
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <span class="font-semibold text-foreground">{sanctionChangeLabel(shift.changeType)}</span>
                                {#if shift.severityDeltaPercent !== null}
                                    <Badge variant={shift.severityDeltaPercent > 0 ? "destructive" : "secondary"} class="text-[10px]">
                                        {shift.severityDeltaPercent > 0 ? `+${shift.severityDeltaPercent}%` : `${shift.severityDeltaPercent}%`}
                                    </Badge>
                                {/if}
                            </div>
                            <p class="font-medium text-foreground/90">{shift.behaviorSummary}</p>
                            {#if shift.oldPenaltyText || shift.newPenaltyText}
                                <p class="text-muted-foreground">
                                    {shift.oldPenaltyText ?? "—"} → <strong class="text-foreground">{shift.newPenaltyText ?? "—"}</strong>
                                </p>
                            {/if}
                        </div>
                    {/each}
                </div>
            </div>
        {/if}

        <!-- Unresolved Frontier -->
        {#if report.unresolvedFrontier.length > 0}
            <div class="flex flex-col gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs">
                <h3 class="flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-200">
                    <FileWarning class="size-4" aria-hidden="true" />
                    Khoảng trống đối chiếu — Văn bản được dẫn chiếu chưa có trong Workspace ({report.unresolvedFrontier.length})
                </h3>
                <ul class="flex flex-col gap-1">
                    {#each report.unresolvedFrontier as missing (`${missing.citation}:${missing.provisionId}`)}
                        <li class="flex items-center gap-2">
                            <AlertCircle class="size-3.5 shrink-0 text-amber-600" aria-hidden="true" />
                            <span><strong>{missing.citation}</strong> (trích dẫn tại {missing.provisionLabel})</span>
                        </li>
                    {/each}
                </ul>
            </div>
        {/if}

        <!-- Synchronization Checklist -->
        {#if report.synchronizationChecklist.length > 0}
            <div class="flex flex-col gap-2.5 rounded-xl border bg-background p-4">
                <h3 class="flex items-center gap-1.5 text-sm font-semibold">
                    <CheckSquare class="size-4 text-primary" aria-hidden="true" />
                    Danh mục khuyến nghị đồng bộ hóa hệ thống pháp luật ({report.synchronizationChecklist.length})
                </h3>
                <ul class="flex flex-col gap-2">
                    {#each report.synchronizationChecklist as item, idx (`${item.targetLabel}-${idx}`)}
                        <li class="flex flex-col gap-1 rounded-lg border bg-card p-3 text-xs">
                            <div class="flex flex-wrap items-center gap-2">
                                <Badge variant={item.priority === "HIGH" ? "destructive" : item.priority === "MEDIUM" ? "secondary" : "outline"} class="text-[10px]">
                                    {PRIORITY_LABEL[item.priority] ?? item.priority}
                                </Badge>
                                <span class="font-semibold text-foreground">{item.action}</span>
                            </div>
                            <p class="text-muted-foreground">{item.reason}</p>
                        </li>
                    {/each}
                </ul>
            </div>
        {/if}

        <p class="text-xs text-muted-foreground">{report.disclaimer}</p>
    {/if}
</section>
