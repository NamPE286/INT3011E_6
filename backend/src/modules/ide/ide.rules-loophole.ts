import type { ExtractedFineRange, ExtractedThreshold } from "./ide.intervals";
import { findNodeAtOffset, rangeFromOffsets, type ParsedDraft, type ParsedNode } from "./ide.parser";
import type { LegalDiagnostic } from "./ide.types";

const UNBOUNDED_EXCEPTION = /trừ\s+(?:các\s+)?(?:trường hợp\s+(?:đặc biệt|cần thiết|bất khả kháng|khác)|lý do\s+chính đáng)/giu;
const QUALIFIED_EXCEPTION = /^\s*(?:theo\s+quy\s+định\s+(?:tại|của)|được\s+quy\s+định)/iu;
const PROHIBITION = /\b(?:nghiêm cấm|không được phép|cấm)\b/giu;
const SANCTION_WORDS = /(?:phạt tiền|phạt cảnh cáo|xử phạt|tước quyền|tịch thu|buộc\s+|bị xử lý|chịu trách nhiệm)/iu;
const DURATION_OR_POINTS = /(?:từ\s+\d+\s*(?:tháng|ngày|năm)|đến\s+\d+\s*(?:tháng|ngày|năm)|\d+\s*điểm)/iu;
const ADDITIONAL_SANCTION_NO_LIMIT = /(tước quyền sử dụng (?:giấy phép lái xe|chứng chỉ hành nghề)|đình chỉ hoạt động|trừ điểm giấy phép lái xe)/giu;
const EFFECTIVE_ARTICLE_TITLE = /hiệu lực(?:\s+thi hành)?/iu;
const AMENDMENT_HINT = /(?:sửa đổi|bổ sung|thay thế|bãi bỏ)\s+(?:một số điều|điều|khoản|điểm|nghị định|luật|thông tư)/iu;
const TRANSITIONAL_HINT = /(?:chuyển tiếp|đã thực hiện trước ngày|tiếp tục áp dụng)/iu;

export function analyzeLoopholes(
    draft: ParsedDraft,
    fineRanges: readonly ExtractedFineRange[],
    thresholds: readonly ExtractedThreshold[],
): LegalDiagnostic[] {
    const diagnostics: LegalDiagnostic[] = [];

    detectUnboundedExceptions(draft, diagnostics);
    detectToothlessProhibitions(draft, diagnostics);
    detectEmptyOrUnenforcedArticles(draft, diagnostics);
    detectThresholdGaps(draft, thresholds, diagnostics);
    detectUnboundedAdditionalSanctions(draft, diagnostics);
    detectMissingEffectiveOrTransitional(draft, diagnostics);
    detectSubjectCoverageGaps(draft, fineRanges, diagnostics);

    return diagnostics;
}

function detectUnboundedExceptions(draft: ParsedDraft, out: LegalDiagnostic[]): void {
    for (const match of draft.content.matchAll(UNBOUNDED_EXCEPTION)) {
        const startOffset = match.index;
        const endOffset = startOffset + match[0].length;
        const tail = draft.content.slice(endOffset, endOffset + 60);

        if (QUALIFIED_EXCEPTION.test(tail)) {
            continue;
        }

        const node = findNodeAtOffset(draft.nodes, startOffset);

        out.push({
            id: `LP001-${startOffset}`,
            code: "LP001",
            category: "LOOPHOLE",
            severity: "warning",
            title: "Ngoại lệ mở không có căn cứ pháp lý",
            message: `Cụm từ "${match[0]}" tạo ngoại lệ miễn trừ trách nhiệm nhưng không dẫn chiếu tới điều khoản hoặc văn bản quy định tiêu chí cụ thể.`,
            exploitScenario: "Cá nhân/tổ chức vi phạm có thể tự viện dẫn 'lý do chính đáng' hoặc 'trường hợp cần thiết' để né tránh xử phạt, khiến cơ quan thực thi không có căn cứ bác bỏ.",
            suggestion: "Gắn ngoại lệ với điều kiện định lượng hoặc dẫn chiếu rõ văn bản/điều khoản quy định (ví dụ: 'theo quy định tại Điều ...').",
            excerpt: match[0],
            provisionRef: node?.refLabel ?? null,
            range: rangeFromOffsets(draft.content, draft.lineStarts, startOffset, endOffset),
            source: "STATIC",
            quickFix: {
                label: "Bổ sung dẫn chiếu 'theo quy định tại Điều ...'",
                replacement: `${match[0]} theo quy định tại Điều ...`,
                startOffset,
                endOffset,
            },
            corpusLink: null,
        });
    }
}

