<script lang="ts">
    import { goto } from "$app/navigation";
    import { Badge } from "$lib/components/ui/badge";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { sessionStore } from "$lib/stores/session.svelte";
    import { CheckCircle2, FolderKanban, Plus, Trash2 } from "@lucide/svelte";

    let newName = $state("");
    let newDescription = $state("");
    let newDomain = $state("traffic");
    let seedSample = $state(false);
    let creating = $state(false);
    let errorMessage = $state<string | null>(null);

    const DOMAINS = [
        { value: "traffic", label: "Giao thông & Xử phạt VPHC" },
        { value: "tax", label: "Thuế & Tài chính công" },
        { value: "labor", label: "Lao động & An sinh" },
        { value: "environment", label: "Môi trường & Xây dựng" },
        { value: "general", label: "Đa lĩnh vực / Chung" },
    ];

    async function handleCreate(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        errorMessage = null;

        if (!newName.trim()) {
            errorMessage = "Vui lòng nhập tên Workspace";

            return;
        }

        creating = true;

        try {
            await sessionStore.createWorkspace({
                name: newName.trim(),
                description: newDescription.trim() || null,
                domain: newDomain,
                seedSample,
            });
            newName = "";
            newDescription = "";
            seedSample = false;
        } catch (err: unknown) {
            errorMessage = err instanceof Error ? err.message : "Không thể tạo Workspace";
        } finally {
            creating = false;
        }
    }

    async function handleSwitch(workspaceId: string): Promise<void> {
        sessionStore.selectWorkspace(workspaceId);
        await goto("/drafting");
    }

    async function handleDelete(workspaceId: string): Promise<void> {
        errorMessage = null;

        try {
            await sessionStore.deleteWorkspace(workspaceId);
        } catch (err: unknown) {
            errorMessage = err instanceof Error ? err.message : "Không thể xóa Workspace";
        }
    }
</script>

