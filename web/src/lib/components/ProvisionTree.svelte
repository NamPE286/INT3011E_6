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

    const INLINE_LEVELS = new Set(["CLAUSE", "POINT"]);

    function sourceName(amendment: Amendment): string {
        return amendment.fromDocumentNumber ?? amendment.fromDocumentTitle ?? amendment.fromDocumentId;
    }

    function isRepealed(notes: Amendment[]): boolean {
        return notes.some((amendment) => amendment.relationType === "REPEALS" && amendment.verificationStatus === "ACCEPTED");
    }
</script>

<ol class="flex flex-col gap-3">
    {#each nodes as node (node.provision.id)}
        {@const provision = node.provision}
        {@const notes = amendments.get(provision.id) ?? []}
        {@const repealed = isRepealed(notes)}
        {@const inline = INLINE_LEVELS.has(provision.level)}
        <li
            id={provision.id}
            class={`scroll-mt-24 rounded-lg target:bg-accent/50 target:ring-2 target:ring-accent ${notes.length > 0 ? "border-l-4 border-destructive/70 pl-3" : ""}`}
        >
            <div class="flex flex-col gap-1.5">
                {#if inline}
                    <p class={`text-sm leading-relaxed whitespace-pre-line ${repealed ? "text-muted-foreground line-through decoration-destructive/60" : ""}`}>
                        <span class="font-semibold">{provisionLabel(provision)}</span>
                        {#if provision.contentRole !== "QUOTED_NEW_TEXT"}{provision.text ?? ""}{/if}
                    </p>
                {:else}
                    <p class={provision.level === "ARTICLE" ? "pt-2 text-base font-semibold" : "text-sm font-semibold"}>
                        {provisionLabel(provision)}{provision.title ? `. ${provision.title}` : ""}
                    </p>
                {/if}

                {#if provision.text && (!inline || provision.contentRole === "QUOTED_NEW_TEXT")}
                    {#if provision.contentRole === "QUOTED_NEW_TEXT"}
                        <blockquote class="rounded-r-lg border-l-2 border-primary/40 bg-muted/50 py-2 pr-3 pl-3 text-sm whitespace-pre-line">
                            <span class="mb-1 block text-xs font-medium text-muted-foreground">Nội dung mới văn bản này quy định cho văn bản khác</span>
                            {provision.text}
                        </blockquote>
                    {:else}
                        <p class={`text-sm leading-relaxed whitespace-pre-line ${repealed ? "text-muted-foreground line-through decoration-destructive/60" : ""}`}>{provision.text}</p>
                    {/if}
                {/if}

                {#each notes as amendment (amendment.relationId)}
                    <div class="flex flex-col gap-1 rounded-lg bg-muted/60 px-3 py-2 text-sm">
                        <p class="flex flex-wrap items-center gap-1.5">
                            <Badge variant={amendment.verificationStatus === "ACCEPTED" ? "destructive" : "outline"}>
                                {AMENDMENT_LABELS[amendment.relationType]}{amendment.verificationStatus === "CANDIDATE" ? " (chưa xác minh)" : ""}
                            </Badge>
                            <span>bởi</span>
                            <a href={provisionHref(amendment.fromDocumentId, amendment.fromProvisionId)} class="font-medium underline underline-offset-4">
                                {sourceName(amendment)}
                            </a>
                            {#if amendment.effectiveFrom}
                                <span class="text-muted-foreground">· từ {formatDate(amendment.effectiveFrom)}</span>
                            {/if}
                        </p>

                        {#if amendment.evidenceText}
                            <details>
                                <summary class="cursor-pointer text-muted-foreground">Căn cứ</summary>
                                <blockquote class="mt-1 border-l-2 pl-3 whitespace-pre-line">{amendment.evidenceText}</blockquote>
                            </details>
                        {/if}
                    </div>
                {/each}
            </div>

            {#if node.children.length > 0}
                <div class="mt-2 ml-2 border-l pl-4 sm:ml-4">
                    <Self nodes={node.children} {amendments} />
                </div>
            {/if}
        </li>
    {/each}
</ol>
