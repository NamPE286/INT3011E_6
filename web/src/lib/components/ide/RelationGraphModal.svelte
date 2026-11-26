<script lang="ts">
    import type { WorkspaceRelationEdge, WorkspaceRelationGraph } from "$lib/engine/workspace-relations";
    import { AlertTriangle, ExternalLink, GitCommitHorizontal, Network, RotateCcw, X, ZoomIn, ZoomOut } from "@lucide/svelte";
    import {
        GRAPH_NODE_H,
        GRAPH_NODE_W,
        type GraphBoxNode,
        type GraphFilterType,
        type GraphPoint,
        buildRelationGraphLayout,
        computeRelationEdgeCurve,
        edgeStrokeColor,
        edgeTargetKey,
        filterRelationEdges,
        nodeStrokeColor,
        relationLabel,
        statusLabel,
    } from "./relation-graph-layout";

    type Props = {
        graph: WorkspaceRelationGraph;
        initialFilter?: GraphFilterType;
        customPositions?: Record<string, GraphPoint>;
        onMoveNode?: (key: string, pos: GraphPoint) => void;
        onResetPositions?: () => void;
        onJumpToFileLine: (path: string, line: number) => void;
        onClose: () => void;
    };

    let {
        graph,
        initialFilter = "ALL",
        customPositions,
        onMoveNode,
        onResetPositions,
        onJumpToFileLine,
        onClose,
    }: Props = $props();

    let filterOverride = $state<GraphFilterType | null>(null);
    const filter = $derived(filterOverride ?? initialFilter);
    let selectedNodeKey = $state<string | null>(null);
    let zoom = $state(1);
    let pan = $state({ x: 0, y: 0 });
    let draggingCanvas = $state(false);
    let canvasDragStart = $state({ x: 0, y: 0, panX: 0, panY: 0 });
    let localPositions = $state<Record<string, GraphPoint>>({});
    let svgEl = $state<SVGSVGElement | null>(null);
    let draggingNodeKey = $state<string | null>(null);
    let nodeDrag = $state<{
        key: string;
        startClientX: number;
        startClientY: number;
        offsetX: number;
        offsetY: number;
        moved: boolean;
    } | null>(null);
    let suppressNextNodeClick = $state(false);

    const effectivePositions = $derived(customPositions ?? localPositions);
    const filteredEdges = $derived(filterRelationEdges(graph.edges, filter));
    const layout = $derived(buildRelationGraphLayout(graph, effectivePositions));
    const selectedNode = $derived(selectedNodeKey ? (layout.byKey.get(selectedNodeKey) ?? null) : null);

    const orderedNodes = $derived.by(() => {
        if (!draggingNodeKey) {
            return layout.nodes;
        }

        const rest: GraphBoxNode[] = [];
        let active: GraphBoxNode | null = null;

        for (const node of layout.nodes) {
            if (node.key === draggingNodeKey) {
                active = node;
            } else {
                rest.push(node);
            }
        }

        return active ? [...rest, active] : rest;
    });

    const positionedEdges = $derived.by(() => {
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

    const relatedEdgeIds = $derived.by(() => {
        if (!selectedNodeKey) {
            return null;
        }

        const ids = new Set<string>();

        for (const edge of filteredEdges) {
            if (edge.fromPath === selectedNodeKey || edgeTargetKey(edge) === selectedNodeKey) {
                ids.add(edge.id);
            }
        }

        return ids;
    });

    const selectedIncoming = $derived(
        selectedNodeKey
            ? filteredEdges.filter((e) => edgeTargetKey(e) === selectedNodeKey)
            : [],
    );

    const selectedOutgoing = $derived(
        selectedNodeKey
            ? filteredEdges.filter((e) => e.fromPath === selectedNodeKey)
            : [],
    );

    function edgeMarker(edge: WorkspaceRelationEdge): string {
        if (edge.isLegalViolation || edge.relationType === "REPEALS") {
            return "url(#modal-rel-arrow-err)";
        }

        if (edge.relationType === "REPLACES") {
            return "url(#modal-rel-arrow-replace)";
        }

        if (
            edge.relationType === "AMENDS"
            || edge.relationType === "SUPPLEMENTS"
            || edge.relationType === "AMENDS_SUPPLEMENTS"
        ) {
            return "url(#modal-rel-arrow-amend)";
        }

        return "url(#modal-rel-arrow-base)";
    }

    function clientToSvgPoint(clientX: number, clientY: number): GraphPoint | null {
        if (!svgEl) {
            return null;
        }

        const ctm = svgEl.getScreenCTM();

        if (!ctm) {
            return null;
        }

        const pt = svgEl.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const transformed = pt.matrixTransform(ctm.inverse());

        return { x: transformed.x, y: transformed.y };
    }

    function moveNode(key: string, pos: GraphPoint): void {
        if (onMoveNode) {
            onMoveNode(key, pos);

            return;
        }

        localPositions = { ...localPositions, [key]: pos };
    }

    function resetNodePositions(): void {
        if (onResetPositions) {
            onResetPositions();

            return;
        }

        localPositions = {};
    }

    function handleWheel(event: WheelEvent): void {
        event.preventDefault();
        const delta = event.deltaY < 0 ? 0.1 : -0.1;
        zoom = Math.max(0.4, Math.min(2.5, Number((zoom + delta).toFixed(2))));
    }

    function handleCanvasPointerDown(event: PointerEvent): void {
        if (event.button !== 0 || (event.target as HTMLElement).closest("[data-graph-node]")) {
            return;
        }

        draggingCanvas = true;
        canvasDragStart = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    }

    function handleNodePointerDown(event: PointerEvent, node: GraphBoxNode): void {
        if (event.button !== 0) {
            return;
        }

        event.stopPropagation();
        const pt = clientToSvgPoint(event.clientX, event.clientY);

        if (!pt) {
            return;
        }

        nodeDrag = {
            key: node.key,
            startClientX: event.clientX,
            startClientY: event.clientY,
            offsetX: pt.x - node.x,
            offsetY: pt.y - node.y,
            moved: false,
        };
    }

    function handleWindowPointerMove(event: PointerEvent): void {
        if (nodeDrag) {
            const dx = event.clientX - nodeDrag.startClientX;
            const dy = event.clientY - nodeDrag.startClientY;

            if (!nodeDrag.moved && Math.hypot(dx, dy) < 4) {
                return;
            }

            const pt = clientToSvgPoint(event.clientX, event.clientY);

            if (!pt) {
                return;
            }

            if (!nodeDrag.moved) {
                nodeDrag = { ...nodeDrag, moved: true };
            }

            draggingNodeKey = nodeDrag.key;
            moveNode(nodeDrag.key, {
                x: Math.round(pt.x - nodeDrag.offsetX),
                y: Math.round(pt.y - nodeDrag.offsetY),
            });

            return;
        }

        if (!draggingCanvas) {
            return;
        }

        pan = {
            x: canvasDragStart.panX + (event.clientX - canvasDragStart.x),
            y: canvasDragStart.panY + (event.clientY - canvasDragStart.y),
        };
    }

    function handleWindowPointerUp(): void {
        if (nodeDrag) {
            if (nodeDrag.moved) {
                suppressNextNodeClick = true;
            }

            nodeDrag = null;
            draggingNodeKey = null;
        }

        draggingCanvas = false;
    }

    function handleNodeClick(nodeKey: string): void {
        if (suppressNextNodeClick) {
            suppressNextNodeClick = false;

            return;
        }

        selectedNodeKey = selectedNodeKey === nodeKey ? null : nodeKey;
    }

    function resetView(): void {
        zoom = 1;
        pan = { x: 0, y: 0 };
        selectedNodeKey = null;
        resetNodePositions();
    }

    function jumpAndClose(path: string, line: number): void {
        onClose();
        onJumpToFileLine(path, line);
    }
</script>

<svelte:window
    onkeydown={(event) => {
        if (event.key === "Escape") {
            onClose();
        }
    }}
    onpointermove={handleWindowPointerMove}
    onpointerup={handleWindowPointerUp}
    onpointercancel={handleWindowPointerUp}
/>

<div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-5"
    role="dialog"
    aria-modal="true"
    aria-label="Lược đồ quan hệ văn bản toàn màn hình"
>
    <div class="flex h-full w-full flex-col overflow-hidden rounded-[4px] border border-border bg-[var(--ide-panel)] text-xs shadow-2xl">
        <!-- Header -->
        <header class="flex h-11 shrink-0 items-center justify-between gap-3 border-b bg-[var(--ide-chrome)] px-3 select-none">
            <div class="flex min-w-0 items-center gap-2">
                <Network class="size-4 shrink-0 text-primary" aria-hidden="true" />
                <span class="truncate text-xs font-semibold text-foreground">
                    Lược đồ quan hệ văn bản ({graph.summary.totalDocuments} văn bản · {graph.edges.length} quan hệ)
                </span>
                {#if graph.summary.violationCount > 0}
                    <span class="shrink-0 rounded-[2px] bg-[var(--diag-logic-bg)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--diag-logic)]">
                        {graph.summary.violationCount} lỗi
                    </span>
                {/if}
            </div>

            <div class="hidden flex-wrap items-center gap-1 lg:flex">
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
                        onclick={() => (filterOverride = pill.id as GraphFilterType)}
                        class={`rounded-[2px] px-2 py-1 text-[11px] transition-colors ${
                            filter === pill.id
                                ? "bg-primary text-primary-foreground"
                                : "bg-secondary text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        {pill.label}
                    </button>
                {/each}
            </div>

            <div class="flex shrink-0 items-center gap-1">
                <button
                    type="button"
                    onclick={() => (zoom = Math.max(0.4, Number((zoom - 0.15).toFixed(2))))}
                    title="Thu nhỏ"
                    class="rounded-[2px] border border-border bg-background p-1 text-muted-foreground hover:text-foreground"
                >
                    <ZoomOut class="size-3.5" aria-hidden="true" />
                </button>
                <span class="w-11 text-center font-mono text-[11px] text-muted-foreground">{Math.round(zoom * 100)}%</span>
                <button
                    type="button"
                    onclick={() => (zoom = Math.min(2.5, Number((zoom + 0.15).toFixed(2))))}
                    title="Phóng to"
                    class="rounded-[2px] border border-border bg-background p-1 text-muted-foreground hover:text-foreground"
                >
                    <ZoomIn class="size-3.5" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    onclick={resetView}
                    title="Đặt lại góc nhìn và vị trí nút"
                    class="rounded-[2px] border border-border bg-background p-1 text-muted-foreground hover:text-foreground"
                >
                    <RotateCcw class="size-3.5" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    onclick={onClose}
                    title="Đóng (Esc)"
                    class="ml-1 rounded-[2px] p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                    <X class="size-4" aria-hidden="true" />
                </button>
            </div>
        </header>

        <!-- Body -->
        <div class="flex min-h-0 flex-1 overflow-hidden">
            <!-- Interactive SVG Canvas -->
            <div
                role="presentation"
                class={`relative min-w-0 flex-1 overflow-hidden bg-[var(--ide-editor)] ${draggingCanvas ? "cursor-grabbing" : "cursor-grab"}`}
                onwheel={handleWheel}
                onpointerdown={handleCanvasPointerDown}
            >
                <div
                    class={`h-full w-full origin-center ${draggingCanvas || draggingNodeKey !== null ? "" : "transition-transform duration-75"}`}
                    style:transform={`translate(${pan.x}px, ${pan.y}px) scale(${zoom})`}
                >
                    <svg
                        bind:this={svgEl}
                        viewBox={`0 0 ${layout.canvasWidth} ${layout.canvasHeight}`}
                        class="h-full w-full overflow-visible select-none"
                    >
                        <defs>
                            <marker id="modal-rel-arrow-base" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                                <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--primary)" />
                            </marker>
                            <marker id="modal-rel-arrow-amend" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                                <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--diag-loophole)" />
                            </marker>
                            <marker id="modal-rel-arrow-replace" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                                <path d="M0,0 L7,3.5 L0,7 Z" fill="#f97316" />
                            </marker>
                            <marker id="modal-rel-arrow-err" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                                <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--diag-logic)" />
                            </marker>
                        </defs>

                        {#each positionedEdges as { edge, curve } (edge.id)}
                            {@const dimmed = relatedEdgeIds !== null && !relatedEdgeIds.has(edge.id)}
                            <g opacity={dimmed ? 0.18 : 1}>
                                <path
                                    d={curve.path}
                                    fill="none"
                                    stroke={edgeStrokeColor(edge)}
                                    stroke-width={edge.isLegalViolation ? 2.2 : 1.5}
                                    stroke-dasharray={edge.isLegalViolation ? "5 3" : edge.relationType === "BASED_ON" ? "3 3" : undefined}
                                    marker-end={edgeMarker(edge)}
                                />
                                <rect
                                    x={curve.labelX - 38}
                                    y={curve.labelY - 8}
                                    width="76"
                                    height="16"
                                    rx="2"
                                    fill="var(--ide-panel)"
                                    stroke={edgeStrokeColor(edge)}
                                    stroke-width="0.6"
                                    opacity="0.92"
                                />
                                <text
                                    x={curve.labelX}
                                    y={curve.labelY + 3}
                                    text-anchor="middle"
                                    font-size="8.5"
                                    fill={edge.isLegalViolation ? "var(--diag-logic)" : "currentColor"}
                                    class="font-mono text-foreground"
                                >
                                    {relationLabel(edge.relationType)}
                                </text>
                            </g>
                        {/each}

                        {#each orderedNodes as node (node.key)}
                            {@const isSelected = selectedNodeKey === node.key}
                            {@const isDragging = draggingNodeKey === node.key}
                            {@const isConnected = relatedEdgeIds === null
                                || isSelected
                                || filteredEdges.some(
                                    (e) => relatedEdgeIds.has(e.id) && (e.fromPath === node.key || edgeTargetKey(e) === node.key),
                                )}
                            <g
                                data-graph-node="true"
                                role="button"
                                tabindex="0"
                                opacity={isConnected ? 1 : 0.25}
                                class={isDragging ? "cursor-grabbing" : "cursor-grab"}
                                onpointerdown={(event) => handleNodePointerDown(event, node)}
                                onclick={() => handleNodeClick(node.key)}
                                ondblclick={() => node.path && jumpAndClose(node.path, 1)}
                                onkeydown={(e) => {
                                    if (e.key === "Enter") {
                                        selectedNodeKey = isSelected ? null : node.key;
                                    }
                                }}
                            >
                                <rect
                                    x={node.x}
                                    y={node.y}
                                    width={GRAPH_NODE_W}
                                    height={GRAPH_NODE_H}
                                    rx="4"
                                    fill="var(--ide-panel)"
                                    stroke={isSelected || isDragging ? "var(--primary)" : nodeStrokeColor(node)}
                                    stroke-width={isSelected || isDragging ? 2.5 : 1.4}
                                    stroke-dasharray={node.isExternal ? "4 3" : undefined}
                                />
                                <text
                                    x={node.x + 10}
                                    y={node.y + 18}
                                    font-size="11"
                                    font-weight="700"
                                    fill="currentColor"
                                    class="font-mono text-foreground"
                                >
                                    {(node.documentNumber ?? node.title).slice(0, 22)}
                                </text>
                                <text
                                    x={node.x + 10}
                                    y={node.y + 34}
                                    font-size="9.5"
                                    fill="currentColor"
                                    class="text-muted-foreground"
                                >
                                    {node.title.slice(0, 30)}
                                </text>
                                <text
                                    x={node.x + 10}
                                    y={node.y + 52}
                                    font-size="8.5"
                                    font-weight="600"
                                    fill={nodeStrokeColor(node)}
                                    class="font-mono"
                                >
                                    {statusLabel(node.status)}{node.effectiveDate ? ` · ${node.effectiveDate}` : ""}
                                </text>
                            </g>
                        {/each}
                    </svg>
                </div>

                <!-- Legend -->
                <div class="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-3 rounded-[3px] border border-border/80 bg-[var(--ide-panel)]/90 px-2.5 py-1.5 text-[10px] text-muted-foreground backdrop-blur-xs">
                    <span class="flex items-center gap-1"><span class="size-2 rounded-full bg-[var(--diag-ok)]"></span>Hiệu lực</span>
                    <span class="flex items-center gap-1"><span class="size-2 rounded-full bg-primary"></span>Dự thảo</span>
                    <span class="flex items-center gap-1"><span class="size-2 rounded-full bg-[var(--diag-logic)]"></span>Thay thế / Vi phạm</span>
                    <span class="hidden sm:inline">· Kéo nút để di chuyển · Kéo nền để dịch chuyển · Lăn chuột để Zoom · Click đúp nút để mở</span>
                </div>
            </div>

            <!-- Inspector Sidebar -->
            <aside class="ide-scroll hidden w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l bg-[var(--ide-panel)] p-3 md:flex">
                {#if selectedNode}
                    <div class="flex flex-col gap-2 rounded-[2px] border bg-background/60 p-2.5">
                        <div class="flex items-start justify-between gap-2">
                            <span class="font-mono text-xs font-semibold text-foreground">
                                {selectedNode.documentNumber ?? selectedNode.title}
                            </span>
                            <button
                                type="button"
                                onclick={() => (selectedNodeKey = null)}
                                class="text-[10px] text-muted-foreground hover:text-foreground"
                            >
                                Bỏ chọn
                            </button>
                        </div>
                        <p class="text-[11px] text-foreground">{selectedNode.title}</p>
                        <p class="text-[10px] text-muted-foreground">{selectedNode.statusNote}</p>
                        {#if selectedNode.path}
                            <button
                                type="button"
                                onclick={() => jumpAndClose(selectedNode.path!, 1)}
                                class="mt-1 flex items-center justify-center gap-1.5 rounded-[2px] bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90"
                            >
                                <ExternalLink class="size-3" aria-hidden="true" />
                                <span>Mở trong Editor</span>
                            </button>
                        {/if}
                    </div>

                    <section>
                        <h4 class="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                            Tác động tới văn bản này ({selectedIncoming.length})
                        </h4>
                        {#if selectedIncoming.length === 0}
                            <p class="text-[11px] text-muted-foreground">Không có.</p>
                        {:else}
                            <ul class="flex flex-col gap-1">
                                {#each selectedIncoming as edge (edge.id)}
                                    <li>
                                        <button
                                            type="button"
                                            onclick={() => jumpAndClose(edge.fromPath, edge.line)}
                                            class="flex w-full flex-col gap-0.5 rounded-[2px] border bg-background/60 p-2 text-left hover:border-primary/50"
                                        >
                                            <span class="font-mono text-[10px] font-semibold text-primary">
                                                {relationLabel(edge.relationType)} · L{edge.line}
                                            </span>
                                            <span class="truncate text-[10px] text-foreground">Từ: {edge.fromPath}</span>
                                        </button>
                                    </li>
                                {/each}
                            </ul>
                        {/if}
                    </section>

                    <section>
                        <h4 class="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                            Văn bản này tác động tới ({selectedOutgoing.length})
                        </h4>
                        {#if selectedOutgoing.length === 0}
                            <p class="text-[11px] text-muted-foreground">Không có.</p>
                        {:else}
                            <ul class="flex flex-col gap-1">
                                {#each selectedOutgoing as edge (edge.id)}
                                    <li>
                                        <button
                                            type="button"
                                            onclick={() => jumpAndClose(edge.fromPath, edge.line)}
                                            class={`flex w-full flex-col gap-0.5 rounded-[2px] border p-2 text-left hover:border-primary/50 ${
                                                edge.isLegalViolation ? "border-[var(--diag-logic)]/40 bg-[var(--diag-logic-bg)]" : "bg-background/60"
                                            }`}
                                        >
                                            <span class="font-mono text-[10px] font-semibold">
                                                {relationLabel(edge.relationType)} → {edge.toExternalLabel}
                                            </span>
                                            {#if edge.violationReason}
                                                <span class="text-[10px] text-[var(--diag-logic)]">{edge.violationReason}</span>
                                            {/if}
                                        </button>
                                    </li>
                                {/each}
                            </ul>
                        {/if}
                    </section>
                {:else}
                    <section>
                        <h4 class="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                            Danh sách văn bản ({layout.nodes.length})
                        </h4>
                        <ul class="flex flex-col gap-1">
                            {#each layout.nodes as node (node.key)}
                                <li>
                                    <button
                                        type="button"
                                        onclick={() => (selectedNodeKey = node.key)}
                                        class="flex w-full items-center justify-between gap-2 rounded-[2px] border bg-background/60 px-2 py-1.5 text-left hover:border-primary/50"
                                    >
                                        <span class="truncate font-mono text-[11px] text-foreground">
                                            {node.documentNumber ?? node.title}
                                        </span>
                                        <span class="shrink-0 font-mono text-[9px] text-muted-foreground">
                                            {statusLabel(node.status)}
                                        </span>
                                    </button>
                                </li>
                            {/each}
                        </ul>
                    </section>

                    <section>
                        <h4 class="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                            Cạnh quan hệ ({filteredEdges.length})
                        </h4>
                        <ul class="flex flex-col gap-1">
                            {#each filteredEdges as edge (edge.id)}
                                <li>
                                    <button
                                        type="button"
                                        onclick={() => jumpAndClose(edge.fromPath, edge.line)}
                                        class={`flex w-full flex-col gap-0.5 rounded-[2px] border p-2 text-left hover:border-primary/50 ${
                                            edge.isLegalViolation
                                                ? "border-[var(--diag-logic)]/40 bg-[var(--diag-logic-bg)]"
                                                : "bg-background/60"
                                        }`}
                                    >
                                        <span class="flex items-center gap-1 font-mono text-[10px] font-semibold">
                                            {#if edge.isLegalViolation}
                                                <AlertTriangle class="size-3 text-[var(--diag-logic)]" aria-hidden="true" />
                                            {:else}
                                                <GitCommitHorizontal class="size-3 text-primary" aria-hidden="true" />
                                            {/if}
                                            <span>{relationLabel(edge.relationType)} · L{edge.line}</span>
                                        </span>
                                        <span class="truncate text-[10px] text-foreground">→ {edge.toExternalLabel}</span>
                                    </button>
                                </li>
                            {/each}
                        </ul>
                    </section>
                {/if}
            </aside>
        </div>
    </div>
</div>