function detectToothlessProhibitions(draft: ParsedDraft, out: LegalDiagnostic[]): void {
    for (const match of draft.content.matchAll(PROHIBITION)) {
        const startOffset = match.index;
        const endOffset = startOffset + match[0].length;
        const node = findNodeAtOffset(draft.nodes, startOffset);

        if (!node || node.level === "CHAPTER") {
            continue;
        }

        const parentArticle = findParentArticle(draft.nodes, node);
        const searchScope = parentArticle ? draft.content.slice(parentArticle.startOffset, parentArticle.endOffset) : node.text;

        if (SANCTION_WORDS.test(searchScope)) {
            continue;
        }

        const hasExternalReference = /xử phạt|quy định tại\s+Điều/iu.test(draft.content);

        if (hasExternalReference && /nguyên tắc|phạm vi/iu.test(parentArticle?.title ?? "")) {
            continue;
        }

        out.push({
            id: `LP002-${startOffset}`,
            code: "LP002",
            category: "LOOPHOLE",
            severity: "error",
            title: "Hành vi bị cấm thiếu chế tài xử lý",
            message: `Điều khoản quy định "${match[0]}" nhưng trong cùng Điều không có mức phạt tiền, hình thức xử phạt bổ sung hay dẫn chiếu điều khoản xử phạt.`,
            exploitScenario: "Khi bị phát hiện vi phạm, đối tượng có thể khiếu nại quyết định xử phạt vì văn bản chỉ nêu lệnh cấm mà không quy định khung phạt tương ứng.",
            suggestion: "Bổ sung điều khoản chế tài cụ thể hoặc dẫn chiếu trực tiếp tới Điều/Khoản xử phạt tương ứng.",
            excerpt: match[0],
            provisionRef: node.refLabel,
            range: rangeFromOffsets(draft.content, draft.lineStarts, startOffset, endOffset),
            source: "STATIC",
            quickFix: null,
            corpusLink: null,
        });
    }
}

