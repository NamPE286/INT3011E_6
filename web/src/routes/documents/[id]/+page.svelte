<script lang="ts">
    import { amendmentsByProvision, buildProvisionTree } from "$lib/api/documents";
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
    const amendments = $derived(amendmentsByProvision(document.amendments));
    const heading = $derived(documentTitleOf({ id: document.id, documentNumber: document.metadata?.documentNumber ?? null, title: document.title }));

    function labelOf(documentId: string): string {
        const known = data.corpus.find((entry) => entry.id === documentId);

        return known ? documentTitleOf(known) : documentId;
    }
</script>

<svelte:head>
    <title>{heading}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
    <nav aria-label="Đường dẫn">
        <a href="/documents" class="text-sm text-muted-foreground underline underline-offset-4">← Văn bản pháp luật</a>
    </nav>

    <header class="flex flex-col gap-2">
        <h1 class="text-2xl font-semibold tracking-tight">{heading}</h1>

        {#if document.title && document.metadata?.documentNumber}
            <p class="text-sm text-muted-foreground">{document.title}</p>
        {/if}

        <div class="flex flex-wrap gap-2">
            {#if document.metadata?.documentType}
                <Badge variant="secondary">{document.metadata.documentType}</Badge>
            {/if}
            {#if document.metadata?.agency}
                <Badge variant="outline">{document.metadata.agency}</Badge>
            {/if}
            {#if document.metadata?.issuedAt}
                <Badge variant="outline">Ban hành {formatDate(document.metadata.issuedAt)}</Badge>
            {/if}
            <Badge variant="outline">
                {document.metadata?.effectiveFrom ? `Hiệu lực từ ${formatDate(document.metadata.effectiveFrom)}` : "Chưa đọc được ngày hiệu lực"}
            </Badge>
        </div>
    </header>

    <Tabs value="content">
        <TabsList>
            <TabsTrigger value="content">Nội dung</TabsTrigger>
            <TabsTrigger value="actions">Hành vi vi phạm ({data.actions.length})</TabsTrigger>
            <TabsTrigger value="relations">Quan hệ</TabsTrigger>
        </TabsList>

        <TabsContent value="content" class="flex flex-col gap-4 pt-4">
            {#if document.provisions.length === 0}
                <p class="text-sm text-muted-foreground" role="status">
                    Văn bản chưa có cấu trúc Điều/Khoản/Điểm được phân tích.
                </p>
            {:else}
                <p class="text-sm text-muted-foreground">
                    Phần có nhãn là phần bị văn bản khác tác động, khi hệ thống có căn cứ. Phần không có nhãn chưa chắc còn nguyên hiệu lực nếu văn bản tác động chưa được nhập.
                </p>
                <ProvisionTree nodes={tree} {amendments} />
            {/if}

            <ScopeNotice kind="document" />
        </TabsContent>

        <TabsContent value="actions" class="flex flex-col gap-3 pt-4">
            <p class="text-sm text-muted-foreground">Hành vi mỗi quy tắc xử phạt được đọc thành, và mục từ vựng hành vi đã khớp.</p>
            <DocumentActions actions={data.actions} />
        </TabsContent>

        <TabsContent value="relations" class="pt-4">
            <RelationsPanel documentId={document.id} relations={data.relations} {labelOf} />
        </TabsContent>
    </Tabs>
</main>
