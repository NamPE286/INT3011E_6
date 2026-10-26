<script lang="ts">
    import SearchForm from "$lib/components/SearchForm.svelte";
    import { Card, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";

    let { data } = $props();

    const searched = $derived(data.query.trim().length > 0);

    function otherAliases(violation: { canonicalName: string; aliases: string[] }): string[] {
        return violation.aliases.filter((alias) => alias !== violation.canonicalName).slice(0, 3);
    }
</script>

<svelte:head>
    <title>Hành vi vi phạm</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
    <header>
        <h1 class="text-2xl font-semibold tracking-tight">Hành vi vi phạm</h1>
        <p class="text-sm text-muted-foreground">
            Tìm theo cách diễn đạt trong văn bản hoặc tên gọi khác của hành vi. Tìm kiếm không dùng AI.
        </p>
    </header>

    <SearchForm action="/violations" label="Hành vi vi phạm" placeholder="Ví dụ: không chấp hành hiệu lệnh của đèn tín hiệu" value={data.query} />

    <section aria-labelledby="results-heading" class="flex flex-col gap-3">
        <h2 id="results-heading" class="text-lg font-semibold">
            {searched ? `Kết quả cho “${data.query}”` : "Các hành vi đã nhận diện"}
        </h2>

        {#if data.violations.length === 0}
            <p class="text-sm text-muted-foreground" role="status">
                Không tìm thấy hành vi phù hợp trong dữ liệu đã xử lý. Hãy thử cách diễn đạt khác hoặc hỏi đáp bằng AI.
            </p>
        {:else}
            <ul class="flex flex-col gap-3">
                {#each data.violations as violation (violation.id)}
                    <li>
                        <a href={`/violations/${encodeURIComponent(violation.id)}`} class="block rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2">
                            <Card class="transition-colors hover:bg-muted/50">
                                <CardHeader>
                                    <CardTitle>{violation.canonicalName}</CardTitle>
                                    {#if otherAliases(violation).length > 0}
                                        <CardDescription>Còn được diễn đạt: {otherAliases(violation).join("; ")}</CardDescription>
                                    {/if}
                                </CardHeader>
                            </Card>
                        </a>
                    </li>
                {/each}
            </ul>
        {/if}
    </section>
</main>
