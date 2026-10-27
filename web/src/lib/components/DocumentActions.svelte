<script lang="ts">
    import type { DocumentAction } from "$lib/api/review";
    import { Badge } from "$lib/components/ui/badge";

    let { actions }: { actions: DocumentAction[] } = $props();
</script>

{#if actions.length === 0}
    <p class="text-sm text-muted-foreground" role="status">Chưa trích xuất hành vi vi phạm nào cho văn bản này.</p>
{:else}
    <ul class="flex flex-col gap-2">
        {#each actions as action (action.ruleId)}
            <li class="flex flex-col gap-1 rounded-md border p-3 text-sm">
                <p>{action.behaviorText}</p>
                <div class="flex flex-wrap items-center gap-2">
                    {#if action.actionLabel}
                        <Badge variant="outline">{action.actionLabel}</Badge>
                    {:else}
                        <span class="text-xs text-muted-foreground">Chưa xác định hành vi</span>
                    {/if}
                    {#if action.vocabId}
                        <code class="text-xs text-muted-foreground">{action.vocabId}</code>
                    {:else if action.actionLabel}
                        <span class="text-xs text-muted-foreground">Chưa có trong từ vựng</span>
                    {/if}
                </div>
            </li>
        {/each}
    </ul>
{/if}
