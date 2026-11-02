<script lang="ts">
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { BookOpen, MessageCircleQuestion, Network, Search } from "@lucide/svelte";

    const QUICK_SEARCHES = ["đèn tín hiệu", "mũ bảo hiểm", "đỗ xe", "nồng độ cồn", "quá tốc độ"];
    const SAMPLE_QUESTION = "Vượt đèn đỏ bị phạt bao nhiêu và trước đây thế nào?";

    const entries = [
        {
            href: "/documents",
            icon: BookOpen,
            title: "Văn bản pháp luật",
            description: "Tìm theo số hiệu hoặc tên, đọc Điều, Khoản, Điểm và xem phần nào đã bị sửa đổi, bãi bỏ.",
        },
        {
            href: "/graph",
            icon: Network,
            title: "Đồ thị quan hệ",
            description: "Văn bản nào sửa đổi văn bản nào, điều khoản nào tác động tới điều khoản nào, theo thời gian.",
        },
        {
            href: `/ask?q=${encodeURIComponent(SAMPLE_QUESTION)}`,
            icon: MessageCircleQuestion,
            title: "Hỏi đáp bằng AI",
            description: "Hỏi bằng lời thường; mỗi ý trả lời đều dẫn về điều khoản nguồn để bạn tự kiểm tra.",
        },
    ];
</script>

<svelte:head>
    <title>Tra cứu xử phạt giao thông</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-10 sm:px-6 sm:py-16">
    <section aria-labelledby="hero-heading" class="flex flex-col gap-6">
        <div class="flex max-w-3xl flex-col gap-3">
            <h1 id="hero-heading" class="text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
                Hành vi này bị phạt bao nhiêu, theo điều khoản nào?
            </h1>
            <p class="text-base text-pretty text-muted-foreground sm:text-lg">
                Tra mức phạt hiện hành hoặc tại một ngày bất kỳ, kèm điều khoản căn cứ và lịch sử thay đổi của quy định.
            </p>
        </div>

        <form method="GET" action="/violations" role="search" class="flex max-w-3xl flex-col gap-3 sm:flex-row">
            <label for="hero-search" class="sr-only">Tìm hành vi vi phạm</label>
            <div class="relative flex-1">
                <Search class="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                    id="hero-search"
                    name="q"
                    type="search"
                    placeholder="Mô tả hành vi, ví dụ: không đội mũ bảo hiểm"
                    autocomplete="off"
                    class="h-12 rounded-xl bg-card pl-12 text-base shadow-sm"
                />
            </div>
            <Button type="submit" size="lg" class="h-12 rounded-xl px-6 text-base">Tra cứu</Button>
        </form>

        <div class="flex flex-wrap items-center gap-2 text-sm">
            <span class="text-muted-foreground">Tìm nhanh:</span>
            {#each QUICK_SEARCHES as query (query)}
                <a
                    href={`/violations?q=${encodeURIComponent(query)}`}
                    class="rounded-full border bg-card px-3 py-1.5 transition-colors hover:border-primary/40 hover:bg-accent hover:text-accent-foreground"
                >
                    {query}
                </a>
            {/each}
        </div>
    </section>

    <section aria-label="Các công cụ khác">
        <ul class="grid gap-4 md:grid-cols-3">
            {#each entries as entry (entry.href)}
                <li>
                    <a
                        href={entry.href}
                        class="group flex h-full flex-col gap-3 rounded-2xl border bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                        <span class="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                            <entry.icon class="size-5" aria-hidden="true" />
                        </span>
                        <span class="text-lg font-semibold">{entry.title}</span>
                        <span class="text-sm text-muted-foreground">{entry.description}</span>
                    </a>
                </li>
            {/each}
        </ul>
    </section>

    <footer class="flex flex-col gap-2 border-t pt-6 text-sm text-muted-foreground sm:flex-row sm:justify-between">
        <p>Dữ liệu lấy từ các văn bản đã nhập vào hệ thống. Kết quả không thay thế tư vấn pháp lý.</p>
        <a href="/admin" class="underline underline-offset-4 hover:text-foreground">Quản trị dữ liệu</a>
    </footer>
</main>
