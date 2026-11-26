<script lang="ts">
    import { page } from "$app/state";
    import favicon from "$lib/assets/favicon.svg";
    import IdeActivityBar from "$lib/components/ide/IdeActivityBar.svelte";
    import SiteHeader from "$lib/components/SiteHeader.svelte";
    import { sessionStore } from "$lib/stores/session.svelte";
    import { onMount } from "svelte";
    import "./layout.css";

    let { children } = $props();

    const isWorkbench = $derived(page.url.pathname === "/");

    onMount(() => {
        if (!isWorkbench) {
            void sessionStore.init();
        }
    });
</script>

<svelte:head>
    <link rel="icon" href={favicon} />
</svelte:head>

{#if isWorkbench}
    <div class="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground md:flex-row">
        <IdeActivityBar />
        <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {@render children()}
        </div>
    </div>
{:else}
    <SiteHeader />
    <div class="ide-scroll min-h-0 min-w-0 flex-1 overflow-y-auto">
        {@render children()}
    </div>
{/if}
