import {
    AFFECTING_RELATION_TYPES,
    DEPENDENCY_RELATION_TYPES,
    TERMINATING_RELATION_TYPES,
    documentLabelOf,
    extractExternalDocumentNumbers,
    normalizeDocNumber,
    normalizeText,
    provisionLabelOf,
} from "./analysis.helpers";
import type {
    AnalysisDocument,
    AnalysisProvision,
    DirectImpactedDocument,
    ImpactRiskLevel,
    ImpactScopeReport,
    ImpactedProvisionItem,
    IndirectImpactedDocument,
    SynchronizationItem,
    UnresolvedCitationItem,
    WorkspaceAnalysisSnapshot,
} from "./analysis.types";

const DEFAULT_MAX_DEPTH = 3;
const DISCLAIMER =
    "Phạm vi tác động được tính trên tập văn bản và quan hệ hiện có trong Workspace. Các số hiệu văn bản trong mục Frontier chưa được nhập vào Workspace có thể chứa thêm tác động dây chuyền.";

const SUBJECT_PATTERNS: { label: string; pattern: RegExp }[] = [
    { label: "Người điều khiển xe ô tô", pattern: /\bxe\s+o\s+to\b/i },
    { label: "Người điều khiển xe mô tô / xe gắn máy", pattern: /\bxe\s+(mo\s+to|gan\s+may|may)\b/i },
    { label: "Phương tiện lưu thông trên đường cao tốc", pattern: /\bduong\s+cao\s+toc\b|\bcao\s+toc\b/i },
    { label: "Người sở hữu giấy phép lái xe (cơ chế trừ điểm)", pattern: /\bgiay\s+phep\s+lai\s+xe\b|\bgplx\b|\btru\s+\d+\s+diem\b/i },
    { label: "Người đi bộ / phương tiện thô sơ", pattern: /\bnguoi\s+di\s+bo\b|\bxe\s+dap\b|\btho\s+so\b/i },
    { label: "Doanh nghiệp / Tổ chức kinh doanh vận tải", pattern: /\bto\s+chuc\b|\bdoanh\s+nghiep\b|\bkinh\s+doanh\s+van\s+tai\b/i },
    { label: "Cơ quan thực thi & xử phạt (CSGT / Thanh tra)", pattern: /\bbo\s+cong\s+an\b|\bcanh\s+sat\s+giao\s+thong\b|\bthong\s+tu\b/i },
];

/** Computes direct (1-hop) and cascading transitive (multi-hop) legal impact scope for a document or draft. */
export function analyzeImpactScope(
    snapshot: WorkspaceAnalysisSnapshot,
    documentId: string,
    maxDepth: number = DEFAULT_MAX_DEPTH,
): ImpactScopeReport | null {
    const targetDoc = snapshot.documents.find((doc) => doc.id === documentId);

    if (!targetDoc) {
        return null;
    }

    const boundedDepth = Math.max(1, Math.min(5, Math.floor(maxDepth)));
    const docMap = new Map(snapshot.documents.map((doc) => [doc.id, doc]));
    const provMap = new Map(snapshot.provisions.map((prov) => [prov.id, prov]));

    const directImpacts = collectDirectImpacts(targetDoc.id, snapshot, docMap);
    const indirectImpacts = collectIndirectImpacts(targetDoc, directImpacts, snapshot, docMap, boundedDepth);
    const affectedProvisions = collectAffectedProvisions(targetDoc.id, snapshot, docMap, provMap);
    const sanctionShifts = snapshot.sanctionEdges.filter(
        (edge) => edge.fromDocumentId === targetDoc.id,
    );
    const affectedSubjects = collectAffectedSubjects(targetDoc.id, snapshot, sanctionShifts);
    const unresolvedFrontier = collectUnresolvedFrontier(targetDoc, snapshot);
    const synchronizationChecklist = buildSynchronizationChecklist(
        directImpacts,
        indirectImpacts,
        unresolvedFrontier,
        docMap,
    );

    const escalatedCount = sanctionShifts.filter(
        (edge) =>
            edge.changeType === "SANCTION_INCREASE" ||
            (edge.severityDeltaPercent !== null && edge.severityDeltaPercent > 0),
    ).length;
    const reducedCount = sanctionShifts.filter(
        (edge) =>
            edge.changeType === "SANCTION_DECREASE" ||
            (edge.severityDeltaPercent !== null && edge.severityDeltaPercent < 0),
    ).length;
    const addedOrRepealedCount = sanctionShifts.filter(
        (edge) => edge.changeType === "VIOLATION_ADDED" || edge.changeType === "REPEALED",
    ).length;

    const riskLevel = computeRiskLevel(directImpacts, indirectImpacts, sanctionShifts, unresolvedFrontier);

    return {
        workspaceId: snapshot.workspaceId,
        documentId: targetDoc.id,
        documentNumber: targetDoc.documentNumber,
        documentTitle: targetDoc.title,
        effectiveFrom: targetDoc.effectiveFrom,
        analyzedAt: new Date().toISOString(),
        maxDepth: boundedDepth,
        summary: {
            riskLevel,
            directDocumentCount: directImpacts.length,
            indirectDocumentCount: indirectImpacts.length,
            affectedProvisionCount: affectedProvisions.length,
            sanctionShiftCount: sanctionShifts.length,
            escalatedCount,
            reducedCount,
            addedOrRepealedCount,
            unresolvedCitationCount: unresolvedFrontier.length,
        },
        directImpacts,
        indirectImpacts,
        affectedProvisions,
        sanctionShifts,
        affectedSubjects,
        unresolvedFrontier,
        synchronizationChecklist,
        disclaimer: DISCLAIMER,
    };
}

