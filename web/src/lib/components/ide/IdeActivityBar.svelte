<script lang="ts">
    import { ideUi, type ActivityView } from "$lib/ide-ui.svelte";
    import { localSettings } from "$lib/local-settings.svelte";
    import { BugPlay, Files, GitBranch, Library, Moon, Network, Scale, Search, Settings, Sun } from "@lucide/svelte";
    import { onMount } from "svelte";

    const ACTIVITIES: { id: ActivityView; label: string; icon: typeof Files }[] = [
        { id: "explorer", label: "Explorer — Thư mục & Cấu trúc", icon: Files },
        { id: "search", label: "Find and Replace (Ctrl+Shift+F)", icon: Search },
        { id: "scm", label: "Source Control — Phiên bản & Diff", icon: GitBranch },
        { id: "debug", label: "Run and Debug — Tòa án giả lập (F5)", icon: BugPlay },
        { id: "library", label: "Library — Import bộ luật nền để xây dựng", icon: Library },
        { id: "relations", label: "Lược đồ quan hệ — Quan hệ & Hiệu lực văn bản", icon: Network },
        { id: "behaviors", label: "Hành vi — Danh mục hành vi & Lịch sử thay đổi", icon: Scale },
    ];

    let isDark = $state(true);

    onMount(() => {
        isDark = document.documentElement.classList.contains("dark");
    });

    function toggleTheme(): void {
        const nextDark = !isDark;
        isDark = nextDark;

        if (nextDark) {
            document.documentElement.classList.add("dark");
            localStorage.setItem("lexide-theme", "dark");
        } else {
            document.documentElement.classList.remove("dark");
            localStorage.setItem("lexide-theme", "light");
        }
    }
</script>

<aside
    aria-label="VS Code Activity Bar"
    class="flex shrink-0 items-center justify-between border-b bg-[var(--ide-chrome)] px-2 py-1 md:w-12 md:flex-col md:border-r md:border-b-0 md:px-0 md:py-1"
>
    <nav aria-label="Chế độ thanh bên" class="flex items-center gap-1 md:w-full md:flex-col md:gap-0">
        {#each ACTIVITIES as item (item.id)}
            {@const active = ideUi.sidebarOpen && ideUi.activeView === item.id}
            <button
                type="button"
                onclick={() => ideUi.selectView(item.id)}
                title={item.label}
                aria-pressed={active}
                class={`relative flex size-10 items-center justify-center transition-colors md:h-12 md:w-full ${
                    active
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                }`}
            >
                {#if active}
                    <span class="absolute top-0 bottom-0 left-0 hidden w-0.5 bg-primary md:block" aria-hidden="true"></span>
                    <span class="absolute right-1 bottom-0 left-1 h-0.5 bg-primary md:hidden" aria-hidden="true"></span>
                {/if}
                <item.icon class="size-[22px] stroke-[1.6]" aria-hidden="true" />
                {#if item.id === "scm" && ideUi.scmBadgeCount > 0}
                    <span class="absolute right-1.5 bottom-1.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[9px] font-bold text-primary-foreground">
                        {ideUi.scmBadgeCount}
                    </span>
                {:else if item.id === "relations" && ideUi.relationViolationCount > 0}
                    <span class="absolute right-1.5 bottom-1.5 flex min-w-4 items-center justify-center rounded-full bg-[var(--diag-logic)] px-1 font-mono text-[9px] font-bold text-white">
                        {ideUi.relationViolationCount}
                    </span>
                {/if}
                <span class="sr-only">{item.label}</span>
            </button>
        {/each}
    </nav>

    <div class="flex items-center gap-1 md:w-full md:flex-col md:gap-0">
        <button
            type="button"
            onclick={() => ideUi.openSettings()}
            title="Cài đặt Thư mục & API Token (Onboarding)"
            class="relative flex size-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground md:h-11 md:w-full"
        >
            <Settings class="size-[20px] stroke-[1.6]" aria-hidden="true" />
            {#if localSettings.hasApiKey}
                <span class="absolute right-2.5 bottom-2.5 size-2 rounded-full bg-[var(--diag-ok)]" title="Đã cấu hình API Token"></span>
            {/if}
            <span class="sr-only">Cài đặt</span>
        </button>

        <button
            type="button"
            onclick={toggleTheme}
            title={isDark ? "Chuyển sang VS Code Light Modern" : "Chuyển sang VS Code Dark Modern"}
            class="flex size-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground md:h-11 md:w-full"
        >
            {#if isDark}
                <Sun class="size-[20px] stroke-[1.6]" aria-hidden="true" />
                <span class="sr-only">Light Modern</span>
            {:else}
                <Moon class="size-[20px] stroke-[1.6]" aria-hidden="true" />
                <span class="sr-only">Dark Modern</span>
            {/if}
        </button>
    </div>
</aside>
