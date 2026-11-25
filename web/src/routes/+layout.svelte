<script lang="ts">
    import "./layout.css";
    import { onMount } from "svelte";
    import favicon from "$lib/assets/favicon.svg";
    import SiteHeader from "$lib/components/SiteHeader.svelte";
    import { sessionStore } from "$lib/stores/session.svelte";

    let { children } = $props();

    onMount(() => {
        void sessionStore.init();
    });
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<SiteHeader />
{@render children()}