function collectDirectImpacts(
    documentId: string,
    snapshot: WorkspaceAnalysisSnapshot,
    docMap: Map<string, AnalysisDocument>,
): DirectImpactedDocument[] {
    const provCountByTargetDoc = new Map<string, number>();

    for (const rel of snapshot.provisionRelations) {
        if (rel.fromDocumentId !== documentId) {
            continue;
        }

        provCountByTargetDoc.set(rel.toDocumentId, (provCountByTargetDoc.get(rel.toDocumentId) ?? 0) + 1);
    }

    const seenKeys = new Set<string>();
    const results: DirectImpactedDocument[] = [];

    for (const rel of snapshot.documentRelations) {
        if (rel.fromDocumentId !== documentId || rel.toDocumentId === documentId) {
            continue;
        }

        if (!AFFECTING_RELATION_TYPES.has(rel.relationType)) {
            continue;
        }

        const dedupKey = `${rel.toDocumentId}:${rel.relationType}`;

        if (seenKeys.has(dedupKey)) {
            continue;
        }

        seenKeys.add(dedupKey);
        const target = docMap.get(rel.toDocumentId);

        if (!target) {
            continue;
        }

        results.push({
            documentId: target.id,
            documentNumber: target.documentNumber,
            title: target.title,
            documentType: target.documentType,
            relationType: rel.relationType,
            scope: rel.scope,
            sourceMode: rel.sourceMode,
            note: rel.note,
            affectedProvisionCount: provCountByTargetDoc.get(target.id) ?? 0,
        });
    }

    return results;
}

function collectIndirectImpacts(
    sourceDoc: AnalysisDocument,
    directImpacts: DirectImpactedDocument[],
    snapshot: WorkspaceAnalysisSnapshot,
    docMap: Map<string, AnalysisDocument>,
    maxDepth: number,
): IndirectImpactedDocument[] {
    if (maxDepth < 2 || directImpacts.length === 0) {
        return [];
    }

    // Build reverse dependency index: if X GUIDES / DETAILS / LEGAL_BASIS / REFERENCES / AMENDS Y,
    // then when Y changes, X is transitively affected and needs review/synchronization!
    const dependentsByTarget = new Map<string, { dependentId: string; relationType: string }[]>();

    for (const rel of snapshot.documentRelations) {
        if (rel.fromDocumentId === rel.toDocumentId) {
            continue;
        }

        if (!DEPENDENCY_RELATION_TYPES.has(rel.relationType)) {
            continue;
        }

        const list = dependentsByTarget.get(rel.toDocumentId) ?? [];
        list.push({ dependentId: rel.fromDocumentId, relationType: rel.relationType });
        dependentsByTarget.set(rel.toDocumentId, list);
    }

    const visited = new Set<string>([sourceDoc.id]);
    const queue: { docId: string; depth: number; path: string[] }[] = [];

    for (const direct of directImpacts) {
        visited.add(direct.documentId);
        const directDoc = docMap.get(direct.documentId);
        queue.push({
            docId: direct.documentId,
            depth: 1,
            path: [documentLabelOf(sourceDoc), directDoc ? documentLabelOf(directDoc) : direct.documentId],
        });
    }

    const indirect: IndirectImpactedDocument[] = [];

    while (queue.length > 0) {
        const current = queue.shift();

        if (!current || current.depth >= maxDepth) {
            continue;
        }

        const dependents = dependentsByTarget.get(current.docId) ?? [];

        for (const dep of dependents) {
            if (visited.has(dep.dependentId)) {
                continue;
            }

            const depDoc = docMap.get(dep.dependentId);

            if (!depDoc) {
                continue;
            }

            visited.add(dep.dependentId);
            const nextDepth = current.depth + 1;
            const nextPath = [...current.path, documentLabelOf(depDoc)];
            const viaDoc = docMap.get(current.docId);

            indirect.push({
                documentId: depDoc.id,
                documentNumber: depDoc.documentNumber,
                title: depDoc.title,
                documentType: depDoc.documentType,
                depth: nextDepth,
                viaDocumentId: current.docId,
                viaRelationType: dep.relationType,
                impactPath: nextPath,
                reason: buildTransitiveReason(dep.relationType, viaDoc ? documentLabelOf(viaDoc) : current.docId),
            });

            if (nextDepth < maxDepth) {
                queue.push({
                    docId: depDoc.id,
                    depth: nextDepth,
                    path: nextPath,
                });
            }
        }
    }

    return indirect;
}

