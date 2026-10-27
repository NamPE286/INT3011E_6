<script lang="ts">
    import { page } from "$app/state";

    const links = [
        { href: "/documents", label: "Văn bản pháp luật" },
        { href: "/violations", label: "Hành vi vi phạm" },
        { href: "/ask", label: "Hỏi đáp AI" },
        { href: "/admin", label: "Quản trị" },
    ];

    function isCurrent(href: string): boolean {
        return page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
    }
</script>

<header class="border-b bg-background">
    <div class="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
        <a href="/" class="text-base font-semibold tracking-tight">
            Tra cứu xử phạt giao thông
        </a>

        <nav aria-label="Điều hướng chính">
            <ul class="flex flex-wrap gap-4 text-sm">
                {#each links as link (link.href)}
                    <li>
                        <a
                            href={link.href}
                            aria-current={isCurrent(link.href) ? "page" : undefined}
                            class="text-muted-foreground hover:text-foreground aria-[current=page]:font-medium aria-[current=page]:text-foreground"
                        >
                            {link.label}
                        </a>
                    </li>
                {/each}
            </ul>
        </nav>
    </div>
</header>
