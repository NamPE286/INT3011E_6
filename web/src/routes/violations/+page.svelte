<script lang="ts">
    import SearchForm from "$lib/components/SearchForm.svelte";
    import { ChevronRight, Sparkles } from "@lucide/svelte";

    let { data } = $props();

    const searched = $derived(data.query.trim().length > 0);

    function otherAliases(violation: { canonicalName: string; aliases: string[] }): string[] {
        return violation.aliases.filter((alias) => alias !== violation.canonicalName).slice(0, 2);
    }
</script>

<svelte:head>
    <title>Hành vi vi phạm</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6">
    <header class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">Hành vi vi phạm</h1>
        <p class="text-muted-foreground">Tìm theo từ khóa trong cách diễn đạt của văn bản. Tìm kiếm không dùng AI.</p>
    </header>

    <SearchForm action="/violations" label="Mô tả hành vi" placeholder="Ví dụ: đỗ xe ngoài đô thị" value={data.query} />

    <section aria-labelledby="results-heading" class="flex flex-col gap-3">
        <h2 id="results-heading" class="text-sm font-medium text-muted-foreground">
            {searched ? `${data.violations.length} kết quả cho “${data.query}”` : `${data.violations.length} hành vi đã nhận diện`}
        </h2>

        {#if data.violations.length === 0}
            <div class="flex flex-col gap-3 rounded-2xl border border-dashed p-5" role="status">
                {#if searched}
                    <p class="font-medium">Không tìm thấy hành vi khớp với các từ này trong dữ liệu đã xử lý.</p>
                    <p class="text-sm text-muted-foreground">Văn bản có thể dùng cách diễn đạt khác. Hỏi AI để hệ thống tìm hành vi tương ứng và trả lời kèm điều khoản nguồn.</p>
                    <a
                        href={`/ask?q=${encodeURIComponent(data.query)}`}
                        class="inline-flex items-center gap-2 self-start rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    >
                        <Sparkles class="size-4" aria-hidden="true" />
                        Hỏi AI: “{data.query}”
                    </a>
                {:else}
                    <p class="font-medium">Chưa có hành vi vi phạm nào trong dữ liệu.</p>
                    <p class="text-sm text-muted-foreground">Hành vi được nhận diện tự động sau khi nhập văn bản pháp luật ở trang Quản trị.</p>
                {/if}
            </div>
        {:else}
            <ul class="flex flex-col divide-y rounded-2xl border bg-card">
                {#each data.violations as violation (violation.id)}
                    <li>
                        <a
                            href={`/violations/${encodeURIComponent(violation.id)}`}
                            class="group flex items-center gap-4 p-4 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2"
                        >
                            <span class="flex min-w-0 flex-1 flex-col gap-1">
                                <span class="font-medium">{violation.canonicalName}</span>
                                {#if otherAliases(violation).length > 0}
                                    <span class="text-sm text-muted-foreground">Còn được diễn đạt: {otherAliases(violation).join("; ")}</span>
                                {/if}
                            </span>
                            <span class="hidden shrink-0 text-sm text-muted-foreground group-hover:text-foreground sm:inline">Xem mức phạt</span>
                            <ChevronRight class="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                        </a>
                    </li>
                {/each}
            </ul>
        {/if}
    </section>
</main>
