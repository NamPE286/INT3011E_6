import type {
    LegalRelationType,
    WorkspaceRelationEdge,
    WorkspaceRelationGraph,
    WorkspaceRelationNode,
} from "$lib/engine/workspace-relations";

export const GRAPH_NODE_W = 220;
export const GRAPH_NODE_H = 66;
export const GRAPH_COL_GAP = 48;
export const GRAPH_ROW_GAP = 64;
export const THUMBNAIL_PADDING = 32;

export type GraphFilterType = "ALL" | "VIOLATION" | LegalRelationType;

export type GraphPoint = {
    x: number;
    y: number;
};

export type GraphBoxNode = {
    key: string;
    path: string | null;
    title: string;
    documentNumber: string | null;
    documentType: string | null;
    hierarchyRank: number;
    effectiveDate: string | null;
    status: string;
    statusNote: string;
    isDraft: boolean;
    isExternal: boolean;
    x: number;
    y: number;
};

export type GraphEdgeCurve = {
    path: string;
    labelX: number;
    labelY: number;
};

export type GraphLayoutResult = {
    nodes: GraphBoxNode[];
    byKey: Map<string, GraphBoxNode>;
    canvasWidth: number;
    canvasHeight: number;
    viewBox: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
};

export function edgeTargetKey(edge: WorkspaceRelationEdge): string {
    return edge.toPath ?? `ext:${edge.toExternalLabel}`;
}

export function filterRelationEdges(
    edges: readonly WorkspaceRelationEdge[],
    filter: GraphFilterType,
): WorkspaceRelationEdge[] {
    return edges.filter((edge) => {
        if (filter === "ALL") {
            return true;
        }

        if (filter === "VIOLATION") {
            return edge.isLegalViolation;
        }

        if (filter === "AMENDS") {
            return (
                edge.relationType === "AMENDS"
                || edge.relationType === "SUPPLEMENTS"
                || edge.relationType === "AMENDS_SUPPLEMENTS"
            );
        }

        return edge.relationType === filter;
    });
}

