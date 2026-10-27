<script lang="ts">
    import SearchForm from "$lib/components/SearchForm.svelte";
    import ScopeNotice from "$lib/components/ScopeNotice.svelte";
    import { Badge } from "$lib/components/ui/badge";
    import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
    import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
    import { formatDate } from "$lib/format";
    import { documentTitleOf } from "$lib/labels";

    let { data } = $props();

    const documentTypes = ["Luật", "Nghị định", "Thông tư", "Nghị quyết", "Quyết định", "Pháp lệnh", "Chỉ thị"];
    const searched = $derived(data.query.trim().length > 0);
</script>

<svelte:head>
    <title>Văn bản pháp luật</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
    <header>
        <h1 class="text-2xl font-semibold tracking-tight">Văn bản pháp luật</h1>
        <p class="text-sm text-muted-foreground">Tìm theo số hiệu, tên văn bản hoặc từ khóa. Tìm kiếm không dùng AI.</p>
    </header>

    <SearchForm action="/documents" label="Số hiệu, tên hoặc từ khóa" placeholder="Ví dụ: 100/2019/NĐ-CP" value={data.query}>
        {#snippet filters()}
            <div class="flex flex-col gap-1.5">
                <label for="document-type" class="text-sm font-medium">Loại văn bản</label>
                <NativeSelect id="document-type" name="type" value={data.documentType ?? ""}>
                    <NativeSelectOption value="">Tất cả</NativeSelectOption>
                    {#each documentTypes as type (type)}
                        <NativeSelectOption value={type}>{type}</NativeSelectOption>
                    {/each}
                </NativeSelect>
            </div>
        {/snippet}
    </SearchForm>

    <section aria-labelledby="results-heading" class="flex flex-col gap-3">
        <h2 id="results-heading" class="text-lg font-semibold">
            {searched ? `Kết quả cho “${data.query}”` : "Văn bản mới nhất"}
        </h2>

        {#if data.result.documents.length === 0}
            <p class="text-sm text-muted-foreground" role="status">
                Không tìm thấy văn bản phù hợp trong dữ liệu đã nhập.
            </p>
        {:else}
            <ul class="flex flex-col gap-3">
                {#each data.result.documents as document (document.id)}
                    <li>
                        <a href={`/documents/${encodeURIComponent(document.id)}`} class="block rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2">
                            <Card class="transition-colors hover:bg-muted/50">
                                <CardHeader>
                                    <CardTitle>{documentTitleOf(document)}</CardTitle>
                                    {#if document.title && document.documentNumber}
                                        <CardDescription>{document.title}</CardDescription>
                                    {/if}
                                </CardHeader>
                                <CardContent class="flex flex-wrap gap-2">
                                    {#if document.documentType}
                                        <Badge variant="secondary">{document.documentType}</Badge>
                                    {/if}
                                    {#if document.agency}
                                        <Badge variant="outline">{document.agency}</Badge>
                                    {/if}
                                    {#if document.issuedAt}
                                        <Badge variant="outline">Ban hành {formatDate(document.issuedAt)}</Badge>
                                    {/if}
                                </CardContent>
                            </Card>
                        </a>
                    </li>
                {/each}
            </ul>
        {/if}
    </section>

    <ScopeNotice kind="documents" />
</main>
