<script lang="ts">
    import { page } from "$app/state";
    import { Scale } from "@lucide/svelte";

    const links = [
        { href: "/violations", label: "Hành vi vi phạm" },
        { href: "/documents", label: "Văn bản" },
        { href: "/graph", label: "Đồ thị quan hệ" },
        { href: "/ask", label: "Hỏi đáp AI" },
    ];

    function isCurrent(href: string): boolean {
        return page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
    }
</script>

<header class="sticky top-0 z-30 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
    <div class="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 px-4 sm:px-6 md:flex-nowrap">
        <a href="/" class="flex shrink-0 items-center gap-2 py-3 font-semibold tracking-tight">
            <span class="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Scale class="size-4" aria-hidden="true" />
            </span>
            <span class="hidden sm:inline">Tra cứu xử phạt giao thông</span>
            <span class="sm:hidden">Tra cứu xử phạt</span>
        </a>

        <nav aria-label="Điều hướng chính" class="-mx-1 order-last w-full min-w-0 overflow-x-auto pb-2 md:order-none md:w-auto md:flex-1 md:pb-0">
            <ul class="flex w-max gap-1 px-1 text-sm">
                {#each links as link (link.href)}
                    <li>
                        <a
                            href={link.href}
                            aria-current={isCurrent(link.href) ? "page" : undefined}
                            class="block rounded-md px-3 py-2 whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-accent-foreground"
                        >
                            {link.label}
                        </a>
                    </li>
                {/each}
            </ul>
        </nav>

        <a
            href="/admin"
            aria-current={isCurrent("/admin") ? "page" : undefined}
            class="ml-auto shrink-0 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground aria-[current=page]:font-medium aria-[current=page]:text-foreground"
        >
            Quản trị
        </a>
    </div>
</header>
