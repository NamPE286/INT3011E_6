<script lang="ts">
    import type { Snippet } from "svelte";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { Search } from "@lucide/svelte";

    type Props = {
        action: string;
        label: string;
        placeholder: string;
        value?: string;
        filters?: Snippet;
    };

    let { action, label, placeholder, value = "", filters }: Props = $props();
</script>

<form method="GET" {action} role="search" class="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm sm:flex-row sm:items-end">
    <div class="flex flex-1 flex-col gap-1.5">
        <label for="search-query" class="text-sm font-medium">{label}</label>
        <div class="relative">
            <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input id="search-query" name="q" type="search" {placeholder} {value} autocomplete="off" class="pl-9" />
        </div>
    </div>

    {@render filters?.()}

    <Button type="submit">Tìm kiếm</Button>
</form>
