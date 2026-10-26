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

<form method="GET" {action} role="search" class="flex flex-col gap-3 sm:flex-row sm:items-end">
    <div class="flex flex-1 flex-col gap-1.5">
        <label for="search-query" class="text-sm font-medium">{label}</label>
        <Input id="search-query" name="q" type="search" {placeholder} {value} autocomplete="off" />
    </div>

    {@render filters?.()}

    <Button type="submit">
        <Search aria-hidden="true" />
        Tìm kiếm
    </Button>
</form>
