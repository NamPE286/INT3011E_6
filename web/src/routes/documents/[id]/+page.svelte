<script lang="ts">
    import { amendmentsByProvision, articleOutline, buildProvisionTree } from "$lib/api/documents";
    import DocumentActions from "$lib/components/DocumentActions.svelte";
    import ProvisionTree from "$lib/components/ProvisionTree.svelte";
    import RelationsPanel from "$lib/components/RelationsPanel.svelte";
    import ScopeNotice from "$lib/components/ScopeNotice.svelte";
    import { Badge } from "$lib/components/ui/badge";
    import { Tabs, TabsContent, TabsList, TabsTrigger } from "$lib/components/ui/tabs";
    import { formatDate } from "$lib/format";
    import { documentTitleOf } from "$lib/labels";

    let { data } = $props();

    const document = $derived(data.document);
    const tree = $derived(buildProvisionTree(document.provisions));
    const outline = $derived(articleOutline(tree));
    const amendments = $derived(amendmentsByProvision(document.amendments));
    const amendedCount = $derived(amendments.size);
    const heading = $derived(documentTitleOf({ id: document.id, documentNumber: document.metadata?.documentNumber ?? null, title: document.title }));

    function labelOf(documentId: string): string {
        const known = data.corpus.find((entry) => entry.id === documentId);

        return known ? documentTitleOf(known) : documentId;
    }
</script>

<svelte:head>
    <title>{heading}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
    <nav aria-label="Đường dẫn">
        <a href="/documents" class="text-sm text-muted-foreground underline-offset-4 hover:underline">← Văn bản pháp luật</a>
    </nav>

    <header class="flex flex-col gap-3 rounded-2xl border bg-card p-5 sm:p-6">
        <div class="flex flex-wrap gap-2">
            {#if document.metadata?.documentType}
                <Badge>{document.metadata.documentType}</Badge>
            {/if}
            {#if document.metadata?.agency}
                <Badge variant="outline">{document.metadata.agency}</Badge>
            {/if}
        </div>

        <h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">{heading}</h1>

        {#if document.title && document.metadata?.documentNumber}
            <p class="text-muted-foreground">{document.title}</p>
        {/if}

        <dl class="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div>
                <dt class="text-muted-foreground">Ban hành</dt>
                <dd class="font-medium">{document.metadata?.issuedAt ? formatDate(document.metadata.issuedAt) : "Chưa đọc được"}</dd>
            </div>
            <div>
                <dt class="text-muted-foreground">Hiệu lực từ</dt>
                <dd class="font-medium">{document.metadata?.effectiveFrom ? formatDate(document.metadata.effectiveFrom) : "Chưa đọc được"}</dd>
            </div>
            <div>
                <dt class="text-muted-foreground">Phần bị văn bản khác tác động</dt>
                <dd class="font-medium">{amendedCount}</dd>
            </div>
        </dl>
    </header>

    <Tabs value="content">
        <TabsList>
            <TabsTrigger value="content">Nội dung</TabsTrigger>
            <TabsTrigger value="relations">Quan hệ</TabsTrigger>
        </TabsList>

        <TabsContent value="content" class="pt-4">
            {#if document.provisions.length === 0}
                <p class="text-sm text-muted-foreground" role="status">Văn bản chưa có cấu trúc Điều, Khoản, Điểm được phân tích.</p>
            {:else}
                <div class="grid gap-8 lg:grid-cols-[15rem_1fr]">
                    {#if outline.length > 0}
                        <nav aria-label="Mục lục" class="hidden lg:block">
                            <div class="sticky top-20 flex max-h-[calc(100vh-6rem)] flex-col gap-1 overflow-y-auto text-sm">
                                <p class="mb-1 font-medium">Mục lục</p>
                                {#each outline as entry (entry.id)}
                                    <a href={`#${encodeURIComponent(entry.id)}`} class="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                                        {entry.label}
                                    </a>
                                {/each}
                            </div>
                        </nav>
                    {/if}

                    <div class="flex min-w-0 flex-col gap-6">
                        {#if amendedCount > 0}
                            <p class="flex flex-wrap items-center gap-2 rounded-lg bg-accent/60 p-3 text-sm text-accent-foreground">
                                <span class="inline-block h-4 w-1 rounded bg-destructive" aria-hidden="true"></span>
                                Phần có vạch đỏ bên trái đã bị văn bản khác sửa đổi hoặc bãi bỏ; mở “Căn cứ” để xem lệnh tác động.
                            </p>
                        {/if}

                        <ProvisionTree nodes={tree} {amendments} />

                        <details class="rounded-2xl border bg-card p-4">
                            <summary class="cursor-pointer font-medium">Hành vi vi phạm được đọc từ văn bản ({data.actions.length})</summary>
                            <div class="mt-3">
                                <DocumentActions actions={data.actions} />
                            </div>
                        </details>

                        <ScopeNotice kind="document" />
                    </div>
                </div>
            {/if}
        </TabsContent>

        <TabsContent value="relations" class="pt-4">
            <RelationsPanel documentId={document.id} relations={data.relations} {labelOf} />
        </TabsContent>
    </Tabs>
</main>
