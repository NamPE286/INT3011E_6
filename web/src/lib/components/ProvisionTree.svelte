<script lang="ts">
    import Self from "./ProvisionTree.svelte";
    import type { Amendment, ProvisionNode } from "$lib/api/documents";
    import { Badge } from "$lib/components/ui/badge";
    import { formatDate } from "$lib/format";
    import { AMENDMENT_LABELS, provisionHref, provisionLabel } from "$lib/labels";

    type Props = {
        nodes: ProvisionNode[];
        amendments: Map<string, Amendment[]>;
    };

    let { nodes, amendments }: Props = $props();

    function sourceName(amendment: Amendment): string {
        return amendment.fromDocumentNumber ?? amendment.fromDocumentTitle ?? amendment.fromDocumentId;
    }
</script>

<ol class="flex flex-col gap-3">
    {#each nodes as node (node.provision.id)}
        {@const provision = node.provision}
        {@const notes = amendments.get(provision.id) ?? []}
        <li id={provision.id} class="scroll-mt-20 target:rounded-lg target:bg-muted/60">
            <div class="flex flex-col gap-1.5">
                <p class="text-sm">
                    <span class="font-semibold">{provisionLabel(provision)}</span>
                    {#if provision.title}
                        <span class="font-semibold">{provision.title}</span>
                    {/if}
                </p>

                {#if provision.text}
                    {#if provision.contentRole === "QUOTED_NEW_TEXT"}
                        <blockquote class="border-l-2 pl-3 text-sm whitespace-pre-line text-muted-foreground">
                            <span class="mb-1 block text-xs font-medium">Nội dung mới do văn bản này quy định cho văn bản khác</span>
                            {provision.text}
                        </blockquote>
                    {:else}
                        <p class="text-sm whitespace-pre-line">{provision.text}</p>
                    {/if}
                {/if}

                {#each notes as amendment (amendment.relationId)}
                    <div class="rounded-lg border bg-muted/30 p-2 text-sm">
                        <Badge variant={amendment.verificationStatus === "ACCEPTED" ? "destructive" : "outline"}>
                            {AMENDMENT_LABELS[amendment.relationType]}{amendment.verificationStatus === "CANDIDATE" ? " (chưa xác minh)" : ""}
                        </Badge>
                        bởi
                        <a href={provisionHref(amendment.fromDocumentId, amendment.fromProvisionId)} class="underline underline-offset-4">
                            {sourceName(amendment)}
                        </a>
                        {#if amendment.effectiveFrom}
                            · hiệu lực từ {formatDate(amendment.effectiveFrom)}
                        {/if}

                        {#if amendment.evidenceText}
                            <details class="mt-1">
                                <summary class="cursor-pointer text-muted-foreground">Căn cứ</summary>
                                <blockquote class="mt-1 border-l-2 pl-3 whitespace-pre-line">{amendment.evidenceText}</blockquote>
                            </details>
                        {/if}
                    </div>
                {/each}
            </div>

            {#if node.children.length > 0}
                <div class="mt-2 ml-4 border-l pl-4">
                    <Self nodes={node.children} {amendments} />
                </div>
            {/if}
        </li>
    {/each}
</ol>
