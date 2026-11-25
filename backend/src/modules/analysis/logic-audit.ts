import { isValidIsoDate, normalizeDocNumber, provisionLabelOf } from "./analysis.helpers";
import type {
    AnalysisDocument,
    AnalysisProvision,
    LogicAuditFinding,
    LogicAuditReport,
    ReadinessStatus,
    WorkspaceAnalysisSnapshot,
} from "./analysis.types";
import {
    checkReferenceRules,
    checkSanctionAndConflictRules,
    checkTemporalRules,
    type PushFinding,
} from "./logic-audit-crossdoc";

const TOTAL_CHECKED_RULES = 16;
const VIETNAMESE_POINT_ALPHABET = [
    "a", "b", "c", "d", "đ", "e", "g", "h", "i", "k", "l", "m",
    "n", "o", "p", "q", "r", "s", "t", "u", "v", "x", "y",
];

const LEVEL_RANK: Record<string, number> = {
    PART: 1,
    CHAPTER: 2,
    SECTION: 3,
    ARTICLE: 4,
    CLAUSE: 5,
    POINT: 6,
};

const DISCLAIMER =
    "Kết quả soát logic luật được tính toán tất định từ cấu trúc văn bản, ngày hiệu lực, dẫn chiếu và đồ thị quan hệ trong Workspace hiện tại. Không có lỗi không thay thế thẩm định pháp lý của cơ quan có thẩm quyền.";

/** Runs deterministic legal logic checks across structure, temporality, references, sanctions, and drafting technique. */
export function runLogicAudit(snapshot: WorkspaceAnalysisSnapshot, documentId: string): LogicAuditReport | null {
    const targetDoc = snapshot.documents.find((doc) => doc.id === documentId);

    if (!targetDoc) {
        return null;
    }

    const docMap = new Map(snapshot.documents.map((doc) => [doc.id, doc]));
    const docByNormalizedNumber = new Map<string, AnalysisDocument>();

    for (const doc of snapshot.documents) {
        if (doc.normalizedNumber) {
            docByNormalizedNumber.set(doc.normalizedNumber, doc);
        } else if (doc.documentNumber) {
            docByNormalizedNumber.set(normalizeDocNumber(doc.documentNumber), doc);
        }
    }

    const docProvisions = snapshot.provisions
        .filter((prov) => prov.documentId === documentId)
        .sort((a, b) => a.ordinal - b.ordinal);

    const findings: LogicAuditFinding[] = [];
    let counter = 1;

    function pushFinding(finding: Omit<LogicAuditFinding, "id">): void {
        findings.push({
            id: `${documentId}:audit:${counter}`,
            ...finding,
        });
        counter += 1;
    }

    checkStructureRules(docProvisions, pushFinding);
    checkTemporalRules(targetDoc, snapshot, docMap, pushFinding);
    checkReferenceRules(targetDoc, docProvisions, snapshot, docByNormalizedNumber, pushFinding);
    checkSanctionAndConflictRules(targetDoc, docProvisions, snapshot, docMap, pushFinding);
    checkDraftingTechniqueRules(targetDoc, pushFinding);

    const errorCount = findings.filter((item) => item.severity === "ERROR").length;
    const warningCount = findings.filter((item) => item.severity === "WARNING").length;
    const infoCount = findings.filter((item) => item.severity === "INFO").length;

    const rawScore = 100 - errorCount * 20 - warningCount * 8 - infoCount * 2;
    const score = Math.max(0, Math.min(100, rawScore));

    let status: ReadinessStatus = "PASS";

    if (errorCount > 0) {
        status = "FAIL";
    } else if (warningCount > 0) {
        status = "WARNING";
    }

    return {
        workspaceId: snapshot.workspaceId,
        documentId: targetDoc.id,
        documentNumber: targetDoc.documentNumber,
        documentTitle: targetDoc.title,
        checkedAt: new Date().toISOString(),
        summary: {
            status,
            score,
            total: findings.length,
            errorCount,
            warningCount,
            infoCount,
            checkedRules: TOTAL_CHECKED_RULES,
        },
        findings,
        disclaimer: DISCLAIMER,
    };
}