export function buildRelationGraphLayout(
    graph: WorkspaceRelationGraph,
    customPositions?: Readonly<Record<string, GraphPoint>>,
): GraphLayoutResult {
    const sorted = [...graph.nodes].sort(
        (a, b) => a.hierarchyRank - b.hierarchyRank || (a.effectiveDate ?? "").localeCompare(b.effectiveDate ?? ""),
    );
    const byRank = new Map<number, WorkspaceRelationNode[]>();

    for (const node of sorted) {
        const list = byRank.get(node.hierarchyRank) ?? [];
        list.push(node);
        byRank.set(node.hierarchyRank, list);
    }

    const externalLabels: string[] = [];
    const seenExt = new Set<string>();

    for (const edge of graph.edges) {
        if (!edge.toPath && edge.toExternalLabel && !seenExt.has(edge.toExternalLabel)) {
            seenExt.add(edge.toExternalLabel);
            externalLabels.push(edge.toExternalLabel);
        }
    }

    const ranks = [...byRank.keys()].sort((a, b) => a - b);
    const extChunkSize = 6;
    const extRowsCount = Math.ceil(externalLabels.length / extChunkSize);
    const maxPerRow = Math.max(
        1,
        ...ranks.map((r) => byRank.get(r)?.length ?? 1),
        externalLabels.length > 0 ? Math.min(extChunkSize, externalLabels.length) : 1,
    );
    const canvasWidth = Math.max(760, maxPerRow * (GRAPH_NODE_W + GRAPH_COL_GAP) + 80);

    const nodes: GraphBoxNode[] = [];
    const byKey = new Map<string, GraphBoxNode>();

    ranks.forEach((rank, rowIdx) => {
        const row = byRank.get(rank) ?? [];
        const rowWidth = row.length * GRAPH_NODE_W + Math.max(0, row.length - 1) * GRAPH_COL_GAP;
        const startX = Math.max(40, (canvasWidth - rowWidth) / 2);
        const y = 40 + rowIdx * (GRAPH_NODE_H + GRAPH_ROW_GAP);

        row.forEach((node, colIdx) => {
            const custom = customPositions?.[node.path];
            const box: GraphBoxNode = {
                key: node.path,
                path: node.path,
                title: node.title,
                documentNumber: node.documentNumber,
                documentType: node.documentType,
                hierarchyRank: node.hierarchyRank,
                effectiveDate: node.effectiveDate,
                status: node.status,
                statusNote: node.statusNote,
                isDraft: node.isDraft,
                isExternal: false,
                x: custom ? custom.x : startX + colIdx * (GRAPH_NODE_W + GRAPH_COL_GAP),
                y: custom ? custom.y : y,
            };
            nodes.push(box);
            byKey.set(box.key, box);
        });
    });

    let totalRows = ranks.length;

    for (let extRowIdx = 0; extRowIdx < extRowsCount; extRowIdx += 1) {
        const extRow = externalLabels.slice(extRowIdx * extChunkSize, (extRowIdx + 1) * extChunkSize);
        const rowWidth = extRow.length * GRAPH_NODE_W + Math.max(0, extRow.length - 1) * GRAPH_COL_GAP;
        const startX = Math.max(40, (canvasWidth - rowWidth) / 2);
        const y = 40 + totalRows * (GRAPH_NODE_H + GRAPH_ROW_GAP);

        extRow.forEach((label, colIdx) => {
            const key = `ext:${label}`;
            const custom = customPositions?.[key];
            const box: GraphBoxNode = {
                key,
                path: null,
                title: label,
                documentNumber: label,
                documentType: "Ngoài Workspace",
                hierarchyRank: 99,
                effectiveDate: null,
                status: "EXTERNAL",
                statusNote: "Văn bản được dẫn chiếu nhưng chưa nạp tệp vào Workspace.",
                isDraft: false,
                isExternal: true,
                x: custom ? custom.x : startX + colIdx * (GRAPH_NODE_W + GRAPH_COL_GAP),
                y: custom ? custom.y : y,
            };
            nodes.push(box);
            byKey.set(key, box);
        });

        totalRows += 1;
    }

    const canvasHeight = Math.max(380, totalRows * (GRAPH_NODE_H + GRAPH_ROW_GAP) + 60);

    if (nodes.length === 0) {
        return {
            nodes,
            byKey,
            canvasWidth,
            canvasHeight,
            viewBox: { x: 0, y: 0, width: 400, height: 200 },
        };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const node of nodes) {
        if (node.x < minX) {
            minX = node.x;
        }

        if (node.y < minY) {
            minY = node.y;
        }

        if (node.x + GRAPH_NODE_W > maxX) {
            maxX = node.x + GRAPH_NODE_W;
        }

        if (node.y + GRAPH_NODE_H > maxY) {
            maxY = node.y + GRAPH_NODE_H;
        }
    }

    return {
        nodes,
        byKey,
        canvasWidth,
        canvasHeight,
        viewBox: {
            x: minX - THUMBNAIL_PADDING,
            y: minY - THUMBNAIL_PADDING,
            width: Math.max(120, maxX - minX + THUMBNAIL_PADDING * 2),
            height: Math.max(80, maxY - minY + THUMBNAIL_PADDING * 2),
        },
    };
}

