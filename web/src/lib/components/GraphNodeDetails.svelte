<script lang="ts">
    import type { RelationGraph } from "$lib/api/graph";
    import { Badge } from "$lib/components/ui/badge";
    import { formatDate } from "$lib/format";
    import { provisionPathLabel, type VisibleGraph } from "$lib/graph-view";
    import { RELATION_SCOPE_LABELS, documentTitleOf, provisionHref, relationLabel } from "$lib/labels";
    import { relationColor } from "$lib/relation-colors";

    type Props = {
        nodeId: string;
        graph: RelationGraph;
        visible: VisibleGraph;
        onselect: (nodeId: string | null) => void;
    };

    let { nodeId, graph, visible, onselect }: Props = $props();

    const document = $derived(graph.documents.find((entry) => entry.id === nodeId) ?? null);
    const provision = $derived(graph.provisions.find((entry) => entry.id === nodeId) ?? null);
    const documentEdges = $derived(visible.documentRelations.filter((edge) => edge.fromDocumentId === nodeId || edge.toDocumentId === nodeId));
    const provisionEdges = $derived(
        visible.provisionRelations.filter((edge) =>
            provision ? edge.fromProvisionId === nodeId || edge.toProvisionId === nodeId : edge.fromDocumentId === nodeId || edge.toDocumentId === nodeId,
        ),
    );

    function documentName(documentId: string): string {
        const entry = graph.documents.find((candidate) => candidate.id === documentId);

        return entry ? documentTitleOf(entry) : documentId;
    }

    function provisionName(provisionId: string | null, documentId: string): string {
        const entry = provisionId ? graph.provisions.find((candidate) => candidate.id === provisionId) : undefined;
        const label = entry ? provisionPathLabel(entry) : "Toàn văn bản";

        return `${label} — ${documentName(documentId)}`;
    }

    function isOutgoing(fromId: string): boolean {
        return fromId === nodeId;
    }
</script>

<section aria-labelledby="node-details-heading" class="flex flex-col gap-4 rounded-lg border p-4 text-sm">
    <div class="flex items-start justify-between gap-2">
        {#if document}
            <div class="flex flex-col gap-1">
                <h2 id="node-details-heading" class="text-base font-semibold">{documentTitleOf(document)}</h2>
                {#if document.title && document.documentNumber}
                    <p class="text-muted-foreground">{document.title}</p>
                {/if}
                <p class="text-muted-foreground">
                    {document.issuedAt ? `Ban hành ${formatDate(document.issuedAt)}` : "Chưa rõ ngày ban hành"}
                    · {document.effectiveFrom ? `Hiệu lực từ ${formatDate(document.effectiveFrom)}` : "Chưa đọc được ngày hiệu lực"}
                </p>
                <a href={`/documents/${encodeURIComponent(document.id)}`} class="underline underline-offset-4">Mở văn bản</a>
            </div>
        {:else if provision}
            <div class="flex flex-col gap-1">
                <h2 id="node-details-heading" class="text-base font-semibold">{provisionPathLabel(provision)}</h2>
                <p class="text-muted-foreground">{documentName(provision.documentId)}</p>
                {#if provision.textPreview}
                    <blockquote class="border-l-2 pl-3 whitespace-pre-line">{provision.textPreview}</blockquote>
                {/if}
                <a href={provisionHref(provision.documentId, provision.id)} class="underline underline-offset-4">Mở điều khoản trong văn bản</a>
            </div>
        {:else}
            <h2 id="node-details-heading" class="text-base font-semibold">{nodeId}</h2>
        {/if}

        <button type="button" class="text-muted-foreground underline underline-offset-4" onclick={() => onselect(null)}>Bỏ chọn</button>
    </div>

    {#if documentEdges.length > 0}
        <div class="flex flex-col gap-2">
            <h3 class="font-medium">Quan hệ văn bản đã xác minh</h3>
            <ul class="flex flex-col gap-1">
                {#each documentEdges as edge (edge.id)}
                    {@const outgoing = isOutgoing(edge.fromDocumentId)}
                    {@const otherId = outgoing ? edge.toDocumentId : edge.fromDocumentId}
                    <li class="flex flex-wrap items-center gap-2">
                        <span class="inline-block size-2.5 rounded-full" style:background-color={relationColor(edge.relationType)} aria-hidden="true"></span>
                        <span>{relationLabel(edge.relationType, outgoing ? "OUTGOING" : "INCOMING")}</span>
                        <button type="button" class="underline underline-offset-4" onclick={() => onselect(otherId)}>{documentName(otherId)}</button>
                        <Badge variant="outline">{RELATION_SCOPE_LABELS[edge.scope] ?? edge.scope}</Badge>
                    </li>
                {/each}
            </ul>
        </div>
    {/if}

    {#if provisionEdges.length > 0}
        <div class="flex flex-col gap-2">
            <h3 class="font-medium">Quan hệ điều khoản</h3>
            <ul class="flex flex-col gap-3">
                {#each provisionEdges as edge (edge.id)}
                    {@const outgoing = provision ? isOutgoing(edge.fromProvisionId) : isOutgoing(edge.fromDocumentId)}
                    <li class="flex flex-col gap-1 rounded-md border p-2">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="inline-block size-2.5 rounded-full" style:background-color={relationColor(edge.relationType)} aria-hidden="true"></span>
                            <span class="font-medium">{relationLabel(edge.relationType, "OUTGOING")}</span>
                            {#if edge.verificationStatus === "CANDIDATE"}
                                <Badge variant="outline">Ứng viên, chưa xác minh</Badge>
                            {/if}
                            {#if edge.effectiveFrom}
                                <Badge variant="secondary">Từ {formatDate(edge.effectiveFrom)}</Badge>
                            {/if}
                        </div>
                        <p>
                            <a href={provisionHref(edge.fromDocumentId, edge.fromProvisionId)} class="underline underline-offset-4">
                                {provisionName(edge.fromProvisionId, edge.fromDocumentId)}
                            </a>
                            →
                            {#if edge.toProvisionId}
                                <a href={provisionHref(edge.toDocumentId, edge.toProvisionId)} class="underline underline-offset-4">
                                    {provisionName(edge.toProvisionId, edge.toDocumentId)}
                                </a>
                            {:else}
                                <a href={`/documents/${encodeURIComponent(edge.toDocumentId)}`} class="underline underline-offset-4">
                                    {provisionName(null, edge.toDocumentId)}
                                </a>
                            {/if}
                            <span class="sr-only">{outgoing ? "(điều khoản này tác động)" : "(điều khoản này bị tác động)"}</span>
                        </p>
                        {#if edge.evidenceText}
                            <blockquote class="border-l-2 pl-3 text-muted-foreground whitespace-pre-line">{edge.evidenceText}</blockquote>
                        {/if}
                    </li>
                {/each}
            </ul>
        </div>
    {/if}

    {#if documentEdges.length === 0 && provisionEdges.length === 0}
        <p class="text-muted-foreground">Không có quan hệ nào trong phần đồ thị đang hiển thị.</p>
    {/if}
</section>