function detectEmptyOrUnenforcedArticles(draft: ParsedDraft, out: LegalDiagnostic[]): void {
    const articles = draft.nodes.filter((node) => node.level === "ARTICLE");

    for (const article of articles) {
        const articleSlice = draft.content.slice(article.startOffset, article.endOffset);
        const bodyLines = articleSlice
            .replace(/\r\n/g, "\n")
            .split("\n")
            .slice(1)
            .map((line) => line.trim())
            .filter(Boolean);

        if (bodyLines.length === 0) {
            out.push({
                id: `LP007-empty-${article.startOffset}`,
                code: "LP007",
                category: "LOOPHOLE",
                severity: "error",
                title: "Điều khoản rỗng — chưa có nội dung quy phạm",
                message: `${article.refLabel} mới chỉ có dòng tiêu đề, chưa có khoản, nội dung điều chỉnh hay chế tài cụ thể.`,
                exploitScenario: "Điều khoản không có nội dung thi hành tạo kẽ hở pháp lý và không thể áp dụng xử phạt tại Tòa.",
                suggestion: "Bổ sung ít nhất 01 khoản quy định rõ hành vi, chủ thể và mức chế tài tương ứng.",
                excerpt: article.text.slice(0, 80),
                provisionRef: article.refLabel,
                range: rangeFromOffsets(draft.content, draft.lineStarts, article.startOffset, article.endOffset),
                source: "STATIC",
                quickFix: {
                    label: "Bổ sung khoản 1 quy định mức phạt mẫu",
                    replacement: `${article.text}\n1. Phạt tiền từ 4.000.000 đồng đến 6.000.000 đồng đối với hành vi vi phạm quy định tại Điều này.`,
                    startOffset: article.startOffset,
                    endOffset: article.endOffset,
                },
                corpusLink: null,
            });
        }

        const titleText = article.title ?? "";
        const isMetaArticle = /(?:phạm vi|giải thích từ ngữ|nguyên tắc|hiệu lực)/iu.test(titleText);

        if (isMetaArticle) {
            continue;
        }

        const mentionsViolation = /\b(?:lỗi|vi phạm|xử phạt)\b/iu.test(`${titleText} ${articleSlice}`);
        const hasSanction = SANCTION_WORDS.test(articleSlice) || /quy định tại\s+Điều/iu.test(articleSlice);
        const alreadyHasLp002 = out.some(
            (diag) => diag.code === "LP002" && diag.range.startOffset >= article.startOffset && diag.range.startOffset <= article.endOffset,
        );

        if (mentionsViolation && !hasSanction && !alreadyHasLp002) {
            out.push({
                id: `LP002-article-${article.startOffset}`,
                code: "LP002",
                category: "LOOPHOLE",
                severity: "error",
                title: "Quy định về vi phạm nhưng thiếu chế tài xử lý",
                message: `${article.refLabel} đề cập hành vi vi phạm nhưng chưa quy định mức phạt tiền, hình phạt bổ sung hay dẫn chiếu điều khoản xử phạt.`,
                exploitScenario: "Không có căn cứ pháp lý để ấn định hình phạt khi hành vi vi phạm xảy ra trên thực tế.",
                suggestion: "Bổ sung khung tiền phạt (từ ... đồng đến ... đồng) hoặc dẫn chiếu tới Điều/Khoản xử phạt.",
                excerpt: article.text.slice(0, 80),
                provisionRef: article.refLabel,
                range: rangeFromOffsets(draft.content, draft.lineStarts, article.startOffset, Math.min(article.endOffset, article.startOffset + 80)),
                source: "STATIC",
                quickFix: null,
                corpusLink: null,
            });
        }
    }
}

function detectThresholdGaps(draft: ParsedDraft, thresholds: readonly ExtractedThreshold[], out: LegalDiagnostic[]): void {
    for (const item of thresholds) {
        if (item.status !== "GAP_BEFORE" || !item.gapFrom || item.gapFrom.max === null || item.min === null) {
            continue;
        }

        const gapStart = item.gapFrom.max;
        const gapEnd = item.min;

        out.push({
            id: `LP003-${item.startOffset}`,
            code: "LP003",
            category: "LOOPHOLE",
            severity: "error",
            title: `Khoảng trống định lượng (${gapStart} – ${gapEnd} ${item.unit})`,
            message: `Giữa mức "${item.gapFrom.excerpt}" và "${item.excerpt}" tồn tại khoảng trống từ ${gapStart} đến dưới ${gapEnd} ${item.unit} không thuộc khung nào.`,
            exploitScenario: `Nếu đo được mức vi phạm rơi đúng vào khoảng ${gapStart} đến ${gapEnd} ${item.unit}, cơ quan chức năng không có khung phạt hợp lệ để áp dụng.`,
            suggestion: `Điều chỉnh cận dưới thành "từ ${gapStart} ${item.unit}" (hoặc "trên ${gapStart} ${item.unit}") để khép kín dải giá trị.`,
            excerpt: item.excerpt,
            provisionRef: item.provisionRef,
            range: rangeFromOffsets(draft.content, draft.lineStarts, item.startOffset, item.endOffset),
            source: "STATIC",
            quickFix: null,
            corpusLink: null,
        });
    }
}