function buildTransitiveReason(relationType: string, viaLabel: string): string {
    if (relationType === "GUIDES" || relationType === "DETAILS" || relationType === "EXPLAINS") {
        return `Văn bản hướng dẫn / quy định chi tiết cho ${viaLabel}, cần rà soát sửa đổi đồng bộ khi văn bản gốc thay đổi.`;
    }

    if (relationType === "LEGAL_BASIS") {
        return `Văn bản lấy ${viaLabel} làm căn cứ ban hành, có nguy cơ thay đổi cơ sở pháp lý.`;
    }

    if (relationType === "REFERENCES") {
        return `Văn bản có dẫn chiếu tới ${viaLabel}, cần kiểm tra lại các điều khoản viện dẫn.`;
    }

    return `Văn bản có quan hệ sửa đổi/bổ sung gắn với ${viaLabel}, cần đối chiếu hiệu lực chồng chéo.`;
}

function collectAffectedProvisions(
    documentId: string,
    snapshot: WorkspaceAnalysisSnapshot,
    docMap: Map<string, AnalysisDocument>,
    provMap: Map<string, AnalysisProvision>,
): ImpactedProvisionItem[] {
    return snapshot.provisionRelations
        .filter((rel) => rel.fromDocumentId === documentId)
        .map((rel) => {
            const fromProv = provMap.get(rel.fromProvisionId);
            const toProv = rel.toProvisionId ? provMap.get(rel.toProvisionId) : null;
            const toDoc = docMap.get(rel.toDocumentId);

            return {
                relationId: rel.id,
                fromProvisionId: rel.fromProvisionId,
                fromProvisionLabel: fromProv ? provisionLabelOf(fromProv) : rel.fromProvisionId,
                toDocumentId: rel.toDocumentId,
                toDocumentLabel: toDoc ? documentLabelOf(toDoc) : rel.toDocumentId,
                toProvisionId: rel.toProvisionId,
                toProvisionLabel: toProv ? provisionLabelOf(toProv) : null,
                relationType: rel.relationType,
                evidenceText: rel.evidenceText,
                effectiveFrom: rel.effectiveFrom,
                sourceMode: rel.sourceMode,
            };
        });
}

function collectAffectedSubjects(
    documentId: string,
    snapshot: WorkspaceAnalysisSnapshot,
    sanctionShifts: WorkspaceAnalysisSnapshot["sanctionEdges"],
): string[] {
    const corpusParts: string[] = [];

    for (const prov of snapshot.provisions) {
        if (prov.documentId === documentId) {
            if (prov.title) {
                corpusParts.push(prov.title);
            }

            if (prov.text) {
                corpusParts.push(prov.text);
            }
        }
    }

    for (const shift of sanctionShifts) {
        corpusParts.push(shift.behaviorSummary);

        if (shift.note) {
            corpusParts.push(shift.note);
        }
    }

    const normalizedCorpus = normalizeText(corpusParts.join(" "));
    const subjects: string[] = [];

    for (const item of SUBJECT_PATTERNS) {
        if (item.pattern.test(normalizedCorpus)) {
            subjects.push(item.label);
        }
    }

    return subjects;
}

