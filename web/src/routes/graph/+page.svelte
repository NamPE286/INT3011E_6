<script lang="ts">
    import { onMount } from "svelte";
    import { getRelationGraph } from "$lib/api/client";
    import type { GraphSanctionChangeEdge, RelationGraph } from "$lib/api/graph";
    import {
        createManualDocumentRelationApi,
        createManualSanctionEdgeApi,
        deleteManualDocumentRelationApi,
        deleteManualSanctionEdgeApi,
    } from "$lib/api/workspaces";
    import GraphNodeDetails from "$lib/components/GraphNodeDetails.svelte";
    import RelationGraphView from "$lib/components/RelationGraph.svelte";
    import ScopeNotice from "$lib/components/ScopeNotice.svelte";
    import { Badge } from "$lib/components/ui/badge";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
    import { filterGraph, layoutGraph, relationTypesOf, type GraphLevel } from "$lib/graph-view";
    import { documentTitleOf, relationLabel, sanctionChangeLabel } from "$lib/labels";
    import { relationColor } from "$lib/relation-colors";
    import { sessionStore } from "$lib/stores/session.svelte";
    import { ArrowRight, GitCompareArrows, Link2, Network, Plus, Sparkles, Trash2, TrendingUp, X } from "@lucide/svelte";

    let { data } = $props();

    type GraphEdgeMode = "sanction_change" | "document_influence";

    // svelte-ignore state_referenced_locally
    let graph = $state<RelationGraph>(data.graph);
    let edgeMode = $state<GraphEdgeMode>("sanction_change");
    let showLinker = $state(false);
    let linkerError = $state<string | null>(null);
    let linkerFeedback = $state<string | null>(null);

    // Manual edge linker fields (shared + mode-specific)
    let linkFromDocId = $state("");
    let linkToDocId = $state("");
    let linkDocRelationType = $state("AMENDS");
    let linkDocScope = $state("PARTIAL");
    let linkNote = $state("");

    // Mode 1 (Sanction Change) manual fields
    let linkBehavior = $state("");
    let linkSanctionChangeType = $state("SANCTION_INCREASE");
    let linkOldPenalty = $state("");
    let linkNewPenalty = $state("");
    let linkOldMax = $state("");
    let linkNewMax = $state("");

    // Mode 2 (Document Influence) filters
    const LEVELS: { value: GraphLevel; label: string }[] = [
        { value: "ALL", label: "Văn bản và điều khoản" },
        { value: "DOCUMENT", label: "Chỉ quan hệ văn bản" },
        { value: "PROVISION", label: "Chỉ quan hệ điều khoản" },
    ];

    let hiddenRelationTypes = $state<string[]>([]);
    let includeCandidates = $state(true);
    let level = $state<GraphLevel>("ALL");
    // svelte-ignore state_referenced_locally
    let focusDocumentId = $state(data.focusDocumentId ?? "");
    let search = $state("");
    let selectedId = $state<string | null>(null);

    // Mode 1 (Sanction Change) filter
    let sanctionTypeFilter = $state<string>("ALL");

    const sanctionEdges = $derived(graph.sanctionChangeEdges ?? []);
    const filteredSanctionEdges = $derived(
        sanctionEdges.filter((edge) => {
            if (sanctionTypeFilter !== "ALL" && edge.changeType !== sanctionTypeFilter) {
                return false;
            }

            if (focusDocumentId && edge.fromDocumentId !== focusDocumentId && edge.toDocumentId !== focusDocumentId) {
                return false;
            }

            if (search.trim()) {
                const needle = search.trim().toLowerCase();
                const haystack = `${edge.behaviorSummary} ${edge.oldPenaltyText ?? ""} ${edge.newPenaltyText ?? ""} ${edge.note ?? ""}`.toLowerCase();

                return haystack.includes(needle);
            }

            return true;
        }),
    );

    // Layout for Mode 1 (reuses timeline layout with sanction edges projected as document arcs)
    const sanctionModeVisible = $derived({
        documents: graph.documents,
        provisions: [],
        documentRelations: filteredSanctionEdges.map((edge) => ({
            id: edge.id,
            fromDocumentId: edge.fromDocumentId,
            toDocumentId: edge.toDocumentId,
            relationType: edge.changeType,
            scope: "PARTIAL",
            sourceMode: edge.sourceMode,
            note: edge.note,
        })),
        provisionRelations: [],
    });
    const sanctionLayout = $derived(layoutGraph(sanctionModeVisible));

    // Layout for Mode 2 (Document Influence)
    const relationTypes = $derived(relationTypesOf(graph));
    const visible = $derived(
        filterGraph(graph, {
            hiddenRelationTypes: new Set(hiddenRelationTypes),
            includeCandidates,
            level,
            focusDocumentId: focusDocumentId || null,
            search,
        }),
    );
    const layout = $derived(layoutGraph(visible));
    const isNodeVisible = $derived(selectedId !== null && [...layout.documents, ...layout.provisions].some((box) => box.id === selectedId));
    const edgeCount = $derived(visible.documentRelations.length + visible.provisionRelations.length);

    async function reloadGraph(): Promise<void> {
        try {
            graph = await getRelationGraph(fetch);

            if (!linkFromDocId && graph.documents.length >= 2) {
                linkFromDocId = graph.documents[graph.documents.length - 1]?.id ?? "";
                linkToDocId = graph.documents[graph.documents.length - 2]?.id ?? "";
            }
        } catch {
            // Keep initial SSR data on transient error.
        }
    }

    onMount(() => {
        void reloadGraph();
    });

    function toggleType(relationType: string, shown: boolean): void {
        hiddenRelationTypes = shown ? hiddenRelationTypes.filter((type) => type !== relationType) : [...hiddenRelationTypes, relationType];
    }

    function resetFilters(): void {
        hiddenRelationTypes = [];
        includeCandidates = true;
        level = "ALL";
        focusDocumentId = "";
        search = "";
        sanctionTypeFilter = "ALL";
    }

    function docName(documentId: string): string {
        const found = graph.documents.find((doc) => doc.id === documentId);

        return found ? documentTitleOf(found) : documentId;
    }

    function parseOptionalNumber(raw: string): number | null {
        const cleaned = raw.replace(/[^0-9]/g, "");

        if (!cleaned) {
            return null;
        }

        const parsed = Number(cleaned);

        return Number.isFinite(parsed) ? parsed : null;
    }

    async function handleCreateManualEdge(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        linkerError = null;
        linkerFeedback = null;

        if (!linkFromDocId || !linkToDocId) {
            linkerError = "Vui lòng chọn cả văn bản nguồn và văn bản đích";

            return;
        }

        try {
            if (edgeMode === "sanction_change") {
                if (!linkBehavior.trim()) {
                    linkerError = "Vui lòng nhập mô tả hành vi vi phạm";

                    return;
                }

                await createManualSanctionEdgeApi({
                    fromDocumentId: linkFromDocId,
                    toDocumentId: linkToDocId,
                    behaviorSummary: linkBehavior.trim(),
                    changeType: linkSanctionChangeType,
                    oldPenaltyText: linkOldPenalty.trim() || null,
                    newPenaltyText: linkNewPenalty.trim() || null,
                    oldFineMax: parseOptionalNumber(linkOldMax),
                    newFineMax: parseOptionalNumber(linkNewMax),
                    note: linkNote.trim() || null,
                });
                linkBehavior = "";
                linkOldPenalty = "";
                linkNewPenalty = "";
                linkOldMax = "";
                linkNewMax = "";
                linkNote = "";
                linkerFeedback = "Đã nối cạnh biến động xử phạt thủ công vào lược đồ.";
            } else {
                await createManualDocumentRelationApi({
                    fromDocumentId: linkFromDocId,
                    toDocumentId: linkToDocId,
                    relationType: linkDocRelationType,
                    scope: linkDocScope,
                    note: linkNote.trim() || null,
                });
                linkNote = "";
                linkerFeedback = "Đã nối cạnh quan hệ ảnh hưởng văn bản thủ công vào lược đồ.";
            }

            showLinker = false;
            await reloadGraph();
            await sessionStore.refreshWorkspaces();
        } catch (err: unknown) {
            linkerError = err instanceof Error ? err.message : "Không thể tạo cạnh quan hệ";
        }
    }

    async function handleDeleteSanctionEdge(edge: GraphSanctionChangeEdge): Promise<void> {
        try {
            await deleteManualSanctionEdgeApi(edge.id);
            linkerFeedback = "Đã xóa cạnh biến động xử phạt.";
            await reloadGraph();
            await sessionStore.refreshWorkspaces();
        } catch (err: unknown) {
            linkerError = err instanceof Error ? err.message : "Không thể xóa cạnh";
        }
    }

    async function handleDeleteDocRelation(relationId: string): Promise<void> {
        try {
            await deleteManualDocumentRelationApi(relationId);
            linkerFeedback = "Đã xóa cạnh ảnh hưởng văn bản.";
            await reloadGraph();
            await sessionStore.refreshWorkspaces();
        } catch (err: unknown) {
            linkerError = err instanceof Error ? err.message : "Không thể xóa cạnh";
        }
    }
