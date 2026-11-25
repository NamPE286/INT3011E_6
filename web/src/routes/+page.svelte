<script lang="ts">
    import { Badge } from "$lib/components/ui/badge";
    import { Button } from "$lib/components/ui/button";
    import { sessionStore } from "$lib/stores/session.svelte";
    import {
        BookOpen,
        FilePenLine,
        FolderKanban,
        GitCompareArrows,
        Layers,
        Network,
        Scale,
        ShieldCheck,
        Upload,
    } from "@lucide/svelte";

    const capabilities = [
        {
            href: "/drafting",
            icon: FilePenLine,
            badge: "Soạn thảo cấu trúc",
            title: "Soạn thảo văn bản quy phạm pháp luật",
            description:
                "Khởi tạo dự thảo, chèn cây Chương → Mục → Điều → Khoản → Điểm chuẩn thể thức, chỉnh sửa trực tiếp, soát logic ngay khi soạn và xem trước văn bản.",
        },
        {
            href: "/audit",
            icon: ShieldCheck,
            badge: "16 quy tắc tất định",
            title: "Soát logic luật tự động",
            description:
                "Phát hiện lỗi kết cấu/đánh số, sai thứ tự hiệu lực, sửa văn bản đã bị bãi bỏ, chu trình mâu thuẫn, dẫn chiếu treo và xung đột khung chế tài ngầm.",
        },
        {
            href: "/audit?tab=impact",
            icon: Layers,
            badge: "Trực tiếp & dây chuyền",
            title: "Phân tích phạm vi tác động",
            description:
                "Xác định văn bản và Điều/Khoản/Điểm bị tác động trực tiếp, lan truyền dây chuyền sang thông tư hướng dẫn, biến động mức phạt và danh mục cần sửa đồng bộ.",
        },
        {
            href: "/graph",
            icon: Network,
            badge: "2 chế độ cạnh",
            title: "Lược đồ tác động & Biến động xử phạt",
            description:
                "Chuyển đổi giữa Chế độ 1 (Tăng nặng / Giảm nhẹ mức xử lý hành vi) và Chế độ 2 (Luật nào sửa đổi/thay thế/bãi bỏ luật nào), hỗ trợ nối cạnh AI và thủ công.",
        },
        {
            href: "/workspaces",
            icon: FolderKanban,
            badge: "Đa Workspace",
            title: "Không gian làm việc độc lập",
            description:
                "Mỗi tài khoản quản lý nhiều Workspace tách biệt hoàn toàn về dự thảo, văn bản hiện hành, kết quả soát logic và đồ thị quan hệ cho từng chuyên đề luật.",
        },
        {
            href: "/admin",
            icon: Upload,
            badge: "Tự động AI",
            title: "Nhập PDF hiện hành & Trợ lý rà soát AI",
            description:
                "Tải lên PDF văn bản hiện hành để AI bóc tách Điều/Khoản/Điểm, tự nối quan hệ vào Workspace và hỗ trợ hỏi đáp kiểm chứng căn cứ có trích dẫn.",
        },
    ];

    const activeWorkspace = $derived(sessionStore.activeWorkspace);
</script>

<svelte:head>
    <title>Soạn Luật Studio — Soạn thảo Luật, Soát Logic & Phân tích Phạm vi Tác động</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-10 sm:px-6 sm:py-14">
    <section aria-labelledby="hero-heading" class="flex flex-col gap-6 rounded-3xl border bg-card p-6 shadow-xs sm:p-10">
        <div class="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" class="gap-1.5 px-3 py-1">
                <Scale class="size-3.5" aria-hidden="true" />
                Nền tảng Soạn thảo · Soát Logic · Đánh giá Tác động
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
                Soạn thảo văn bản pháp luật kèm soát logic luật và phân tích phạm vi tác động
            </h1>
            <p class="text-base text-pretty text-muted-foreground sm:text-lg">
                Soạn thảo cấu trúc Điều/Khoản/Điểm chính xác, tự động phát hiện mâu thuẫn hiệu lực, dẫn chiếu treo và xung đột quy phạm, đồng thời mô phỏng phạm vi tác động trực tiếp lẫn dây chuyền trước khi ban hành.
            </p>
        </div>

        <div class="flex flex-wrap gap-3">
            {#if sessionStore.user}
                <Button href="/drafting" size="lg" class="gap-2">
                    <FilePenLine class="size-4" aria-hidden="true" />
                    Mở bàn soạn thảo
                </Button>
                <Button href="/audit" size="lg" variant="outline" class="gap-2">
                    <ShieldCheck class="size-4" aria-hidden="true" />
                    Soát logic & Phạm vi tác động
                </Button>
                <Button href="/graph" size="lg" variant="ghost" class="gap-2">
                    <GitCompareArrows class="size-4" aria-hidden="true" />
                    Xem lược đồ 2 chế độ
                </Button>
            {:else}
                <Button href="/login" size="lg" class="gap-2">
                    Đăng nhập / Tạo tài khoản
                </Button>
                <Button href="/audit" size="lg" variant="outline" class="gap-2">
                    <ShieldCheck class="size-4" aria-hidden="true" />
                    Xem Soát logic & Tác động
                </Button>
                <Button href="/graph" size="lg" variant="ghost" class="gap-2">
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