<svelte:head>
    <title>Quản lý Workspaces — Soạn Luật Studio</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
    <header class="flex flex-col gap-2">
        <h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">Không gian làm việc (Workspaces)</h1>
        <p class="text-sm text-muted-foreground">
            Mỗi Workspace là một instance độc lập có kho văn bản, điều khoản và lược đồ quan hệ riêng biệt. Dùng mỗi Workspace cho một dự án luật hoặc chuyên đề sửa đổi.
        </p>
    </header>

    {#if !sessionStore.user}
        <section class="flex flex-col items-start gap-4 rounded-2xl border bg-card p-6">
            <p class="text-sm text-muted-foreground">Bạn cần đăng nhập để tạo và quản lý các Workspace riêng của tài khoản.</p>
            <Button href="/login">Đăng nhập / Tạo tài khoản</Button>
        </section>
    {:else}
        <section class="rounded-2xl border bg-card p-6 shadow-xs" aria-labelledby="create-ws-heading">
            <h2 id="create-ws-heading" class="mb-4 flex items-center gap-2 text-lg font-semibold">
                <Plus class="size-5 text-primary" aria-hidden="true" />
                Tạo Workspace mới
            </h2>

            <form class="grid gap-4 md:grid-cols-2" onsubmit={handleCreate}>
                <label class="flex flex-col gap-1.5 text-sm">
                    <span class="font-medium">Tên dự án / Workspace</span>
                    <Input bind:value={newName} required placeholder="VD: Dự thảo Luật Bảo vệ Dữ liệu 2026" />
                </label>

                <label class="flex flex-col gap-1.5 text-sm">
                    <span class="font-medium">Lĩnh vực lập pháp</span>
                    <select
                        bind:value={newDomain}
                        class="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring"
                    >
                        {#each DOMAINS as item (item.value)}
                            <option value={item.value}>{item.label}</option>
                        {/each}
                    </select>
                </label>

                <label class="flex flex-col gap-1.5 text-sm md:col-span-2">
                    <span class="font-medium">Mô tả phạm vi soạn thảo</span>
                    <Input bind:value={newDescription} placeholder="Ghi chú ngắn về mục tiêu sửa đổi, phạm vi văn bản liên quan..." />
                </label>

                <label class="flex items-center gap-2 text-sm md:col-span-2">
                    <input type="checkbox" class="size-4 accent-primary" bind:checked={seedSample} />
                    <span>Khởi tạo kèm bộ dữ liệu mẫu (NĐ 100/2019 → NĐ 123/2021 → NĐ 168/2024 → Dự thảo 2026) để trải nghiệm ngay</span>
                </label>

                {#if errorMessage}
                    <p class="text-sm text-destructive md:col-span-2" role="alert">{errorMessage}</p>
                {/if}

                <div class="md:col-span-2">
                    <Button type="submit" disabled={creating}>
                        {creating ? "Đang khởi tạo…" : "Tạo Workspace độc lập"}
                    </Button>
                </div>
            </form>
        </section>

        <section class="flex flex-col gap-4" aria-labelledby="ws-list-heading">
            <h2 id="ws-list-heading" class="text-lg font-semibold">
                Danh sách Workspace của {sessionStore.user.name} ({sessionStore.workspaces.length})
            </h2>

            <div class="grid gap-4 md:grid-cols-2">
                {#each sessionStore.workspaces as ws (ws.id)}
                    {@const isActive = ws.id === sessionStore.activeWorkspaceId}
                    <article class={`flex flex-col justify-between gap-4 rounded-2xl border bg-card p-5 transition-all ${isActive ? "border-primary ring-1 ring-primary/30" : ""}`}>
                        <div class="flex flex-col gap-2">
                            <div class="flex items-start justify-between gap-2">
                                <div class="flex items-center gap-2">
                                    <FolderKanban class="size-5 text-primary" aria-hidden="true" />
                                    <h3 class="text-base font-semibold">{ws.name}</h3>
                                </div>
                                {#if isActive}
                                    <Badge variant="default" class="gap-1">
                                        <CheckCircle2 class="size-3" aria-hidden="true" />
                                        Đang mở
                                    </Badge>
                                {:else}
                                    <Badge variant="outline">{ws.domain}</Badge>
                                {/if}
                            </div>

                            {#if ws.description}
                                <p class="text-sm text-muted-foreground">{ws.description}</p>
                            {/if}

                            <div class="mt-2 grid grid-cols-2 gap-2 rounded-xl bg-muted/50 p-3 text-xs sm:grid-cols-4">
                                <div>
                                    <div class="text-muted-foreground">Văn bản</div>
                                    <div class="text-base font-semibold">{ws.stats.documentCount}</div>
                                </div>
                                <div>
                                    <div class="text-muted-foreground">Điều khoản</div>
                                    <div class="text-base font-semibold">{ws.stats.provisionCount}</div>
                                </div>
                                <div>
                                    <div class="text-muted-foreground">Ảnh hưởng</div>
                                    <div class="text-base font-semibold">{ws.stats.relationCount}</div>
                                </div>
                                <div>
                                    <div class="text-muted-foreground">Biến động phạt</div>
                                    <div class="text-base font-semibold">{ws.stats.sanctionChangeCount}</div>
                                </div>
                            </div>
                        </div>

                        <div class="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                            <div class="flex gap-2">
                                <Button size="sm" variant={isActive ? "secondary" : "default"} onclick={() => handleSwitch(ws.id)}>
                                    {isActive ? "Vào bàn soạn thảo" : "Chuyển sang Workspace này"}
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onclick={() => {
                                        sessionStore.selectWorkspace(ws.id);
                                        void goto("/graph");
                                    }}
                                >
                                    Mở lược đồ
                                </Button>
                            </div>

                            {#if sessionStore.workspaces.length > 1}
                                <button
                                    type="button"
                                    onclick={() => handleDelete(ws.id)}
                                    class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                                >
                                    <Trash2 class="size-3.5" aria-hidden="true" />
                                    Xóa
                                </button>
                            {/if}
                        </div>
                    </article>
                {/each}
            </div>
        </section>
    {/if}
</main>