function collectUnresolvedFrontier(
    targetDoc: AnalysisDocument,
    snapshot: WorkspaceAnalysisSnapshot,
): UnresolvedCitationItem[] {
    const knownNumbers = new Set<string>();

    for (const doc of snapshot.documents) {
        if (doc.normalizedNumber) {
            knownNumbers.add(doc.normalizedNumber);
        } else if (doc.documentNumber) {
            knownNumbers.add(normalizeDocNumber(doc.documentNumber));
        }
    }

    const seen = new Set<string>();
    const frontier: UnresolvedCitationItem[] = [];

    for (const prov of snapshot.provisions) {
        if (prov.documentId !== targetDoc.id || !prov.text) {
            continue;
        }

        for (const citation of extractExternalDocumentNumbers(prov.text)) {
            const normalized = normalizeDocNumber(citation);

            if (knownNumbers.has(normalized) || seen.has(normalized)) {
                continue;
            }

            seen.add(normalized);
            frontier.push({
                citation,
                provisionId: prov.id,
                provisionLabel: provisionLabelOf(prov),
            });
        }
    }

    return frontier;
}

function buildSynchronizationChecklist(
    directImpacts: DirectImpactedDocument[],
    indirectImpacts: IndirectImpactedDocument[],
    unresolvedFrontier: UnresolvedCitationItem[],
    docMap: Map<string, AnalysisDocument>,
): SynchronizationItem[] {
    const items: SynchronizationItem[] = [];

    for (const direct of directImpacts) {
        const doc = docMap.get(direct.documentId);
        const label = doc ? documentLabelOf(doc) : direct.documentId;

        if (TERMINATING_RELATION_TYPES.has(direct.relationType) && direct.scope === "FULL") {
            items.push({
                priority: "HIGH",
                targetDocumentId: direct.documentId,
                targetLabel: label,
                action: `Rà soát điều khoản chuyển tiếp cho văn bản bị thay thế/bãi bỏ toàn bộ (${label})`,
                reason: `Dự thảo tác động toàn bộ (${direct.relationType}) lên ${label}, cần quy định rõ việc xử lý các hồ sơ/vụ việc đang thi hành.`,
            });
        } else {
            items.push({
                priority: "MEDIUM",
                targetDocumentId: direct.documentId,
                targetLabel: label,
                action: `Kiểm tra hợp nhất và đối chiếu các điều khoản bị tác động tại ${label}`,
                reason: `Có quan hệ ${direct.relationType} trực tiếp${direct.affectedProvisionCount > 0 ? ` (${direct.affectedProvisionCount} điều khoản được nối)` : ""}.`,
            });
        }
    }

    for (const indirect of indirectImpacts) {
        const doc = docMap.get(indirect.documentId);
        const label = doc ? documentLabelOf(doc) : indirect.documentId;

        items.push({
            priority: indirect.viaRelationType === "GUIDES" || indirect.viaRelationType === "DETAILS" ? "HIGH" : "MEDIUM",
            targetDocumentId: indirect.documentId,
            targetLabel: label,
            action: `Sửa đổi/rà soát đồng bộ văn bản liên quan cấp ${indirect.depth}: ${label}`,
            reason: indirect.reason,
        });
    }

    for (const missing of unresolvedFrontier) {
        items.push({
            priority: "LOW",
            targetDocumentId: null,
            targetLabel: missing.citation,
            action: `Bổ sung văn bản "${missing.citation}" vào Workspace`,
            reason: `Được dẫn chiếu tại ${missing.provisionLabel} nhưng chưa có dữ liệu trong Workspace để đánh giá đầy đủ tác động dây chuyền.`,
        });
    }

    return items;
}

function computeRiskLevel(
    directImpacts: DirectImpactedDocument[],
    indirectImpacts: IndirectImpactedDocument[],
    sanctionShifts: WorkspaceAnalysisSnapshot["sanctionEdges"],
    unresolvedFrontier: UnresolvedCitationItem[],
): ImpactRiskLevel {
    const hasFullTermination = directImpacts.some(
        (item) => TERMINATING_RELATION_TYPES.has(item.relationType) && item.scope === "FULL",
    );
    const hasSharpSanctionJump = sanctionShifts.some(
        (edge) => edge.severityDeltaPercent !== null && Math.abs(edge.severityDeltaPercent) >= 50,
    );

    if (hasFullTermination || directImpacts.length >= 3 || indirectImpacts.length >= 2 || hasSharpSanctionJump) {
        return "HIGH";
    }

    if (directImpacts.length >= 1 || indirectImpacts.length >= 1 || sanctionShifts.length >= 1 || unresolvedFrontier.length >= 1) {
        return "MEDIUM";
    }

    return "LOW";
}