</script>

<svelte:head>
    <title>Lược đồ tác động (2 chế độ) — Soạn Luật Studio</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6">
    <header class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex flex-col gap-1">
            <h1 class="text-2xl font-semibold tracking-tight">Lược đồ quan hệ & Đánh giá tác động</h1>
            <p class="text-sm text-muted-foreground">
                Chuyển đổi giữa 2 chế độ cạnh (AI tự nối & nối thủ công): biến động mức xử lý hành vi hoặc ảnh hưởng pháp lý giữa các văn bản.
            </p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
            {#if sessionStore.user}
                <Button onclick={() => (showLinker = !showLinker)} class="gap-1.5">
                    <Link2 class="size-4" aria-hidden="true" />
                    Nối cạnh thủ công
                </Button>
            {:else}
                <Button href="/login" variant="outline">Đăng nhập để nối cạnh</Button>
            {/if}
        </div>
    </header>

    <!-- Dual-Mode Switcher -->
    <section aria-label="Chế độ cạnh lược đồ" class="grid gap-3 md:grid-cols-2">
        <button
            type="button"
            onclick={() => {
                edgeMode = "sanction_change";
                selectedId = null;
            }}
            class={`flex items-start gap-3 rounded-2xl border p-4 text-left transition-all ${
                edgeMode === "sanction_change"
                    ? "border-destructive/60 bg-destructive/5 ring-1 ring-destructive/30"
                    : "bg-card hover:bg-muted/50"
            }`}
        >
            <span class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-destructive/15 text-destructive">
                <TrendingUp class="size-5" aria-hidden="true" />
            </span>
            <div class="flex flex-col gap-1">
                <div class="flex items-center gap-2">
                    <span class="font-semibold">Chế độ 1: Biến động mức xử lý hành vi</span>
                    <Badge variant="secondary">{sanctionEdges.length} cạnh</Badge>
                </div>
                <span class="text-xs text-muted-foreground">
                    Hiển thị sự thay đổi mức xử phạt giữa các văn bản: tăng nặng xử phạt, giảm nhẹ, thay đổi trừ điểm GPLX, bãi bỏ chế tài.
                </span>
            </div>
        </button>

        <button
            type="button"
            onclick={() => {
                edgeMode = "document_influence";
                selectedId = null;
            }}
            class={`flex items-start gap-3 rounded-2xl border p-4 text-left transition-all ${
                edgeMode === "document_influence"
                    ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                    : "bg-card hover:bg-muted/50"
            }`}
        >
            <span class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Network class="size-5" aria-hidden="true" />
            </span>
            <div class="flex flex-col gap-1">
                <div class="flex items-center gap-2">
                    <span class="font-semibold">Chế độ 2: Quan hệ ảnh hưởng văn bản</span>
                    <Badge variant="secondary">{graph.documentRelations.length + graph.provisionRelations.length} cạnh</Badge>
                </div>
                <span class="text-xs text-muted-foreground">
                    Luật nào sửa đổi, bổ sung, thay thế, bãi bỏ hoặc căn cứ vào luật nào (ở cả cấp văn bản và điều khoản).
                </span>
            </div>
        </button>
    </section>

    {#if linkerFeedback}
        <p class="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-300" role="status">
            {linkerFeedback}
        </p>
    {/if}

    {#if linkerError}
        <p class="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive" role="alert">
            {linkerError}
        </p>
    {/if}

    <!-- Manual Edge Linker Panel -->
    {#if showLinker}
        <section class="rounded-2xl border border-primary/40 bg-card p-5 shadow-xs" aria-labelledby="manual-linker-heading">
            <div class="mb-4 flex items-center justify-between">
                <h2 id="manual-linker-heading" class="flex items-center gap-2 text-base font-semibold">
                    <Plus class="size-4 text-primary" aria-hidden="true" />
                    Nối cạnh thủ công — {edgeMode === "sanction_change" ? "Chế độ 1: Biến động mức xử lý" : "Chế độ 2: Ảnh hưởng văn bản"}
                </h2>
                <button type="button" onclick={() => (showLinker = false)} class="text-muted-foreground hover:text-foreground">
                    <X class="size-4" />
                </button>
            </div>

            <form class="grid gap-4 md:grid-cols-2" onsubmit={handleCreateManualEdge}>
                <label class="flex flex-col gap-1 text-sm">
                    <span class="font-medium">Văn bản tác động / Văn bản mới *</span>
                    <select bind:value={linkFromDocId} required class="h-9 rounded-md border bg-background px-3 text-sm">
                        <option value="">— Chọn văn bản nguồn —</option>
                        {#each graph.documents as doc (doc.id)}
                            <option value={doc.id}>{documentTitleOf(doc)}</option>
                        {/each}
                    </select>
                </label>

                <label class="flex flex-col gap-1 text-sm">
                    <span class="font-medium">Văn bản bị tác động / Văn bản cũ *</span>
                    <select bind:value={linkToDocId} required class="h-9 rounded-md border bg-background px-3 text-sm">
                        <option value="">— Chọn văn bản đích —</option>
                        {#each graph.documents as doc (doc.id)}
                            <option value={doc.id}>{documentTitleOf(doc)}</option>
                        {/each}
                    </select>
                </label>

                {#if edgeMode === "sanction_change"}
                    <label class="flex flex-col gap-1 text-sm">
                        <span class="font-medium">Hành vi vi phạm *</span>
                        <Input bind:value={linkBehavior} required placeholder="VD: Vượt đèn đỏ / Dừng đỗ trên cao tốc" />
                    </label>

                    <label class="flex flex-col gap-1 text-sm">
                        <span class="font-medium">Loại biến động mức xử lý</span>
                        <select bind:value={linkSanctionChangeType} class="h-9 rounded-md border bg-background px-3 text-sm">
                            <option value="SANCTION_INCREASE">Tăng nặng xử phạt</option>
                            <option value="SANCTION_DECREASE">Giảm nhẹ xử phạt</option>
                            <option value="POINT_DEDUCTION_CHANGED">Thay đổi trừ điểm GPLX</option>
                            <option value="LICENSE_SUSPENSION_CHANGED">Thay đổi tước GPLX</option>
                            <option value="VIOLATION_ADDED">Bổ sung hành vi xử phạt</option>
                            <option value="REPEALED">Bãi bỏ xử phạt</option>
                            <option value="SANCTION_CHANGED">Thay đổi mức xử lý khác</option>
                        </select>
                    </label>

                    <label class="flex flex-col gap-1 text-sm">
                        <span class="font-medium">Mức phạt cũ (mô tả)</span>
                        <Input bind:value={linkOldPenalty} placeholder="VD: 4.000.000 – 6.000.000 đ" />
                    </label>

                    <label class="flex flex-col gap-1 text-sm">
                        <span class="font-medium">Mức phạt mới (mô tả)</span>
                        <Input bind:value={linkNewPenalty} placeholder="VD: 18.000.000 – 20.000.000 đ + trừ 4 điểm" />
                    </label>

                    <label class="flex flex-col gap-1 text-sm">
                        <span class="font-medium">Mức phạt tối đa cũ (VNĐ, để tính %)</span>
                        <Input bind:value={linkOldMax} placeholder="VD: 6000000" />
                    </label>

                    <label class="flex flex-col gap-1 text-sm">
                        <span class="font-medium">Mức phạt tối đa mới (VNĐ, để tính %)</span>
                        <Input bind:value={linkNewMax} placeholder="VD: 20000000" />
                    </label>
                {:else}
                    <label class="flex flex-col gap-1 text-sm">
                        <span class="font-medium">Loại quan hệ pháp lý</span>
                        <select bind:value={linkDocRelationType} class="h-9 rounded-md border bg-background px-3 text-sm">
                            <option value="AMENDS">Sửa đổi</option>
                            <option value="SUPPLEMENTS">Bổ sung</option>
                            <option value="REPLACES">Thay thế</option>
                            <option value="REPEALS">Bãi bỏ</option>
                            <option value="LEGAL_BASIS">Căn cứ vào</option>
                            <option value="GUIDES">Hướng dẫn thi hành</option>
                            <option value="REFERENCES">Dẫn chiếu tới</option>
                        </select>
                    </label>

                    <label class="flex flex-col gap-1 text-sm">
                        <span class="font-medium">Phạm vi tác động</span>
                        <select bind:value={linkDocScope} class="h-9 rounded-md border bg-background px-3 text-sm">
                            <option value="PARTIAL">Một phần văn bản</option>
                            <option value="FULL">Toàn bộ văn bản</option>
                        </select>
                    </label>
                {/if}

                <label class="flex flex-col gap-1 text-sm md:col-span-2">
                    <span class="font-medium">Ghi chú / Căn cứ lập pháp</span>
                    <Input bind:value={linkNote} placeholder="Lý do điều chỉnh mức phạt hoặc điều khoản dẫn chiếu..." />
                </label>

                <div class="flex gap-2 md:col-span-2">
                    <Button type="submit">Lưu cạnh vào lược đồ</Button>
                    <Button type="button" variant="ghost" onclick={() => (showLinker = false)}>Hủy</Button>
                </div>
            </form>
        </section>
    {/if}

    <!-- MODE 1: SANCTION CHANGE MODE -->
    {#if edgeMode === "sanction_change"}
        <form class="flex flex-wrap items-end gap-4 rounded-xl border bg-card p-4 text-sm" onsubmit={(event) => event.preventDefault()}>
            <label class="flex min-w-52 flex-1 flex-col gap-1">
                <span class="font-medium">Tìm hành vi / mức phạt</span>
                <Input type="search" bind:value={search} placeholder="VD: đèn tín hiệu, cao tốc, trừ điểm..." />
            </label>

            <label class="flex min-w-48 flex-col gap-1">
                <span class="font-medium">Loại biến động</span>
                <select bind:value={sanctionTypeFilter} class="h-9 rounded-md border bg-background px-3 text-sm">
                    <option value="ALL">Tất cả biến động ({sanctionEdges.length})</option>
                    <option value="SANCTION_INCREASE">Tăng nặng xử phạt</option>
                    <option value="SANCTION_DECREASE">Giảm nhẹ xử phạt</option>
                    <option value="POINT_DEDUCTION_CHANGED">Thay đổi trừ điểm GPLX</option>
                    <option value="LICENSE_SUSPENSION_CHANGED">Thay đổi tước GPLX</option>
                    <option value="VIOLATION_ADDED">Bổ sung hành vi xử phạt</option>
                    <option value="REPEALED">Bãi bỏ xử phạt</option>
                </select>
            </label>

            <label class="flex min-w-48 flex-col gap-1">
                <span class="font-medium">Lọc theo văn bản</span>
                <NativeSelect bind:value={focusDocumentId} class="w-full">
                    <NativeSelectOption value="">Tất cả văn bản</NativeSelectOption>
                    {#each graph.documents as document (document.id)}
                        <NativeSelectOption value={document.id}>{documentTitleOf(document)}</NativeSelectOption>
                    {/each}
                </NativeSelect>
            </label>

            <button type="button" class="pb-2 text-muted-foreground underline underline-offset-4" onclick={resetFilters}>Bỏ lọc</button>
        </form>

        <div class="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-[#dc2626]"></span> Tăng nặng xử phạt</span>
            <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-[#16a34a]"></span> Giảm nhẹ xử phạt</span>
            <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-[#ea580c]"></span> Thay đổi trừ điểm / tước GPLX</span>
            <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-[#9333ea]"></span> Bổ sung hành vi</span>
            <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-full bg-[#64748b]"></span> Bãi bỏ xử phạt</span>
        </div>

        {#if graph.documents.length === 0}
            <p class="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Chưa có văn bản nào trong Workspace này.</p>
        {:else}
            <RelationGraphView
                layout={sanctionLayout}
                documents={graph.documents}
                provisions={[]}
                {selectedId}
                onselect={(nodeId) => (selectedId = nodeId)}
            />
        {/if}

        <section class="flex flex-col gap-3" aria-labelledby="sanction-edges-heading">
            <h2 id="sanction-edges-heading" class="flex items-center gap-2 text-base font-semibold">
                <GitCompareArrows class="size-4 text-destructive" aria-hidden="true" />
                Chi tiết các cạnh biến động mức xử lý ({filteredSanctionEdges.length})
            </h2>

            {#if filteredSanctionEdges.length === 0}
                <p class="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
                    Chưa có cạnh biến động mức xử lý nào khớp bộ lọc. Hãy dùng nút "Nối cạnh thủ công" hoặc nhập văn bản để AI tự đối chiếu.
                </p>
            {:else}
                <div class="grid gap-3 md:grid-cols-2">
                    {#each filteredSanctionEdges as edge (edge.id)}
                        <article class="flex flex-col gap-2.5 rounded-xl border bg-card p-4 text-sm">
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <div class="flex flex-wrap items-center gap-1.5">
                                    <span class="inline-block size-2.5 rounded-full" style:background-color={relationColor(edge.changeType)}></span>
                                    <span class="font-semibold">{sanctionChangeLabel(edge.changeType)}</span>
                                    {#if edge.severityDeltaPercent !== null}
                                        <Badge variant={edge.severityDeltaPercent > 0 ? "destructive" : "secondary"}>
                                            {edge.severityDeltaPercent > 0 ? `+${edge.severityDeltaPercent}%` : `${edge.severityDeltaPercent}%`}
                                        </Badge>
                                    {/if}
                                </div>
                                <div class="flex items-center gap-1.5">
                                    <Badge variant="outline" class="gap-1 text-[11px]">
                                        {#if edge.sourceMode === "AI"}
                                            <Sparkles class="size-3" />
                                            AI tự nối
                                        {:else}
                                            Thủ công
                                        {/if}
                                    </Badge>
                                    {#if edge.sourceMode === "MANUAL" && sessionStore.user}
                                        <button
                                            type="button"
                                            onclick={() => handleDeleteSanctionEdge(edge)}
                                            class="rounded p-1 text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
                                            title="Xóa cạnh thủ công"
                                        >
                                            <Trash2 class="size-3.5" />
                                        </button>
                                    {/if}
                                </div>
                            </div>

                            <p class="font-medium text-foreground">{edge.behaviorSummary}</p>

                            <div class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                <span class="rounded bg-muted px-2 py-0.5 font-medium text-foreground">{docName(edge.toDocumentId)}</span>
                                <ArrowRight class="size-3.5" />
                                <span class="rounded bg-muted px-2 py-0.5 font-medium text-foreground">{docName(edge.fromDocumentId)}</span>
                            </div>

                            {#if edge.oldPenaltyText || edge.newPenaltyText}
                                <div class="grid gap-2 rounded-lg bg-muted/50 p-2.5 text-xs sm:grid-cols-2">
                                    <div>
                                        <div class="text-muted-foreground">Mức xử lý cũ</div>
                                        <div class="font-medium">{edge.oldPenaltyText ?? "—"}</div>
                                    </div>
                                    <div>
                                        <div class="text-muted-foreground">Mức xử lý mới</div>
                                        <div class="font-semibold text-foreground">{edge.newPenaltyText ?? "—"}</div>
                                    </div>
                                </div>
                            {/if}

                            {#if edge.note}
                                <p class="text-xs text-muted-foreground">{edge.note}</p>
                            {/if}
                        </article>
                    {/each}
                </div>
            {/if}
        </section>
    {:else}
        <!-- MODE 2: DOCUMENT INFLUENCE MODE -->
        <form class="flex flex-col gap-4 rounded-xl border bg-card p-4 text-sm" aria-label="Bộ lọc đồ thị" onsubmit={(event) => event.preventDefault()}>
            <div class="grid gap-4 md:grid-cols-3">
                <label class="flex flex-col gap-1">
                    <span class="font-medium">Tìm văn bản</span>
                    <Input type="search" bind:value={search} placeholder="Số hiệu hoặc tên, ví dụ 168/2024" />
                </label>

                <label class="flex flex-col gap-1">
                    <span class="font-medium">Văn bản trọng tâm</span>
                    <NativeSelect bind:value={focusDocumentId} class="w-full">
                        <NativeSelectOption value="">Tất cả văn bản</NativeSelectOption>
                        {#each graph.documents as document (document.id)}
                            <NativeSelectOption value={document.id}>{documentTitleOf(document)}</NativeSelectOption>
                        {/each}
                    </NativeSelect>
                </label>

                <label class="flex flex-col gap-1">
                    <span class="font-medium">Cấp hiển thị</span>
                    <NativeSelect bind:value={level} class="w-full">
                        {#each LEVELS as option (option.value)}
                            <NativeSelectOption value={option.value}>{option.label}</NativeSelectOption>
                        {/each}
                    </NativeSelect>
                </label>
            </div>

            <fieldset class="flex flex-col gap-2">
                <legend class="font-medium">Loại quan hệ ảnh hưởng</legend>
                {#if relationTypes.length === 0}
                    <p class="text-muted-foreground">Chưa có quan hệ nào trong dữ liệu.</p>
                {:else}
                    <div class="flex flex-wrap gap-x-4 gap-y-2">
                        {#each relationTypes as relationType (relationType)}
                            <label class="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    class="size-4 accent-primary"
                                    checked={!hiddenRelationTypes.includes(relationType)}
                                    onchange={(event) => toggleType(relationType, event.currentTarget.checked)}
                                />
                                <span class="inline-block h-0.5 w-5" style:background-color={relationColor(relationType)} aria-hidden="true"></span>
                                {relationLabel(relationType, "OUTGOING")}
                            </label>
                        {/each}
                    </div>
                {/if}
            </fieldset>

            <div class="flex flex-wrap items-center justify-between gap-3">
                <label class="flex items-center gap-2">
                    <input type="checkbox" class="size-4 accent-primary" bind:checked={includeCandidates} />
                    Hiện quan hệ điều khoản chưa xác minh (nét đứt)
                </label>

                <button type="button" class="text-muted-foreground underline underline-offset-4" onclick={resetFilters}>Bỏ lọc</button>
            </div>
        </form>

        <p class="text-sm text-muted-foreground" role="status">
            Đang hiển thị {visible.documents.length}/{graph.documents.length} văn bản, {visible.provisions.length} điều khoản, {edgeCount} quan hệ ảnh hưởng.
        </p>

        {#if visible.documents.length === 0}
            <p class="text-sm text-muted-foreground">Không có văn bản nào khớp bộ lọc.</p>
        {:else}
            <RelationGraphView {layout} documents={visible.documents} provisions={visible.provisions} {selectedId} onselect={(nodeId) => (selectedId = nodeId)} />
        {/if}

        {#if selectedId && isNodeVisible}
            <GraphNodeDetails nodeId={selectedId} {graph} {visible} onselect={(nodeId) => (selectedId = nodeId)} />
        {/if}

        {#if visible.documentRelations.length > 0}
            <section class="flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm">
                <h2 class="font-semibold">Danh sách cạnh ảnh hưởng giữa các văn bản ({visible.documentRelations.length})</h2>
                <ul class="flex flex-col gap-2">
                    {#each visible.documentRelations as rel (rel.id)}
                        <li class="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2">
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="inline-block size-2.5 rounded-full" style:background-color={relationColor(rel.relationType)}></span>
                                <span class="font-medium">{docName(rel.fromDocumentId)}</span>
                                <Badge variant="secondary">{relationLabel(rel.relationType, "OUTGOING")}</Badge>
                                <span class="font-medium">{docName(rel.toDocumentId)}</span>
                                {#if rel.note}
                                    <span class="text-xs text-muted-foreground">— {rel.note}</span>
                                {/if}
                            </div>
                            <div class="flex items-center gap-1.5">
                                <Badge variant="outline" class="text-[11px]">{rel.sourceMode === "MANUAL" ? "Thủ công" : "AI tự nối"}</Badge>
                                {#if rel.sourceMode === "MANUAL" && sessionStore.user}
                                    <button
                                        type="button"
                                        onclick={() => handleDeleteDocRelation(rel.id)}
                                        class="rounded p-1 text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
                                        title="Xóa cạnh thủ công"
                                    >
                                        <Trash2 class="size-3.5" />
                                    </button>
                                {/if}
                            </div>
                        </li>
                    {/each}
                </ul>
            </section>
        {/if}
    {/if}

    <ScopeNotice kind="graph" documentCount={graph.documents.length} />
</main>
