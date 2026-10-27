<script lang="ts">
    import { invalidateAll } from "$app/navigation";
    import { acceptJobDocument } from "$lib/api/client";
    import ReviewNodeTree from "$lib/components/ReviewNodeTree.svelte";
    import { Alert, AlertDescription, AlertTitle } from "$lib/components/ui/alert";
    import { Badge } from "$lib/components/ui/badge";
    import { Button } from "$lib/components/ui/button";

    let { data } = $props();

    const job = $derived(data.job);
    const errorCount = $derived(job.issues.filter((issue) => issue.severity === "ERROR").length);
    const needsReview = $derived(job.reviewStatus === "REVIEW_REQUIRED");

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
                Văn bản được lưu nhưng chưa dùng cho tra cứu và hỏi đáp. Đối chiếu từng lỗi và nội dung bên dưới với PDF gốc; chỉ duyệt khi nội dung đúng.
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

    <section aria-labelledby="meta-heading" class="flex flex-col gap-3">
        <h2 id="meta-heading" class="text-lg font-semibold">Thông tin văn bản</h2>

        <dl class="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
            <dt class="text-muted-foreground">Tiêu đề</dt>
            <dd>{job.title ?? "—"}</dd>
            <dt class="text-muted-foreground">Mã snapshot</dt>
            <dd class="break-all">{job.source.snapshotId ?? "—"}</dd>
            <dt class="text-muted-foreground">SHA-256 của PDF</dt>
            <dd class="break-all">{job.source.pdfSha256 ?? "—"}</dd>
            <dt class="text-muted-foreground">Phần thứ</dt>
            <dd>{job.source.partIndex ?? "—"}</dd>
            <dt class="text-muted-foreground">Phần mở đầu</dt>
            <dd class="whitespace-pre-line">{job.content ?? "—"}</dd>
        </dl>
    </section>

    <section aria-labelledby="content-heading" class="flex flex-col gap-3">
        <h2 id="content-heading" class="text-lg font-semibold">Nội dung đã đọc</h2>

        {#if job.nodes.length === 0}
            <p class="text-sm text-muted-foreground">Chưa đọc được Điều nào.</p>
        {:else}
            <ReviewNodeTree nodes={job.nodes} />
        {/if}
    </section>

    <details class="rounded-md border p-3">
        <summary class="cursor-pointer text-sm font-medium">JSON gốc</summary>
        <pre class="mt-3 max-h-[32rem] overflow-auto text-xs">{JSON.stringify(job.raw, null, 4)}</pre>
    </details>

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
