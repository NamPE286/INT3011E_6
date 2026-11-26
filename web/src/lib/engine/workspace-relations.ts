import type { LocalWorkspaceFile } from "./local-workspace";
import { computeLineStarts, extractDocumentMetadata, positionAtOffset, rangeFromOffsets, type ParsedDraft } from "./parser";
import type { LegalDiagnostic } from "./types";

export type LegalRelationType =
    | "BASED_ON"
    | "REPLACES"
    | "AMENDS"
    | "SUPPLEMENTS"
    | "AMENDS_SUPPLEMENTS"
    | "REPEALS"
    | "IMPLEMENTS"
    | "REFERENCES";

export type RelationScope = "FULL" | "PARTIAL";

export type DocumentLifecycleStatus =
    | "ACTIVE"
    | "AMENDED"
    | "PARTIALLY_REPEALED"
    | "REPLACED"
    | "REPEALED"
    | "DRAFT";

export type WorkspaceRelationNode = {
    path: string;
    title: string;
    documentNumber: string | null;
    documentType: string | null;
    hierarchyRank: number;
    issuedDate: string | null;
    effectiveDate: string | null;
    isLibrary: boolean;
    isDraft: boolean;
    status: DocumentLifecycleStatus;
    statusNote: string;
    replacedBy: string[];
    amendedBy: string[];
    repealedProvisions: string[];
};

export type WorkspaceRelationEdge = {
    id: string;
    fromPath: string;
    toPath: string | null;
    toExternalLabel: string;
    relationType: LegalRelationType;
    scope: RelationScope;
    targetProvisions: string[];
    line: number;
    startOffset: number;
    endOffset: number;
    evidenceText: string;
    isLegalViolation: boolean;
    violationCode: string | null;
    violationReason: string | null;
};

export type WorkspaceRelationGraph = {
    nodes: WorkspaceRelationNode[];
    edges: WorkspaceRelationEdge[];
    violations: LegalDiagnostic[];
    summary: {
        totalDocuments: number;
        totalEdges: number;
        replacedCount: number;
        amendedCount: number;
        violationCount: number;
    };
};

const DOC_NUM_REGEX = /\b(\d{1,4}\/\d{4}\/[A-ZĐ0-9\-]+)\b/giu;
const BASIS_LINE_REGEX = /^\s*Căn\s+cứ\s+([^\n]+)/gimu;
const PROVISION_REF_REGEX = /(?:điểm\s+[a-zđ]\s+)?(?:khoản\s+\d+\s+)?Điều\s+\d+[a-zđ]?/giu;

const AFFECTING_TYPES = new Set<LegalRelationType>([
    "REPLACES",
    "AMENDS",
    "SUPPLEMENTS",
    "AMENDS_SUPPLEMENTS",
    "REPEALS",
]);

function normalizeDocNum(raw: string | null | undefined): string {
    return (raw ?? "").trim().toUpperCase();
}

