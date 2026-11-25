<script lang="ts">
    import { Badge } from "$lib/components/ui/badge";
    import { Button } from "$lib/components/ui/button";
    import { sessionStore } from "$lib/stores/session.svelte";
    import {
        BookOpen,
        FilePenLine,
        FolderKanban,
        GitCompareArrows,
        MessageCircleQuestion,
        Network,
        Scale,
        TrendingUp,
        Upload,
    } from "@lucide/svelte";

    const capabilities = [
        {
            href: "/drafting",
            icon: FilePenLine,
            badge: "Chế độ Manual",
            title: "Soạn thảo văn bản quy phạm",
            description:
                "Tự khởi tạo dự thảo, chèn cây Chương → Mục → Điều → Khoản → Điểm chuẩn thể thức, chỉnh sửa trực tiếp và xem trước văn bản.",
        },
        {
            href: "/graph",
            icon: Network,
            badge: "2 chế độ cạnh",
            title: "Lược đồ tác động & Biến động xử phạt",
            description:
                "Chuyển đổi giữa Chế độ 1 (Tăng nặng / Giảm nhẹ mức xử lý hành vi) và Chế độ 2 (Luật nào ảnh hưởng luật nào), hỗ trợ nối cạnh AI và thủ công.",
        },
        {
            href: "/workspaces",
            icon: FolderKanban,
            badge: "Đa Workspace",
            title: "Không gian làm việc độc lập",
            description:
                "Mỗi tài khoản quản lý nhiều Workspace tách biệt hoàn toàn về bộ văn bản, khung xử phạt và đồ thị quan hệ cho từng dự án luật.",
        },
        {
            href: "/admin",
            icon: Upload,
            badge: "Tự động AI",
            title: "Nhập PDF & Trích xuất tự động",
            description:
                "Tải lên văn bản hiện hành để AI tự bóc tách Điều/Khoản/Điểm, trích xuất khung phạt và tự động nối quan hệ vào Workspace.",
        },
        {
            href: "/violations",
            icon: TrendingUp,
            badge: "Đối chiếu lịch sử",
            title: "Khung xử phạt & Lịch sử hiệu lực",
            description:
                "Theo dõi tiến hóa mức phạt của từng hành vi qua các nghị định theo mốc thời gian (as-of) để cân đối chính sách hình phạt.",
        },
        {
            href: "/ask",
            icon: MessageCircleQuestion,
            badge: "Rà soát AI",
            title: "Trợ lý rà soát chồng chéo & căn cứ",
            description:
                "Hỏi đáp trực tiếp trên tập văn bản của Workspace để kiểm tra quy định mâu thuẫn, căn cứ pháp lý và tác động sửa đổi kèm trích dẫn.",
        },
    ];

    const activeWorkspace = $derived(sessionStore.activeWorkspace);
</script>

