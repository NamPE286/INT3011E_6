<script lang="ts">
    import GraphNodeDetails from "$lib/components/GraphNodeDetails.svelte";
    import RelationGraph from "$lib/components/RelationGraph.svelte";
    import ScopeNotice from "$lib/components/ScopeNotice.svelte";
    import { Input } from "$lib/components/ui/input";
    import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
    import { filterGraph, layoutGraph, relationTypesOf, type GraphLevel } from "$lib/graph-view";
    import { documentTitleOf, relationLabel } from "$lib/labels";
    import { relationColor } from "$lib/relation-colors";

    let { data } = $props();

    const LEVELS: { value: GraphLevel; label: string }[] = [
        { value: "ALL", label: "Văn bản và điều khoản" },
        { value: "DOCUMENT", label: "Chỉ quan hệ văn bản" },
        { value: "PROVISION", label: "Chỉ quan hệ điều khoản" },
    ];

    const relationTypes = $derived(relationTypesOf(data.graph));

    let hiddenRelationTypes = $state<string[]>([]);
    let includeCandidates = $state(true);
    let level = $state<GraphLevel>("ALL");
    // The page load reads ?document= once; afterwards the select owns the focus.
    // svelte-ignore state_referenced_locally
    let focusDocumentId = $state(data.focusDocumentId ?? "");
    let search = $state("");
    let selectedId = $state<string | null>(null);

    const visible = $derived(
        filterGraph(data.graph, {
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

    function toggleType(relationType: string, shown: boolean): void {
        hiddenRelationTypes = shown ? hiddenRelationTypes.filter((type) => type !== relationType) : [...hiddenRelationTypes, relationType];
    }

    function resetFilters(): void {
        hiddenRelationTypes = [];
        includeCandidates = true;
        level = "ALL";
        focusDocumentId = "";
        search = "";
    }
</script>

<svelte:head>
    <title>Đồ thị quan hệ</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
    <header class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold tracking-tight">Đồ thị quan hệ</h1>
        <p class="text-sm text-muted-foreground">
            Văn bản xếp theo ngày ban hành từ trái sang phải, điều khoản nằm dưới văn bản chứa nó. Mũi tên đi từ phần tác động tới phần bị tác động. Chọn một ô để xem căn cứ.
        </p>
    </header>

    <form class="flex flex-col gap-4 rounded-lg border p-4 text-sm" aria-label="Bộ lọc đồ thị" onsubmit={(event) => event.preventDefault()}>
        <div class="grid gap-4 md:grid-cols-3">
            <label class="flex flex-col gap-1">
                <span class="font-medium">Tìm văn bản</span>
                <Input type="search" bind:value={search} placeholder="Số hiệu hoặc tên, ví dụ 01/2030" />
            </label>

            <label class="flex flex-col gap-1">
                <span class="font-medium">Văn bản trọng tâm</span>
                <NativeSelect bind:value={focusDocumentId} class="w-full">
                    <NativeSelectOption value="">Tất cả văn bản</NativeSelectOption>
                    {#each data.graph.documents as document (document.id)}
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
            <legend class="font-medium">Loại quan hệ</legend>
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
        Đang hiển thị {visible.documents.length}/{data.graph.documents.length} văn bản, {visible.provisions.length} điều khoản, {edgeCount} quan hệ.
    </p>

    {#if data.graph.truncated}
        <p class="text-sm text-destructive" role="alert">Dữ liệu vượt giới hạn hiển thị nên đồ thị chỉ gồm một phần văn bản hoặc quan hệ.</p>
    {/if}

    {#if visible.documents.length === 0}
        <p class="text-sm text-muted-foreground">Không có văn bản nào khớp bộ lọc.</p>
    {:else}
        <RelationGraph {layout} documents={visible.documents} provisions={visible.provisions} {selectedId} onselect={(nodeId) => (selectedId = nodeId)} />
    {/if}

    {#if selectedId && isNodeVisible}
        <GraphNodeDetails nodeId={selectedId} graph={data.graph} {visible} onselect={(nodeId) => (selectedId = nodeId)} />
    {/if}

    <ScopeNotice kind="graph" documentCount={data.graph.documents.length} />
</main>
