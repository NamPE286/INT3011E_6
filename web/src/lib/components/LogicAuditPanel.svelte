<script lang="ts">
    import type { AuditCategory, AuditSeverity, LogicAuditReport } from "$lib/api/analysis";
    import { Badge } from "$lib/components/ui/badge";
    import { Button } from "$lib/components/ui/button";
    import {
        AlertTriangle,
        CheckCircle2,
        ExternalLink,
        Info,
        RefreshCw,
        ShieldAlert,
        ShieldCheck,
        Wrench,
    } from "@lucide/svelte";

    type Props = {
        report: LogicAuditReport | null;
        loading?: boolean;
        onRefresh?: () => void;
        onJumpToProvision?: (provisionId: string) => void;
    };

    let { report, loading = false, onRefresh, onJumpToProvision }: Props = $props();

    let severityFilter = $state<"ALL" | AuditSeverity>("ALL");
    let categoryFilter = $state<"ALL" | AuditCategory>("ALL");

    const CATEGORY_LABELS: Record<AuditCategory, string> = {
        STRUCTURE: "Kết cấu & đánh số",
        TEMPORAL: "Hiệu lực & thời gian",
        REFERENCE: "Dẫn chiếu & mục tiêu",
        SANCTION_CONFLICT: "Chế tài & xung đột quy phạm",
        DRAFTING_TECHNIQUE: "Kỹ thuật lập pháp",
    };

    const STATUS_BADGE: Record<string, { label: string; className: string }> = {
        PASS: {
            label: "Đạt chuẩn logic",
            className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        },
        WARNING: {
            label: "Cần rà soát cảnh báo",
            className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        },
        FAIL: {
            label: "Có lỗi logic nghiêm trọng",
            className: "border-destructive/40 bg-destructive/10 text-destructive",
        },
    };

    const filteredFindings = $derived(
        (report?.findings ?? []).filter((finding) => {
            if (severityFilter !== "ALL" && finding.severity !== severityFilter) {
                return false;
            }

            if (categoryFilter !== "ALL" && finding.category !== categoryFilter) {
                return false;
            }

            return true;
        }),
    );

    function severityClass(severity: AuditSeverity): string {
        if (severity === "ERROR") {
            return "border-destructive/40 bg-destructive/5";
        }

        if (severity === "WARNING") {
            return "border-amber-500/40 bg-amber-500/5";
        }

        return "border-border bg-muted/30";
    }
</script>

