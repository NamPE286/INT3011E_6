import { describe, expect, it } from "bun:test";
import type { WorkspaceRelationEdge, WorkspaceRelationGraph, WorkspaceRelationNode } from "$lib/engine/workspace-relations";
import {
    GRAPH_NODE_H,
    GRAPH_NODE_W,
    THUMBNAIL_PADDING,
    buildRelationGraphLayout,
    computeRelationEdgeCurve,
    filterRelationEdges,
} from "./relation-graph-layout";

function makeNode(overrides: Partial<WorkspaceRelationNode> & { path: string }): WorkspaceRelationNode {
    return {
        title: overrides.path,
        documentNumber: overrides.path,
        documentType: "Nghị định",
        hierarchyRank: 5,
        issuedDate: null,
        effectiveDate: null,
        isLibrary: true,
        isDraft: false,
        status: "ACTIVE",
        statusNote: "Đang có hiệu lực",
        replacedBy: [],
        amendedBy: [],
        repealedProvisions: [],
        ...overrides,
    };
}

function makeEdge(overrides: Partial<WorkspaceRelationEdge> & { id: string; fromPath: string }): WorkspaceRelationEdge {
    return {
        toPath: null,
        toExternalLabel: "Văn bản khác",
        relationType: "BASED_ON",
        scope: "FULL",
        targetProvisions: [],
        line: 1,
        startOffset: 0,
        endOffset: 10,
        evidenceText: "Căn cứ...",
        isLegalViolation: false,
        violationCode: null,
        violationReason: null,
        ...overrides,
    };
}

describe("relation-graph-layout", () => {
    it("places workspace nodes in hierarchical rows and external nodes below without overlap", () => {
        const graph: WorkspaceRelationGraph = {
            nodes: [
                makeNode({ path: "decree-a.txt", hierarchyRank: 5, effectiveDate: "2020-01-01" }),
                makeNode({ path: "law-a.txt", hierarchyRank: 2, effectiveDate: "2015-01-01" }),
                makeNode({ path: "decree-b.txt", hierarchyRank: 5, effectiveDate: "2024-01-01" }),
            ],
            edges: [
                makeEdge({ id: "e1", fromPath: "decree-a.txt", toPath: "law-a.txt", relationType: "BASED_ON" }),
                makeEdge({ id: "e2", fromPath: "decree-b.txt", toPath: null, toExternalLabel: "99/2010/QH12", relationType: "BASED_ON" }),
            ],
            violations: [],
            summary: {
                totalDocuments: 3,
                totalEdges: 2,
                replacedCount: 0,
                amendedCount: 0,
                violationCount: 0,
            },
        };

        const layout = buildRelationGraphLayout(graph);

        expect(layout.nodes.length).toBe(4);

        const lawNode = layout.byKey.get("law-a.txt");
        const decreeA = layout.byKey.get("decree-a.txt");
        const decreeB = layout.byKey.get("decree-b.txt");
        const extNode = layout.byKey.get("ext:99/2010/QH12");

        expect(lawNode).toBeDefined();
        expect(decreeA).toBeDefined();
        expect(decreeB).toBeDefined();
        expect(extNode).toBeDefined();

        if (!lawNode || !decreeA || !decreeB || !extNode) {
            return;
        }

        expect(lawNode.y).toBeLessThan(decreeA.y);
        expect(decreeA.y).toBe(decreeB.y);
        expect(decreeA.x + GRAPH_NODE_W).toBeLessThanOrEqual(decreeB.x);
        expect(decreeB.y).toBeLessThan(extNode.y);
        expect(extNode.isExternal).toBe(true);
    });

    it("applies customPositions and expands viewBox to frame moved nodes", () => {
        const graph: WorkspaceRelationGraph = {
            nodes: [
                makeNode({ path: "a.txt", hierarchyRank: 2 }),
                makeNode({ path: "b.txt", hierarchyRank: 5 }),
            ],
            edges: [],
            violations: [],
            summary: {
                totalDocuments: 2,
                totalEdges: 0,
                replacedCount: 0,
                amendedCount: 0,
                violationCount: 0,
            },
        };

        const layout = buildRelationGraphLayout(graph, {
            "a.txt": { x: -120, y: -50 },
            "b.txt": { x: 900, y: 600 },
        });

        const nodeA = layout.byKey.get("a.txt");
        const nodeB = layout.byKey.get("b.txt");

        expect(nodeA?.x).toBe(-120);
        expect(nodeA?.y).toBe(-50);
        expect(nodeB?.x).toBe(900);
        expect(nodeB?.y).toBe(600);

        expect(layout.viewBox.x).toBe(-120 - THUMBNAIL_PADDING);
        expect(layout.viewBox.y).toBe(-50 - THUMBNAIL_PADDING);
        expect(layout.viewBox.width).toBe(900 + GRAPH_NODE_W - (-120) + THUMBNAIL_PADDING * 2);
        expect(layout.viewBox.height).toBe(600 + GRAPH_NODE_H - (-50) + THUMBNAIL_PADDING * 2);
    });

    it("computes vertical or horizontal edge anchors and separates parallel edges", () => {
        const top = { key: "top", x: 100, y: 40 };
        const bottom = { key: "bottom", x: 100, y: 240 };

        const vertical = computeRelationEdgeCurve(top, bottom, 0, 1);
        expect(vertical.path.startsWith(`M ${100 + GRAPH_NODE_W / 2} ${40 + GRAPH_NODE_H}`)).toBe(true);
        expect(vertical.path.endsWith(`${100 + GRAPH_NODE_W / 2} 240`)).toBe(true);

        const right = { key: "right", x: 520, y: 40 };
        const horizontal = computeRelationEdgeCurve(top, right, 0, 1);
        expect(horizontal.path.startsWith(`M ${100 + GRAPH_NODE_W} ${40 + GRAPH_NODE_H / 2}`)).toBe(true);
        expect(horizontal.path.endsWith(`520 ${40 + GRAPH_NODE_H / 2}`)).toBe(true);

        const p0 = computeRelationEdgeCurve(top, bottom, 0, 2);
        const p1 = computeRelationEdgeCurve(top, bottom, 1, 2);
        expect(p0.labelX).not.toBe(p1.labelX);
    });

    it("filters edges by ALL, VIOLATION, AMENDS (including SUPPLEMENTS), and specific types", () => {
        const edges: WorkspaceRelationEdge[] = [
            makeEdge({ id: "1", fromPath: "a", relationType: "BASED_ON", isLegalViolation: false }),
            makeEdge({ id: "2", fromPath: "a", relationType: "AMENDS", isLegalViolation: false }),
            makeEdge({ id: "3", fromPath: "a", relationType: "SUPPLEMENTS", isLegalViolation: false }),
            makeEdge({ id: "4", fromPath: "a", relationType: "AMENDS_SUPPLEMENTS", isLegalViolation: true }),
            makeEdge({ id: "5", fromPath: "a", relationType: "REPEALS", isLegalViolation: true }),
        ];

        expect(filterRelationEdges(edges, "ALL").length).toBe(5);
        expect(filterRelationEdges(edges, "VIOLATION").map((e) => e.id)).toEqual(["4", "5"]);
        expect(filterRelationEdges(edges, "AMENDS").map((e) => e.id)).toEqual(["2", "3", "4"]);
        expect(filterRelationEdges(edges, "REPEALS").map((e) => e.id)).toEqual(["5"]);
    });
});
