<script lang="ts">
    import type { WorkspaceRelationGraph } from "$lib/engine/workspace-relations";
    import { AlertTriangle, GitCommitHorizontal, Maximize2, Network } from "@lucide/svelte";
    import RelationGraphModal from "./RelationGraphModal.svelte";
    import {
        GRAPH_NODE_H,
        GRAPH_NODE_W,
        type GraphFilterType,
        type GraphPoint,
        buildRelationGraphLayout,
        computeRelationEdgeCurve,
        edgeStrokeColor,
        edgeTargetKey,
        filterRelationEdges,
        nodeStrokeColor,
        relationLabel,
        statusBadgeClass,
        statusLabel,
    } from "./relation-graph-layout";

    type Props = {
        graph: WorkspaceRelationGraph;
        onJumpToFileLine: (path: string, line: number) => void;
    };

    let { graph, onJumpToFileLine }: Props = $props();

    let filter = $state<GraphFilterType>("ALL");
    let expanded = $state(false);
    let nodePositions = $state<Record<string, GraphPoint>>({});

    const filteredEdges = $derived(filterRelationEdges(graph.edges, filter));
    const layout = $derived(buildRelationGraphLayout(graph, nodePositions));

    const thumbnailEdges = $derived.by(() => {
        const pairTotals = new Map<string, number>();

        for (const edge of filteredEdges) {
            const pairKey = `${edge.fromPath}::${edgeTargetKey(edge)}`;
            pairTotals.set(pairKey, (pairTotals.get(pairKey) ?? 0) + 1);
        }

        const pairSeen = new Map<string, number>();

        return filteredEdges.flatMap((edge) => {
            const fromNode = layout.byKey.get(edge.fromPath);
            const toNode = layout.byKey.get(edgeTargetKey(edge));

            if (!fromNode || !toNode) {
                return [];
            }

            const pairKey = `${edge.fromPath}::${edgeTargetKey(edge)}`;
            const idx = pairSeen.get(pairKey) ?? 0;
            pairSeen.set(pairKey, idx + 1);

            return [
                {
                    edge,
                    curve: computeRelationEdgeCurve(fromNode, toNode, idx, pairTotals.get(pairKey) ?? 1),
                },
            ];
        });
    });

    function handleMoveNode(key: string, pos: GraphPoint): void {
        nodePositions = { ...nodePositions, [key]: pos };
    }

    function handleResetPositions(): void {
        nodePositions = {};
    }
</script>

