import {
    AFFECTING_RELATION_TYPES,
    TERMINATING_RELATION_TYPES,
    computeJaccardSimilarity,
    documentLabelOf,
    extractBehaviorTokens,
    extractExternalDocumentNumbers,
    hasAmendmentLanguage,
    isValidIsoDate,
    normalizeDocNumber,
    parseFineRanges,
    parsePointDeductions,
    provisionLabelOf,
} from "./analysis.helpers";
import type {
    AnalysisDocument,
    AnalysisProvision,
    LogicAuditFinding,
    WorkspaceAnalysisSnapshot,
} from "./analysis.types";

export type PushFinding = (finding: Omit<LogicAuditFinding, "id">) => void;

const MAX_GPLX_POINTS = 12;

export function checkTemporalRules(
    targetDoc: AnalysisDocument,
    snapshot: WorkspaceAnalysisSnapshot,
    docMap: Map<string, AnalysisDocument>,
    pushFinding: PushFinding,
): void {
    // 1. effectiveFrom < issuedAt
    if (isValidIsoDate(targetDoc.issuedAt) && isValidIsoDate(targetDoc.effectiveFrom)) {
        if (targetDoc.effectiveFrom < targetDoc.issuedAt) {
            pushFinding({
                code: "TEMP_EFFECTIVE_BEFORE_ISSUED",
                category: "TEMPORAL",
                severity: "ERROR",
                title: "Ngày hiệu lực sớm hơn ngày ban hành",
                message: `Văn bản có ngày hiệu lực (${targetDoc.effectiveFrom}) sớm hơn ngày ban hành (${targetDoc.issuedAt}).`,
                provisionId: null,
                relatedDocumentId: null,
                relatedProvisionId: null,
                evidence: `Ban hành: ${targetDoc.issuedAt} | Hiệu lực: ${targetDoc.effectiveFrom}`,
                suggestion: "Cập nhật ngày có hiệu lực phải bằng hoặc sau ngày ban hành (trừ trường hợp hồi tố đặc biệt cần ghi chú rõ).",
            });
        }
    }

    const outgoing = snapshot.documentRelations.filter(
        (rel) => rel.fromDocumentId === targetDoc.id && AFFECTING_RELATION_TYPES.has(rel.relationType),
    );

    for (const rel of outgoing) {
        // 2. Self relation
        if (rel.toDocumentId === targetDoc.id) {
            pushFinding({
                code: "TEMP_SELF_RELATION",
                category: "TEMPORAL",
                severity: "ERROR",
                title: "Văn bản tự tác động lên chính nó",
                message: `Văn bản đang có quan hệ ${rel.relationType} trỏ ngược về chính nó.`,
                provisionId: null,
                relatedDocumentId: targetDoc.id,
                relatedProvisionId: null,
                evidence: rel.note ?? rel.relationType,
                suggestion: "Xóa cạnh quan hệ tự trỏ này trong Lược đồ tác động.",
            });
            continue;
        }

        const otherDoc = docMap.get(rel.toDocumentId);

        if (!otherDoc) {
            continue;
        }

        // 3. Amending/repealing before target's effective date
        if (isValidIsoDate(targetDoc.effectiveFrom) && isValidIsoDate(otherDoc.effectiveFrom)) {
            if (targetDoc.effectiveFrom < otherDoc.effectiveFrom) {
                pushFinding({
                    code: "TEMP_AMEND_BEFORE_TARGET_EFFECTIVE",
                    category: "TEMPORAL",
                    severity: "ERROR",
                    title: "Hiệu lực sửa đổi sớm hơn văn bản gốc",
                    message: `Văn bản này có hiệu lực từ ${targetDoc.effectiveFrom}, sớm hơn ngày hiệu lực (${otherDoc.effectiveFrom}) của văn bản đích ${documentLabelOf(otherDoc)}.`,
                    provisionId: null,
                    relatedDocumentId: otherDoc.id,
                    relatedProvisionId: null,
                    evidence: `${targetDoc.effectiveFrom} < ${otherDoc.effectiveFrom}`,
                    suggestion: "Điều chỉnh ngày dự kiến có hiệu lực của dự thảo cho phù hợp với văn bản bị tác động.",
                });
            }
        }

        // 4. Amending a document that was already fully repealed/replaced by another document
        if (rel.relationType === "AMENDS" || rel.relationType === "SUPPLEMENTS" || rel.relationType === "AMENDS_OR_SUPPLEMENTS") {
            const terminatingEdge = snapshot.documentRelations.find(
                (edge) =>
                    edge.toDocumentId === otherDoc.id &&
                    edge.fromDocumentId !== targetDoc.id &&
                    TERMINATING_RELATION_TYPES.has(edge.relationType) &&
                    edge.scope === "FULL",
            );

            if (terminatingEdge) {
                const terminator = docMap.get(terminatingEdge.fromDocumentId);
                const terminatorEffective = terminator?.effectiveFrom ?? terminator?.issuedAt ?? null;
                const draftEffective = targetDoc.effectiveFrom ?? targetDoc.issuedAt ?? null;
                const alreadyTerminated =
                    !isValidIsoDate(terminatorEffective) ||
                    !isValidIsoDate(draftEffective) ||
                    terminatorEffective <= draftEffective;

                if (alreadyTerminated) {
                    pushFinding({
                        code: "TEMP_AMEND_REPEALED_TARGET",
                        category: "TEMPORAL",
                        severity: "ERROR",
                        title: "Sửa đổi văn bản đã hết hiệu lực / bị thay thế toàn bộ",
                        message: `Dự thảo đang sửa đổi ${documentLabelOf(otherDoc)}, nhưng văn bản này đã bị ${terminator ? documentLabelOf(terminator) : terminatingEdge.fromDocumentId} thay thế/bãi bỏ toàn bộ.`,
                        provisionId: null,
                        relatedDocumentId: otherDoc.id,
                        relatedProvisionId: null,
                        evidence: terminatingEdge.note ?? `${terminatingEdge.relationType} (FULL)`,
                        suggestion: terminator
                            ? `Chuyển mục tiêu sửa đổi sang văn bản hiện hành ${documentLabelOf(terminator)} thay vì sửa văn bản đã hết hiệu lực.`
                            : "Kiểm tra lại hiệu lực văn bản đích trước khi sửa đổi.",
                    });
                }
            }
        }
    }

    // 5. Cycle detection in affecting relations involving targetDoc
    const cyclePartner = findAffectingCycle(targetDoc.id, snapshot);

    if (cyclePartner) {
        const partnerDoc = docMap.get(cyclePartner);

        pushFinding({
            code: "TEMP_RELATION_CYCLE",
            category: "TEMPORAL",
            severity: "ERROR",
            title: "Phát hiện chu trình mâu thuẫn trong quan hệ sửa đổi",
            message: `Quan hệ tác động giữa văn bản này và ${partnerDoc ? documentLabelOf(partnerDoc) : cyclePartner} tạo thành vòng lặp khép kín, gây mâu thuẫn thứ tự hiệu lực.`,
            provisionId: null,
            relatedDocumentId: cyclePartner,
            relatedProvisionId: null,
            evidence: `${documentLabelOf(targetDoc)} ⇄ ${partnerDoc ? documentLabelOf(partnerDoc) : cyclePartner}`,
            suggestion: "Xác định lại chiều tác động một hướng theo thứ tự thời gian ban hành giữa các văn bản.",
        });
    }
}

