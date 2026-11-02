<script lang="ts">
    import type { GraphDocument, GraphProvision } from "$lib/api/graph";
    import { formatDate } from "$lib/format";
    import { provisionPathLabel, type GraphLayout, type NodeBox } from "$lib/graph-view";
    import { relationColor } from "$lib/relation-colors";

    type Props = {
        layout: GraphLayout;
        documents: GraphDocument[];
        provisions: GraphProvision[];
        selectedId: string | null;
        onselect: (nodeId: string | null) => void;
    };

    let { layout, documents, provisions, selectedId, onselect }: Props = $props();

    const documentById = $derived(new Map(documents.map((document) => [document.id, document])));
    const provisionById = $derived(new Map(provisions.map((provision) => [provision.id, provision])));
    const colors = $derived([...new Set(layout.edges.map((edge) => relationColor(edge.relationType)))]);
    const linkedIds = $derived(linkedNodeIds(selectedId));

    function linkedNodeIds(nodeId: string | null): Set<string> {
        const linked = new Set<string>();

        if (!nodeId) {
            return linked;
        }

        linked.add(nodeId);

        for (const edge of layout.edges) {
            if (edge.fromNodeId === nodeId || edge.toNodeId === nodeId) {
                linked.add(edge.fromNodeId);
                linked.add(edge.toNodeId);
            }
        }

        return linked;
    }

    function isDimmed(nodeId: string): boolean {
        return selectedId !== null && !linkedIds.has(nodeId);
    }

    function isEdgeDimmed(fromNodeId: string, toNodeId: string): boolean {
        return selectedId !== null && fromNodeId !== selectedId && toNodeId !== selectedId;
    }

    function shorten(text: string, length: number): string {
        return text.length > length ? `${text.slice(0, length - 1)}…` : text;
    }

    function documentHeading(nodeId: string): string {
        const document = documentById.get(nodeId);

        return document?.documentNumber ?? document?.title ?? nodeId;
    }

    function documentDate(nodeId: string): string {
        const issuedAt = documentById.get(nodeId)?.issuedAt;

        return issuedAt ? `Ban hành ${formatDate(issuedAt)}` : "Chưa rõ ngày ban hành";
    }

    function provisionHeading(nodeId: string): string {
        const provision = provisionById.get(nodeId);

        return provision ? provisionPathLabel(provision) : nodeId;
    }

    function provisionPreview(nodeId: string): string {
        return shorten(provisionById.get(nodeId)?.textPreview ?? "", 34);
    }

    function toggle(box: NodeBox): void {
        onselect(selectedId === box.id ? null : box.id);
    }

    function onNodeKey(event: KeyboardEvent, box: NodeBox): void {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggle(box);
        }
    }

    function markerId(color: string): string {
        return `arrow-${color.replace("#", "")}`;
    }
</script>

<div class="overflow-auto rounded-lg border bg-background">
    <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="group"
        aria-label="Đồ thị quan hệ giữa văn bản và điều khoản"
        class="block"
    >
        <defs>
            {#each colors as color (color)}
                <marker id={markerId(color)} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
                </marker>
            {/each}
        </defs>

        {#each layout.edges as edge (edge.id)}
            <path
                d={edge.path}
                fill="none"
                stroke={relationColor(edge.relationType)}
                stroke-width={edge.kind === "DOCUMENT" ? 2.5 : 1.75}
                stroke-dasharray={edge.isCandidate ? "6 4" : undefined}
                marker-end={`url(#${markerId(relationColor(edge.relationType))})`}
                opacity={isEdgeDimmed(edge.fromNodeId, edge.toNodeId) ? 0.12 : 0.9}
            />
        {/each}

        {#each layout.documents as box (box.id)}
            <g
                role="button"
                tabindex="0"
                aria-pressed={selectedId === box.id}
                aria-label={`Văn bản ${documentHeading(box.id)}`}
                class="cursor-pointer outline-none [&:focus-visible>rect]:stroke-ring"
                opacity={isDimmed(box.id) ? 0.35 : 1}
                onclick={() => toggle(box)}
                onkeydown={(event) => onNodeKey(event, box)}
            >
                <rect
                    x={box.x}
                    y={box.y}
                    width={box.width}
                    height={box.height}
                    rx="10"
                    class={selectedId === box.id ? "fill-primary stroke-primary" : "fill-muted stroke-border"}
                    stroke-width="2"
                />
                <text x={box.x + 12} y={box.y + 26} class={`text-sm font-semibold ${selectedId === box.id ? "fill-primary-foreground" : "fill-foreground"}`}>
                    {shorten(documentHeading(box.id), 26)}
                </text>
                <text x={box.x + 12} y={box.y + 48} class={`text-xs ${selectedId === box.id ? "fill-primary-foreground" : "fill-muted-foreground"}`}>
                    {documentDate(box.id)}
                </text>
            </g>
        {/each}

        {#each layout.provisions as box (box.id)}
            <g
                role="button"
                tabindex="0"
                aria-pressed={selectedId === box.id}
                aria-label={`${provisionHeading(box.id)} của ${documentHeading(provisionById.get(box.id)?.documentId ?? "")}`}
                class="cursor-pointer outline-none [&:focus-visible>rect]:stroke-ring"
                opacity={isDimmed(box.id) ? 0.35 : 1}
                onclick={() => toggle(box)}
                onkeydown={(event) => onNodeKey(event, box)}
            >
                <rect
                    x={box.x}
                    y={box.y}
                    width={box.width}
                    height={box.height}
                    rx="8"
                    class={selectedId === box.id ? "fill-accent stroke-primary" : "fill-background stroke-border"}
                    stroke-width={selectedId === box.id ? 2 : 1}
                />
                <text x={box.x + 10} y={box.y + 17} class="fill-foreground text-xs font-medium">{provisionHeading(box.id)}</text>
                <text x={box.x + 10} y={box.y + 32} class="fill-muted-foreground text-[11px]">{provisionPreview(box.id)}</text>
            </g>
        {/each}
    </svg>
</div>
