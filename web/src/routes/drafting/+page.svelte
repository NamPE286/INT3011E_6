<script lang="ts">
    import { onMount } from "svelte";
    import { page } from "$app/state";
    import type { ImpactScopeReport, LogicAuditReport } from "$lib/api/analysis";
    import { getDocument, getDocumentAudit, getDocumentImpact, searchDocuments } from "$lib/api/client";
    import type { DocumentListItem, DocumentView, Provision } from "$lib/api/documents";
    import {
        createManualDocumentApi,
        deleteManualDocumentApi,
        deleteManualProvisionApi,
        insertManualProvisionApi,
        updateManualDocumentApi,
        updateManualProvisionApi,
        type ManualProvisionLevel,
    } from "$lib/api/workspaces";
    import ImpactScopePanel from "$lib/components/ImpactScopePanel.svelte";
    import LogicAuditPanel from "$lib/components/LogicAuditPanel.svelte";
    import { Badge } from "$lib/components/ui/badge";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { provisionLabel } from "$lib/labels";
    import { sessionStore } from "$lib/stores/session.svelte";
    import {
        Eye,
        FilePenLine,
        FilePlus2,
        Layers,
        Network,
        Pencil,
        Plus,
        Save,
        ShieldAlert,
        ShieldCheck,
        Trash2,
        X,
    } from "@lucide/svelte";

    let documents = $state<DocumentListItem[]>([]);
    let selectedDocId = $state<string | null>(null);
    let docView = $state<DocumentView | null>(null);
    let auditReport = $state<LogicAuditReport | null>(null);
    let impactReport = $state<ImpactScopeReport | null>(null);
    let impactDepth = $state(3);
    let loadingList = $state(false);
    let loadingDoc = $state(false);
    let loadingAnalysis = $state(false);
    let viewMode = $state<"editor" | "audit" | "impact" | "preview">("editor");
    let feedback = $state<string | null>(null);
    let errorMessage = $state<string | null>(null);

    // Edit document metadata form
    let showEditMetaForm = $state(false);
    let metaTitle = $state("");
    let metaNumber = $state("");
    let metaType = $state("Dự thảo");
    let metaAgency = $state("");
    let metaIssuedAt = $state("");
    let metaEffectiveFrom = $state("");

    // New document form
    let showNewDocForm = $state(false);
    let newDocNumber = $state("");
    let newDocTitle = $state("");
    let newDocType = $state("Dự thảo");
    let newDocAgency = $state("Cơ quan chủ trì soạn thảo");
    let newDocIssuedAt = $state(new Date().toISOString().slice(0, 10));
    let newDocEffectiveFrom = $state("");

    // Insert provision form
    let insertTargetParentId = $state<string | null>(null);
    let insertLevel = $state<ManualProvisionLevel>("ARTICLE");
    let insertNumber = $state("");
    let insertTitle = $state("");
    let insertText = $state("");
    let showInsertForm = $state(false);

    // Inline edit provision
    let editingProvisionId = $state<string | null>(null);
    let editNumber = $state("");
    let editTitle = $state("");
    let editText = $state("");

    const LEVEL_LABELS: Record<string, string> = {
        CHAPTER: "Chương",
        SECTION: "Mục",
        ARTICLE: "Điều",
        CLAUSE: "Khoản",
        POINT: "Điểm",
    };

    async function loadAnalysis(documentId: string, depth: number = impactDepth): Promise<void> {
        loadingAnalysis = true;

        try {
            const [audit, impact] = await Promise.all([
                getDocumentAudit(documentId, fetch),
                getDocumentImpact(documentId, depth, fetch),
            ]);
            auditReport = audit;
            impactReport = impact;
        } catch {
            // Keep drafting responsive even if analysis temporarily fails.
        } finally {
            loadingAnalysis = false;
        }
    }

    async function loadDocuments(selectId?: string): Promise<void> {
        loadingList = true;
        errorMessage = null;

        try {
            const result = await searchDocuments(fetch, "", null, 50);
            documents = result.documents;

            const queryDocId = selectId ?? page.url.searchParams.get("document");
            const preferredId =
                queryDocId && documents.some((d) => d.id === queryDocId)
                    ? queryDocId
                    : selectedDocId && documents.some((d) => d.id === selectedDocId)
                      ? selectedDocId
                      : documents.find((d) => d.documentType === "Dự thảo")?.id ?? documents[0]?.id ?? null;

            selectedDocId = preferredId;

            if (preferredId) {
                await loadDocumentDetail(preferredId);
            } else {
                docView = null;
                auditReport = null;
                impactReport = null;
            }
        } catch (err: unknown) {
            errorMessage = err instanceof Error ? err.message : "Không thể tải danh sách văn bản";
        } finally {
            loadingList = false;
        }
    }

    async function loadDocumentDetail(documentId: string): Promise<void> {
        loadingDoc = true;
        errorMessage = null;
        showEditMetaForm = false;

        try {
            docView = await getDocument(fetch, documentId);
            selectedDocId = documentId;
            await loadAnalysis(documentId, impactDepth);
        } catch (err: unknown) {
            errorMessage = err instanceof Error ? err.message : "Không thể tải nội dung văn bản";
        } finally {
            loadingDoc = false;
        }
    }

    onMount(() => {
        void loadDocuments();
    });

    function openEditMetadata(): void {
        if (!docView) {
            return;
        }

        metaTitle = docView.title ?? "";
        metaNumber = docView.metadata?.documentNumber ?? "";
        metaType = docView.metadata?.documentType ?? "Dự thảo";
        metaAgency = docView.metadata?.agency ?? "";
        metaIssuedAt = docView.metadata?.issuedAt ?? "";
        metaEffectiveFrom = docView.metadata?.effectiveFrom ?? "";
        showEditMetaForm = true;
    }

    async function handleSaveMetadata(event: SubmitEvent): Promise<void> {
        event.preventDefault();

        if (!selectedDocId) {
            return;
        }

        errorMessage = null;
        feedback = null;

        try {
            await updateManualDocumentApi(selectedDocId, {
                title: metaTitle,
                documentNumber: metaNumber || null,
                documentType: metaType || null,
                agency: metaAgency || null,
                issuedAt: metaIssuedAt || null,
                effectiveFrom: metaEffectiveFrom || null,
            });
            showEditMetaForm = false;
            feedback = "Đã cập nhật thông tin văn bản và chạy lại soát logic.";
            await loadDocuments(selectedDocId);
        } catch (err: unknown) {
            errorMessage = err instanceof Error ? err.message : "Không thể cập nhật thông tin văn bản";
        }
    }

    function jumpToProvision(provisionId: string): void {
        const target = docView?.provisions.find((prov) => prov.id === provisionId);

        if (!target) {
            return;
        }

        viewMode = "editor";
        startEdit(target);
    }

    async function handleImpactDepthChange(nextDepth: number): Promise<void> {
        impactDepth = nextDepth;

        if (selectedDocId) {
            await loadAnalysis(selectedDocId, nextDepth);
        }
    }

    async function handleCreateDocument(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        errorMessage = null;
        feedback = null;

        try {
            const created = await createManualDocumentApi({
                documentNumber: newDocNumber,
                title: newDocTitle,
                documentType: newDocType,
                agency: newDocAgency || null,
                issuedAt: newDocIssuedAt || null,
                effectiveFrom: newDocEffectiveFrom || null,
            });
            showNewDocForm = false;
            newDocNumber = "";
            newDocTitle = "";
            feedback = "Đã tạo văn bản dự thảo mới. Bạn có thể bắt đầu chèn Điều, Khoản, Điểm.";
            await sessionStore.refreshWorkspaces();
            await loadDocuments(created.id);
        } catch (err: unknown) {
            errorMessage = err instanceof Error ? err.message : "Không thể tạo văn bản";
        }
    }

    async function handleDeleteDocument(documentId: string): Promise<void> {
        errorMessage = null;

        try {
            await deleteManualDocumentApi(documentId);
            feedback = "Đã xóa văn bản khỏi Workspace.";
            await sessionStore.refreshWorkspaces();
            await loadDocuments();
        } catch (err: unknown) {
            errorMessage = err instanceof Error ? err.message : "Không thể xóa văn bản";
        }
    }

    function openInsertProvision(level: ManualProvisionLevel, parentId: string | null): void {
        insertLevel = level;
        insertTargetParentId = parentId;
        insertNumber = suggestNextNumber(level, parentId);
        insertTitle = "";
        insertText = "";
        showInsertForm = true;
        editingProvisionId = null;
    }

    function suggestNextNumber(level: ManualProvisionLevel, parentId: string | null): string {
        const siblings = (docView?.provisions ?? []).filter((p) => p.parentId === parentId && p.level === level);

        if (level === "POINT") {
            const letters = "abcdefghiklmnopqrstuvwxyz";

            return letters[siblings.length] ?? String(siblings.length + 1);
        }

        if (level === "CHAPTER") {
            const romans = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

            return romans[siblings.length] ?? String(siblings.length + 1);
        }

        return String(siblings.length + 1);
    }

    async function handleInsertProvision(event: SubmitEvent): Promise<void> {
        event.preventDefault();

        if (!selectedDocId) {
            return;
        }

        errorMessage = null;
        feedback = null;

        try {
            await insertManualProvisionApi(selectedDocId, {
                parentId: insertTargetParentId,
                level: insertLevel,
                number: insertNumber,
                title: insertTitle || null,
                text: insertText || null,
            });
            showInsertForm = false;
            feedback = `Đã chèn ${LEVEL_LABELS[insertLevel]} ${insertNumber}.`;
            await loadDocumentDetail(selectedDocId);
            await sessionStore.refreshWorkspaces();
        } catch (err: unknown) {
            errorMessage = err instanceof Error ? err.message : "Không thể chèn điều khoản";
        }
    }

    function startEdit(provision: Provision): void {
        editingProvisionId = provision.id;
        editNumber = provision.number;
        editTitle = provision.title ?? "";
        editText = provision.text ?? "";
        showInsertForm = false;
    }

    async function handleSaveEdit(provisionId: string): Promise<void> {
        if (!selectedDocId) {
            return;
        }

        errorMessage = null;

        try {
            await updateManualProvisionApi(selectedDocId, provisionId, {
                number: editNumber,
                title: editTitle || null,
                text: editText || null,
            });
            editingProvisionId = null;
            feedback = "Đã lưu thay đổi điều khoản.";
            await loadDocumentDetail(selectedDocId);
        } catch (err: unknown) {
            errorMessage = err instanceof Error ? err.message : "Không thể cập nhật điều khoản";
        }
    }

    async function handleDeleteProvision(provisionId: string): Promise<void> {
        if (!selectedDocId) {
            return;
        }

        errorMessage = null;

        try {
            await deleteManualProvisionApi(selectedDocId, provisionId);
            feedback = "Đã xóa điều khoản.";
            await loadDocumentDetail(selectedDocId);
            await sessionStore.refreshWorkspaces();
        } catch (err: unknown) {
            errorMessage = err instanceof Error ? err.message : "Không thể xóa điều khoản";
        }
    }

    function indentClass(level: string): string {
        if (level === "SECTION") {
            return "ml-3";
        }

        if (level === "ARTICLE") {
            return "ml-0";
        }

        if (level === "CLAUSE") {
            return "ml-6";
        }

        if (level === "POINT") {
            return "ml-12";
        }

        return "ml-0";
    }