function checkStructureRules(provisions: AnalysisProvision[], pushFinding: PushFinding): void {
    const byId = new Map(provisions.map((prov) => [prov.id, prov]));
    const childrenByParent = new Map<string, AnalysisProvision[]>();

    for (const prov of provisions) {
        const key = prov.parentId ?? "__ROOT__";
        const bucket = childrenByParent.get(key) ?? [];
        bucket.push(prov);
        childrenByParent.set(key, bucket);
    }

    // 1. Invalid hierarchy & empty provisions
    for (const prov of provisions) {
        if (prov.parentId) {
            const parent = byId.get(prov.parentId);

            if (parent) {
                const parentRank = LEVEL_RANK[parent.level] ?? 0;
                const childRank = LEVEL_RANK[prov.level] ?? 0;

                if (childRank <= parentRank || (prov.level === "POINT" && parent.level !== "CLAUSE")) {
                    pushFinding({
                        code: "STRUCT_INVALID_HIERARCHY",
                        category: "STRUCTURE",
                        severity: "ERROR",
                        title: "Sai thứ bậc kết cấu điều khoản",
                        message: `${provisionLabelOf(prov)} được đặt trực tiếp dưới ${provisionLabelOf(parent)} không đúng thể thức Chương → Mục → Điều → Khoản → Điểm.`,
                        provisionId: prov.id,
                        relatedDocumentId: null,
                        relatedProvisionId: parent.id,
                        evidence: `${parent.level} ${parent.number} → ${prov.level} ${prov.number}`,
                        suggestion: "Sắp xếp lại điều khoản cha đúng cấp cấu trúc (ví dụ Điểm phải trực thuộc Khoản).",
                    });
                }
            }
        }

        const hasChildren = (childrenByParent.get(prov.id)?.length ?? 0) > 0;
        const hasText = Boolean(prov.text?.trim());

        if (!hasChildren && !hasText && prov.level !== "PREAMBLE") {
            pushFinding({
                code: "STRUCT_EMPTY_PROVISION",
                category: "STRUCTURE",
                severity: "WARNING",
                title: "Điều khoản rỗng chưa có nội dung quy phạm",
                message: `${provisionLabelOf(prov)} chưa có nội dung quy định và cũng không chứa khoản/điểm con nào.`,
                provisionId: prov.id,
                relatedDocumentId: null,
                relatedProvisionId: null,
                evidence: prov.title ?? provisionLabelOf(prov),
                suggestion: "Bổ sung nội dung quy phạm cho điều khoản này hoặc chèn các Khoản/Điểm con tương ứng.",
            });
        }
    }

    // 2. Duplicate numbers & numbering gaps among siblings of the same level
    for (const siblings of childrenByParent.values()) {
        const byLevel = new Map<string, AnalysisProvision[]>();

        for (const sibling of siblings) {
            const list = byLevel.get(sibling.level) ?? [];
            list.push(sibling);
            byLevel.set(sibling.level, list);
        }

        for (const [level, group] of byLevel.entries()) {
            const seenNumbers = new Map<string, AnalysisProvision>();

            for (const prov of group) {
                const normalizedNum = prov.number.trim().toLowerCase();
                const duplicate = seenNumbers.get(normalizedNum);

                if (duplicate) {
                    pushFinding({
                        code: "STRUCT_DUPLICATE_NUMBER",
                        category: "STRUCTURE",
                        severity: "ERROR",
                        title: "Trùng số hiệu điều khoản cùng cấp",
                        message: `${provisionLabelOf(prov)} bị đánh số trùng với một mục cùng cấp đã tồn tại.`,
                        provisionId: prov.id,
                        relatedDocumentId: null,
                        relatedProvisionId: duplicate.id,
                        evidence: `${level} ${prov.number}`,
                        suggestion: "Đánh lại số thứ tự duy nhất hoặc gộp nội dung hai mục bị trùng.",
                    });
                } else {
                    seenNumbers.set(normalizedNum, prov);
                }
            }

            checkNumberingSequence(level, group, pushFinding);
        }
    }
}

