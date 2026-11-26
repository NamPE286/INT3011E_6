import type { D1Database } from "@cloudflare/workers-types";
import type { ExtractedFineRange } from "./ide.intervals";
import { findNodeAtOffset, rangeFromOffsets, type ParsedDraft } from "./ide.parser";
import type { LegalDiagnostic } from "./ide.types";

type DocMatchRow = {
    id: string;
    document_title: string | null;
    document_number: string | null;
};

type ProvisionCheckRow = {
    id: string;
    article_no: string | null;
    paragraph_no: string | null;
    point_no: string | null;
    text: string | null;
};

type RuleOverlapRow = {
    id: string;
    document_id: string;
    provision_id: string;
    behavior_summary: string;
    fine_min: number | null;
    fine_max: number | null;
    document_title: string | null;
    document_number: string | null;
};

const EXTERNAL_CITE = /(?:(điểm)\s+([a-zđ])\s+)?(?:(khoản)\s+(\d+)\s+)?Điều\s+(\d+[a-zđ]?)\s+(?:của\s+)?(?:Nghị định|Luật|Thông tư)\s+(?:số\s+)?(\d{1,4}\/\d{4}\/[A-ZĐ0-9\-]+)/giu;
const AMENDMENT_CONTEXT = /(?:sửa đổi|bổ sung|thay thế|bãi bỏ)/iu;

export async function analyzeAgainstCorpus(
    db: D1Database | undefined,
    draft: ParsedDraft,
    fineRanges: readonly ExtractedFineRange[],
): Promise<LegalDiagnostic[]> {
    if (!db) {
        return [];
    }

    const diagnostics: LegalDiagnostic[] = [];

    try {
        await checkExternalCitations(db, draft, diagnostics);
        await checkActiveFineConflicts(db, draft, fineRanges, diagnostics);
    } catch {
        // Corpus tables may not be populated in minimal test fixtures; fail open without blocking static analysis.
        return diagnostics;
    }

    return diagnostics;
}

async function checkExternalCitations(db: D1Database, draft: ParsedDraft, out: LegalDiagnostic[]): Promise<void> {
    for (const match of draft.content.matchAll(EXTERNAL_CITE)) {
        const startOffset = match.index;
        const endOffset = startOffset + match[0].length;
        const pointNo = match[2]?.toLowerCase() ?? null;
        const clauseNo = match[4] ?? null;
        const articleNo = match[5]?.toLowerCase() ?? null;
        const docNumber = match[6];

        if (!articleNo || !docNumber) {
            continue;
        }

        const doc = await db
            .prepare(
                `SELECT d.id, d.document_title, m.document_number
                 FROM legal_documents d
                 LEFT JOIN document_metadata m ON m.document_id = d.id
                 WHERE d.review_status = 'ACCEPTED'
                   AND (LOWER(m.document_number) = LOWER(?) OR LOWER(d.document_title) LIKE LOWER(?))
                 LIMIT 1`,
            )
            .bind(docNumber, `%${docNumber}%`)
            .first<DocMatchRow>();

        if (!doc) {
            const node = findNodeAtOffset(draft.nodes, startOffset);

            out.push({
                id: `WS001-cite-${startOffset}`,
                code: "WS001",
                category: "LOGIC",
                severity: "info",
                title: `Văn bản dẫn chiếu chưa có trong workspace (${docNumber})`,
                message: `Dự thảo dẫn chiếu tới "${match[0]}", nhưng văn bản "${docNumber}" chưa được nhập vào workspace nên chưa thể đối chiếu điều khoản gốc.`,
                exploitScenario: "Hệ thống chỉ thẩm định dựa trên văn bản có trong workspace; thiếu văn bản gốc có thể bỏ sót xung đột sửa đổi hoặc bãi bỏ.",
                suggestion: `Nhập PDF văn bản ${docNumber} vào workspace để hệ thống kiểm chứng chính xác.`,
                excerpt: match[0],
                provisionRef: node?.refLabel ?? null,
                range: rangeFromOffsets(draft.content, draft.lineStarts, startOffset, endOffset),
                source: "CORPUS",
                quickFix: null,
                corpusLink: null,
            });

            continue;
        }

        const provisionsResult = await db
            .prepare("SELECT id, article_no, paragraph_no, point_no, text FROM provisions WHERE document_id = ? AND LOWER(article_no) = LOWER(?)")
            .bind(doc.id, articleNo)
            .all<ProvisionCheckRow>();

        if (provisionsResult.results.length === 0) {
            continue;
        }

        const matched = provisionsResult.results.find((row) => {
            if (pointNo && clauseNo) {
                return row.paragraph_no === clauseNo && (row.point_no ?? "").toLowerCase() === pointNo;
            }

            if (clauseNo) {
                return row.paragraph_no === clauseNo;
            }

            return true;
        });

        if (matched) {
            continue;
        }

        const node = findNodeAtOffset(draft.nodes, startOffset);
        const docLabel = doc.document_number ?? doc.document_title ?? doc.id;

        out.push({
            id: `LG008-cite-${startOffset}`,
            code: "LG008",
            category: "LOGIC",
            severity: "error",
            title: `Dẫn chiếu văn bản hiện hành không khớp (${docLabel})`,
            message: `Dự thảo dẫn chiếu tới "${match[0]}", nhưng trong kho văn bản đã kiểm định (${docLabel}) không tìm thấy điều/khoản/điểm tương ứng.`,
            exploitScenario: "Dẫn chiếu sai điều khoản của văn bản gốc khiến điều khoản sửa đổi/viện dẫn bị vô hiệu khi áp dụng.",
            suggestion: `Mở văn bản ${docLabel} để đối chiếu lại chính xác số Điều/Khoản/Điểm.`,
            excerpt: match[0],
            provisionRef: node?.refLabel ?? null,
            range: rangeFromOffsets(draft.content, draft.lineStarts, startOffset, endOffset),
            source: "CORPUS",
            quickFix: null,
            corpusLink: {
                documentId: doc.id,
                documentLabel: docLabel,
                provisionId: provisionsResult.results[0]?.id ?? null,
                excerpt: provisionsResult.results[0]?.text?.slice(0, 140) ?? "",
            },
        });
    }
}

