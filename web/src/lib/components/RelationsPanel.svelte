<script lang="ts">
    import type { DocumentRelations, RelationEdge } from "$lib/api/documents";
    import ScopeNotice from "$lib/components/ScopeNotice.svelte";
    import { Badge } from "$lib/components/ui/badge";
    import { CANDIDATE_STATUS_LABELS, RELATION_SCOPE_LABELS, provisionHref, relationLabel } from "$lib/labels";

    type Props = {
        documentId: string;
        relations: DocumentRelations;
        labelOf: (documentId: string) => string;
    };

    let { documentId, relations, labelOf }: Props = $props();

    const groups = $derived([
        { heading: "Văn bản này tác động tới văn bản khác", edges: relations.outgoing },
        { heading: "Văn bản khác tác động tới văn bản này", edges: relations.incoming },
    ]);
    const statusSummary = $derived(Object.entries(relations.statusCounts).map(([status, count]) => `${CANDIDATE_STATUS_LABELS[status] ?? status}: ${count}`));

    function evidenceHref(edge: RelationEdge, provisionId: string): string {
        const sourceDocumentId = edge.direction === "INCOMING" ? edge.otherDocumentId : documentId;

        return provisionHref(sourceDocumentId, provisionId);
    }
</script>

<div class="flex flex-col gap-6">
    <section aria-labelledby="verified-heading" class="flex flex-col gap-4">
        <div>
            <h2 id="verified-heading" class="text-lg font-semibold">Quan hệ đã xác minh</h2>
            <p class="text-sm text-muted-foreground">
                Lược đồ do hệ thống tự xây từ toàn văn văn bản. Chỉ các cạnh có đủ căn cứ và đã khớp một văn bản trong dữ liệu mới được liệt kê ở đây.
            </p>
        </div>

        {#each groups as group (group.heading)}
            <div class="flex flex-col gap-2">
                <h3 class="text-sm font-medium">{group.heading}</h3>

                {#if group.edges.length === 0}
                    <p class="text-sm text-muted-foreground">
                        Chưa tìm thấy quan hệ nào trong dữ liệu đã xử lý. Điều này không chứng minh rằng không có quan hệ pháp lý.
                    </p>
                {:else}
                    <ul class="flex flex-col gap-2">
                        {#each group.edges as edge (edge.id)}
                            <li class="rounded-lg border p-3 text-sm">
                                <div class="flex flex-wrap items-center gap-2">
                                    <span class="font-medium">{relationLabel(edge.relationType, edge.direction)}</span>
                                    <a href={`/documents/${encodeURIComponent(edge.otherDocumentId)}`} class="underline underline-offset-4">
                                        {labelOf(edge.otherDocumentId)}
                                    </a>
                                    <Badge variant="outline">{RELATION_SCOPE_LABELS[edge.scope] ?? edge.scope}</Badge>
                                </div>

                                {#if edge.evidence.length > 0}
                                    <details class="mt-2">
                                        <summary class="cursor-pointer text-muted-foreground">Căn cứ ({edge.evidence.length})</summary>
                                        <ul class="mt-1 flex flex-col gap-2">
                                            {#each edge.evidence as evidence (evidence.id)}
                                                <li>
                                                    <blockquote class="border-l-2 pl-3 whitespace-pre-line">{evidence.quotedText}</blockquote>
                                                    {#if evidence.sourceProvisionId}
                                                        <a href={evidenceHref(edge, evidence.sourceProvisionId)} class="text-xs underline underline-offset-4">
                                                            Mở điều khoản nguồn
                                                        </a>
                                                    {/if}
                                                </li>
                                            {/each}
                                        </ul>
                                    </details>
                                {/if}
                            </li>
                        {/each}
                    </ul>
                {/if}
            </div>
        {/each}
    </section>

    <section aria-labelledby="candidates-heading" class="flex flex-col gap-3">
        <div>
            <h2 id="candidates-heading" class="text-lg font-semibold">Dẫn chiếu chưa xác minh</h2>
            <p class="text-sm text-muted-foreground">
                Đây không phải quan hệ pháp lý đã xác nhận: hệ thống thấy dẫn chiếu trong văn bản nhưng chưa khớp được văn bản đích hoặc chưa chắc về hành động.
            </p>
        </div>

        {#if relations.candidates.length === 0}
            <p class="text-sm text-muted-foreground">Không có dẫn chiếu nào đang chờ xác minh.</p>
        {:else}
            <ul class="flex flex-col gap-2">
                {#each relations.candidates as candidate (candidate.id)}
                    <li class="rounded-lg border border-dashed p-3 text-sm">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="font-medium">{candidate.rawTargetCitation || candidate.targetDocumentNumber || "Dẫn chiếu không có số hiệu"}</span>
                            <Badge variant="outline">{CANDIDATE_STATUS_LABELS[candidate.status] ?? candidate.status}</Badge>
                        </div>

                        {#if candidate.quotedText}
                            <blockquote class="mt-1 border-l-2 pl-3 whitespace-pre-line">{candidate.quotedText}</blockquote>
                        {/if}

                        {#if candidate.sourceProvisionId}
                            <a href={provisionHref(documentId, candidate.sourceProvisionId)} class="text-xs underline underline-offset-4">
                                Mở điều khoản nguồn
                            </a>
                        {/if}
                    </li>
                {/each}
            </ul>
        {/if}
    </section>

    {#if statusSummary.length > 0}
        <p class="text-sm text-muted-foreground">Thống kê dẫn chiếu: {statusSummary.join(" · ")}.</p>
    {/if}

    <ScopeNotice kind="graph" frontier={relations.frontier} />
</div>
