<script lang="ts">
    import { onMount } from "svelte";
    import { page } from "$app/state";
    import type { ImpactScopeReport, LogicAuditReport, WorkspaceAuditOverview } from "$lib/api/analysis";
    import { getDocumentAudit, getDocumentImpact, getWorkspaceAuditOverviewApi } from "$lib/api/client";
    import ImpactScopePanel from "$lib/components/ImpactScopePanel.svelte";
    import LogicAuditPanel from "$lib/components/LogicAuditPanel.svelte";
    import { Badge } from "$lib/components/ui/badge";
    import { Button } from "$lib/components/ui/button";
    import { FilePenLine, Layers, Network, RefreshCw, ShieldAlert, ShieldCheck } from "@lucide/svelte";

    let overview = $state<WorkspaceAuditOverview | null>(null);
    let selectedDocId = $state<string | null>(null);
    let activeTab = $state<"logic" | "impact">("logic");
    let maxDepth = $state(3);
    let auditReport = $state<LogicAuditReport | null>(null);
    let impactReport = $state<ImpactScopeReport | null>(null);
    let loadingOverview = $state(false);
    let loadingDetail = $state(false);
    let errorMessage = $state<string | null>(null);

    async function loadOverview(preferredDocId?: string | null): Promise<void> {
        loadingOverview = true;
        errorMessage = null;

        try {
            const data = await getWorkspaceAuditOverviewApi(fetch);
            overview = data;

            const queryDocId = preferredDocId ?? page.url.searchParams.get("document");
            const fallbackId =
                data.documents.find((doc) => doc.documentType === "Dự thảo")?.documentId ??
                data.documents[0]?.documentId ??
                null;
            const nextDocId =
                queryDocId && data.documents.some((doc) => doc.documentId === queryDocId)
                    ? queryDocId
                    : selectedDocId && data.documents.some((doc) => doc.documentId === selectedDocId)
                      ? selectedDocId
                      : fallbackId;

            selectedDocId = nextDocId;

            if (nextDocId) {
                await loadDocumentReports(nextDocId, maxDepth);
            } else {
                auditReport = null;
                impactReport = null;
            }
        } catch (err: unknown) {
            errorMessage = err instanceof Error ? err.message : "Không thể tải báo cáo soát logic và tác động";
        } finally {
            loadingOverview = false;
        }
    }

    async function loadDocumentReports(documentId: string, depth: number): Promise<void> {
        loadingDetail = true;
        errorMessage = null;

        try {
            const [audit, impact] = await Promise.all([
                getDocumentAudit(documentId, fetch),
                getDocumentImpact(documentId, depth, fetch),
            ]);
            selectedDocId = documentId;
            auditReport = audit;
            impactReport = impact;
        } catch (err: unknown) {
            errorMessage = err instanceof Error ? err.message : "Không thể tải chi tiết soát logic và phạm vi tác động";
        } finally {
            loadingDetail = false;
        }
    }

    async function handleDepthChange(nextDepth: number): Promise<void> {
        maxDepth = nextDepth;

        if (selectedDocId) {
            await loadDocumentReports(selectedDocId, nextDepth);
        }
    }

    onMount(() => {
        const initialTab = page.url.searchParams.get("tab");

        if (initialTab === "impact") {
            activeTab = "impact";
        }

        void loadOverview(page.url.searchParams.get("document"));
    });

    const selectedSummary = $derived(
        overview?.documents.find((doc) => doc.documentId === selectedDocId) ?? null,
    );
</script>