function inferTitleKeywords(title: string): string {
    return title
        .toLowerCase()
        .replace(/^(?:luật|bộ luật|nghị định|thông tư|quyết định|dự thảo)\s+/iu, "")
        .replace(/[^a-zà-ỹ0-9\s]/giu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function resolveTargetNodes(
    rawText: string,
    nodes: readonly WorkspaceRelationNode[],
    excludePath: string,
): WorkspaceRelationNode[] {
    const matched = new Map<string, WorkspaceRelationNode>();

    for (const match of rawText.matchAll(DOC_NUM_REGEX)) {
        const targetNum = normalizeDocNum(match[1]);
        const byNum = nodes.find(
            (n) => n.path !== excludePath && normalizeDocNum(n.documentNumber) === targetNum,
        );

        if (byNum) {
            matched.set(byNum.path, byNum);
        }
    }

    const lower = rawText.toLowerCase();

    for (const node of nodes) {
        if (node.path === excludePath || matched.has(node.path)) {
            continue;
        }

        const kw = inferTitleKeywords(node.title);

        if (kw.length >= 10 && lower.includes(kw)) {
            matched.set(node.path, node);
        }
    }

    return [...matched.values()];
}

function resolveTargetNode(
    rawText: string,
    nodes: readonly WorkspaceRelationNode[],
    excludePath: string,
): WorkspaceRelationNode | null {
    return resolveTargetNodes(rawText, nodes, excludePath)[0] ?? null;
}

function inferExternalHierarchyRank(text: string): number {
    if (/\bHiến pháp\b/iu.test(text)) {
        return 1;
    }

    if (/\/NQ-QH/i.test(text) || /\b(?:Bộ luật|Luật)\b/iu.test(text) || /\/QH\d+/i.test(text)) {
        return 2;
    }

    if (/\bPháp lệnh\b/iu.test(text)) {
        return 3;
    }

    if (/\bNghị quyết\b/iu.test(text) || /\/NQ-(?:HĐTP|UBTVQH|CP)/i.test(text)) {
        return 4;
    }

    if (/\bNghị định\b/iu.test(text) || /\/NĐ-CP/i.test(text)) {
        return 5;
    }

    if (/\bQuyết định\b/iu.test(text)) {
        return 6;
    }

    if (/\bThông tư\b/iu.test(text) || /\/TT-/i.test(text)) {
        return 7;
    }

    return 9;
}

function extractProvisionRefs(text: string): string[] {
    const refs: string[] = [];

    for (const match of text.matchAll(PROVISION_REF_REGEX)) {
        refs.push(match[0].trim());
    }

    return [...new Set(refs)].slice(0, 12);
}

/**
 * Builds the complete legal relation graph & document lifecycle state for all files in the workspace.
 */
export function buildWorkspaceRelationGraph(
    files: readonly LocalWorkspaceFile[],
    activeFilePath?: string,
    activeContent?: string,
): WorkspaceRelationGraph {
    const hasActiveInFiles = activeFilePath ? files.some((file) => file.path === activeFilePath) : true;
    const effectiveFiles: LocalWorkspaceFile[] = files.map((file) => {
        if (activeFilePath && activeContent !== undefined && file.path === activeFilePath) {
            return { ...file, content: activeContent };
        }

        return file;
    });

    if (activeFilePath && activeContent !== undefined && activeContent.trim().length > 0 && !hasActiveInFiles) {
        const firstLine = activeContent.split("\n").find((l) => l.trim().length > 0)?.trim() ?? activeFilePath;
        const meta = extractDocumentMetadata(activeContent, activeFilePath);
        effectiveFiles.push({
            path: activeFilePath,
            name: activeFilePath.split("/").pop() ?? activeFilePath,
            title: firstLine.slice(0, 120),
            documentNumber: meta.documentNumber,
            documentType: meta.documentType,
            content: activeContent,
            isLibrary: false,
            updatedAt: new Date().toISOString(),
        });
    }

    const nodes: WorkspaceRelationNode[] = effectiveFiles.map((file) => {
        const meta = extractDocumentMetadata(file.content, file.path);

        return {
            path: file.path,
            title: file.title,
            documentNumber: file.documentNumber ?? meta.documentNumber,
            documentType: file.documentType ?? meta.documentType,
            hierarchyRank: meta.hierarchyRank,
            issuedDate: meta.issuedDate,
            effectiveDate: meta.effectiveDate,
            isLibrary: file.isLibrary,
            isDraft: !file.isLibrary,
            status: file.isLibrary ? "ACTIVE" : "DRAFT",
            statusNote: file.isLibrary ? "Đang có hiệu lực" : "Dự thảo đang soạn",
            replacedBy: [],
            amendedBy: [],
            repealedProvisions: [],
        };
    });

    const edges: WorkspaceRelationEdge[] = [];
    let edgeSeq = 0;

    for (const file of effectiveFiles) {
        const fromNode = nodes.find((n) => n.path === file.path);

        if (!fromNode) {
            continue;
        }

        const lineStarts = computeLineStarts(file.content);

        // 1. Extract BASED_ON from "Căn cứ ..." strictly in the preamble (before Chương / Điều 1)
        const firstHeadingMatch = /^\s*(?:Chương\s+|Điều\s+\d+)/imu.exec(file.content);
        const preamble = firstHeadingMatch ? file.content.slice(0, firstHeadingMatch.index) : file.content;

        for (const match of preamble.matchAll(BASIS_LINE_REGEX)) {
            const startOffset = match.index ?? 0;
            const endOffset = startOffset + match[0].length;
            const line = positionAtOffset(lineStarts, startOffset).line;
            const target = resolveTargetNode(match[1], nodes, file.path);
            const numMatch = /\b(\d{1,4}\/\d{4}\/[A-ZĐ0-9\-]+)\b/iu.exec(match[1]);

            edgeSeq += 1;
            edges.push({
                id: `rel-${edgeSeq}`,
                fromPath: file.path,
                toPath: target?.path ?? null,
                toExternalLabel: target ? (target.documentNumber ?? target.title) : (numMatch?.[1] ?? match[1].slice(0, 60)),
                relationType: "BASED_ON",
                scope: "FULL",
                targetProvisions: [],
                line,
                startOffset,
                endOffset,
                evidenceText: match[0].trim(),
                isLegalViolation: false,
                violationCode: null,
                violationReason: null,
            });
        }

        // 2. Scan sentences for REPLACES / AMENDS / SUPPLEMENTS / REPEALS / IMPLEMENTS / REFERENCES
        const lines = file.content.split("\n");

        for (let idx = 0; idx < lines.length; idx += 1) {
            const lineText = lines[idx];
            const trimmed = lineText.trim();

            if (!trimmed || /^Căn\s+cứ\s+/iu.test(trimmed)) {
                continue;
            }

            const lineStart = lineStarts[idx] ?? 0;
            const lineNumber = idx + 1;

            let relationType: LegalRelationType | null = null;
            let scope: RelationScope = "PARTIAL";

            if (/(?:hết hiệu lực|thay thế)(?![\p{L}\p{N}])/iu.test(trimmed) && /(?:kể từ ngày|bị thay thế|thay thế\s+(?:Luật|Bộ luật|Nghị định|Nghị quyết|Thông tư|Pháp lệnh))/iu.test(trimmed)) {
                const isPartial = /(?:các\s+quy\s+định\s+về|phần\s+quy\s+định|một\s+số\s+điều|(?:sửa đổi|bãi bỏ|thay thế)\s+(?:một\s+số\s+)?(?:Điều|Khoản))/iu.test(trimmed);
                relationType = /hết hiệu lực/iu.test(trimmed) && !/thay thế/iu.test(trimmed) ? "REPEALS" : "REPLACES";
                scope = isPartial ? "PARTIAL" : "FULL";
            } else if (/quy định chi tiết|hướng dẫn thi hành|hướng dẫn áp dụng|để áp dụng đúng và thống nhất/iu.test(trimmed)) {
                relationType = "IMPLEMENTS";
                scope = "PARTIAL";
            } else if (/sửa đổi\s*(?:,|và)?\s*bổ sung/iu.test(trimmed)) {
                relationType = "AMENDS_SUPPLEMENTS";
                scope = "PARTIAL";
            } else if (/(?<![\p{L}\p{N}])bãi bỏ(?![\p{L}\p{N}])/iu.test(trimmed)) {
                relationType = "REPEALS";
                scope = /(?:toàn bộ|hết hiệu lực)/iu.test(trimmed) ? "FULL" : "PARTIAL";
            } else if (/(?<![\p{L}\p{N}])sửa đổi(?![\p{L}\p{N}])/iu.test(trimmed)) {
                relationType = "AMENDS";
                scope = "PARTIAL";
            } else if (/(?<![\p{L}\p{N}])bổ sung(?![\p{L}\p{N}])/iu.test(trimmed) && /(?:Nghị định|Luật|Bộ luật|Nghị quyết|Thông tư)/iu.test(trimmed)) {
                relationType = "SUPPLEMENTS";
                scope = "PARTIAL";
            }

            if (relationType) {
                const afterCue = trimmed.replace(/^.*?(?:thay thế|bãi bỏ|sửa đổi(?:\s*(?:,|và)?\s*bổ sung)?|quy định chi tiết|hướng dẫn thi hành)\s+/iu, "");
                const targets = resolveTargetNodes(afterCue, nodes, file.path);
                const fallbackTargets = targets.length > 0 ? targets : resolveTargetNodes(trimmed, nodes, file.path);
                const docNumMatches = [...afterCue.matchAll(DOC_NUM_REGEX)].map((m) => m[1]);
                const provRefs = extractProvisionRefs(trimmed);

                if (fallbackTargets.length > 0) {
                    for (const target of fallbackTargets) {
                        edgeSeq += 1;
                        edges.push({
                            id: `rel-${edgeSeq}`,
                            fromPath: file.path,
                            toPath: target.path,
                            toExternalLabel: target.documentNumber ?? target.title,
                            relationType,
                            scope,
                            targetProvisions: provRefs,
                            line: lineNumber,
                            startOffset: lineStart,
                            endOffset: lineStart + lineText.length,
                            evidenceText: trimmed.slice(0, 180),
                            isLegalViolation: false,
                            violationCode: null,
                            violationReason: null,
                        });
                    }
                } else if (docNumMatches.length > 0) {
                    edgeSeq += 1;
                    edges.push({
                        id: `rel-${edgeSeq}`,
                        fromPath: file.path,
                        toPath: null,
                        toExternalLabel: docNumMatches[0] ?? trimmed.slice(0, 50),
                        relationType,
                        scope,
                        targetProvisions: provRefs,
                        line: lineNumber,
                        startOffset: lineStart,
                        endOffset: lineStart + lineText.length,
                        evidenceText: trimmed.slice(0, 180),
                        isLegalViolation: false,
                        violationCode: null,
                        violationReason: null,
                    });
                }
            }
        }
    }

    // 3. Apply lifecycle status from edges
    const nodeMap = new Map(nodes.map((n) => [n.path, n]));

    for (const edge of edges) {
        if (!edge.toPath) {
            continue;
        }

        const fromNode = nodeMap.get(edge.fromPath);
        const toNode = nodeMap.get(edge.toPath);

        if (!fromNode || !toNode || fromNode.isDraft) {
            continue;
        }

        const fromLabel = fromNode.documentNumber ?? fromNode.title;

        if ((edge.relationType === "REPLACES" || edge.relationType === "REPEALS") && edge.scope === "FULL") {
            toNode.status = edge.relationType === "REPLACES" ? "REPLACED" : "REPEALED";

            if (!toNode.replacedBy.includes(fromLabel)) {
                toNode.replacedBy.push(fromLabel);
            }

            toNode.statusNote = `Đã bị thay thế bởi ${toNode.replacedBy.join(" & ")}`;
        } else if (edge.relationType === "REPLACES" || edge.relationType === "REPEALS") {
            if (toNode.status === "ACTIVE" || toNode.status === "AMENDED") {
                toNode.status = "PARTIALLY_REPEALED";
                toNode.statusNote = `Bãi bỏ/thay thế một phần bởi ${fromLabel}`;
            }

            for (const prov of edge.targetProvisions) {
                if (!toNode.repealedProvisions.includes(prov)) {
                    toNode.repealedProvisions.push(prov);
                }
            }
        } else if (
            edge.relationType === "AMENDS" ||
            edge.relationType === "SUPPLEMENTS" ||
            edge.relationType === "AMENDS_SUPPLEMENTS"
        ) {
            if (toNode.status === "ACTIVE") {
                toNode.status = "AMENDED";
                toNode.statusNote = `Được sửa đổi, bổ sung bởi ${fromLabel}`;
            }

            if (!toNode.amendedBy.includes(fromLabel)) {
                toNode.amendedBy.push(fromLabel);
            }
        }
    }

    // 4. Validate edges for legal violations (hierarchy & superseded targets)
    const violations: LegalDiagnostic[] = [];

    for (const edge of edges) {
        const fromNode = nodeMap.get(edge.fromPath);
        const toNode = edge.toPath ? nodeMap.get(edge.toPath) : null;

        if (!fromNode) {
            continue;
        }

        const targetRank = toNode?.hierarchyRank ?? inferExternalHierarchyRank(edge.evidenceText);

        if (edge.relationType === "BASED_ON" && fromNode.hierarchyRank < targetRank && targetRank < 9) {
            edge.isLegalViolation = true;
            edge.violationCode = "LG009";
            edge.violationReason = `Văn bản cấp trên (${fromNode.documentType ?? "cấp trên"}) không được căn cứ vào văn bản cấp dưới (${edge.toExternalLabel}).`;
        } else if (AFFECTING_TYPES.has(edge.relationType) && fromNode.hierarchyRank > targetRank && targetRank < 9) {
            edge.isLegalViolation = true;
            edge.violationCode = "LG014";
            edge.violationReason = `Văn bản cấp dưới (${fromNode.documentType ?? "cấp dưới"}) không có thẩm quyền sửa đổi/bãi bỏ văn bản cấp trên (${edge.toExternalLabel}).`;
        } else if (toNode && (toNode.status === "REPLACED" || toNode.status === "REPEALED")) {
            const isSelfReplacer = toNode.replacedBy.includes(fromNode.documentNumber ?? fromNode.title);

            if (!isSelfReplacer && (edge.relationType === "BASED_ON" || AFFECTING_TYPES.has(edge.relationType))) {
                edge.isLegalViolation = true;
                edge.violationCode = "LG011";
                edge.violationReason = `${edge.toExternalLabel} đã hết hiệu lực (${toNode.statusNote}).`;
            }
        }
    }

    return {
        nodes,
        edges,
        violations,
        summary: {
            totalDocuments: nodes.length,
            totalEdges: edges.length,
            replacedCount: nodes.filter((n) => n.status === "REPLACED" || n.status === "REPEALED").length,
            amendedCount: nodes.filter((n) => n.status === "AMENDED" || n.status === "PARTIALLY_REPEALED").length,
            violationCount: edges.filter((e) => e.isLegalViolation).length,
        },
    };
}

/**
 * Audits the active draft's legal bases (Căn cứ) and cross-document references against Vietnamese legislative rules.
 */
export function auditDraftReferencesAndBases(
    draft: ParsedDraft,
    graph: WorkspaceRelationGraph,
    currentPath?: string,
): LegalDiagnostic[] {
    const diagnostics: LegalDiagnostic[] = [];
    const draftEdges = graph.edges.filter((e) => !currentPath || e.fromPath === currentPath);
    const nodeMap = new Map(graph.nodes.map((n) => [n.path, n]));
    const currentNode = currentPath ? nodeMap.get(currentPath) : null;
    const currentRank = currentNode?.hierarchyRank ?? extractDocumentMetadata(draft.content).hierarchyRank;

    // 1. Check "Căn cứ" order & formatting (Điều 61 NĐ 34/2016/NĐ-CP)
    const basisEdges = draftEdges.filter((e) => e.relationType === "BASED_ON");
    let prevBasisRank = 0;

    for (const edge of basisEdges) {
        const toNode = edge.toPath ? nodeMap.get(edge.toPath) : null;
        const targetRank = toNode?.hierarchyRank ?? inferExternalHierarchyRank(edge.evidenceText);
        const range = rangeFromOffsets(draft.content, draft.lineStarts, edge.startOffset, edge.endOffset);

        if (edge.isLegalViolation && edge.violationCode === "LG009") {
            diagnostics.push({
                id: `LG009-${edge.startOffset}`,
                code: "LG009",
                category: "LOGIC",
                severity: "error",
                title: `Căn cứ sai thứ bậc pháp lý (${edge.toExternalLabel})`,
                message: edge.violationReason ?? "Văn bản cấp trên không được lấy văn bản cấp dưới làm căn cứ ban hành.",
                exploitScenario: "Vi phạm Điều 61 Nghị định 34/2016/NĐ-CP về thẩm quyền và thứ bậc hiệu lực văn bản.",
                suggestion: "Loại bỏ căn cứ cấp dưới hoặc thay bằng văn bản có hiệu lực pháp lý cao hơn.",
                excerpt: edge.evidenceText,
                provisionRef: "Phần Căn cứ",
                range,
                source: "CORPUS",
                quickFix: null,
                corpusLink: null,
            });
        }

        if (edge.isLegalViolation && edge.violationCode === "LG011") {
            diagnostics.push({
                id: `LG011-basis-${edge.startOffset}`,
                code: "LG011",
                category: "LOGIC",
                severity: "error",
                title: `Căn cứ vào văn bản đã hết hiệu lực (${edge.toExternalLabel})`,
                message: `Dự thảo lấy "${edge.toExternalLabel}" làm căn cứ, nhưng trong workspace văn bản này ${toNode?.statusNote ?? "đã bị thay thế/bãi bỏ"}.`,
                exploitScenario: "Văn bản ban hành dựa trên căn cứ đã hết hiệu lực sẽ bị coi là thiếu cơ sở pháp lý.",
                suggestion: `Cập nhật căn cứ sang văn bản thay thế hiện hành (${toNode?.replacedBy.join(", ") || "Luật mới"}).`,
                excerpt: edge.evidenceText,
                provisionRef: "Phần Căn cứ",
                range,
                source: "CORPUS",
                quickFix: null,
                corpusLink: null,
            });
        }

        if (prevBasisRank > 0 && targetRank < prevBasisRank && targetRank < 9) {
            diagnostics.push({
                id: `LG010-${edge.startOffset}`,
                code: "LG010",
                category: "LOGIC",
                severity: "warning",
                title: `Sai thứ tự liệt kê Căn cứ (${edge.toExternalLabel})`,
                message: `Văn bản có hiệu lực pháp lý cao hơn (${edge.toExternalLabel}) đang được xếp sau văn bản có hiệu lực pháp lý thấp hơn.`,
                exploitScenario: "Vi phạm quy tắc trình bày căn cứ từ cao xuống thấp theo Nghị định 34/2016/NĐ-CP và Nghị định 30/2020/NĐ-CP.",
                suggestion: "Sắp xếp lại các dòng Căn cứ theo thứ tự: Hiến pháp → Bộ luật/Luật → Nghị quyết → Nghị định → Thông tư.",
                excerpt: edge.evidenceText,
                provisionRef: "Phần Căn cứ",
                range,
                source: "STATIC",
                quickFix: null,
                corpusLink: null,
            });
        }

        if (targetRank < 9) {
            prevBasisRank = targetRank;
        }

        if (!/[.;]$/.test(edge.evidenceText.trim())) {
            diagnostics.push({
                id: `LG013-semi-${edge.startOffset}`,
                code: "LG013",
                category: "AMBIGUITY",
                severity: "info",
                title: "Dòng Căn cứ thiếu dấu chấm phẩy (;) cuối dòng",
                message: "Theo Nghị định 30/2020/NĐ-CP, mỗi dòng Căn cứ phải kết thúc bằng dấu chấm phẩy (;).",
                exploitScenario: "Lỗi thể thức trình bày văn bản quy phạm pháp luật.",
                suggestion: "Thêm dấu chấm phẩy (;) vào cuối dòng Căn cứ.",
                excerpt: edge.evidenceText,
                provisionRef: "Phần Căn cứ",
                range,
                source: "STATIC",
                quickFix: {
                    label: "Thêm dấu ';' cuối dòng",
                    replacement: `${edge.evidenceText};`,
                    startOffset: edge.startOffset,
                    endOffset: edge.endOffset,
                },
                corpusLink: null,
            });
        }
    }

    if (currentRank >= 5 && currentRank <= 7 && basisEdges.length === 0 && draft.nodes.filter((n) => n.level === "ARTICLE").length >= 4) {
        diagnostics.push({
            id: "LG013-missing-basis",
            code: "LG013",
            category: "LOGIC",
            severity: "info",
            title: "Thiếu phần Căn cứ ban hành",
            message: "Nghị định/Quyết định/Thông tư bắt buộc phải có phần 'Căn cứ ...;' trước nội dung điều khoản.",
            exploitScenario: "Thiếu căn cứ pháp lý làm văn bản không xác định được thẩm quyền ban hành.",
            suggestion: "Bổ sung các dòng 'Căn cứ Luật ...;' ở phần mở đầu văn bản.",
            excerpt: draft.content.slice(0, 60),
            provisionRef: "Phần mở đầu",
            range: rangeFromOffsets(draft.content, draft.lineStarts, 0, Math.min(40, draft.content.length)),
            source: "STATIC",
            quickFix: null,
            corpusLink: null,
        });
    }

    // 2. Check affecting edges (LG014 hierarchy violation, LG011 superseded target, LG012 missing amending doc)
    for (const edge of draftEdges) {
        if (edge.relationType === "BASED_ON") {
            continue;
        }

        const range = rangeFromOffsets(draft.content, draft.lineStarts, edge.startOffset, edge.endOffset);
        const toNode = edge.toPath ? nodeMap.get(edge.toPath) : null;

        if (edge.isLegalViolation && edge.violationCode === "LG014") {
            diagnostics.push({
                id: `LG014-${edge.startOffset}`,
                code: "LG014",
                category: "LOGIC",
                severity: "error",
                title: `Vượt thẩm quyền sửa đổi/bãi bỏ văn bản cấp trên (${edge.toExternalLabel})`,
                message: edge.violationReason ?? "Văn bản cấp dưới không được sửa đổi, thay thế hoặc bãi bỏ văn bản cấp trên.",
                exploitScenario: "Điều khoản trái thẩm quyền sẽ bị đình chỉ thi hành hoặc bãi bỏ.",
                suggestion: "Chỉ sửa đổi/bãi bỏ văn bản cùng cấp hoặc cấp dưới thuộc thẩm quyền.",
                excerpt: edge.evidenceText,
                provisionRef: `Dòng ${edge.line}`,
                range,
                source: "CORPUS",
                quickFix: null,
                corpusLink: null,
            });
        } else if (edge.isLegalViolation && edge.violationCode === "LG011") {
            diagnostics.push({
                id: `LG011-aff-${edge.startOffset}`,
                code: "LG011",
                category: "LOGIC",
                severity: "error",
                title: `Sửa đổi/dẫn chiếu văn bản đã hết hiệu lực (${edge.toExternalLabel})`,
                message: `Dự thảo tác động tới "${edge.toExternalLabel}", nhưng văn bản này ${toNode?.statusNote ?? "đã bị thay thế"}.`,
                exploitScenario: "Sửa đổi văn bản đã hết hiệu lực không làm thay đổi quy phạm hiện hành.",
                suggestion: `Chuyển đối tượng tác động sang văn bản hiện hành (${toNode?.replacedBy.join(", ") || "văn bản thay thế"}).`,
                excerpt: edge.evidenceText,
                provisionRef: `Dòng ${edge.line}`,
                range,
                source: "CORPUS",
                quickFix: null,
                corpusLink: null,
            });
        } else if (toNode && toNode.status === "AMENDED" && toNode.amendedBy.length > 0) {
            const currentLabel = currentNode?.documentNumber ?? currentNode?.title ?? "";
            const currentDate = currentNode?.issuedDate ?? currentNode?.effectiveDate ?? null;
            const preambleText = draft.content.slice(0, 1200);
            const applicableAmenders = toNode.amendedBy.filter((am) => {
                if (currentLabel && am === currentLabel) {
                    return false;
                }

                const amNode = graph.nodes.find((n) => (n.documentNumber ?? n.title) === am);
                const amDate = amNode?.issuedDate ?? amNode?.effectiveDate ?? null;

                if (currentDate && amDate && amDate > currentDate) {
                    return false;
                }

                return true;
            });

            const mentionsAmender = applicableAmenders.length === 0
                || applicableAmenders.some((am) => edge.evidenceText.includes(am) || preambleText.includes(am));

            if (!mentionsAmender) {
                diagnostics.push({
                    id: `LG012-${edge.startOffset}`,
                    code: "LG012",
                    category: "LOGIC",
                    severity: "warning",
                    title: `Viện dẫn văn bản gốc nhưng thiếu văn bản sửa đổi (${edge.toExternalLabel})`,
                    message: `"${edge.toExternalLabel}" đã được sửa đổi, bổ sung bởi ${applicableAmenders.join(", ")} nhưng trích dẫn chưa nêu kèm văn bản sửa đổi.`,
                    exploitScenario: "Có thể áp dụng nhầm nội dung điều khoản cũ đã bị sửa đổi.",
                    suggestion: `Ghi rõ "${edge.toExternalLabel} (đã được sửa đổi, bổ sung bởi ${applicableAmenders.join(", ")})".`,
                    excerpt: edge.evidenceText,
                    provisionRef: `Dòng ${edge.line}`,
                    range,
                    source: "CORPUS",
                    quickFix: null,
                    corpusLink: null,
                });
            }
        }
    }

    return diagnostics;
}
