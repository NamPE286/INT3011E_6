<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { PUBLIC_BACKEND_URL } from "$env/static/public";
    import { Badge } from "$lib/components/ui/badge";
    import { Button } from "$lib/components/ui/button";
    import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
    import { Progress } from "$lib/components/ui/progress";
    import * as Table from "$lib/components/ui/table";
    import { isJobActive, parseJobList, type JobSummary } from "$lib/file-processing-response";
    import { ClipboardCheck, FileJson, RefreshCw } from "@lucide/svelte";

    const ACTIVE_POLL_INTERVAL_MS = 3000;
    const backendUrl = PUBLIC_BACKEND_URL.replace(/\/$/, "");

    let jobs = $state<JobSummary[]>([]);
    let loading = $state(true);
    let errorMessage = $state<string | null>(null);
    let refreshInFlight = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const STATUS_LABELS: Record<JobSummary["status"], string> = {
        queued: "Đang chờ",
        processing: "Đang xử lý",
        completed: "Hoàn tất",
        needs_review: "Cần kiểm tra",
        failed: "Lỗi, đang thử lại",
    };

    /** Reloads the list; keeps polling only while some job is still queued or processing. */
    export async function refresh(): Promise<void> {
        if (refreshInFlight) {
            return;
        }

        refreshInFlight = true;

        try {
            const response = await fetch(`${backendUrl}/api/jobs`);

            if (!response.ok) {
                throw new Error(`Không thể tải danh sách (HTTP ${response.status})`);
            }

            const parsed = parseJobList(await response.json());

            if (!parsed) {
                throw new Error("Máy chủ trả về danh sách không hợp lệ");
            }

            jobs = parsed;
            errorMessage = null;
        } catch (error: unknown) {
            errorMessage = error instanceof Error ? error.message : "Không thể kết nối máy chủ";
        } finally {
            loading = false;
            refreshInFlight = false;
            scheduleNextPoll();
        }
    }

    function scheduleNextPoll(): void {
        if (pollTimer !== null) {
            clearTimeout(pollTimer);
            pollTimer = null;
        }

        if (jobs.some(isJobActive)) {
            pollTimer = setTimeout(() => void refresh(), ACTIVE_POLL_INTERVAL_MS);
        }
    }

    function formatSize(bytes: number): string {
        if (bytes < 1024 * 1024) {
            return `${Math.max(1, Math.round(bytes / 1024))} KB`;
        }

        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function formatDate(value: string): string {
        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return value;
        }

        return new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(date);
    }

    function hasDocument(job: JobSummary): boolean {
        return job.status === "completed" || job.status === "needs_review";
    }

    onMount(() => {
        void refresh();
    });

    onDestroy(() => {
        if (pollTimer !== null) {
            clearTimeout(pollTimer);
        }
    });
</script>

<Card class="w-full">
    <CardHeader class="flex flex-row items-start justify-between gap-4">
        <div class="space-y-1.5">
            <CardTitle>Văn bản đã tải lên</CardTitle>
            <CardDescription>100 job gần nhất. Danh sách tự cập nhật khi còn job đang xử lý.</CardDescription>
        </div>
        <Button variant="outline" size="icon" aria-label="Làm mới danh sách" onclick={() => refresh()}>
            <RefreshCw class="size-4" />
        </Button>
    </CardHeader>

    <CardContent>
        {#if errorMessage}
            <p role="alert" class="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {errorMessage}
            </p>
        {/if}

        <Table.Root>
            <Table.Header>
                <Table.Row>
                    <Table.Head>Tệp</Table.Head>
                    <Table.Head>Tải lên</Table.Head>
                    <Table.Head>Dung lượng</Table.Head>
                    <Table.Head>Trạng thái</Table.Head>
                    <Table.Head class="text-right">Kết quả</Table.Head>
                </Table.Row>
            </Table.Header>

            <Table.Body>
                {#if loading}
                    <Table.Row>
                        <Table.Cell colspan={5} class="text-center text-muted-foreground">Đang tải danh sách...</Table.Cell>
                    </Table.Row>
                {:else if jobs.length === 0}
                    <Table.Row>
                        <Table.Cell colspan={5} class="text-center text-muted-foreground">Chưa có văn bản nào.</Table.Cell>
                    </Table.Row>
                {:else}
                    {#each jobs as job (job.id)}
                        <Table.Row>
                            <Table.Cell class="max-w-64">
                                <div class="truncate font-medium" title={job.filename}>{job.filename}</div>
                                <div class="text-xs text-muted-foreground">{job.id.slice(0, 8)}</div>
                            </Table.Cell>
                            <Table.Cell class="whitespace-nowrap">{formatDate(job.createdAt)}</Table.Cell>
                            <Table.Cell class="whitespace-nowrap">{formatSize(job.fileSize)}</Table.Cell>
                            <Table.Cell class="w-72 max-w-72 whitespace-normal">
                                <Badge variant={job.status === "failed" ? "destructive" : job.status === "completed" ? "default" : "secondary"}>
                                    {STATUS_LABELS[job.status]}
                                </Badge>

                                {#if isJobActive(job)}
                                    <div class="mt-2 flex items-center gap-2">
                                        <Progress value={job.progress} max={100} class="h-1.5" />
                                        <span class="text-xs text-muted-foreground">{job.progress}%</span>
                                    </div>
                                {:else if job.error}
                                    <p class="mt-1 line-clamp-2 text-xs text-muted-foreground" title={job.error}>{job.error}</p>
                                {/if}
                            </Table.Cell>
                            <Table.Cell class="text-right">
                                {#if job.status === "needs_review"}
                                    <Button variant="outline" size="sm" href={`/admin/review/${job.id}`}>
                                        <ClipboardCheck class="size-4" />
                                        Xem xét
                                    </Button>
                                {/if}

                                {#if hasDocument(job)}
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        href={`${backendUrl}/api/jobs/${job.id}/document`}
                                        target="_blank"
                                        rel="noopener"
                                    >
                                        <FileJson class="size-4" />
                                        JSON
                                    </Button>
                                {/if}
                            </Table.Cell>
                        </Table.Row>
                    {/each}
                {/if}
            </Table.Body>
        </Table.Root>
    </CardContent>
</Card>