function findAffectingCycle(startDocId: string, snapshot: WorkspaceAnalysisSnapshot): string | null {
    const adjacency = new Map<string, string[]>();

    for (const rel of snapshot.documentRelations) {
        if (!AFFECTING_RELATION_TYPES.has(rel.relationType) || rel.fromDocumentId === rel.toDocumentId) {
            continue;
        }

        const targets = adjacency.get(rel.fromDocumentId) ?? [];
        targets.push(rel.toDocumentId);
        adjacency.set(rel.fromDocumentId, targets);
    }

    const firstHops = adjacency.get(startDocId) ?? [];

    for (const hop of firstHops) {
        const visited = new Set<string>([hop]);
        const queue: string[] = [hop];

        while (queue.length > 0) {
            const current = queue.shift();

            if (!current) {
                continue;
            }

            const nextNodes = adjacency.get(current) ?? [];

            for (const next of nextNodes) {
                if (next === startDocId) {
                    return hop;
                }

                if (!visited.has(next)) {
                    visited.add(next);
                    queue.push(next);
                }
            }
        }
    }

    return null;
}

export function checkReferenceRules(
    targetDoc: AnalysisDocument,
    provisions: AnalysisProvision[],
    snapshot: WorkspaceAnalysisSnapshot,
    docByNormalizedNumber: Map<string, AnalysisDocument>,
    pushFinding: PushFinding,
): void {
    const existingArticles = new Set(
        provisions
            .filter((prov) => prov.articleNo)
            .map((prov) => prov.articleNo!.trim().toLowerCase()),
    );

    const clausesByArticle = new Map<string, Set<string>>();

    for (const prov of provisions) {
        if (prov.articleNo && prov.paragraphNo) {
            const artKey = prov.articleNo.trim().toLowerCase();
            const set = clausesByArticle.get(artKey) ?? new Set<string>();
            set.add(prov.paragraphNo.trim().toLowerCase());
            clausesByArticle.set(artKey, set);
        }
    }

    const hasOutgoingDocRel = snapshot.documentRelations.some(
        (rel) => rel.fromDocumentId === targetDoc.id && AFFECTING_RELATION_TYPES.has(rel.relationType),
    );
    const linkedProvisionIds = new Set(
        snapshot.provisionRelations
            .filter((rel) => rel.fromDocumentId === targetDoc.id)
            .map((rel) => rel.fromProvisionId),
    );
    const selfNormalizedNumber = targetDoc.normalizedNumber ?? (targetDoc.documentNumber ? normalizeDocNumber(targetDoc.documentNumber) : null);

    for (const prov of provisions) {
        const text = prov.text?.trim() ?? "";

        if (!text) {
            continue;
        }

        // 1. Check internal citations ("khoản X Điều này", "Điều Y" when not citing external doc)
        const clauseThisArtRegex = /khoản\s+(\d+)\s+Điều\s+này/giu;
        let match: RegExpExecArray | null;

        while ((match = clauseThisArtRegex.exec(text)) !== null) {
            const citedClause = match[1]?.trim().toLowerCase();
            const artKey = prov.articleNo?.trim().toLowerCase();

            if (citedClause && artKey && !clausesByArticle.get(artKey)?.has(citedClause)) {
                pushFinding({
                    code: "REF_BROKEN_INTERNAL_CITATION",
                    category: "REFERENCE",
                    severity: "ERROR",
                    title: "Dẫn chiếu nội văn bản tới Khoản không tồn tại",
                    message: `${provisionLabelOf(prov)} dẫn chiếu tới "${match[0]}", nhưng Điều ${prov.articleNo} không có Khoản ${citedClause}.`,
                    provisionId: prov.id,
                    relatedDocumentId: null,
                    relatedProvisionId: null,
                    evidence: match[0],
                    suggestion: "Kiểm tra lại số Khoản được viện dẫn hoặc bổ sung Khoản còn thiếu.",
                });
            }
        }

        const internalArticleRegex = /\bĐiều\s+(\d+)\b(?!\s+(?:Nghị\s+định|Luật|Thông\s+tư|Nghị\s+quyết|Quyết\s+định|của\s+(?:Nghị\s+định|Luật|Thông\s+tư)))/giu;

        while ((match = internalArticleRegex.exec(text)) !== null) {
            const citedArticle = match[1]?.trim().toLowerCase();
            const afterText = text.slice(match.index + match[0].length, match.index + match[0].length + 45);
            const pointsExternal = /^\s*(?:của\s+)?(?:Nghị\s+định|Luật|Thông\s+tư|Nghị\s+quyết|Pháp\s+lệnh)/iu.test(afterText);

            if (citedArticle && !pointsExternal && existingArticles.size > 0 && !existingArticles.has(citedArticle)) {
                pushFinding({
                    code: "REF_BROKEN_INTERNAL_CITATION",
                    category: "REFERENCE",
                    severity: "ERROR",
                    title: "Dẫn chiếu tới Điều không tồn tại trong văn bản",
                    message: `${provisionLabelOf(prov)} viện dẫn "${match[0]}", nhưng văn bản hiện chưa có Điều ${citedArticle}.`,
                    provisionId: prov.id,
                    relatedDocumentId: null,
                    relatedProvisionId: null,
                    evidence: match[0],
                    suggestion: "Cập nhật số hiệu Điều viện dẫn hoặc bổ sung tên văn bản nếu đây là dẫn chiếu sang văn bản khác.",
                });
            }
        }

        // 2. External document numbers cited in prose that are not yet in the workspace
        const citedNumbers = extractExternalDocumentNumbers(text);

        for (const rawNum of citedNumbers) {
            const normalized = normalizeDocNumber(rawNum);

            if (normalized === selfNormalizedNumber) {
                continue;
            }

            if (!docByNormalizedNumber.has(normalized)) {
                pushFinding({
                    code: "REF_UNRESOLVED_EXTERNAL_DOCUMENT",
                    category: "REFERENCE",
                    severity: "WARNING",
                    title: "Văn bản được dẫn chiếu chưa có trong Workspace",
                    message: `${provisionLabelOf(prov)} trích dẫn số hiệu "${rawNum}" nhưng văn bản này chưa có trong Workspace để đối chiếu hiệu lực và chồng chéo.`,
                    provisionId: prov.id,
                    relatedDocumentId: null,
                    relatedProvisionId: null,
                    evidence: rawNum,
                    suggestion: `Nhập PDF hoặc tạo bản ghi văn bản "${rawNum}" vào Workspace để mở rộng phạm vi rà soát.`,
                });
            }
        }

        // 3. Amendment language in provision without any linked DocumentRelation or ProvisionRelation
        if (hasAmendmentLanguage(text) && !linkedProvisionIds.has(prov.id) && !hasOutgoingDocRel) {
            pushFinding({
                code: "REF_UNLINKED_AMENDMENT_CLAUSE",
                category: "REFERENCE",
                severity: "WARNING",
                title: "Điều khoản có lệnh sửa đổi/bãi bỏ nhưng chưa nối quan hệ",
                message: `${provisionLabelOf(prov)} chứa câu lệnh sửa đổi/bổ sung/bãi bỏ nhưng chưa được nối cạnh quan hệ tác động trong Lược đồ.`,
                provisionId: prov.id,
                relatedDocumentId: null,
                relatedProvisionId: null,
                evidence: text.slice(0, 140),
                suggestion: "Mở Lược đồ tác động (Chế độ 2) để nối cạnh ảnh hưởng tới văn bản/điều khoản đích tương ứng.",
            });
        }
    }
}