async function checkActiveFineConflicts(
    db: D1Database,
    draft: ParsedDraft,
    fineRanges: readonly ExtractedFineRange[],
    out: LegalDiagnostic[],
): Promise<void> {
    if (fineRanges.length === 0 || AMENDMENT_CONTEXT.test(draft.content)) {
        return;
    }

    const activeRules = await db
        .prepare(
            `SELECT r.id, r.document_id, r.provision_id, r.behavior_summary, r.fine_min, r.fine_max,
                    d.document_title, m.document_number
             FROM violation_rules r
             JOIN legal_documents d ON d.id = r.document_id
             LEFT JOIN document_metadata m ON m.document_id = d.id
             WHERE d.review_status = 'ACCEPTED'
               AND r.fine_min IS NOT NULL
               AND r.fine_max IS NOT NULL
             LIMIT 100`,
        )
        .all<RuleOverlapRow>();

    if (activeRules.results.length === 0) {
        return;
    }

    const flaggedRules = new Set<string>();

    for (const fine of fineRanges) {
        const node = findNodeAtOffset(draft.nodes, fine.startOffset);

        if (!node) {
            continue;
        }

        const nodeTextLower = node.text.toLowerCase();

        for (const rule of activeRules.results) {
            if (flaggedRules.has(rule.id)) {
                continue;
            }

            const keywords = rule.behavior_summary
                .toLowerCase()
                .split(/\s+/)
                .filter((word) => word.length >= 4);

            if (keywords.length < 2) {
                continue;
            }

            const overlapCount = keywords.filter((word) => nodeTextLower.includes(word)).length;

            if (overlapCount < Math.min(3, keywords.length)) {
                continue;
            }

            if (rule.fine_min === fine.min && rule.fine_max === fine.max) {
                continue;
            }

            flaggedRules.add(rule.id);
            const docLabel = rule.document_number ?? rule.document_title ?? rule.document_id;

            out.push({
                id: `LG008-rule-${fine.startOffset}`,
                code: "LG008",
                category: "LOGIC",
                severity: "warning",
                title: `Chồng lấn khung phạt với văn bản hiện hành (${docLabel})`,
                message: `Khung phạt mới (${fine.minRaw}–${fine.maxRaw}đ) có dấu hiệu trùng hành vi "${rule.behavior_summary}" đang được quy định tại ${docLabel} với mức khác, nhưng dự thảo chưa có lệnh sửa đổi/bãi bỏ.`,
                exploitScenario: "Hai văn bản cùng quy định mức phạt khác nhau cho một hành vi khiến người vi phạm viện dẫn mức nhẹ hơn hoặc gây xung đột thẩm quyền.",
                suggestion: `Bổ sung điều khoản sửa đổi/bãi bỏ quy định tương ứng tại ${docLabel} hoặc phân tách rõ phạm vi áp dụng.`,
                excerpt: draft.content.slice(fine.startOffset, fine.endOffset),
                provisionRef: node.refLabel,
                range: rangeFromOffsets(draft.content, draft.lineStarts, fine.startOffset, fine.endOffset),
                source: "CORPUS",
                quickFix: null,
                corpusLink: {
                    documentId: rule.document_id,
                    documentLabel: docLabel,
                    provisionId: rule.provision_id,
                    excerpt: rule.behavior_summary,
                },
            });

            break;
        }
    }
}