<svelte:head>
    <title>Soát logic luật & Phạm vi tác động — Soạn Luật Studio</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6">
    <header class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex flex-col gap-1">
            <div class="flex flex-wrap items-center gap-2">
                <h1 class="text-2xl font-semibold tracking-tight">Trung tâm Soát Logic Luật & Phạm vi Tác động</h1>
                <Badge variant="secondary">Kiểm định tất định</Badge>
            </div>
            <p class="text-sm text-muted-foreground">
                Kiểm tra tính nhất quán kết cấu, thời gian hiệu lực, dẫn chiếu nội/ngoại văn bản, xung đột khung chế tài và mô phỏng phạm vi tác động trực tiếp lẫn dây chuyền trên toàn Workspace.
            </p>
        </div>

        <div class="flex flex-wrap gap-2">
            <Button variant="outline" onclick={() => loadOverview(selectedDocId)} disabled={loadingOverview} class="gap-1.5">
                <RefreshCw class={`size-4 ${loadingOverview ? "animate-spin" : ""}`} aria-hidden="true" />
                Quét lại Workspace
            </Button>
            {#if selectedDocId}
                <Button href={`/drafting?document=${encodeURIComponent(selectedDocId)}`} class="gap-1.5">
                    <FilePenLine class="size-4" aria-hidden="true" />
                    Mở trong bàn soạn thảo
                </Button>
            {/if}
        </div>
    </header>

    {#if errorMessage}
        <div class="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive" role="alert">
            {errorMessage}
        </div>
    {/if}

    {#if overview}
        <section class="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Tổng quan toàn Workspace">
            <div class="rounded-2xl border bg-card p-4">
                <div class="text-xs text-muted-foreground">Văn bản được kiểm định</div>
                <div class="mt-1 text-2xl font-semibold">{overview.totalDocuments}</div>
            </div>
            <div class="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
                <div class="text-xs text-muted-foreground">Tổng lỗi logic (ERROR)</div>
                <div class="mt-1 text-2xl font-semibold text-destructive">{overview.totalErrors}</div>
            </div>
            <div class="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
                <div class="text-xs text-muted-foreground">Tổng cảnh báo (WARNING)</div>
                <div class="mt-1 text-2xl font-semibold text-amber-700 dark:text-amber-300">{overview.totalWarnings}</div>
            </div>
            <div class="rounded-2xl border bg-card p-4">
                <div class="text-xs text-muted-foreground">Văn bản phạm vi tác động cao</div>
                <div class="mt-1 text-2xl font-semibold">{overview.highRiskDocuments}</div>
            </div>
        </section>
    {/if}

    <div class="grid gap-6 lg:grid-cols-[300px_1fr]">
        <aside class="flex flex-col gap-3 rounded-2xl border bg-card p-4">
            <h2 class="text-sm font-semibold text-muted-foreground">
                Chọn văn bản rà soát ({overview?.documents.length ?? 0})
            </h2>

            {#if loadingOverview && !overview}
                <p class="text-sm text-muted-foreground">Đang quét văn bản…</p>
            {:else if !overview || overview.documents.length === 0}
                <p class="text-sm text-muted-foreground">
                    Workspace chưa có văn bản nào. Hãy <a href="/drafting" class="underline underline-offset-4">soạn dự thảo</a> hoặc <a href="/admin" class="underline underline-offset-4">nhập PDF</a>.
                </p>
            {:else}
                <ul class="flex flex-col gap-2">
                    {#each overview.documents as doc (doc.documentId)}
                        {@const active = doc.documentId === selectedDocId}
                        <li>
                            <button
                                type="button"
                                onclick={() => loadDocumentReports(doc.documentId, maxDepth)}
                                class={`flex w-full flex-col gap-1.5 rounded-xl border p-3 text-left text-sm transition-colors ${
                                    active ? "border-primary bg-accent text-accent-foreground" : "border-border/70 bg-background hover:bg-muted/60"
                                }`}
                            >
                                <div class="flex items-start justify-between gap-2">
                                    <span class="line-clamp-1 font-semibold">{doc.documentNumber ?? doc.title ?? doc.documentId}</span>
                                    <Badge variant={doc.auditStatus === "FAIL" ? "destructive" : doc.auditStatus === "WARNING" ? "secondary" : "outline"} class="shrink-0 text-[10px]">
                                        {doc.score}/100
                                    </Badge>
                                </div>
                                {#if doc.title && doc.documentNumber}
                                    <span class="line-clamp-2 text-xs text-muted-foreground">{doc.title}</span>
                                {/if}
                                <div class="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                                    {#if doc.errorCount > 0}
                                        <span class="font-medium text-destructive">{doc.errorCount} lỗi</span>
                                    {:else}
                                        <span class="text-emerald-700 dark:text-emerald-300">0 lỗi</span>
                                    {/if}
                                    <span>·</span>
                                    <span>{doc.warningCount} cảnh báo</span>
                                    <span>·</span>
                                    <span>Tác động: {doc.directDocumentCount}+{doc.indirectDocumentCount} VB</span>
                                </div>
                            </button>
                        </li>
                    {/each}
                </ul>
            {/if}
        </aside>

        <section class="flex flex-col gap-4 rounded-2xl border bg-card p-5">
            {#if !selectedSummary}
                <div class="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
                    <ShieldCheck class="size-10 opacity-40" aria-hidden="true" />
                    <p class="text-sm">Chọn một văn bản bên trái để xem báo cáo soát logic và phân tích phạm vi tác động.</p>
                </div>
            {:else}
                <div class="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
                    <div class="flex flex-col gap-1">
                        <div class="flex flex-wrap items-center gap-2">
                            <h2 class="text-lg font-semibold">{selectedSummary.documentNumber ?? selectedSummary.title}</h2>
                            {#if selectedSummary.documentType}
                                <Badge variant="secondary">{selectedSummary.documentType}</Badge>
                            {/if}
                        </div>
                        {#if selectedSummary.title && selectedSummary.documentNumber}
                            <p class="text-sm text-muted-foreground">{selectedSummary.title}</p>
                        {/if}
                    </div>

                    <div class="flex flex-wrap items-center gap-2">
                        <div class="inline-flex rounded-lg border bg-muted p-0.5 text-xs">
                            <button
                                type="button"
                                onclick={() => (activeTab = "logic")}
                                class={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 ${activeTab === "logic" ? "bg-background font-semibold shadow-xs" : "text-muted-foreground"}`}
                            >
                                <ShieldAlert class="size-3.5" aria-hidden="true" />
                                Soát logic luật ({auditReport?.summary.total ?? selectedSummary.errorCount + selectedSummary.warningCount})
                            </button>
                            <button
                                type="button"
                                onclick={() => (activeTab = "impact")}
                                class={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 ${activeTab === "impact" ? "bg-background font-semibold shadow-xs" : "text-muted-foreground"}`}
                            >
                                <Layers class="size-3.5" aria-hidden="true" />
                                Phạm vi tác động ({(impactReport?.summary.directDocumentCount ?? selectedSummary.directDocumentCount) + (impactReport?.summary.indirectDocumentCount ?? selectedSummary.indirectDocumentCount)})
                            </button>
                        </div>

                        <Button href={`/graph?document=${encodeURIComponent(selectedSummary.documentId)}`} size="sm" variant="outline" class="gap-1.5">
                            <Network class="size-3.5" aria-hidden="true" />
                            Lược đồ
                        </Button>
                    </div>
                </div>

                {#if activeTab === "logic"}
                    <LogicAuditPanel
                        report={auditReport}
                        loading={loadingDetail}
                        onRefresh={() => selectedDocId && loadDocumentReports(selectedDocId, maxDepth)}
                    />
                {:else}
                    <ImpactScopePanel
                        report={impactReport}
                        loading={loadingDetail}
                        {maxDepth}
                        onDepthChange={handleDepthChange}
                        onRefresh={() => selectedDocId && loadDocumentReports(selectedDocId, maxDepth)}
                    />
                {/if}
            {/if}
        </section>
    </div>
</main>