export function computeRelationEdgeCurve(
    from: Pick<GraphBoxNode, "x" | "y">,
    to: Pick<GraphBoxNode, "x" | "y">,
    parallelIndex: number,
    parallelCount: number,
): GraphEdgeCurve {
    const fx = from.x + GRAPH_NODE_W / 2;
    const fy = from.y + GRAPH_NODE_H / 2;
    const tx = to.x + GRAPH_NODE_W / 2;
    const ty = to.y + GRAPH_NODE_H / 2;
    const dx = tx - fx;
    const dy = ty - fy;
    const spread = (parallelIndex - (parallelCount - 1) / 2) * 32;

    let x1: number;
    let y1: number;
    let x2: number;
    let y2: number;
    let cx1: number;
    let cy1: number;
    let cx2: number;
    let cy2: number;

    if (Math.abs(dx) > Math.abs(dy) * 1.35) {
        x1 = dx >= 0 ? from.x + GRAPH_NODE_W : from.x;
        y1 = fy;
        x2 = dx >= 0 ? to.x : to.x + GRAPH_NODE_W;
        y2 = ty;
        cx1 = x1 + (x2 - x1) * 0.45;
        cy1 = y1 + spread;
        cx2 = x2 - (x2 - x1) * 0.45;
        cy2 = y2 + spread;
    } else {
        x1 = fx;
        y1 = dy >= 0 ? from.y + GRAPH_NODE_H : from.y;
        x2 = tx;
        y2 = dy >= 0 ? to.y : to.y + GRAPH_NODE_H;
        cx1 = x1 + spread;
        cy1 = y1 + (y2 - y1) * 0.45;
        cx2 = x2 + spread;
        cy2 = y2 - (y2 - y1) * 0.45;
    }

    const labelX = 0.125 * x1 + 0.375 * cx1 + 0.375 * cx2 + 0.125 * x2;
    const labelY = 0.125 * y1 + 0.375 * cy1 + 0.375 * cy2 + 0.125 * y2;

    return {
        path: `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`,
        labelX,
        labelY,
    };
}

export function relationLabel(type: LegalRelationType): string {
    if (type === "REPLACES") {
        return "Thay thế";
    }

    if (type === "AMENDS" || type === "AMENDS_SUPPLEMENTS") {
        return "Sửa đổi/Bổ sung";
    }

    if (type === "SUPPLEMENTS") {
        return "Bổ sung";
    }

    if (type === "REPEALS") {
        return "Bãi bỏ";
    }

    if (type === "BASED_ON") {
        return "Căn cứ";
    }

    if (type === "IMPLEMENTS") {
        return "Quy định chi tiết";
    }

    return "Dẫn chiếu";
}

export function statusLabel(status: string): string {
    if (status === "REPLACED") {
        return "ĐÃ THAY THẾ";
    }

    if (status === "REPEALED") {
        return "ĐÃ BÃI BỎ";
    }

    if (status === "AMENDED") {
        return "ĐÃ SỬA ĐỔI";
    }

    if (status === "PARTIALLY_REPEALED") {
        return "BÃI BỎ 1 PHẦN";
    }

    if (status === "DRAFT") {
        return "DỰ THẢO";
    }

    if (status === "EXTERNAL") {
        return "NGOÀI WORKSPACE";
    }

    return "HIỆU LỰC";
}

export function statusBadgeClass(status: string): string {
    if (status === "REPLACED" || status === "REPEALED") {
        return "bg-[var(--diag-logic-bg)] text-[var(--diag-logic)]";
    }

    if (status === "AMENDED" || status === "PARTIALLY_REPEALED") {
        return "bg-[var(--diag-loophole-bg)] text-[var(--diag-loophole)]";
    }

    if (status === "DRAFT") {
        return "bg-primary/20 text-primary";
    }

    return "bg-[var(--diag-ok-bg)] text-[var(--diag-ok)]";
}

export function nodeStrokeColor(node: Pick<GraphBoxNode, "isExternal" | "status" | "isDraft">): string {
    if (node.isExternal) {
        return "var(--muted-foreground)";
    }

    if (node.status === "REPLACED" || node.status === "REPEALED") {
        return "var(--diag-logic)";
    }

    if (node.isDraft) {
        return "var(--primary)";
    }

    return "var(--diag-ok)";
}

export function edgeStrokeColor(edge: Pick<WorkspaceRelationEdge, "isLegalViolation" | "relationType">): string {
    if (edge.isLegalViolation || edge.relationType === "REPEALS") {
        return "var(--diag-logic)";
    }

    if (edge.relationType === "REPLACES") {
        return "#f97316";
    }

    if (
        edge.relationType === "AMENDS"
        || edge.relationType === "SUPPLEMENTS"
        || edge.relationType === "AMENDS_SUPPLEMENTS"
    ) {
        return "var(--diag-loophole)";
    }

    return "var(--primary)";
}
