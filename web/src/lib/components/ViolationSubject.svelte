<script lang="ts">
    import type { LineageContext } from "$lib/api/violations";
    import { Badge } from "$lib/components/ui/badge";
    import { shortVehicle, subjectLabel } from "$lib/labels";
    import { UserRound } from "@lucide/svelte";

    type Props = {
        context: LineageContext;
    };

    let { context }: Props = $props();

    const subject = $derived(subjectLabel(context.subject));
</script>

<span class="inline-flex flex-wrap items-center gap-1.5">
    {#if subject || context.vehicles.length === 0}
        <span class="inline-flex items-center gap-1.5 font-medium text-foreground">
            <UserRound class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {subject ?? "Mọi phương tiện và đối tượng"}
        </span>
    {/if}

    {#each context.vehicles as vehicle (vehicle)}
        <Badge variant="outline" title={vehicle}>{shortVehicle(vehicle)}</Badge>
    {/each}
</span>
