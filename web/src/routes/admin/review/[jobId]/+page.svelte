<script lang="ts">
    import { invalidateAll } from "$app/navigation";
    import { acceptJobDocument } from "$lib/api/client";
    import type { ReadQuality } from "$lib/api/review";
    import { Alert, AlertDescription, AlertTitle } from "$lib/components/ui/alert";
    import { Badge } from "$lib/components/ui/badge";
    import { Button } from "$lib/components/ui/button";
    import * as Table from "$lib/components/ui/table";

    let { data } = $props();

    const job = $derived(data.job);
    const errorCount = $derived(job.issues.filter((issue) => issue.severity === "ERROR").length);
    const needsReview = $derived(job.reviewStatus === "REVIEW_REQUIRED");

    const QUALITY_LABELS: Record<ReadQuality, string> = {
        GOOD: "Đọc tốt",
        PARTIAL: "Đọc một phần",
        UNREADABLE: "Không đọc được",
    };

    let accepting = $state(false);
    let errorMessage = $state<string | null>(null);

    async function accept(): Promise<void> {
        accepting = true;
        errorMessage = null;

        try {
            await acceptJobDocument(fetch, job.jobId);
            await invalidateAll();
        } catch (cause: unknown) {
            errorMessage = cause instanceof Error ? cause.message : "Không thể duyệt văn bản";
        } finally {
            accepting = false;
        }
    }
</script>

<svelte:head>
    <title>Xem xét văn bản</title>
</svelte:head>

<!-- TODO(#4): restrict this admin page once authentication is implemented. -->
<main class="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
    <nav aria-label="Đường dẫn">
        <a href="/admin" class="text-sm text-muted-foreground underline underline-offset-4">← Nhập văn bản</a>
    </nav>

    <header class="flex flex-col gap-2">
        <h1 class="text-2xl font-semibold tracking-tight">{job.title ?? "Văn bản chưa đọc được tiêu đề"}</h1>

        <div class="flex flex-wrap gap-2">
            <Badge variant={needsReview ? "secondary" : "default"}>{needsReview ? "Cần kiểm tra" : "Đã duyệt"}</Badge>
            {#if job.pageCount !== null}
                <Badge variant="outline">{job.pageCount} trang</Badge>
            {/if}
            {#if job.model}
                <Badge variant="outline">{job.model}</Badge>
            {/if}
        </div>
    </header>

    {#if needsReview}
        <Alert>
            <AlertTitle>{errorCount} lỗi đang chặn việc công bố</AlertTitle>
            <AlertDescription>
                Văn bản được lưu nhưng chưa dùng cho tra cứu và hỏi đáp. Đối chiếu từng lỗi và danh sách Điều với PDF gốc; chỉ duyệt khi nội dung đúng.
            </AlertDescription>
        </Alert>
    {/if}

    <section aria-labelledby="issues-heading" class="flex flex-col gap-3">
        <h2 id="issues-heading" class="text-lg font-semibold">Vấn đề phát hiện ({job.issues.length})</h2>

        {#if job.issues.length === 0}
            <p class="text-sm text-muted-foreground">Không có vấn đề nào.</p>
        {:else}
            <ul class="flex flex-col gap-2">
                {#each job.issues as issue, index (index)}
                    <li class="flex flex-col gap-1 rounded-md border p-3 text-sm">
                        <div class="flex flex-wrap items-center gap-2">
                            <Badge variant={issue.severity === "ERROR" ? "destructive" : "secondary"}>
                                {issue.severity === "ERROR" ? "Lỗi" : "Cảnh báo"}
                            </Badge>
                            <code class="text-xs text-muted-foreground">{issue.code}</code>
                            {#if issue.page !== null}
                                <span class="text-xs text-muted-foreground">Trang {issue.page}</span>
                            {/if}
                        </div>
                        <p>{issue.message}</p>
                    </li>
                {/each}
            </ul>
        {/if}
    </section>

    <section aria-labelledby="articles-heading" class="flex flex-col gap-3">
        <h2 id="articles-heading" class="text-lg font-semibold">Các Điều đã đọc ({job.articles.length})</h2>

        <Table.Root>
            <Table.Header>
                <Table.Row>
                    <Table.Head>Điều</Table.Head>
                    <Table.Head>Tiêu đề</Table.Head>
                    <Table.Head>Khoản</Table.Head>
                    <Table.Head>Trang</Table.Head>
                    <Table.Head>Chất lượng đọc</Table.Head>
                </Table.Row>
            </Table.Header>

            <Table.Body>
                {#each job.articles as article, index (index)}
                    <Table.Row>
                        <Table.Cell class="whitespace-nowrap font-medium">Điều {article.number}</Table.Cell>
                        <Table.Cell class="whitespace-normal">{article.title ?? "—"}</Table.Cell>
                        <Table.Cell>{article.clauseCount}</Table.Cell>
                        <Table.Cell>{article.pageStart ?? "—"}</Table.Cell>
                        <Table.Cell>
                            <Badge variant={article.quality === "GOOD" ? "outline" : "destructive"}>{QUALITY_LABELS[article.quality]}</Badge>
                        </Table.Cell>
                    </Table.Row>
                {/each}
            </Table.Body>
        </Table.Root>
    </section>

    <div aria-live="polite" class="flex flex-col gap-3">
        {#if errorMessage}
            <Alert variant="destructive">
                <AlertTitle>Không duyệt được văn bản</AlertTitle>
                <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
        {/if}

        {#if needsReview}
            <div class="flex flex-wrap gap-2">
                <Button onclick={accept} disabled={accepting}>
                    {accepting ? "Đang duyệt…" : "Duyệt và công bố"}
                </Button>
                <Button variant="outline" href="/admin">Để sau</Button>
            </div>
        {:else}
            <Button variant="outline" href={`/documents/${job.jobId}`}>Xem văn bản đã công bố</Button>
        {/if}
    </div>
</main>