<div class="flex h-full flex-col bg-[var(--ide-panel)] text-xs">
    <div class="flex h-9 shrink-0 items-center justify-between border-b px-2.5 select-none">
        <span class="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            <Network class="size-3.5 text-primary" aria-hidden="true" />
            <span>Lược đồ quan hệ ({graph.summary.totalDocuments})</span>
        </span>
        <div class="flex items-center gap-1.5">
            {#if graph.summary.violationCount > 0}
                <span class="rounded-[2px] bg-[var(--diag-logic-bg)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--diag-logic)]">
                    {graph.summary.violationCount} lỗi
                </span>
            {/if}
            <button
                type="button"
                onclick={() => (expanded = true)}
                title="Phóng to lược đồ toàn màn hình"
                class="rounded-[2px] p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
                <Maximize2 class="size-3.5" aria-hidden="true" />
            </button>
        </div>
    </div>

    <div class="flex flex-wrap gap-1 border-b px-2 py-1.5">
        {#each [
            { id: "ALL", label: `Tất cả (${graph.edges.length})` },
            { id: "REPLACES", label: "Thay thế" },
            { id: "AMENDS", label: "Sửa đổi" },
            { id: "REPEALS", label: "Bãi bỏ" },
            { id: "BASED_ON", label: "Căn cứ" },
            { id: "VIOLATION", label: `Vi phạm (${graph.summary.violationCount})` },
        ] as pill (pill.id)}
            <button
                type="button"
                onclick={() => (filter = pill.id as GraphFilterType)}
                class={`rounded-[2px] px-1.5 py-0.5 text-[10px] transition-colors ${
                    filter === pill.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground hover:text-foreground"
                }`}
            >
                {pill.label}
            </button>
        {/each}
    </div>

    <div class="ide-scroll flex-1 space-y-3 overflow-y-auto p-2.5">
        {#if layout.nodes.length > 0}
            <button
                type="button"
                onclick={() => (expanded = true)}
                aria-label="Mở lược đồ quan hệ toàn màn hình"
                title="Bấm để phóng to và sắp xếp lược đồ"
                class="group relative block w-full overflow-hidden rounded-[3px] border border-border bg-[var(--ide-editor)] p-2 text-left transition-colors hover:border-primary/60"
            >
                <span class="absolute top-1.5 right-1.5 z-10 flex items-center gap-1 rounded-[2px] border border-border bg-[var(--ide-panel)]/95 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors group-hover:border-primary/50 group-hover:text-foreground">
                    <Maximize2 class="size-3" aria-hidden="true" />
                    <span>Phóng to</span>
                </span>

                <svg
                    viewBox={`${layout.viewBox.x} ${layout.viewBox.y} ${layout.viewBox.width} ${layout.viewBox.height}`}
                    preserveAspectRatio="xMidYMid meet"
                    aria-hidden="true"
                    class="pointer-events-none block h-32 w-full select-none"
                >
                    {#each thumbnailEdges as item (item.edge.id)}
                        <path
                            d={item.curve.path}
                            fill="none"
                            stroke={edgeStrokeColor(item.edge)}
                            stroke-width={item.edge.isLegalViolation ? 6 : 4}
                            stroke-dasharray={item.edge.isLegalViolation ? "12 8" : undefined}
                            opacity="0.78"
                        />
                    {/each}

                    {#each layout.nodes as node (node.key)}
                        <g>
                            <rect
                                x={node.x}
                                y={node.y}
                                width={GRAPH_NODE_W}
                                height={GRAPH_NODE_H}
                                rx="8"
                                fill="var(--ide-panel)"
                                stroke={nodeStrokeColor(node)}
                                stroke-width="6"
                                stroke-dasharray={node.isExternal ? "12 8" : undefined}
                            />
                            <rect
                                x={node.x + 14}
                                y={node.y + 14}
                                width={GRAPH_NODE_W - 28}
                                height="10"
                                rx="4"
                                fill={nodeStrokeColor(node)}
                                opacity="0.85"
                            />
                            <rect
                                x={node.x + 14}
                                y={node.y + 34}
                                width={Math.round((GRAPH_NODE_W - 28) * 0.65)}
                                height="7"
                                rx="3"
                                fill="currentColor"
                                class="text-muted-foreground/40"
                            />
                            <rect
                                x={node.x + 14}
                                y={node.y + 47}
                                width={Math.round((GRAPH_NODE_W - 28) * 0.4)}
                                height="6"
                                rx="3"
                                fill="currentColor"
                                class="text-muted-foreground/25"
                            />
                        </g>
                    {/each}
                </svg>

                <span class="pointer-events-none mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span class="font-mono">{layout.nodes.length} nút · {filteredEdges.length} cạnh</span>
                    <span class="opacity-80 group-hover:text-primary">Bấm để tương tác</span>
                </span>
            </button>
        {/if}

        <section>
            <h3 class="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                Hiệu lực văn bản trong Workspace
            </h3>
            <ul class="flex flex-col gap-1">
                {#each graph.nodes as node (node.path)}
                    <li>
                        <button
                            type="button"
                            onclick={() => onJumpToFileLine(node.path, 1)}
                            class="flex w-full flex-col gap-0.5 rounded-[2px] border bg-background/60 p-2 text-left hover:border-primary/50"
                        >
                            <div class="flex items-center justify-between gap-1.5">
                                <span class="truncate font-mono text-[11px] font-semibold text-foreground">
                                    {node.documentNumber ?? node.title}
                                </span>
                                <span class={`shrink-0 rounded-[2px] px-1 py-0.5 font-mono text-[9px] font-semibold ${statusBadgeClass(node.status)}`}>
                                    {statusLabel(node.status)}
                                </span>
                            </div>
                            <p class="truncate text-[10px] text-muted-foreground">{node.statusNote}</p>
                        </button>
                    </li>
                {/each}
            </ul>
        </section>

        <section>
            <h3 class="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                Chi tiết cạnh quan hệ ({filteredEdges.length})
            </h3>
            {#if filteredEdges.length === 0}
                <p class="rounded-[2px] border bg-background/60 p-2 text-[11px] text-muted-foreground">
                    Không có quan hệ nào khớp bộ lọc.
                </p>
            {:else}
                <ul class="flex flex-col gap-1">
                    {#each filteredEdges as edge (edge.id)}
                        <li>
                            <button
                                type="button"
                                onclick={() => onJumpToFileLine(edge.fromPath, edge.line)}
                                class={`flex w-full flex-col gap-1 rounded-[2px] border p-2 text-left hover:border-primary/50 ${
                                    edge.isLegalViolation
                                        ? "border-[var(--diag-logic)]/40 bg-[var(--diag-logic-bg)]"
                                        : "bg-background/60"
                                }`}
                            >
                                <div class="flex items-center justify-between gap-1">
                                    <span class="flex items-center gap-1 font-mono text-[10px] font-semibold">
                                        {#if edge.isLegalViolation}
                                            <AlertTriangle class="size-3 text-[var(--diag-logic)]" aria-hidden="true" />
                                        {:else}
                                            <GitCommitHorizontal class="size-3 text-primary" aria-hidden="true" />
                                        {/if}
                                        <span>{relationLabel(edge.relationType)}</span>
                                    </span>
                                    <span class="font-mono text-[9px] text-muted-foreground">L{edge.line}</span>
                                </div>
                                <p class="text-[11px] text-foreground">
                                    → <span class="font-medium">{edge.toExternalLabel}</span>
                                </p>
                                {#if edge.violationReason}
                                    <p class="text-[10px] text-[var(--diag-logic)]">{edge.violationReason}</p>
                                {/if}
                            </button>
                        </li>
                    {/each}
                </ul>
            {/if}
        </section>
    </div>
</div>

{#if expanded}
    <RelationGraphModal
        {graph}
        initialFilter={filter}
        customPositions={nodePositions}
        onMoveNode={handleMoveNode}
        onResetPositions={handleResetPositions}
        {onJumpToFileLine}
        onClose={() => (expanded = false)}
    />
{/if}