<svelte:head>
    <title>Soạn Luật Studio — Hệ thống hỗ trợ Nhà soạn luật</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-10 sm:px-6 sm:py-14">
    <section aria-labelledby="hero-heading" class="flex flex-col gap-6 rounded-3xl border bg-card p-6 shadow-xs sm:p-10">
        <div class="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" class="gap-1.5 px-3 py-1">
                <Scale class="size-3.5" aria-hidden="true" />
                Nền tảng dành cho Nhà soạn luật
            </Badge>
            {#if activeWorkspace}
                <Badge variant="outline" class="gap-1.5 px-3 py-1">
                    <FolderKanban class="size-3.5" aria-hidden="true" />
                    Workspace: {activeWorkspace.name}
                </Badge>
            {/if}
        </div>

        <div class="flex max-w-3xl flex-col gap-3">
            <h1 id="hero-heading" class="text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
                Soạn thảo văn bản pháp luật, nối lược đồ và đánh giá tác động xử phạt trên một nền tảng
            </h1>
            <p class="text-base text-pretty text-muted-foreground sm:text-lg">
                Kết hợp sức mạnh tự động hóa của AI (trích xuất điều khoản, phát hiện tăng nặng/giảm nhẹ khung phạt) với chế độ soạn thảo thủ công chính xác đến từng Điều, Khoản, Điểm.
            </p>
        </div>

        <div class="flex flex-wrap gap-3">
            {#if sessionStore.user}
                <Button href="/drafting" size="lg" class="gap-2">
                    <FilePenLine class="size-4" aria-hidden="true" />
                    Mở bàn soạn thảo (Manual)
                </Button>
                <Button href="/graph" size="lg" variant="outline" class="gap-2">
                    <GitCompareArrows class="size-4" aria-hidden="true" />
                    Xem lược đồ 2 chế độ
                </Button>
                <Button href="/workspaces" size="lg" variant="ghost" class="gap-2">
                    <FolderKanban class="size-4" aria-hidden="true" />
                    Quản lý Workspaces
                </Button>
            {:else}
                <Button href="/login" size="lg" class="gap-2">
                    Đăng nhập / Tạo tài khoản
                </Button>
                <Button href="/graph" size="lg" variant="outline" class="gap-2">
                    <Network class="size-4" aria-hidden="true" />
                    Xem lược đồ tác động
                </Button>
            {/if}
        </div>

        {#if activeWorkspace}
            <div class="mt-2 grid grid-cols-2 gap-3 border-t pt-6 sm:grid-cols-4">
                <div class="rounded-xl border bg-background p-4">
                    <div class="text-xs text-muted-foreground">Văn bản trong Workspace</div>
                    <div class="mt-1 text-2xl font-semibold">{activeWorkspace.stats.documentCount}</div>
                </div>
                <div class="rounded-xl border bg-background p-4">
                    <div class="text-xs text-muted-foreground">Điều / Khoản / Điểm</div>
                    <div class="mt-1 text-2xl font-semibold">{activeWorkspace.stats.provisionCount}</div>
                </div>
                <div class="rounded-xl border bg-background p-4">
                    <div class="text-xs text-muted-foreground">Cạnh ảnh hưởng văn bản</div>
                    <div class="mt-1 text-2xl font-semibold">{activeWorkspace.stats.relationCount}</div>
                </div>
                <div class="rounded-xl border bg-background p-4">
                    <div class="text-xs text-muted-foreground">Cạnh biến động xử phạt</div>
                    <div class="mt-1 text-2xl font-semibold text-destructive">{activeWorkspace.stats.sanctionChangeCount}</div>
                </div>
            </div>
        {/if}
    </section>

    <section aria-labelledby="toolkit-heading" class="flex flex-col gap-5">
        <div class="flex flex-col gap-1">
            <h2 id="toolkit-heading" class="text-xl font-semibold tracking-tight">Bộ chức năng dành cho Nhà soạn luật</h2>
            <p class="text-sm text-muted-foreground">
                Quy trình khép kín từ khởi tạo Workspace, soạn thảo dự thảo, nhập văn bản hiện hành bằng AI đến đối chiếu biến động chế tài.
            </p>
        </div>

        <ul class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {#each capabilities as item (item.href)}
                <li>
                    <a
                        href={item.href}
                        class="group flex h-full flex-col gap-3 rounded-2xl border bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                        <div class="flex items-center justify-between">
                            <span class="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                                <item.icon class="size-5" aria-hidden="true" />
                            </span>
                            <Badge variant="outline" class="text-[11px]">{item.badge}</Badge>
                        </div>
                        <span class="text-base font-semibold">{item.title}</span>
                        <span class="text-sm text-muted-foreground">{item.description}</span>
                    </a>
                </li>
            {/each}
        </ul>
    </section>

    <footer class="flex flex-col gap-2 border-t pt-6 text-sm text-muted-foreground sm:flex-row sm:justify-between">
        <p class="flex items-center gap-1.5">
            <BookOpen class="size-4" aria-hidden="true" />
            Soạn Luật Studio — Dữ liệu cô lập theo từng Workspace của tài khoản.
        </p>
        <div class="flex gap-4">
            <a href="/documents" class="underline underline-offset-4 hover:text-foreground">Kho văn bản</a>
            <a href="/admin" class="underline underline-offset-4 hover:text-foreground">Nhập PDF bằng AI</a>
        </div>
    </footer>
</main>
