<script lang="ts">
    import Self from "./ReviewNodeTree.svelte";
    import type { NodeKind, ReadQuality, ReviewNode } from "$lib/api/review";
    import { Badge } from "$lib/components/ui/badge";

    type Props = {
        nodes: ReviewNode[];
    };

    let { nodes }: Props = $props();

    const KIND_LABELS: Record<NodeKind, string> = {
        part: "Phần",
        chapter: "Chương",
        section: "Mục",
        article: "Điều",
        clause: "Khoản",
        point: "Điểm",
        text: "Nội dung",
    };

    const QUALITY_LABELS: Record<ReadQuality, string> = {
        GOOD: "Đọc tốt",
        PARTIAL: "Đọc một phần",
        UNREADABLE: "Không đọc được",
    };

    function pagesOf(node: ReviewNode): string | null {
        if (node.pageStart === null) {
            return null;
        }

        if (node.pageEnd === null || node.pageEnd === node.pageStart) {
            return `Trang ${node.pageStart}`;
        }

        return `Trang ${node.pageStart}–${node.pageEnd}`;
    }
</script>

<ol class="flex flex-col gap-3">
    {#each nodes as node, index (index)}
        <li class="flex flex-col gap-1.5 border-l-2 pl-3">
            <div class="flex flex-wrap items-center gap-2 text-sm">
                <span class="font-semibold">{KIND_LABELS[node.kind]} {node.number}</span>
                {#if node.title}
                    <span class="font-semibold">{node.title}</span>
                {/if}
                {#if pagesOf(node)}
                    <span class="text-xs text-muted-foreground">{pagesOf(node)}</span>
                {/if}
                {#if node.quality !== "GOOD"}
                    <Badge variant="destructive">{QUALITY_LABELS[node.quality]}</Badge>
                {/if}
            </div>

            {#if node.content}
                <p class="text-sm whitespace-pre-line">{node.content}</p>
            {/if}

            {#if node.sourceQuote}
                <p class="text-xs text-muted-foreground">Trích nguồn: “{node.sourceQuote}”</p>
            {/if}

            {#if node.quoted.length > 0}
                <div class="rounded-md bg-muted/50 p-2">
                    <p class="mb-2 text-xs font-medium text-muted-foreground">Nội dung được trích dẫn (văn bản này sửa đổi văn bản khác)</p>
                    <Self nodes={node.quoted} />
                </div>
            {/if}

            {#if node.children.length > 0}
                <Self nodes={node.children} />
            {/if}
        </li>
    {/each}
</ol>