function detectUnboundedAdditionalSanctions(draft: ParsedDraft, out: LegalDiagnostic[]): void {
    for (const match of draft.content.matchAll(ADDITIONAL_SANCTION_NO_LIMIT)) {
        const startOffset = match.index;
        const endOffset = startOffset + match[0].length;
        const windowText = draft.content.slice(startOffset, Math.min(draft.content.length, endOffset + 80));

        if (DURATION_OR_POINTS.test(windowText)) {
            continue;
        }

        const node = findNodeAtOffset(draft.nodes, startOffset);
        const isPoints = match[0].toLowerCase().includes("trừ điểm");

        out.push({
            id: `LP004-${startOffset}`,
            code: "LP004",
            category: "LOOPHOLE",
            severity: "warning",
            title: "Hình phạt bổ sung thiếu thời hạn hoặc định mức",
            message: `Hình thức "${match[0]}" không nêu rõ thời hạn áp dụng (từ ... tháng đến ... tháng) hoặc số điểm bị trừ.`,
            exploitScenario: "Thiếu thời hạn hoặc số điểm cụ thể dẫn tới tùy nghi áp dụng, khó kiểm soát khi giải quyết khiếu nại hành chính.",
            suggestion: isPoints
                ? "Ghi rõ số điểm bị trừ (ví dụ: 'trừ điểm giấy phép lái xe 02 điểm')."
                : "Ghi rõ khoảng thời hạn áp dụng (ví dụ: 'từ 01 tháng đến 03 tháng').",
            excerpt: match[0],
            provisionRef: node?.refLabel ?? null,
            range: rangeFromOffsets(draft.content, draft.lineStarts, startOffset, endOffset),
            source: "STATIC",
            quickFix: {
                label: isPoints ? "Thêm định mức 02 điểm" : "Thêm thời hạn từ 01 tháng đến 03 tháng",
                replacement: isPoints ? `${match[0]} 02 điểm` : `${match[0]} từ 01 tháng đến 03 tháng`,
                startOffset,
                endOffset,
            },
            corpusLink: null,
        });
    }
}

function detectMissingEffectiveOrTransitional(draft: ParsedDraft, out: LegalDiagnostic[]): void {
    const articles = draft.nodes.filter((node) => node.level === "ARTICLE");

    if (articles.length === 0) {
        return;
    }

    if (articles.length === 1 && /giải thích từ ngữ|hiệu lực/iu.test(articles[0].title ?? "")) {
        return;
    }

    const hasEffective = articles.some((article) => article.title && EFFECTIVE_ARTICLE_TITLE.test(article.title));

    if (!hasEffective) {
        const lastArticle = articles[articles.length - 1];

        out.push({
            id: `LP005-effective-${lastArticle.startOffset}`,
            code: "LP005",
            category: "LOOPHOLE",
            severity: "warning",
            title: "Thiếu điều khoản Hiệu lực thi hành",
            message: "Dự thảo có nhiều điều khoản nhưng chưa có Điều quy định ngày hiệu lực thi hành.",
            exploitScenario: "Không xác định được thời điểm bắt đầu áp dụng chế tài mới và xử lý các vi phạm xảy ra trong giai đoạn chuyển giao.",
            suggestion: "Bổ sung Điều 'Hiệu lực thi hành' nêu rõ ngày có hiệu lực và quy định chuyển tiếp nếu cần.",
            excerpt: lastArticle.refLabel,
            provisionRef: lastArticle.refLabel,
            range: rangeFromOffsets(draft.content, draft.lineStarts, lastArticle.startOffset, Math.min(lastArticle.startOffset + 40, lastArticle.endOffset)),
            source: "STATIC",
            quickFix: null,
            corpusLink: null,
        });
    }

    if (AMENDMENT_HINT.test(draft.content) && !TRANSITIONAL_HINT.test(draft.content)) {
        const firstArticle = articles[0];

        out.push({
            id: `LP005-transition-${firstArticle.startOffset}`,
            code: "LP005",
            category: "LOOPHOLE",
            severity: "warning",
            title: "Văn bản sửa đổi/bãi bỏ thiếu điều khoản chuyển tiếp",
            message: "Dự thảo có nội dung sửa đổi hoặc bãi bỏ quy định cũ nhưng chưa thấy điều khoản chuyển tiếp đối với các hồ sơ/vi phạm đang xử lý.",
            exploitScenario: "Các hành vi vi phạm xảy ra trước ngày hiệu lực mới có thể bị bỏ lọt hoặc áp dụng sai khung phạt.",
            suggestion: "Bổ sung khoản quy định chuyển tiếp cho các hành vi xảy ra trước thời điểm văn bản mới có hiệu lực.",
            excerpt: firstArticle.refLabel,
            provisionRef: firstArticle.refLabel,
            range: rangeFromOffsets(draft.content, draft.lineStarts, firstArticle.startOffset, Math.min(firstArticle.startOffset + 40, firstArticle.endOffset)),
            source: "STATIC",
            quickFix: null,
            corpusLink: null,
        });
    }
}

