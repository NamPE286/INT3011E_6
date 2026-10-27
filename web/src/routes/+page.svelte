<script lang="ts">
    import { Card, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";

    const entries = [
        {
            href: "/documents",
            title: "Tìm văn bản pháp luật",
            description: "Tra theo số hiệu, tên hoặc từ khóa; xem cấu trúc Điều/Khoản/Điểm và quan hệ giữa các văn bản.",
        },
        {
            href: "/violations",
            title: "Tra cứu hành vi vi phạm",
            description: "Xem mức phạt đang áp dụng, mức phạt tại một thời điểm trong quá khứ và lịch sử thay đổi.",
        },
        {
            href: "/ask",
            title: "Hỏi đáp bằng AI",
            description: "Đặt câu hỏi bằng ngôn ngữ tự nhiên; mỗi kết luận pháp lý đều dẫn về điều khoản nguồn.",
        },
    ];
</script>

<svelte:head>
    <title>Tra cứu xử phạt giao thông</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
    <header>
        <h1 class="text-2xl font-semibold tracking-tight">Tra cứu quy định xử phạt giao thông đường bộ</h1>
        <p class="text-sm text-muted-foreground">
            Dữ liệu lấy từ các văn bản pháp luật đã nhập vào hệ thống. Kết quả không thay thế tư vấn pháp lý.
        </p>
    </header>

    <ul class="grid gap-4 md:grid-cols-3">
        {#each entries as entry (entry.href)}
            <li>
                <a href={entry.href} class="block h-full rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2">
                    <Card class="h-full transition-colors hover:bg-muted/50">
                        <CardHeader>
                            <CardTitle>{entry.title}</CardTitle>
                            <CardDescription>{entry.description}</CardDescription>
                        </CardHeader>
                    </Card>
                </a>
            </li>
        {/each}
    </ul>
</main>
