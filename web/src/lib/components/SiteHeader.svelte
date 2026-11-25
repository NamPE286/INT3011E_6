<script lang="ts">
    import { goto } from "$app/navigation";
    import { page } from "$app/state";
    import { FolderKanban, LogIn, LogOut, Scale } from "@lucide/svelte";
    import { sessionStore } from "$lib/stores/session.svelte";

    const links = [
        { href: "/drafting", label: "Soạn thảo" },
        { href: "/audit", label: "Soát logic & Tác động" },
        { href: "/graph", label: "Lược đồ tác động" },
        { href: "/documents", label: "Kho văn bản" },
        { href: "/violations", label: "Khung xử phạt" },
        { href: "/ask", label: "Trợ lý AI" },
        { href: "/admin", label: "Nhập AI" },
    ];

    function isCurrent(href: string): boolean {
        return page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
    }

    async function handleWorkspaceChange(event: Event): Promise<void> {
        const select = event.currentTarget as HTMLSelectElement;
        const nextId = select.value;

        if (nextId === "__manage__") {
            await goto("/workspaces");

            return;
        }

        sessionStore.selectWorkspace(nextId);

        if (typeof window !== "undefined") {
            window.location.reload();
        }
    }

    async function handleSignOut(): Promise<void> {
        await sessionStore.signOut();
        await goto("/login");
    }
</script>

<header class="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
    <div class="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-4 sm:px-6 lg:flex-nowrap">
        <a href="/" class="flex shrink-0 items-center gap-2 py-3 font-semibold tracking-tight">
            <span class="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Scale class="size-4" aria-hidden="true" />
            </span>
            <span class="flex flex-col leading-none">
                <span class="text-sm font-semibold">Soạn Luật Studio</span>
                <span class="text-[10px] font-normal text-muted-foreground">Dành cho nhà soạn luật</span>
            </span>
        </a>

        {#if sessionStore.user && sessionStore.workspaces.length > 0}
            <div class="flex items-center gap-1.5 rounded-lg border bg-muted/40 px-2 py-1 text-xs">
                <FolderKanban class="size-3.5 text-muted-foreground" aria-hidden="true" />
                <label for="workspace-switcher" class="sr-only">Chọn không gian làm việc</label>
                <select
                    id="workspace-switcher"
                    class="max-w-44 bg-transparent font-medium outline-none"
                    value={sessionStore.activeWorkspaceId ?? ""}
                    onchange={handleWorkspaceChange}
                >
                    {#each sessionStore.workspaces as ws (ws.id)}
                        <option value={ws.id}>{ws.name}</option>
                    {/each}
                    <option value="__manage__">+ Quản lý workspace…</option>
                </select>
            </div>
        {/if}

        <nav aria-label="Điều hướng chính" class="-mx-1 order-last w-full min-w-0 overflow-x-auto pb-2 lg:order-none lg:w-auto lg:flex-1 lg:pb-0">
            <ul class="flex w-max gap-0.5 px-1 text-[13px]">
                {#each links as link (link.href)}
                    <li>
                        <a
                            href={link.href}
                            aria-current={isCurrent(link.href) ? "page" : undefined}
                            class="block rounded-md px-2 py-1.5 whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-accent-foreground"
                        >
                            {link.label}
                        </a>
                    </li>
                {/each}
            </ul>
        </nav>

        <div class="ml-auto flex shrink-0 items-center gap-2 text-sm">
            {#if sessionStore.user}
                <a
                    href="/workspaces"
                    aria-current={isCurrent("/workspaces") ? "page" : undefined}
                    class="hidden rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground sm:inline-block aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground"
                >
                    Workspaces ({sessionStore.workspaces.length})
                </a>
                <span class="hidden max-w-32 truncate text-xs text-muted-foreground md:inline" title={sessionStore.user.email}>
                    {sessionStore.user.name}
                </span>
                <button
                    type="button"
                    onclick={handleSignOut}
                    class="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                    <LogOut class="size-3.5" aria-hidden="true" />
                    Đăng xuất
                </button>
            {:else}
                <a
                    href="/login"
                    class="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
                >
                    <LogIn class="size-3.5" aria-hidden="true" />
                    Đăng nhập
                </a>
            {/if}
        </div>
    </div>
</header>