function detectSubjectCoverageGaps(draft: ParsedDraft, fineRanges: readonly ExtractedFineRange[], out: LegalDiagnostic[]): void {
    const byArticle = new Map<string, { hasIndividual: boolean; hasOrganization: boolean; firstOffset: number; firstEnd: number; ref: string | null }>();

    for (const fine of fineRanges) {
        if (!fine.subject) {
            continue;
        }

        const key = fine.provisionRef?.split(" ").slice(-2).join(" ") ?? "global";
        const current = byArticle.get(key) ?? {
            hasIndividual: false,
            hasOrganization: false,
            firstOffset: fine.startOffset,
            firstEnd: fine.endOffset,
            ref: fine.provisionRef,
        };

        if (fine.subject === "INDIVIDUAL") {
            current.hasIndividual = true;
        } else {
            current.hasOrganization = true;
        }

        byArticle.set(key, current);
    }

    for (const info of byArticle.values()) {
        if (info.hasIndividual && !info.hasOrganization) {
            out.push({
                id: `LP006-${info.firstOffset}`,
                code: "LP006",
                category: "LOOPHOLE",
                severity: "warning",
                title: "Chỉ quy định mức phạt cho cá nhân, bỏ sót tổ chức",
                message: "Điều khoản quy định mức phạt đối với cá nhân nhưng chưa có mức phạt tương ứng đối với tổ chức (thường gấp 02 lần cá nhân).",
                exploitScenario: "Doanh nghiệp hoặc hợp tác xã thực hiện hành vi tương tự có thể viện dẫn điều khoản chỉ áp dụng cho cá nhân để né mức phạt tổ chức.",
                suggestion: "Quy định rõ mức phạt đối với cả cá nhân và tổ chức hoặc bổ sung nguyên tắc quy đổi tại điều khoản chung.",
                excerpt: draft.content.slice(info.firstOffset, info.firstEnd),
                provisionRef: info.ref,
                range: rangeFromOffsets(draft.content, draft.lineStarts, info.firstOffset, info.firstEnd),
                source: "STATIC",
                quickFix: null,
                corpusLink: null,
            });
        }
    }
}

function findParentArticle(nodes: readonly ParsedNode[], node: ParsedNode): ParsedNode | null {
    if (node.level === "ARTICLE") {
        return node;
    }

    if (!node.articleNo) {
        return null;
    }

    return nodes.find((candidate) => candidate.level === "ARTICLE" && candidate.articleNo === node.articleNo) ?? null;
}