function checkNumberingSequence(level: string, group: AnalysisProvision[], pushFinding: PushFinding): void {
    if (group.length < 2) {
        return;
    }

    if (level === "ARTICLE" || level === "CLAUSE") {
        const numericItems = group
            .map((prov) => ({ prov, num: Number(prov.number.trim()) }))
            .filter((item) => Number.isInteger(item.num) && item.num > 0)
            .sort((a, b) => a.num - b.num);

        for (let i = 1; i < numericItems.length; i += 1) {
            const prev = numericItems[i - 1];
            const curr = numericItems[i];

            if (prev && curr && curr.num - prev.num > 1) {
                pushFinding({
                    code: "STRUCT_NUMBERING_GAP",
                    category: "STRUCTURE",
                    severity: "WARNING",
                    title: "Đánh số thứ tự bị nhảy cóc",
                    message: `Thứ tự nhảy từ ${provisionLabelOf(prev.prov)} sang ${provisionLabelOf(curr.prov)} (thiếu số ${prev.num + 1}).`,
                    provisionId: curr.prov.id,
                    relatedDocumentId: null,
                    relatedProvisionId: prev.prov.id,
                    evidence: `${prev.num} → ${curr.num}`,
                    suggestion: "Kiểm tra lại thứ tự đánh số hoặc bổ sung điều khoản bị thiếu.",
                });
            }
        }

        return;
    }

    if (level === "POINT") {
        const indexed = group
            .map((prov) => ({
                prov,
                idx: VIETNAMESE_POINT_ALPHABET.indexOf(prov.number.trim().toLowerCase()),
            }))
            .filter((item) => item.idx >= 0)
            .sort((a, b) => a.idx - b.idx);

        for (let i = 1; i < indexed.length; i += 1) {
            const prev = indexed[i - 1];
            const curr = indexed[i];

            if (prev && curr && curr.idx - prev.idx > 1) {
                const missingLetter = VIETNAMESE_POINT_ALPHABET[prev.idx + 1] ?? "?";

                pushFinding({
                    code: "STRUCT_NUMBERING_GAP",
                    category: "STRUCTURE",
                    severity: "WARNING",
                    title: "Thứ tự Điểm bị nhảy cóc",
                    message: `Thứ tự nhảy từ Điểm ${prev.prov.number} sang Điểm ${curr.prov.number} (thiếu Điểm ${missingLetter}).`,
                    provisionId: curr.prov.id,
                    relatedDocumentId: null,
                    relatedProvisionId: prev.prov.id,
                    evidence: `${prev.prov.number} → ${curr.prov.number}`,
                    suggestion: "Điều chỉnh ký hiệu Điểm liên tục theo bảng chữ cái tiếng Việt (a, b, c, d, đ, e...).",
                });
            }
        }
    }
}

function checkDraftingTechniqueRules(targetDoc: AnalysisDocument, pushFinding: PushFinding): void {
    if (!isValidIsoDate(targetDoc.effectiveFrom)) {
        pushFinding({
            code: "DRAFT_MISSING_EFFECTIVE_DATE",
            category: "DRAFTING_TECHNIQUE",
            severity: "INFO",
            title: "Chưa khai báo ngày dự kiến có hiệu lực",
            message: "Văn bản chưa có thông tin ngày có hiệu lực (effectiveFrom), khiến hệ thống không thể kiểm tra đầy đủ xung đột thời gian và quy định chuyển tiếp.",
            provisionId: null,
            relatedDocumentId: null,
            relatedProvisionId: null,
            evidence: null,
            suggestion: "Bổ sung ngày dự kiến có hiệu lực trong phần thông tin văn bản.",
        });
    }
}
