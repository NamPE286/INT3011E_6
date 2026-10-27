<script lang="ts">
    import FileProcessor from "$lib/components/FileProcessor.svelte";
    import JobList from "$lib/components/JobList.svelte";

    let jobList = $state<ReturnType<typeof JobList> | null>(null);
</script>

<svelte:head>
    <title>Nhập văn bản pháp luật</title>
</svelte:head>

<!-- TODO(#4): restrict this admin page once authentication is implemented. -->
<main class="mx-auto flex w-full max-w-6xl flex-col gap-6 bg-muted/30 p-6">
    <header>
        <h1 class="text-2xl font-semibold tracking-tight">Nhập văn bản pháp luật giao thông</h1>
        <p class="text-sm text-muted-foreground">
            Tải lên PDF (kể cả bản scan); hệ thống chuyển sang JSON có cấu trúc Chương / Mục / Điều / Khoản / Điểm.
        </p>
    </header>

    <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <FileProcessor onjobchange={() => jobList?.refresh()} />
        <JobList bind:this={jobList} />
    </div>
</main>