export function checkSanctionAndConflictRules(
    targetDoc: AnalysisDocument,
    provisions: AnalysisProvision[],
    snapshot: WorkspaceAnalysisSnapshot,
    docMap: Map<string, AnalysisDocument>,
    pushFinding: PushFinding,
): void {
    // 1. Check inverted fines & invalid point deductions inside provision texts
    for (const prov of provisions) {
        const text = prov.text?.trim() ?? "";

        if (!text) {
            continue;
        }

        for (const fine of parseFineRanges(text)) {
            if (fine.min > fine.max) {
                pushFinding({
                    code: "SANC_INVERTED_FINE_RANGE",
                    category: "SANCTION_CONFLICT",
                    severity: "ERROR",
                    title: "Khung phạt tiền bị đảo ngược (tối thiểu > tối đa)",
                    message: `${provisionLabelOf(prov)} quy định mức phạt tối thiểu (${fine.min.toLocaleString("vi-VN")} đ) lớn hơn mức tối đa (${fine.max.toLocaleString("vi-VN")} đ).`,
                    provisionId: prov.id,
                    relatedDocumentId: null,
                    relatedProvisionId: null,
                    evidence: fine.raw,
                    suggestion: "Sửa lại khung phạt đảm bảo mức tối thiểu nhỏ hơn hoặc bằng mức tối đa.",
                });
            }
        }

        for (const ded of parsePointDeductions(text)) {
            if (ded.points <= 0 || ded.points > MAX_GPLX_POINTS) {
                pushFinding({
                    code: "SANC_INVALID_POINT_DEDUCTION",
                    category: "SANCTION_CONFLICT",
                    severity: "ERROR",
                    title: "Mức trừ điểm GPLX vượt khung luật định",
                    message: `${provisionLabelOf(prov)} quy định trừ ${ded.points} điểm GPLX, nằm ngoài khung hợp lệ (1–${MAX_GPLX_POINTS} điểm theo Luật TTATGTĐB).`,
                    provisionId: prov.id,
                    relatedDocumentId: null,
                    relatedProvisionId: null,
                    evidence: ded.raw,
                    suggestion: `Điều chỉnh số điểm bị trừ nằm trong khoảng từ 1 đến ${MAX_GPLX_POINTS} điểm.`,
                });
            }
        }
    }

    // 2. Check inverted fines on manual/AI sanction edges originating from this document
    for (const edge of snapshot.sanctionEdges) {
        if (edge.fromDocumentId !== targetDoc.id) {
            continue;
        }

        if (edge.newFineMin !== null && edge.newFineMax !== null && edge.newFineMin > edge.newFineMax) {
            pushFinding({
                code: "SANC_INVERTED_FINE_RANGE",
                category: "SANCTION_CONFLICT",
                severity: "ERROR",
                title: "Cạnh biến động xử phạt có khung phạt mới đảo ngược",
                message: `Hành vi "${edge.behaviorSummary}" có mức phạt mới tối thiểu (${edge.newFineMin.toLocaleString("vi-VN")} đ) lớn hơn tối đa (${edge.newFineMax.toLocaleString("vi-VN")} đ).`,
                provisionId: edge.fromProvisionId,
                relatedDocumentId: edge.toDocumentId,
                relatedProvisionId: edge.toProvisionId,
                evidence: edge.newPenaltyText ?? `${edge.newFineMin} – ${edge.newFineMax}`,
                suggestion: "Cập nhật lại thông số mức phạt mới trên cạnh biến động xử phạt.",
            });
        }
    }

    // 3. Implicit norm conflict: overlapping sanction provision against another active document without an explicit affecting relation
    const explicitlyLinkedDocIds = new Set<string>(
        snapshot.documentRelations
            .filter((rel) => rel.fromDocumentId === targetDoc.id && AFFECTING_RELATION_TYPES.has(rel.relationType))
            .map((rel) => rel.toDocumentId),
    );

    const terminatedDocIds = new Set<string>(
        snapshot.documentRelations
            .filter((rel) => TERMINATING_RELATION_TYPES.has(rel.relationType) && rel.scope === "FULL")
            .map((rel) => rel.toDocumentId),
    );

    const targetFineProvisions = provisions
        .map((prov) => ({
            prov,
            fines: parseFineRanges(prov.text ?? ""),
            tokens: extractBehaviorTokens(prov.text ?? ""),
        }))
        .filter((item) => item.fines.length > 0 && item.tokens.size >= 4);

    if (targetFineProvisions.length === 0) {
        return;
    }

    const otherFineProvisions = snapshot.provisions
        .filter(
            (prov) =>
                prov.documentId !== targetDoc.id &&
                !explicitlyLinkedDocIds.has(prov.documentId) &&
                !terminatedDocIds.has(prov.documentId),
        )
        .map((prov) => ({
            prov,
            fines: parseFineRanges(prov.text ?? ""),
            tokens: extractBehaviorTokens(prov.text ?? ""),
        }))
        .filter((item) => item.fines.length > 0 && item.tokens.size >= 4);

    for (const draftItem of targetFineProvisions) {
        for (const otherItem of otherFineProvisions) {
            const similarity = computeJaccardSimilarity(draftItem.tokens, otherItem.tokens);

            if (similarity < 0.55) {
                continue;
            }

            const draftFine = draftItem.fines[0];
            const otherFine = otherItem.fines[0];

            if (!draftFine || !otherFine) {
                continue;
            }

            const fineDiffers = draftFine.min !== otherFine.min || draftFine.max !== otherFine.max;

            if (!fineDiffers) {
                continue;
            }

            const otherDoc = docMap.get(otherItem.prov.documentId);

            pushFinding({
                code: "SANC_IMPLICIT_NORM_CONFLICT",
                category: "SANCTION_CONFLICT",
                severity: "WARNING",
                title: "Nguy cơ xung đột quy phạm ngầm với văn bản hiện hành",
                message: `${provisionLabelOf(draftItem.prov)} quy định khung phạt khác cho hành vi tương tự ${provisionLabelOf(otherItem.prov)} của ${otherDoc ? documentLabelOf(otherDoc) : otherItem.prov.documentId}, nhưng chưa có quan hệ sửa đổi/thay thế/bãi bỏ tới văn bản này.`,
                provisionId: draftItem.prov.id,
                relatedDocumentId: otherItem.prov.documentId,
                relatedProvisionId: otherItem.prov.id,
                evidence: `Dự thảo: ${draftFine.raw} vs Hiện hành: ${otherFine.raw}`,
                suggestion: "Bổ sung điều khoản sửa đổi/bãi bỏ tường minh và nối cạnh quan hệ tới văn bản hiện hành để tránh hai mức phạt song song.",
            });
            break;
        }
    }
}