<section class="flex flex-col gap-4" aria-label="Kết quả soát logic luật">
    {#if loading && !report}
        <p class="py-8 text-center text-sm text-muted-foreground">Đang chạy bộ quy tắc soát logic luật…</p>
    {:else if !report}
        <p class="py-8 text-center text-sm text-muted-foreground">Chọn một văn bản để kiểm tra logic kết cấu, hiệu lực, dẫn chiếu và xung đột chế tài.</p>
    {:else}
        {@const statusMeta = STATUS_BADGE[report.summary.status] ?? STATUS_BADGE.WARNING}
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background p-4">
            <div class="flex flex-wrap items-center gap-3">
                <div class={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${statusMeta.className}`}>
                    {#if report.summary.status === "PASS"}
                        <ShieldCheck class="size-3.5" aria-hidden="true" />
                    {:else}
                        <ShieldAlert class="size-3.5" aria-hidden="true" />
                    {/if}
                    {statusMeta.label}
                </div>
                <span class="text-sm font-semibold">Điểm nhất quán: {report.summary.score}/100</span>
                <span class="text-xs text-muted-foreground">({report.summary.checkedRules} quy tắc tất định)</span>
            </div>

            {#if onRefresh}
                <Button size="sm" variant="outline" onclick={onRefresh} disabled={loading} class="gap-1.5">
                    <RefreshCw class={`size-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
                    Soát lại
                </Button>
            {/if}
        </div>

        <div class="grid grid-cols-3 gap-3 text-sm">
            <div class="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                <div class="text-xs text-muted-foreground">Lỗi nghiêm trọng (ERROR)</div>
                <div class="mt-0.5 text-2xl font-semibold text-destructive">{report.summary.errorCount}</div>
            </div>
            <div class="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                <div class="text-xs text-muted-foreground">Cảnh báo (WARNING)</div>
                <div class="mt-0.5 text-2xl font-semibold text-amber-700 dark:text-amber-300">{report.summary.warningCount}</div>
            </div>
            <div class="rounded-xl border bg-muted/40 p-3">
                <div class="text-xs text-muted-foreground">Gợi ý (INFO)</div>
                <div class="mt-0.5 text-2xl font-semibold">{report.summary.infoCount}</div>
            </div>
        </div>

        {#if report.findings.length > 0}
            <div class="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/30 p-3 text-xs">
                <label class="flex items-center gap-1.5">
                    <span class="font-medium text-muted-foreground">Mức độ:</span>
                    <select bind:value={severityFilter} class="h-8 rounded-md border bg-background px-2 text-xs">
                        <option value="ALL">Tất cả ({report.findings.length})</option>
                        <option value="ERROR">Lỗi ({report.summary.errorCount})</option>
                        <option value="WARNING">Cảnh báo ({report.summary.warningCount})</option>
                        <option value="INFO">Gợi ý ({report.summary.infoCount})</option>
                    </select>
                </label>

                <label class="flex items-center gap-1.5">
                    <span class="font-medium text-muted-foreground">Nhóm quy tắc:</span>
                    <select bind:value={categoryFilter} class="h-8 rounded-md border bg-background px-2 text-xs">
                        <option value="ALL">Tất cả nhóm</option>
                        <option value="STRUCTURE">{CATEGORY_LABELS.STRUCTURE}</option>
                        <option value="TEMPORAL">{CATEGORY_LABELS.TEMPORAL}</option>
                        <option value="REFERENCE">{CATEGORY_LABELS.REFERENCE}</option>
                        <option value="SANCTION_CONFLICT">{CATEGORY_LABELS.SANCTION_CONFLICT}</option>
                        <option value="DRAFTING_TECHNIQUE">{CATEGORY_LABELS.DRAFTING_TECHNIQUE}</option>
                    </select>
                </label>
            </div>
        {/if}

        {#if filteredFindings.length === 0}
            <div class="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-800 dark:text-emerald-200">
                <CheckCircle2 class="size-5 shrink-0" aria-hidden="true" />
                <div>
                    <p class="font-medium">
                        {report.findings.length === 0
                            ? "Không phát hiện lỗi logic nào trên văn bản này."
                            : "Không có phát hiện nào khớp bộ lọc đang chọn."}
                    </p>
                    <p class="text-xs opacity-80">Đã đối chiếu kết cấu Điều/Khoản/Điểm, thứ tự hiệu lực, dẫn chiếu nội/ngoại văn bản và xung đột chế tài.</p>
                </div>
            </div>
        {:else}
            <ul class="flex flex-col gap-3">
                {#each filteredFindings as finding (finding.id)}
                    <li class={`flex flex-col gap-2 rounded-xl border p-4 text-sm ${severityClass(finding.severity)}`}>
                        <div class="flex flex-wrap items-start justify-between gap-2">
                            <div class="flex flex-wrap items-center gap-2">
                                {#if finding.severity === "ERROR"}
                                    <ShieldAlert class="size-4 text-destructive" aria-hidden="true" />
                                    <Badge variant="destructive" class="text-[11px]">LỖI</Badge>
                                {:else if finding.severity === "WARNING"}
                                    <AlertTriangle class="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                                    <Badge variant="secondary" class="text-[11px]">CẢNH BÁO</Badge>
                                {:else}
                                    <Info class="size-4 text-muted-foreground" aria-hidden="true" />
                                    <Badge variant="outline" class="text-[11px]">GỢI Ý</Badge>
                                {/if}
                                <Badge variant="outline" class="text-[11px]">{CATEGORY_LABELS[finding.category]}</Badge>
                                <span class="font-semibold">{finding.title}</span>
                            </div>

                            <code class="rounded bg-background/80 px-1.5 py-0.5 text-[11px] text-muted-foreground">{finding.code}</code>
                        </div>

                        <p class="text-sm text-foreground/90">{finding.message}</p>

                        {#if finding.evidence}
                            <div class="rounded-lg border bg-background/70 px-3 py-1.5 text-xs text-muted-foreground">
                                <span class="font-medium text-foreground">Bằng chứng:</span> {finding.evidence}
                            </div>
                        {/if}

                        <div class="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                            <p class="flex items-center gap-1.5 text-muted-foreground">
                                <Wrench class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                                <span><strong class="text-foreground">Đề xuất xử lý:</strong> {finding.suggestion}</span>
                            </p>

                            <div class="flex flex-wrap gap-2">
                                {#if finding.provisionId && onJumpToProvision}
                                    <button
                                        type="button"
                                        onclick={() => onJumpToProvision(finding.provisionId!)}
                                        class="inline-flex items-center gap-1 rounded-md border bg-background px-2.5 py-1 font-medium text-foreground hover:bg-muted"
                                    >
                                        Sửa điều khoản
                                    </button>
                                {:else if finding.provisionId}
                                    <a
                                        href={`/documents/${encodeURIComponent(report.documentId)}#${encodeURIComponent(finding.provisionId)}`}
                                        class="inline-flex items-center gap-1 rounded-md border bg-background px-2.5 py-1 font-medium text-foreground hover:bg-muted"
                                    >
                                        Xem điều khoản
                                        <ExternalLink class="size-3" aria-hidden="true" />
                                    </a>
                                {/if}

                                {#if finding.relatedDocumentId}
                                    <a
                                        href={`/documents/${encodeURIComponent(finding.relatedDocumentId)}`}
                                        class="inline-flex items-center gap-1 rounded-md border bg-background px-2.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                                    >
                                        Mở văn bản liên quan
                                        <ExternalLink class="size-3" aria-hidden="true" />
                                    </a>
                                {/if}
                            </div>
                        </div>
                    </li>
                {/each}
            </ul>
        {/if}

        <p class="text-xs text-muted-foreground">{report.disclaimer}</p>
    {/if}
</section>