</script>

<svelte:head>
    <title>Soạn thảo văn bản (Manual) — Soạn Luật Studio</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6">
    <header class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex flex-col gap-1">
            <div class="flex items-center gap-2">
                <h1 class="text-2xl font-semibold tracking-tight">Bàn soạn thảo văn bản (Chế độ Manual)</h1>
                <Badge variant="secondary">Chèn Điều · Khoản · Điểm</Badge>
            </div>
            <p class="text-sm text-muted-foreground">
                Tự tạo văn bản dự thảo, chèn cấu trúc Chương / Mục / Điều / Khoản / Điểm và quản lý trực tiếp trong Workspace hiện tại.
            </p>
        </div>

        <div class="flex flex-wrap gap-2">
            {#if sessionStore.user}
                <Button onclick={() => (showNewDocForm = !showNewDocForm)} class="gap-1.5">
                    <FilePlus2 class="size-4" aria-hidden="true" />
                    Tạo văn bản mới
                </Button>
            {:else}
                <Button href="/login">Đăng nhập để soạn thảo</Button>
            {/if}
            <Button href="/graph" variant="outline" class="gap-1.5">
                <Network class="size-4" aria-hidden="true" />
                Nối lược đồ quan hệ
            </Button>
        </div>
    </header>

    {#if !sessionStore.user}
        <div class="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
            Bạn đang xem ở chế độ khách. Hãy <a href="/login" class="font-medium underline underline-offset-4">đăng nhập bằng Better Auth</a> để tạo, chỉnh sửa văn bản và lưu vào Workspace riêng của bạn.
        </div>
    {/if}

    {#if feedback}
        <div class="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-300" role="status">
            {feedback}
        </div>
    {/if}

    {#if errorMessage}
        <div class="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive" role="alert">
            {errorMessage}
        </div>
    {/if}

    {#if showNewDocForm}
        <section class="rounded-2xl border bg-card p-5 shadow-xs" aria-labelledby="new-doc-heading">
            <div class="mb-4 flex items-center justify-between">
                <h2 id="new-doc-heading" class="text-base font-semibold">Khởi tạo văn bản quy phạm mới (Manual)</h2>
                <button type="button" onclick={() => (showNewDocForm = false)} class="text-muted-foreground hover:text-foreground">
                    <X class="size-4" />
                </button>
            </div>

            <form class="grid gap-4 md:grid-cols-3" onsubmit={handleCreateDocument}>
                <label class="flex flex-col gap-1 text-sm">
                    <span class="font-medium">Số hiệu văn bản *</span>
                    <Input bind:value={newDocNumber} required placeholder="VD: Dự thảo 02/2026/NĐ-CP" />
                </label>

                <label class="flex flex-col gap-1 text-sm md:col-span-2">
                    <span class="font-medium">Tên / Trích yếu văn bản *</span>
                    <Input bind:value={newDocTitle} required placeholder="Nghị định quy định sửa đổi mức xử phạt vi phạm..." />
                </label>

                <label class="flex flex-col gap-1 text-sm">
                    <span class="font-medium">Loại văn bản</span>
                    <select bind:value={newDocType} class="h-9 rounded-md border bg-background px-3 text-sm">
                        <option value="Dự thảo">Dự thảo</option>
                        <option value="Luật">Luật</option>
                        <option value="Nghị định">Nghị định</option>
                        <option value="Thông tư">Thông tư</option>
                        <option value="Nghị quyết">Nghị quyết</option>
                    </select>
                </label>

                <label class="flex flex-col gap-1 text-sm">
                    <span class="font-medium">Cơ quan ban hành / chủ trì</span>
                    <Input bind:value={newDocAgency} placeholder="Chính phủ / Bộ Tư pháp..." />
                </label>

                <div class="grid grid-cols-2 gap-2">
                    <label class="flex flex-col gap-1 text-sm">
                        <span class="font-medium">Ngày ban hành</span>
                        <Input type="date" bind:value={newDocIssuedAt} />
                    </label>
                    <label class="flex flex-col gap-1 text-sm">
                        <span class="font-medium">Hiệu lực từ</span>
                        <Input type="date" bind:value={newDocEffectiveFrom} />
                    </label>
                </div>

                <div class="flex gap-2 md:col-span-3">
                    <Button type="submit">Tạo văn bản & Mở trình soạn thảo</Button>
                    <Button type="button" variant="ghost" onclick={() => (showNewDocForm = false)}>Hủy</Button>
                </div>
            </form>
        </section>
    {/if}

    <div class="grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside class="flex flex-col gap-3 rounded-2xl border bg-card p-4">
            <h2 class="text-sm font-semibold text-muted-foreground">Văn bản trong Workspace ({documents.length})</h2>

            {#if loadingList}
                <p class="text-sm text-muted-foreground">Đang tải…</p>
            {:else if documents.length === 0}
                <p class="text-sm text-muted-foreground">Chưa có văn bản nào. Hãy bấm "Tạo văn bản mới" để bắt đầu soạn thảo.</p>
            {:else}
                <ul class="flex flex-col gap-1.5">
                    {#each documents as doc (doc.id)}
                        {@const active = doc.id === selectedDocId}
                        <li>
                            <button
                                type="button"
                                onclick={() => loadDocumentDetail(doc.id)}
                                class={`flex w-full flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
                                    active ? "border-primary bg-accent font-medium text-accent-foreground" : "border-transparent hover:bg-muted"
                                }`}
                            >
                                <span class="line-clamp-1 font-medium">{doc.documentNumber ?? doc.title ?? doc.id}</span>
                                <span class="line-clamp-2 text-xs text-muted-foreground">{doc.title ?? "Chưa có trích yếu"}</span>
                                {#if doc.documentType}
                                    <Badge variant="outline" class="mt-1 text-[10px]">{doc.documentType}</Badge>
                                {/if}
                            </button>
                        </li>
                    {/each}
                </ul>
            {/if}
        </aside>

        <section class="flex flex-col gap-4 rounded-2xl border bg-card p-5">
            {#if loadingDoc}
                <p class="text-sm text-muted-foreground">Đang tải nội dung văn bản…</p>
            {:else if !docView}
                <div class="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
                    <FilePenLine class="size-10 opacity-40" />
                    <p class="text-sm">Chọn một văn bản bên trái hoặc tạo dự thảo mới để bắt đầu soạn thảo Điều, Khoản, Điểm.</p>
                </div>
            {:else}
                <div class="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
                    <div class="flex flex-col gap-1">
                        <div class="flex flex-wrap items-center gap-2">
                            <h2 class="text-lg font-semibold">{docView.metadata?.documentNumber ?? docView.title}</h2>
                            {#if docView.metadata?.documentType}
                                <Badge variant="secondary">{docView.metadata.documentType}</Badge>
                            {/if}
                            {#if auditReport}
                                <Badge
                                    variant={auditReport.summary.status === "FAIL" ? "destructive" : auditReport.summary.status === "WARNING" ? "secondary" : "outline"}
                                    class="gap-1 text-[11px]"
                                >
                                    {#if auditReport.summary.status === "PASS"}
                                        <ShieldCheck class="size-3" aria-hidden="true" />
                                    {:else}
                                        <ShieldAlert class="size-3" aria-hidden="true" />
                                    {/if}
                                    Logic {auditReport.summary.score}/100
                                </Badge>
                            {/if}
                        </div>
                        <p class="text-sm text-muted-foreground">{docView.title}</p>
                        <p class="text-xs text-muted-foreground">
                            Cơ quan: {docView.metadata?.agency ?? "Chưa rõ"} · Ban hành: {docView.metadata?.issuedAt ?? "—"} · Hiệu lực: {docView.metadata?.effectiveFrom ?? "—"}
                        </p>
                    </div>

                    <div class="flex flex-wrap items-center gap-2">
                        <div class="inline-flex flex-wrap rounded-lg border bg-muted p-0.5 text-xs">
                            <button
                                type="button"
                                onclick={() => (viewMode = "editor")}
                                class={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 ${viewMode === "editor" ? "bg-background font-medium shadow-xs" : "text-muted-foreground"}`}
                            >
                                <FilePenLine class="size-3.5" aria-hidden="true" />
                                Soạn thảo
                            </button>
                            <button
                                type="button"
                                onclick={() => (viewMode = "audit")}
                                class={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 ${viewMode === "audit" ? "bg-background font-medium shadow-xs" : "text-muted-foreground"}`}
                            >
                                <ShieldAlert class="size-3.5" aria-hidden="true" />
                                Soát logic
                                {#if auditReport && auditReport.summary.total > 0}
                                    <span class="rounded-full bg-destructive/15 px-1.5 text-[10px] font-semibold text-destructive">
                                        {auditReport.summary.total}
                                    </span>
                                {/if}
                            </button>
                            <button
                                type="button"
                                onclick={() => (viewMode = "impact")}
                                class={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 ${viewMode === "impact" ? "bg-background font-medium shadow-xs" : "text-muted-foreground"}`}
                            >
                                <Layers class="size-3.5" aria-hidden="true" />
                                Phạm vi tác động
                                {#if impactReport}
                                    <span class="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
                                        {impactReport.summary.directDocumentCount + impactReport.summary.indirectDocumentCount}
                                    </span>
                                {/if}
                            </button>
                            <button
                                type="button"
                                onclick={() => (viewMode = "preview")}
                                class={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 ${viewMode === "preview" ? "bg-background font-medium shadow-xs" : "text-muted-foreground"}`}
                            >
                                <Eye class="size-3.5" aria-hidden="true" />
                                Xem trước
                            </button>
                        </div>

                        {#if sessionStore.user}
                            <button
                                type="button"
                                onclick={openEditMetadata}
                                class="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted"
                            >
                                <Pencil class="size-3.5" aria-hidden="true" />
                                Sửa thông tin
                            </button>
                            <button
                                type="button"
                                onclick={() => handleDeleteDocument(docView!.id)}
                                class="inline-flex items-center gap-1 rounded-md border border-destructive/30 px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                            >
                                <Trash2 class="size-3.5" aria-hidden="true" />
                                Xóa
                            </button>
                        {/if}
                    </div>
                </div>

                {#if showEditMetaForm}
                    <form class="grid gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4 md:grid-cols-3" onsubmit={handleSaveMetadata}>
                        <div class="flex items-center justify-between md:col-span-3">
                            <span class="text-sm font-semibold">Cập nhật thông tin & ngày hiệu lực văn bản</span>
                            <button type="button" onclick={() => (showEditMetaForm = false)} class="text-muted-foreground hover:text-foreground">
                                <X class="size-4" />
                            </button>
                        </div>

                        <label class="flex flex-col gap-1 text-xs">
                            <span class="font-medium">Số hiệu văn bản</span>
                            <Input bind:value={metaNumber} placeholder="VD: Dự thảo 01/2026/NĐ-CP" />
                        </label>
                        <label class="flex flex-col gap-1 text-xs md:col-span-2">
                            <span class="font-medium">Tên / Trích yếu *</span>
                            <Input bind:value={metaTitle} required />
                        </label>
                        <label class="flex flex-col gap-1 text-xs">
                            <span class="font-medium">Loại văn bản</span>
                            <Input bind:value={metaType} />
                        </label>
                        <label class="flex flex-col gap-1 text-xs">
                            <span class="font-medium">Cơ quan ban hành / chủ trì</span>
                            <Input bind:value={metaAgency} />
                        </label>
                        <div class="grid grid-cols-2 gap-2">
                            <label class="flex flex-col gap-1 text-xs">
                                <span class="font-medium">Ngày ban hành</span>
                                <Input type="date" bind:value={metaIssuedAt} />
                            </label>
                            <label class="flex flex-col gap-1 text-xs">
                                <span class="font-medium">Hiệu lực từ</span>
                                <Input type="date" bind:value={metaEffectiveFrom} />
                            </label>
                        </div>
                        <div class="flex gap-2 md:col-span-3">
                            <Button type="submit" size="sm">Lưu thông tin</Button>
                            <Button type="button" size="sm" variant="ghost" onclick={() => (showEditMetaForm = false)}>Hủy</Button>
                        </div>
                    </form>
                {/if}

                {#if viewMode === "editor"}
                    <div class="flex flex-wrap items-center gap-2 rounded-xl bg-muted/50 p-3">
                        <span class="text-xs font-medium text-muted-foreground">Chèn nhanh cấp văn bản:</span>
                        <Button size="sm" variant="outline" disabled={!sessionStore.user} onclick={() => openInsertProvision("CHAPTER", null)}>
                            <Plus class="mr-1 size-3.5" />
                            Chèn Chương
                        </Button>
                        <Button size="sm" variant="default" disabled={!sessionStore.user} onclick={() => openInsertProvision("ARTICLE", null)}>
                            <Plus class="mr-1 size-3.5" />
                            Chèn Điều
                        </Button>
                    </div>

                    {#if showInsertForm}
                        <form class="flex flex-col gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4" onsubmit={handleInsertProvision}>
                            <div class="flex items-center justify-between">
                                <span class="text-sm font-semibold">
                                    Chèn {LEVEL_LABELS[insertLevel]} mới
                                    {#if insertTargetParentId}
                                        <span class="font-normal text-muted-foreground">(trực thuộc mục đang chọn)</span>
                                    {/if}
                                </span>
                                <button type="button" onclick={() => (showInsertForm = false)} class="text-muted-foreground hover:text-foreground">
                                    <X class="size-4" />
                                </button>
                            </div>

                            <div class="grid gap-3 sm:grid-cols-3">
                                <label class="flex flex-col gap-1 text-xs">
                                    <span class="font-medium">Cấp cấu trúc</span>
                                    <select bind:value={insertLevel} class="h-9 rounded-md border bg-background px-2.5 text-sm">
                                        <option value="CHAPTER">Chương</option>
                                        <option value="SECTION">Mục</option>
                                        <option value="ARTICLE">Điều</option>
                                        <option value="CLAUSE">Khoản</option>
                                        <option value="POINT">Điểm</option>
                                    </select>
                                </label>

                                <label class="flex flex-col gap-1 text-xs">
                                    <span class="font-medium">Số / Ký hiệu *</span>
                                    <Input bind:value={insertNumber} required placeholder="VD: 5 hoặc 1 hoặc a" />
                                </label>

                                <label class="flex flex-col gap-1 text-xs">
                                    <span class="font-medium">Tiêu đề (tuỳ chọn)</span>
                                    <Input bind:value={insertTitle} placeholder="VD: Xử phạt người điều khiển..." />
                                </label>
                            </div>

                            <label class="flex flex-col gap-1 text-xs">
                                <span class="font-medium">Nội dung quy phạm</span>
                                <textarea
                                    bind:value={insertText}
                                    rows="3"
                                    placeholder="Nhập nội dung quy định, mức phạt tiền, điểm trừ GPLX..."
                                    class="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring"
                                ></textarea>
                            </label>

                            <div class="flex gap-2">
                                <Button type="submit" size="sm">Lưu vào văn bản</Button>
                                <Button type="button" size="sm" variant="ghost" onclick={() => (showInsertForm = false)}>Hủy</Button>
                            </div>
                        </form>
                    {/if}

                    {#if docView.provisions.length === 0}
                        <p class="py-8 text-center text-sm text-muted-foreground">
                            Văn bản chưa có điều khoản nào. Bấm "+ Chèn Điều" để bắt đầu soạn thảo.
                        </p>
                    {:else}
                        <ul class="flex flex-col gap-2">
                            {#each docView.provisions as prov (prov.id)}
                                <li class={`rounded-xl border bg-background p-3.5 ${indentClass(prov.level)}`}>
                                    {#if editingProvisionId === prov.id}
                                        <div class="flex flex-col gap-2.5">
                                            <div class="grid gap-2 sm:grid-cols-3">
                                                <Input bind:value={editNumber} placeholder="Số hiệu" />
                                                <Input bind:value={editTitle} placeholder="Tiêu đề" class="sm:col-span-2" />
                                            </div>
                                            <textarea
                                                bind:value={editText}
                                                rows="3"
                                                class="w-full rounded-md border bg-background px-3 py-2 text-sm"
                                            ></textarea>
                                            <div class="flex gap-2">
                                                <Button size="sm" onclick={() => handleSaveEdit(prov.id)} class="gap-1">
                                                    <Save class="size-3.5" />
                                                    Lưu
                                                </Button>
                                                <Button size="sm" variant="ghost" onclick={() => (editingProvisionId = null)}>Hủy</Button>
                                            </div>
                                        </div>
                                    {:else}
                                        <div class="flex flex-wrap items-start justify-between gap-2">
                                            <div class="flex flex-1 flex-col gap-1">
                                                <div class="flex flex-wrap items-center gap-2">
                                                    <Badge variant={prov.level === "ARTICLE" ? "default" : "outline"} class="text-[11px]">
                                                        {provisionLabel(prov)}
                                                    </Badge>
                                                    {#if prov.title}
                                                        <span class="text-sm font-semibold">{prov.title}</span>
                                                    {/if}
                                                </div>
                                                {#if prov.text}
                                                    <p class="text-sm leading-relaxed text-foreground/90 whitespace-pre-line">{prov.text}</p>
                                                {/if}
                                            </div>

                                            {#if sessionStore.user}
                                                <div class="flex shrink-0 flex-wrap items-center gap-1">
                                                    {#if prov.level === "CHAPTER"}
                                                        <button
                                                            type="button"
                                                            onclick={() => openInsertProvision("ARTICLE", prov.id)}
                                                            class="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                                                        >
                                                            + Điều
                                                        </button>
                                                    {:else if prov.level === "ARTICLE"}
                                                        <button
                                                            type="button"
                                                            onclick={() => openInsertProvision("CLAUSE", prov.id)}
                                                            class="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                                                        >
                                                            + Khoản
                                                        </button>
                                                    {:else if prov.level === "CLAUSE"}
                                                        <button
                                                            type="button"
                                                            onclick={() => openInsertProvision("POINT", prov.id)}
                                                            class="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                                                        >
                                                            + Điểm
                                                        </button>
                                                    {/if}
                                                    <button
                                                        type="button"
                                                        onclick={() => startEdit(prov)}
                                                        class="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                                                        title="Chỉnh sửa"
                                                    >
                                                        <Pencil class="size-3.5" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onclick={() => handleDeleteProvision(prov.id)}
                                                        class="rounded-md p-1.5 text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
                                                        title="Xóa"
                                                    >
                                                        <Trash2 class="size-3.5" />
                                                    </button>
                                                </div>
                                            {/if}
                                        </div>
                                    {/if}
                                </li>
                            {/each}
                        </ul>
                    {/if}
                {:else if viewMode === "audit"}
                    <LogicAuditPanel
                        report={auditReport}
                        loading={loadingAnalysis}
                        onRefresh={() => selectedDocId && loadAnalysis(selectedDocId, impactDepth)}
                        onJumpToProvision={jumpToProvision}
                    />
                {:else if viewMode === "impact"}
                    <ImpactScopePanel
                        report={impactReport}
                        loading={loadingAnalysis}
                        maxDepth={impactDepth}
                        onDepthChange={handleImpactDepthChange}
                        onRefresh={() => selectedDocId && loadAnalysis(selectedDocId, impactDepth)}
                    />
                {:else}
                    <article class="mx-auto flex w-full max-w-3xl flex-col gap-4 rounded-xl border bg-background p-6 font-serif shadow-xs">
                        <div class="border-b pb-4 text-center">
                            <p class="text-xs font-semibold tracking-wider uppercase">{docView.metadata?.agency ?? "CƠ QUAN BAN HÀNH"}</p>
                            <p class="mt-1 text-xs">Số: {docView.metadata?.documentNumber ?? "…"}</p>
                            <h3 class="mt-3 text-lg font-bold uppercase">{docView.metadata?.documentType ?? "VĂN BẢN"}</h3>
                            <p class="mt-1 text-sm font-semibold">{docView.title}</p>
                        </div>

                        <div class="flex flex-col gap-3 text-sm leading-relaxed">
                            {#each docView.provisions as prov (prov.id)}
                                <div class={indentClass(prov.level)}>
                                    {#if prov.level === "CHAPTER" || prov.level === "SECTION"}
                                        <p class="mt-2 font-bold uppercase">{provisionLabel(prov)}{prov.title ? `. ${prov.title}` : ""}</p>
                                    {:else if prov.level === "ARTICLE"}
                                        <p class="mt-2 font-bold">{provisionLabel(prov)}.{prov.title ? ` ${prov.title}` : ""}</p>
                                        {#if prov.text}
                                            <p class="mt-0.5">{prov.text}</p>
                                        {/if}
                                    {:else}
                                        <p>
                                            <span class="font-semibold">{provisionLabel(prov)}</span>
                                            {prov.text ? ` ${prov.text}` : ""}
                                        </p>
                                    {/if}
                                </div>
                            {/each}
                        </div>
                    </article>
                {/if}
            {/if}
        </section>
    </div>
</main>
