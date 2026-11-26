import { extractFineRanges, extractNumericThresholds, type ExtractedFineRange } from "./intervals";
import type { LocalWorkspaceFile } from "./local-workspace";
import { parseDraftDocument, positionAtOffset } from "./parser";
import type { ExtractedLegalFact } from "./types";
import type { DocumentLifecycleStatus, WorkspaceRelationGraph } from "./workspace-relations";

export type BehaviorChangeKind =
    | "INITIAL"
    | "AMENDED"
    | "DEFINITION_CHANGED"
    | "REPLACED_BY_NEW_LAW"
    | "PENALTY_INCREASED"
    | "PENALTY_DECREASED"
    | "SANCTION_RESTRUCTURED"
    | "REPEALED"
    | "DRAFT_PROPOSAL"
    | "DRAFT_CONFLICT";

export type BehaviorVersionItem = {
    id: string;
    canonicalKey: string;
    behaviorTitle: string;
    vehicleOrSubject: string;
    modality: "PROHIBITED" | "OBLIGATED" | "PERMITTED" | "SANCTION";
    fineMin: number | null;
    fineMax: number | null;
    fineLabel: string;
    prisonLabel?: string | null;
    hasDeathPenalty?: boolean;
    pointsDeducted: number | null;
    suspensionMonths: string | null;
    thresholdText: string | null;
    hasExplicitSanction: boolean;
    hasExplicitDefinition: boolean;
    definitionText: string | null;
    sourcePath: string;
    documentNumber: string | null;
    documentTitle: string;
    provisionRef: string;
    line: number;
    effectiveDate: string | null;
    lifecycleStatus: DocumentLifecycleStatus;
    excerpt: string;
    changeKind: BehaviorChangeKind;
    changeSummary: string | null;
    sanctionChangeKind: BehaviorChangeKind | null;
    sanctionChangeSummary: string | null;
    definitionChangeKind: BehaviorChangeKind | null;
    definitionChangeSummary: string | null;
    fineDeltaPercent: number | null;
};

export type WorkspaceBehaviorGroup = {
    canonicalKey: string;
    behaviorTitle: string;
    vehicleOrSubject: string;
    latestVersion: BehaviorVersionItem;
    latestSanctionVersion: BehaviorVersionItem | null;
    latestDefinitionVersion: BehaviorVersionItem | null;
    versions: BehaviorVersionItem[];
    sanctionHistory: BehaviorVersionItem[];
    definitionHistory: BehaviorVersionItem[];
    hasHistory: boolean;
    hasSanctionHistory: boolean;
    hasDefinitionHistory: boolean;
    hasDraftConflict: boolean;
    hasReplacedVersion: boolean;
};

export type WorkspaceBehaviorSummary = {
    groups: WorkspaceBehaviorGroup[];
    totalBehaviors: number;
    withHistoryCount: number;
    sanctionHistoryCount: number;
    definitionHistoryCount: number;
    replacedCount: number;
    draftConflictCount: number;
};

const CANONICAL_RULES: readonly { key: string; title: string; pattern: RegExp }[] = [
    {
        key: "vuot_den_do",
        title: "Không chấp hành hiệu lệnh của đèn tín hiệu giao thông (vượt đèn đỏ)",
        pattern: /đèn tín hiệu giao thông|vượt đèn đỏ|tín hiệu đèn/iu,
    },
    {
        key: "nong_do_con",
        title: "Điều khiển phương tiện mà trong máu hoặc hơi thở có nồng độ cồn",
        pattern: /nồng độ cồn|hơi thở có nồng độ cồn/iu,
    },
    {
        key: "qua_toc_do",
        title: "Điều khiển xe chạy quá tốc độ quy định",
        pattern: /quá tốc độ|vượt tốc độ/iu,
    },
    {
        key: "di_nguoc_chieu",
        title: "Đi ngược chiều của đường một chiều / đường có biển cấm đi ngược chiều",
        pattern: /đi ngược chiều/iu,
    },
    {
        key: "khong_doi_mu_bao_hiem",
        title: "Không đội mũ bảo hiểm khi tham gia giao thông bằng mô tô, xe máy",
        pattern: /mũ bảo hiểm/iu,
    },
    {
        key: "su_dung_dien_thoai",
        title: "Dùng tay cầm và sử dụng điện thoại khi điều khiển xe đang chạy",
        pattern: /điện thoại/iu,
    },
];

function detectVehicleOrSubject(text: string, parentArticleTitle?: string | null): string {
    const combined = `${parentArticleTitle ?? ""} ${text}`.toLowerCase();

    if (/xe\s*mô\s*tô|xe\s*gắn\s*máy|(?<![\p{L}])mô\s*tô(?![\p{L}])/iu.test(combined)) {
        return "Xe mô tô / Xe máy";
    }

    if (/(?<![\p{L}])(?:xe\s*)?ô\s*tô(?![\p{L}])/iu.test(combined)) {
        return "Xe ô tô";
    }

    if (/xe\s*tự\s*hành/iu.test(combined)) {
        return "Xe tự hành";
    }

    if (/tổ chức/iu.test(combined)) {
        return "Tổ chức";
    }

    return "Cá nhân / Chung";
}

function classifyCanonicalBehavior(text: string): { key: string; title: string } | null {
    for (const rule of CANONICAL_RULES) {
        if (rule.pattern.test(text)) {
            return { key: rule.key, title: rule.title };
        }
    }

    return null;
}

function formatFineLabel(min: number | null, max: number | null, prisonLabel?: string | null): string {
    const parts: string[] = [];

    if (min !== null && max !== null) {
        parts.push(`${min.toLocaleString("vi-VN")} – ${max.toLocaleString("vi-VN")}đ`);
    } else if (min !== null || max !== null) {
        parts.push(`${(min ?? max ?? 0).toLocaleString("vi-VN")}đ`);
    }

    if (prisonLabel) {
        parts.push(prisonLabel);
    }

    return parts.length > 0 ? parts.join(" · ") : "Định nghĩa hành vi";
}

function extractPrisonSummary(text: string): { prisonLabel: string | null; hasDeathPenalty: boolean } {
    const hasDeathPenalty =
        /\btử hình\b/iu.test(text)
        && !/bỏ\s+(?:hình\s+phạt\s+)?tử hình|không\s+áp\s+dụng\s+hình\s+phạt\s+tử hình/iu.test(text);
    const hasLife = /\btù chung thân\b/iu.test(text);
    const prisonRanges = [...text.matchAll(/phạt\s+tù\s+từ\s+(\d+\s+(?:năm|tháng))\s+đến\s+(\d+\s+năm)/giu)];
    const fixedPrison = /phạt\s+tù\s+(\d+\s+(?:năm|tháng))/iu.exec(text);

    if (hasDeathPenalty) {
        return { prisonLabel: "Tù có thời hạn / Chung thân / Tử hình", hasDeathPenalty: true };
    }

    if (hasLife) {
        return { prisonLabel: "Tù đến 20 năm / Chung thân", hasDeathPenalty: false };
    }

    if (prisonRanges.length > 0) {
        const first = prisonRanges[0];
        const last = prisonRanges[prisonRanges.length - 1];

        return { prisonLabel: `Tù ${first[1]} – ${last[2]}`, hasDeathPenalty: false };
    }

    if (fixedPrison) {
        return { prisonLabel: `Tù ${fixedPrison[1]}`, hasDeathPenalty: false };
    }

    return { prisonLabel: null, hasDeathPenalty: false };
}

function usesArticleStructuredSanctions(file: LocalWorkspaceFile, parsed: ReturnType<typeof parseDraftDocument>): boolean {
    if (file.documentType === "Bộ luật" || /\bBộ luật\b/iu.test(file.title)) {
        return true;
    }

    const crimeArticles = parsed.nodes.filter((n) => n.level === "ARTICLE" && n.title && /^Tội\s+/iu.test(n.title));

    if (crimeArticles.length >= 3) {
        return true;
    }

    return /sửa đổi,\s*bổ sung\s+một\s+số\s+điều/iu.test(`${file.title} ${file.content.slice(0, 600)}`)
        && /\bBộ luật\b/iu.test(file.content.slice(0, 800));
}

function isNonBehaviorMetaClause(text: string, parentArticleTitle?: string | null): boolean {
    const trimmed = text.trim();
    const artTitle = (parentArticleTitle ?? "").trim();

    if (/^(?:Hiệu lực thi hành|Điều khoản chuyển tiếp|Tổ chức thực hiện|Phạm vi điều chỉnh)\b/iu.test(artTitle)) {
        return true;
    }

    if (/^(?:Nghị định|Luật|Bộ luật|Thông tư|Quyết định|Nghị quyết)\s+này\s+(?:quy định|áp dụng|có hiệu lực|hết hiệu lực)/iu.test(trimmed)) {
        return true;
    }

    if (/mức\s+phạt\s+tiền\s+đối\s+với\s+tổ\s+chức\s+bằng\s+\d+\s+lần/iu.test(trimmed)) {
        return true;
    }

    if (/^(?:Bãi bỏ|Hết hiệu lực)\s+(?:các\s+quy\s+định|toàn\s+bộ|một\s+số)/iu.test(trimmed)) {
        return true;
    }

    if (/^Điều khoản chuyển tiếp\s*:/iu.test(trimmed)) {
        return true;
    }

    return false;
}

type ExplicitSanctionInfo = {
    hasExplicitSanction: boolean;
    fineMin: number | null;
    fineMax: number | null;
    fineLabel: string;
    prisonLabel: string | null;
    hasDeathPenalty: boolean;
    pointsDeducted: number | null;
    suspensionMonths: string | null;
};

function parseFixedFine(text: string): number | null {
    const match = /phạt\s+tiền\s+(?:đến\s+)?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(triệu\s+đồng|tỷ\s+đồng|đồng)/iu.exec(text);

    if (!match) {
        return null;
    }

    const rawNum = match[1];
    const unit = match[2].toLowerCase().replace(/\s+/g, " ").trim();

    if (unit === "triệu đồng") {
        return Math.round(Number(rawNum.replace(",", ".")) * 1_000_000);
    }

    if (unit === "tỷ đồng") {
        return Math.round(Number(rawNum.replace(",", ".")) * 1_000_000_000);
    }

    return Number(rawNum.replace(/[.,]/g, ""));
}

function extractExplicitSanction(sanctionText: string, fineRange?: ExtractedFineRange): ExplicitSanctionInfo {
    const fixedFine = fineRange ? null : parseFixedFine(sanctionText);
    const fineMin = fineRange?.min ?? fixedFine;
    const fineMax = fineRange?.max ?? fixedFine;
    const { prisonLabel, hasDeathPenalty } = extractPrisonSummary(sanctionText);
    const pointsMatch = /trừ\s+(?:điểm\s+giấy\s+phép\s+lái\s+xe\s+)?(\d+)\s*điểm/iu.exec(sanctionText);
    const pointsDeducted = pointsMatch ? Number(pointsMatch[1]) : null;
    const suspMatch = /(?:tước\s+quyền\s+sử\s+dụng[^.;\n]{0,40}?(từ\s+\d+\s+(?:tháng|năm)\s+đến\s+\d+\s+(?:tháng|năm))|đình\s+chỉ\s+hoạt\s+động[^.;\n]{0,30}?(vĩnh\s+viễn|từ\s+\d+\s+(?:tháng|năm)\s+đến\s+\d+\s+(?:tháng|năm))|cấm\s+(?:đảm\s+nhiệm\s+chức\s+vụ|hành\s+nghề|kinh\s+doanh)[^.;\n]{0,40}?(từ\s+\d+\s+(?:tháng|năm)\s+đến\s+\d+\s+(?:tháng|năm)))/iu.exec(sanctionText);
    const suspensionMonths = suspMatch ? (suspMatch[1] ?? suspMatch[2] ?? suspMatch[3] ?? null) : null;
    const hasWarning = /\bphạt\s+cảnh\s+cáo\b/iu.test(sanctionText);
    const hasNonCustodial = /\bcải\s+tạo\s+không\s+giam\s+giữ\b/iu.test(sanctionText);
    const hasConfiscationOrRemedial = /tịch\s+thu\s+(?:tang\s+vật|phương\s+tiện|tài\s+sản|một\s+phần\s+hoặc\s+toàn\s+bộ\s+tài\s+sản)|buộc\s+(?:tháo\s+dỡ|tiêu\s+hủy|nộp\s+lại\s+số\s+lợi|khôi\s+phục\s+tình\s+trạng\s+ban\s+đầu)/iu.test(sanctionText);
    const hasExplicitDeathRemovalOrPrisonChange = /bỏ\s+hình\s+phạt\s+tử\s+hình|nâng\s+mức\s+phạt\s+tù/iu.test(sanctionText);

    const hasExplicitSanction = Boolean(
        fineMin !== null
        || fineMax !== null
        || prisonLabel
        || hasDeathPenalty
        || pointsDeducted !== null
        || suspensionMonths
        || hasWarning
        || hasNonCustodial
        || hasConfiscationOrRemedial
        || hasExplicitDeathRemovalOrPrisonChange,
    );

    const parts: string[] = [];

    if (fineMin !== null && fineMax !== null) {
        if (fineMin === fineMax) {
            parts.push(`${fineMax.toLocaleString("vi-VN")}đ`);
        } else {
            parts.push(`${fineMin.toLocaleString("vi-VN")} – ${fineMax.toLocaleString("vi-VN")}đ`);
        }
    } else if (fineMin !== null || fineMax !== null) {
        parts.push(`${(fineMin ?? fineMax ?? 0).toLocaleString("vi-VN")}đ`);
    }

    if (prisonLabel) {
        parts.push(prisonLabel);
    } else if (hasNonCustodial) {
        parts.push("Cải tạo không giam giữ");
    }

    if (hasWarning) {
        parts.push("Phạt cảnh cáo");
    }

    if (pointsDeducted !== null && parts.length === 0) {
        parts.push(`Trừ ${pointsDeducted} điểm GPLX`);
    }

    if (suspensionMonths && parts.length === 0) {
        parts.push(`Tước/Đình chỉ ${suspensionMonths}`);
    }

    if (hasConfiscationOrRemedial && parts.length === 0) {
        parts.push("Tịch thu / Biện pháp khắc phục");
    }

    if (hasExplicitDeathRemovalOrPrisonChange && parts.length === 0) {
        parts.push("Điều chỉnh khung hình phạt");
    }

    return {
        hasExplicitSanction,
        fineMin,
        fineMax,
        fineLabel: parts.length > 0 ? parts.join(" · ") : "Định nghĩa hành vi",
        prisonLabel,
        hasDeathPenalty,
        pointsDeducted,
        suspensionMonths,
    };
}

type ExplicitDefinitionInfo = {
    hasExplicitDefinition: boolean;
    definitionText: string | null;
};

const PURE_OBJECT_GLOSSARY_PREDICATE = /^(?:gồm\s+đường|là\s+hàm\s+lượng|là\s+phương\s+tiện|là\s+đường|là\s+chứng\s+chỉ|là\s+thông\s+số|là\s+tập\s+hợp|là\s+thiết\s+bị|là\s+trạng\s+thái|là\s+tổ\s+chức|là\s+cơ\s+quan)/iu;

function detectBehaviorDefinition(text: string, parentArticleTitle?: string | null): ExplicitDefinitionInfo {
    const trimmed = text.trim();
    const artTitle = (parentArticleTitle ?? "").trim();

    if (/hành\s+vi\s+bị\s+nghiêm\s+cấm/iu.test(artTitle) && !/:\s*$/u.test(trimmed)) {
        return { hasExplicitDefinition: true, definitionText: trimmed.slice(0, 220) };
    }

    if (/nghiêm\s+cấm\b|^cấm\s+(?:hành\s+vi|tự\s+ý|sử\s+dụng|điều\s+khiển|vận\s+hành)/iu.test(trimmed)) {
        return { hasExplicitDefinition: true, definitionText: trimmed.slice(0, 220) };
    }

    if (/^Cấm\s+/iu.test(artTitle) && !/:\s*$/u.test(trimmed)) {
        return { hasExplicitDefinition: true, definitionText: trimmed.slice(0, 220) };
    }

    const defMatch = /^(.{3,90}?)\s+(được\s+hiểu\s+là|được\s+coi\s+là|được\s+xác\s+định\s+là|có\s+nghĩa\s+là|là|bao\s+gồm)\s+(.+)$/iu.exec(trimmed);

    if (defMatch) {
        const subject = defMatch[1].trim();
        const predicate = `${defMatch[2]} ${defMatch[3]}`.trim();

        if (PURE_OBJECT_GLOSSARY_PREDICATE.test(predicate)) {
            return { hasExplicitDefinition: false, definitionText: null };
        }

        const isBehaviorSubject = /\b(?:hành\s+vi|vi\s+phạm|tội|vượt\s+đèn|nồng\s+độ\s+cồn|quá\s+tốc\s+độ|đi\s+ngược\s+chiều|điều\s+khiển|sử\s+dụng)\b/iu.test(subject);
        const isBehaviorPredicate = /\b(?:hành\s+vi|vi\s+phạm|không\s+chấp\s+hành|không\s+dừng|điều\s+khiển)\b/iu.test(defMatch[3]);

        if (isBehaviorSubject || isBehaviorPredicate) {
            return { hasExplicitDefinition: true, definitionText: trimmed.slice(0, 220) };
        }
    }

    return { hasExplicitDefinition: false, definitionText: null };
}

function shortHash(input: string): string {
    let hash = 0x811c9dc5;

    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }

    return (hash >>> 0).toString(16).slice(0, 6);
}

/**
 * Extracts all behaviors across workspace files and links their chronological change history
 * split into sanction changes and definition changes, excluding clauses without explicit sanctions or definitions.
 */
export function buildWorkspaceBehaviorHistory(
    files: readonly LocalWorkspaceFile[],
    relationGraph: WorkspaceRelationGraph,
    cachedFactsByPath: ReadonlyMap<string, readonly ExtractedLegalFact[]> = new Map(),
    activeFilePath?: string,
    activeContent?: string,
): WorkspaceBehaviorSummary {
    const nodeMap = new Map(relationGraph.nodes.map((n) => [n.path, n]));
    const rawItems: BehaviorVersionItem[] = [];
    const baseCrimeTitles = new Map<string, string>();
    let itemSeq = 0;

    const hasActiveInFiles = activeFilePath ? files.some((f) => f.path === activeFilePath) : true;
    const effectiveFiles: LocalWorkspaceFile[] = files.map((file) => {
        if (activeFilePath && activeContent !== undefined && file.path === activeFilePath) {
            return { ...file, content: activeContent };
        }

        return file;
    });

    if (activeFilePath && activeContent !== undefined && activeContent.trim().length > 0 && !hasActiveInFiles) {
        const firstLine = activeContent.split("\n").find((l) => l.trim().length > 0)?.trim() ?? activeFilePath;
        const nodeInfo = nodeMap.get(activeFilePath);
        effectiveFiles.push({
            path: activeFilePath,
            name: activeFilePath.split("/").pop() ?? activeFilePath,
            title: nodeInfo?.title ?? firstLine.slice(0, 120),
            documentNumber: nodeInfo?.documentNumber ?? null,
            documentType: nodeInfo?.documentType ?? null,
            content: activeContent,
            isLibrary: false,
            updatedAt: new Date().toISOString(),
        });
    }

    for (const file of effectiveFiles) {
        const parsed = parseDraftDocument(file.content);

        for (const node of parsed.nodes) {
            if (node.level === "ARTICLE" && node.articleNo && node.title && /^Tội\s+/iu.test(node.title)) {
                baseCrimeTitles.set(node.articleNo.toLowerCase(), `Điều ${node.articleNo}. ${node.title}`);
            }
        }
    }

    for (const file of effectiveFiles) {
        const content = file.content;
        const nodeInfo = nodeMap.get(file.path);
        const parsed = parseDraftDocument(content);
        const fineRanges = extractFineRanges(parsed);
        const thresholds = extractNumericThresholds(parsed, fineRanges);

        if (usesArticleStructuredSanctions(file, parsed)) {
            const isAmending = /sửa đổi,\s*bổ sung/iu.test(`${file.title} ${content.slice(0, 600)}`);

            if (!isAmending) {
                for (const node of parsed.nodes) {
                    if (node.level !== "ARTICLE" || !node.articleNo || !node.title || !/^Tội\s+/iu.test(node.title)) {
                        continue;
                    }

                    const artNo = node.articleNo.toLowerCase();
                    const slice = content.slice(node.startOffset, node.endOffset);
                    const artFines = fineRanges.filter((f) => f.startOffset >= node.startOffset && f.startOffset <= node.endOffset);
                    const sanction = extractExplicitSanction(slice, artFines[0]);

                    if (!sanction.hasExplicitSanction) {
                        continue;
                    }

                    const line = positionAtOffset(parsed.lineStarts, node.startOffset).line;
                    const defSnippet = slice.split(/thì\s+bị\s+phạt/iu)[0]?.trim() ?? slice;

                    itemSeq += 1;
                    rawItems.push({
                        id: `bhv-crim-${itemSeq}`,
                        canonicalKey: `blhs_dieu_${artNo}::Cá nhân`,
                        behaviorTitle: `Điều ${node.articleNo}. ${node.title}`,
                        vehicleOrSubject: "Cá nhân",
                        modality: "SANCTION",
                        fineMin: sanction.fineMin,
                        fineMax: sanction.fineMax,
                        fineLabel: sanction.fineLabel,
                        prisonLabel: sanction.prisonLabel,
                        hasDeathPenalty: sanction.hasDeathPenalty,
                        pointsDeducted: sanction.pointsDeducted,
                        suspensionMonths: sanction.suspensionMonths,
                        thresholdText: null,
                        hasExplicitSanction: true,
                        hasExplicitDefinition: true,
                        definitionText: defSnippet.slice(0, 220),
                        sourcePath: file.path,
                        documentNumber: nodeInfo?.documentNumber ?? file.documentNumber,
                        documentTitle: nodeInfo?.title ?? file.title,
                        provisionRef: node.refLabel,
                        line,
                        effectiveDate: nodeInfo?.effectiveDate ?? nodeInfo?.issuedDate ?? null,
                        lifecycleStatus: nodeInfo?.status ?? (file.isLibrary ? "ACTIVE" : "DRAFT"),
                        excerpt: slice.slice(0, 180),
                        changeKind: "INITIAL",
                        changeSummary: null,
                        sanctionChangeKind: null,
                        sanctionChangeSummary: null,
                        definitionChangeKind: null,
                        definitionChangeSummary: null,
                        fineDeltaPercent: null,
                    });
                }
            } else {
                const lines = content.split("\n");

                for (let idx = 0; idx < lines.length; idx += 1) {
                    const lineText = lines[idx].trim();
                    const repealMatch = /^\d+\.\s*Bãi bỏ Điều\s+(\d+[a-zđ]?)/iu.exec(lineText);

                    if (repealMatch) {
                        const artNo = repealMatch[1].toLowerCase();

                        if (!baseCrimeTitles.has(artNo)) {
                            continue;
                        }

                        itemSeq += 1;
                        rawItems.push({
                            id: `bhv-crim-${itemSeq}`,
                            canonicalKey: `blhs_dieu_${artNo}::Cá nhân`,
                            behaviorTitle: baseCrimeTitles.get(artNo) ?? `Điều ${artNo} BLHS`,
                            vehicleOrSubject: "Cá nhân",
                            modality: "SANCTION",
                            fineMin: null,
                            fineMax: null,
                            fineLabel: "Đã bãi bỏ hoàn toàn",
                            prisonLabel: null,
                            hasDeathPenalty: false,
                            pointsDeducted: null,
                            suspensionMonths: null,
                            thresholdText: null,
                            hasExplicitSanction: true,
                            hasExplicitDefinition: false,
                            definitionText: null,
                            sourcePath: file.path,
                            documentNumber: nodeInfo?.documentNumber ?? file.documentNumber,
                            documentTitle: nodeInfo?.title ?? file.title,
                            provisionRef: `Dòng ${idx + 1}`,
                            line: idx + 1,
                            effectiveDate: nodeInfo?.effectiveDate ?? nodeInfo?.issuedDate ?? null,
                            lifecycleStatus: nodeInfo?.status ?? (file.isLibrary ? "ACTIVE" : "DRAFT"),
                            excerpt: lineText.slice(0, 180),
                            changeKind: "REPEALED",
                            changeSummary: null,
                            sanctionChangeKind: null,
                            sanctionChangeSummary: null,
                            definitionChangeKind: null,
                            definitionChangeSummary: null,
                            fineDeltaPercent: null,
                        });

                        continue;
                    }

                    const amendMatch = /^(?:\d+\.\s*(?:Sửa đổi,\s*bổ sung|Bổ sung)[^.\n]*?Điều\s+(\d+[a-zđ]?)|-\s*Bỏ hình phạt tử hình[^.\n]*?Điều\s+(\d+[a-zđ]?))/iu.exec(lineText);

                    if (amendMatch) {
                        const artNo = (amendMatch[1] ?? amendMatch[2]).toLowerCase();
                        let blockEnd = idx + 1;

                        while (
                            blockEnd < lines.length
                            && !/^\d+\.\s+(?:Sửa đổi|Bổ sung|Bãi bỏ)/iu.test(lines[blockEnd].trim())
                            && !/^Điều\s+\d+/iu.test(lines[blockEnd].trim())
                        ) {
                            blockEnd += 1;
                        }

                        const blockText = lines.slice(idx, Math.min(lines.length, blockEnd)).join("\n");
                        const quotedCrimeMatch = /Điều\s+(\d+[a-zđ]?)\.\s+(Tội\s+[^\n]+)/iu.exec(blockText);

                        if (quotedCrimeMatch) {
                            baseCrimeTitles.set(quotedCrimeMatch[1].toLowerCase(), `Điều ${quotedCrimeMatch[1]}. ${quotedCrimeMatch[2].trim()}`);
                        }

                        const blockParsed = parseDraftDocument(blockText);
                        const blockFines = extractFineRanges(blockParsed);
                        const sanction = extractExplicitSanction(blockText, blockFines[0]);
                        const isKnownCrime = baseCrimeTitles.has(artNo);

                        if (!isKnownCrime && !quotedCrimeMatch) {
                            continue;
                        }

                        const modifiesDefinition = Boolean(
                            quotedCrimeMatch
                            || (!sanction.hasExplicitSanction && isKnownCrime)
                            || /ngưỡng định lượng|điểm\s+[a-zđ]\s+khoản\s+\d+/iu.test(blockText),
                        );

                        if (!sanction.hasExplicitSanction && !modifiesDefinition) {
                            continue;
                        }

                        itemSeq += 1;
                        rawItems.push({
                            id: `bhv-crim-${itemSeq}`,
                            canonicalKey: `blhs_dieu_${artNo}::Cá nhân`,
                            behaviorTitle: baseCrimeTitles.get(artNo) ?? `Điều ${artNo} BLHS`,
                            vehicleOrSubject: "Cá nhân",
                            modality: "SANCTION",
                            fineMin: sanction.fineMin,
                            fineMax: sanction.fineMax,
                            fineLabel: sanction.fineLabel,
                            prisonLabel: sanction.prisonLabel,
                            hasDeathPenalty: sanction.hasDeathPenalty,
                            pointsDeducted: sanction.pointsDeducted,
                            suspensionMonths: sanction.suspensionMonths,
                            thresholdText: null,
                            hasExplicitSanction: sanction.hasExplicitSanction,
                            hasExplicitDefinition: modifiesDefinition,
                            definitionText: modifiesDefinition ? blockText.slice(0, 220) : null,
                            sourcePath: file.path,
                            documentNumber: nodeInfo?.documentNumber ?? file.documentNumber,
                            documentTitle: nodeInfo?.title ?? file.title,
                            provisionRef: `Dòng ${idx + 1}`,
                            line: idx + 1,
                            effectiveDate: nodeInfo?.effectiveDate ?? nodeInfo?.issuedDate ?? null,
                            lifecycleStatus: nodeInfo?.status ?? (file.isLibrary ? "ACTIVE" : "DRAFT"),
                            excerpt: blockText.slice(0, 180),
                            changeKind: "AMENDED",
                            changeSummary: null,
                            sanctionChangeKind: null,
                            sanctionChangeSummary: null,
                            definitionChangeKind: null,
                            definitionChangeSummary: null,
                            fineDeltaPercent: null,
                        });
                    }
                }
            }

            continue;
        }

        const nodeById = new Map(parsed.nodes.map((n) => [n.id, n]));
        const parentIdsWithChildren = new Set<string>();

        for (const n of parsed.nodes) {
            if (n.parentId) {
                parentIdsWithChildren.add(n.parentId);
            }
        }

        let extractedForFile = 0;

        for (const node of parsed.nodes) {
            if (node.level === "CHAPTER") {
                continue;
            }

            if (node.level === "ARTICLE" && parentIdsWithChildren.has(node.id)) {
                continue;
            }

            const text = node.text.trim();

            if (text.length < 6) {
                continue;
            }

            if (node.level === "CLAUSE" && parentIdsWithChildren.has(node.id) && /:\s*$/u.test(text)) {
                continue;
            }

            const parentNode = node.parentId ? (nodeById.get(node.parentId) ?? null) : null;
            const parentArticle = parsed.nodes.find((n) => n.level === "ARTICLE" && n.articleNo === node.articleNo);

            if (isNonBehaviorMetaClause(text, parentArticle?.title)) {
                continue;
            }

            const canInheritParentClause = node.level === "POINT" && parentNode?.level === "CLAUSE";
            const ownFine = fineRanges.find(
                (f) => f.startOffset >= node.startOffset && f.startOffset <= node.endOffset,
            );
            const parentFine = !ownFine && canInheritParentClause && parentNode
                ? fineRanges.find((f) => f.startOffset >= parentNode.startOffset && f.startOffset <= parentNode.endOffset)
                : undefined;
            const fine = ownFine ?? parentFine;
            const sanctionText = canInheritParentClause && parentNode ? `${parentNode.text} ${text}` : text;

            const sanction = extractExplicitSanction(sanctionText, fine);
            const definition = detectBehaviorDefinition(text, parentArticle?.title);

            if (!sanction.hasExplicitSanction && !definition.hasExplicitDefinition) {
                continue;
            }

            const ownThr = thresholds.find(
                (t) => t.startOffset >= node.startOffset && t.startOffset <= node.endOffset,
            );
            const canonical = classifyCanonicalBehavior(text) ?? (canInheritParentClause && parentNode ? classifyCanonicalBehavior(parentNode.text) : null);
            const vehicle = detectVehicleOrSubject(sanctionText, parentArticle?.title);
            const normalizedSlug = text
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/đ/g, "d")
                .replace(/[^a-z0-9]+/g, "_")
                .replace(/^_+|_+$/g, "");
            const fallbackKey = normalizedSlug.length > 56
                ? `${normalizedSlug.slice(0, 48)}_${shortHash(normalizedSlug)}`
                : normalizedSlug;

            const keyBase = canonical?.key ?? fallbackKey;
            const thrSuffix = ownThr ? `_${ownThr.min ?? 0}_${ownThr.max ?? "inf"}` : "";
            const canonicalKey = `${keyBase}${thrSuffix}::${vehicle}`;
            const behaviorTitle = canonical?.title ?? text.slice(0, 90);
            const modality = /nghiêm cấm|\bcấm\b|không được/iu.test(sanctionText) ? "PROHIBITED" : "SANCTION";

            extractedForFile += 1;
            itemSeq += 1;
            rawItems.push({
                id: `bhv-${itemSeq}`,
                canonicalKey,
                behaviorTitle,
                vehicleOrSubject: vehicle,
                modality,
                fineMin: sanction.fineMin,
                fineMax: sanction.fineMax,
                fineLabel: sanction.fineLabel,
                prisonLabel: sanction.prisonLabel,
                hasDeathPenalty: sanction.hasDeathPenalty,
                pointsDeducted: sanction.pointsDeducted,
                suspensionMonths: sanction.suspensionMonths,
                thresholdText: ownThr ? ownThr.excerpt : null,
                hasExplicitSanction: sanction.hasExplicitSanction,
                hasExplicitDefinition: definition.hasExplicitDefinition,
                definitionText: definition.definitionText,
                sourcePath: file.path,
                documentNumber: nodeInfo?.documentNumber ?? file.documentNumber,
                documentTitle: nodeInfo?.title ?? file.title,
                provisionRef: node.refLabel,
                line: positionAtOffset(parsed.lineStarts, node.startOffset).line,
                effectiveDate: nodeInfo?.effectiveDate ?? nodeInfo?.issuedDate ?? null,
                lifecycleStatus: nodeInfo?.status ?? (file.isLibrary ? "ACTIVE" : "DRAFT"),
                excerpt: text.slice(0, 180),
                changeKind: file.isLibrary ? "INITIAL" : "DRAFT_PROPOSAL",
                changeSummary: null,
                sanctionChangeKind: null,
                sanctionChangeSummary: null,
                definitionChangeKind: null,
                definitionChangeSummary: null,
                fineDeltaPercent: null,
            });
        }

        // Fallback for free-form lines typed before adding "Điều 1."
        if (extractedForFile === 0 && !file.isLibrary) {
            const lines = content.split("\n");

            for (let idx = 0; idx < lines.length; idx += 1) {
                const lineText = lines[idx].trim();

                if (lineText.length < 8 || isNonBehaviorMetaClause(lineText)) {
                    continue;
                }

                const lineParsed = parseDraftDocument(lineText);
                const lineFine = extractFineRanges(lineParsed)[0];
                const sanction = extractExplicitSanction(lineText, lineFine);
                const definition = detectBehaviorDefinition(lineText);

                if (!sanction.hasExplicitSanction && !definition.hasExplicitDefinition) {
                    continue;
                }

                const canonical = classifyCanonicalBehavior(lineText);
                const vehicle = detectVehicleOrSubject(lineText);
                const slug = lineText
                    .toLowerCase()
                    .normalize("NFD")
                    .replace(/[\u0300-\u036f]/g, "")
                    .replace(/đ/g, "d")
                    .replace(/[^a-z0-9]+/g, "_")
                    .replace(/^_+|_+$/g, "")
                    .slice(0, 48);

                itemSeq += 1;
                rawItems.push({
                    id: `bhv-line-${itemSeq}`,
                    canonicalKey: `${canonical?.key ?? slug}::${vehicle}`,
                    behaviorTitle: canonical?.title ?? lineText.slice(0, 90),
                    vehicleOrSubject: vehicle,
                    modality: /nghiêm cấm|\bcấm\b|không được/iu.test(lineText) ? "PROHIBITED" : "SANCTION",
                    fineMin: sanction.fineMin,
                    fineMax: sanction.fineMax,
                    fineLabel: sanction.fineLabel,
                    prisonLabel: sanction.prisonLabel,
                    hasDeathPenalty: sanction.hasDeathPenalty,
                    pointsDeducted: sanction.pointsDeducted,
                    suspensionMonths: sanction.suspensionMonths,
                    thresholdText: null,
                    hasExplicitSanction: sanction.hasExplicitSanction,
                    hasExplicitDefinition: definition.hasExplicitDefinition,
                    definitionText: definition.definitionText,
                    sourcePath: file.path,
                    documentNumber: nodeInfo?.documentNumber ?? file.documentNumber,
                    documentTitle: nodeInfo?.title ?? file.title,
                    provisionRef: `Dòng ${idx + 1}`,
                    line: idx + 1,
                    effectiveDate: nodeInfo?.effectiveDate ?? nodeInfo?.issuedDate ?? null,
                    lifecycleStatus: "DRAFT",
                    excerpt: lineText.slice(0, 180),
                    changeKind: "DRAFT_PROPOSAL",
                    changeSummary: null,
                    sanctionChangeKind: null,
                    sanctionChangeSummary: null,
                    definitionChangeKind: null,
                    definitionChangeSummary: null,
                    fineDeltaPercent: null,
                });
            }
        }

        const aiFacts = cachedFactsByPath.get(file.path) ?? [];

        for (const fact of aiFacts) {
            const alreadyExists = rawItems.some(
                (item) => item.sourcePath === file.path && item.line === fact.line,
            );

            if (alreadyExists || isNonBehaviorMetaClause(fact.quote)) {
                continue;
            }

            const sanction = extractExplicitSanction(fact.quote);
            const hasAiFine = fact.fineMin !== null || fact.fineMax !== null;
            const definition = detectBehaviorDefinition(fact.quote);

            if (!hasAiFine && !sanction.hasExplicitSanction && !definition.hasExplicitDefinition) {
                continue;
            }

            const vehicle = detectVehicleOrSubject(fact.quote);
            const canonicalKey = `${fact.actionKey}::${vehicle}`;

            itemSeq += 1;
            rawItems.push({
                id: `bhv-ai-${itemSeq}`,
                canonicalKey,
                behaviorTitle: fact.quote.slice(0, 90),
                vehicleOrSubject: vehicle,
                modality: fact.modality,
                fineMin: fact.fineMin ?? sanction.fineMin,
                fineMax: fact.fineMax ?? sanction.fineMax,
                fineLabel: hasAiFine ? formatFineLabel(fact.fineMin, fact.fineMax) : sanction.fineLabel,
                prisonLabel: sanction.prisonLabel,
                hasDeathPenalty: sanction.hasDeathPenalty,
                pointsDeducted: sanction.pointsDeducted,
                suspensionMonths: sanction.suspensionMonths,
                thresholdText: fact.thresholdMin !== null ? `${fact.thresholdMin}–${fact.thresholdMax ?? "∞"} ${fact.thresholdUnit ?? ""}` : null,
                hasExplicitSanction: hasAiFine || sanction.hasExplicitSanction,
                hasExplicitDefinition: definition.hasExplicitDefinition,
                definitionText: definition.definitionText,
                sourcePath: file.path,
                documentNumber: nodeInfo?.documentNumber ?? file.documentNumber,
                documentTitle: nodeInfo?.title ?? file.title,
                provisionRef: fact.provisionRef ?? `Dòng ${fact.line}`,
                line: fact.line,
                effectiveDate: nodeInfo?.effectiveDate ?? nodeInfo?.issuedDate ?? null,
                lifecycleStatus: nodeInfo?.status ?? (file.isLibrary ? "ACTIVE" : "DRAFT"),
                excerpt: fact.quote,
                changeKind: file.isLibrary ? "INITIAL" : "DRAFT_PROPOSAL",
                changeSummary: null,
                sanctionChangeKind: null,
                sanctionChangeSummary: null,
                definitionChangeKind: null,
                definitionChangeSummary: null,
                fineDeltaPercent: null,
            });
        }
    }

    // Group by canonicalKey
    const grouped = new Map<string, BehaviorVersionItem[]>();

    for (const item of rawItems) {
        const list = grouped.get(item.canonicalKey) ?? [];
        list.push(item);
        grouped.set(item.canonicalKey, list);
    }

    // Attach general Law definitions (e.g., 23/2008 & 36/2024) into matching specific behavior groups
    const keysToDelete: string[] = [];

    for (const [generalKey, generalItems] of grouped.entries()) {
        if (!generalItems.every((item) => item.hasExplicitDefinition && !item.hasExplicitSanction)) {
            continue;
        }

        const [generalBase, generalVehicle] = generalKey.split("::");
        const matchingTargets: string[] = [];

        for (const [targetKey, targetItems] of grouped.entries()) {
            if (targetKey === generalKey) {
                continue;
            }

            const [targetBase, targetVehicle] = targetKey.split("::");
            const sameBase = targetBase === generalBase || targetBase.startsWith(`${generalBase}_`);
            const compatibleVehicle = generalVehicle === "Cá nhân / Chung" || targetVehicle === generalVehicle;

            if (sameBase && compatibleVehicle && targetItems.some((item) => item.hasExplicitSanction)) {
                matchingTargets.push(targetKey);
            }
        }

        if (matchingTargets.length === 0) {
            continue;
        }

        for (const targetKey of matchingTargets) {
            const targetList = grouped.get(targetKey);

            if (!targetList) {
                continue;
            }

            for (const defItem of generalItems) {
                const duplicate = targetList.some(
                    (existing) => existing.sourcePath === defItem.sourcePath && existing.line === defItem.line,
                );

                if (!duplicate) {
                    targetList.push({ ...defItem, canonicalKey: targetKey });
                }
            }
        }

        keysToDelete.push(generalKey);
    }

    for (const key of keysToDelete) {
        grouped.delete(key);
    }

    const groups: WorkspaceBehaviorGroup[] = [];

    for (const [canonicalKey, versions] of grouped.entries()) {
        sortVersionsChronologically(versions);

        const sanctionHistory = versions
            .filter((v) => v.hasExplicitSanction)
            .map((v) => ({ ...v }));
        const definitionHistory = versions
            .filter((v) => v.hasExplicitDefinition)
            .map((v) => ({ ...v }));

        annotateSanctionChanges(sanctionHistory);
        annotateDefinitionChanges(definitionHistory);

        const sanctionById = new Map(sanctionHistory.map((v) => [v.id, v]));
        const definitionById = new Map(definitionHistory.map((v) => [v.id, v]));

        for (const ver of versions) {
            const sItem = sanctionById.get(ver.id);
            const dItem = definitionById.get(ver.id);

            if (sItem) {
                ver.sanctionChangeKind = sItem.sanctionChangeKind;
                ver.sanctionChangeSummary = sItem.sanctionChangeSummary;
                ver.fineDeltaPercent = sItem.fineDeltaPercent;
                ver.changeKind = sItem.sanctionChangeKind ?? ver.changeKind;
                ver.changeSummary = sItem.sanctionChangeSummary;
            }

            if (dItem) {
                ver.definitionChangeKind = dItem.definitionChangeKind;
                ver.definitionChangeSummary = dItem.definitionChangeSummary;

                if (!sItem && dItem.definitionChangeKind) {
                    ver.changeKind = dItem.definitionChangeKind;
                    ver.changeSummary = dItem.definitionChangeSummary;
                }
            }
        }

        const latestSanctionVersion = sanctionHistory.length > 0 ? sanctionHistory[sanctionHistory.length - 1] : null;
        const latestDefinitionVersion = definitionHistory.length > 0 ? definitionHistory[definitionHistory.length - 1] : null;
        const latestVersion = versions[versions.length - 1];
        const hasSanctionHistory = sanctionHistory.length > 1;
        const hasDefinitionHistory = definitionHistory.length > 1;

        groups.push({
            canonicalKey,
            behaviorTitle: latestVersion.behaviorTitle,
            vehicleOrSubject: latestVersion.vehicleOrSubject,
            latestVersion,
            latestSanctionVersion,
            latestDefinitionVersion,
            versions,
            sanctionHistory,
            definitionHistory,
            hasHistory: hasSanctionHistory || hasDefinitionHistory,
            hasSanctionHistory,
            hasDefinitionHistory,
            hasDraftConflict: versions.some((v) => v.changeKind === "DRAFT_CONFLICT"),
            hasReplacedVersion: versions.some((v) => v.lifecycleStatus === "REPLACED" || v.lifecycleStatus === "REPEALED"),
        });
    }

    groups.sort((a, b) => Number(b.hasHistory) - Number(a.hasHistory) || b.versions.length - a.versions.length);

    return {
        groups,
        totalBehaviors: groups.length,
        withHistoryCount: groups.filter((g) => g.hasHistory).length,
        sanctionHistoryCount: groups.filter((g) => g.hasSanctionHistory).length,
        definitionHistoryCount: groups.filter((g) => g.hasDefinitionHistory).length,
        replacedCount: groups.filter((g) => g.hasReplacedVersion).length,
        draftConflictCount: groups.filter((g) => g.hasDraftConflict).length,
    };
}

function sortVersionsChronologically(versions: BehaviorVersionItem[]): void {
    versions.sort((a, b) => {
        if (a.lifecycleStatus === "DRAFT" && b.lifecycleStatus !== "DRAFT") {
            return 1;
        }

        if (b.lifecycleStatus === "DRAFT" && a.lifecycleStatus !== "DRAFT") {
            return -1;
        }

        const dateA = a.effectiveDate ?? "0000-00-00";
        const dateB = b.effectiveDate ?? "0000-00-00";

        if (dateA !== dateB) {
            return dateA.localeCompare(dateB);
        }

        if (a.hasExplicitSanction !== b.hasExplicitSanction) {
            return Number(a.hasExplicitSanction) - Number(b.hasExplicitSanction);
        }

        return a.sourcePath.localeCompare(b.sourcePath);
    });
}

function annotateSanctionChanges(sanctionHistory: BehaviorVersionItem[]): void {
    for (let i = 1; i < sanctionHistory.length; i += 1) {
        const prev = sanctionHistory[i - 1];
        const curr = sanctionHistory[i];

        if (curr.changeKind === "REPEALED") {
            curr.sanctionChangeKind = "REPEALED";
            curr.sanctionChangeSummary = `Bãi bỏ hoàn toàn quy định tại ${curr.documentNumber ?? curr.documentTitle}`;
        } else if (prev.hasDeathPenalty && !curr.hasDeathPenalty) {
            curr.sanctionChangeKind = "SANCTION_RESTRUCTURED";
            curr.sanctionChangeSummary = `Bỏ hình phạt tử hình (${prev.fineLabel} → ${curr.fineLabel})`;
        } else if (curr.lifecycleStatus === "DRAFT") {
            curr.sanctionChangeKind = "DRAFT_PROPOSAL";
            curr.sanctionChangeSummary = `Dự thảo đề xuất mức xử lý mới so với ${prev.documentNumber ?? prev.documentTitle}`;
        } else if (prev.fineMax !== null && curr.fineMax !== null && curr.fineMax > prev.fineMax) {
            const delta = Math.round(((curr.fineMax - prev.fineMax) / prev.fineMax) * 100);
            curr.fineDeltaPercent = delta;
            curr.sanctionChangeKind = "PENALTY_INCREASED";
            curr.sanctionChangeSummary = `Tăng mức phạt +${delta}% (${prev.fineLabel} → ${curr.fineLabel})${curr.pointsDeducted ? ` · Bổ sung trừ ${curr.pointsDeducted} điểm GPLX` : ""}`;
        } else if (prev.fineMax !== null && curr.fineMax !== null && curr.fineMax < prev.fineMax) {
            const delta = Math.round(((curr.fineMax - prev.fineMax) / prev.fineMax) * 100);
            curr.fineDeltaPercent = delta;
            curr.sanctionChangeKind = "PENALTY_DECREASED";
            curr.sanctionChangeSummary = `Giảm mức phạt ${delta}% (${prev.fineLabel} → ${curr.fineLabel})`;
        } else if (curr.pointsDeducted && !prev.pointsDeducted) {
            curr.sanctionChangeKind = "SANCTION_RESTRUCTURED";
            curr.sanctionChangeSummary = `Bổ sung trừ ${curr.pointsDeducted} điểm GPLX thay thế/bổ sung cho ${prev.documentNumber ?? prev.documentTitle}`;
        } else if (prev.lifecycleStatus === "REPLACED" || prev.lifecycleStatus === "REPEALED") {
            curr.sanctionChangeKind = "REPLACED_BY_NEW_LAW";
            curr.sanctionChangeSummary = `Thay thế mức xử lý cũ tại ${prev.documentNumber ?? prev.documentTitle}`;
        } else {
            curr.sanctionChangeKind = "AMENDED";
            curr.sanctionChangeSummary = `Cập nhật mức xử lý từ ${prev.documentNumber ?? prev.documentTitle}`;
        }

        curr.changeKind = curr.sanctionChangeKind;
        curr.changeSummary = curr.sanctionChangeSummary;
    }
}

function annotateDefinitionChanges(definitionHistory: BehaviorVersionItem[]): void {
    for (let i = 1; i < definitionHistory.length; i += 1) {
        const prev = definitionHistory[i - 1];
        const curr = definitionHistory[i];

        if (curr.lifecycleStatus === "DRAFT") {
            curr.definitionChangeKind = "DEFINITION_CHANGED";
            curr.definitionChangeSummary = `Dự thảo điều chỉnh định nghĩa hành vi so với ${prev.documentNumber ?? prev.documentTitle}`;
        } else if (prev.lifecycleStatus === "REPLACED" || prev.lifecycleStatus === "REPEALED") {
            curr.definitionChangeKind = "DEFINITION_CHANGED";
            curr.definitionChangeSummary = `Thay đổi định nghĩa hành vi so với ${prev.documentNumber ?? prev.documentTitle}`;
        } else {
            curr.definitionChangeKind = "DEFINITION_CHANGED";
            curr.definitionChangeSummary = `Sửa đổi/bổ sung định nghĩa hành vi từ ${prev.documentNumber ?? prev.documentTitle}`;
        }

        if (!curr.hasExplicitSanction) {
            curr.changeKind = curr.definitionChangeKind;
            curr.changeSummary = curr.definitionChangeSummary;
        }
    }
}

export type BehaviorLineIndicator = {
    id: string;
    canonicalKey: string;
    line: number;
    isNew: boolean;
    behaviorTitle: string;
    vehicleOrSubject: string;
    modality: BehaviorVersionItem["modality"];
    fineLabel: string;
    pointsDeducted: number | null;
    suspensionMonths: string | null;
    provisionRef: string;
    changeSummary: string | null;
    hasExplicitSanction: boolean;
    hasExplicitDefinition: boolean;
    definitionText: string | null;
    versionCount: number;
    previousVersions: {
        documentLabel: string;
        provisionRef: string;
        fineLabel: string;
        lifecycleStatus: string;
    }[];
    previousSanctions: {
        documentLabel: string;
        provisionRef: string;
        fineLabel: string;
        lifecycleStatus: string;
    }[];
    previousDefinitions: {
        documentLabel: string;
        provisionRef: string;
        definitionText: string;
        lifecycleStatus: string;
    }[];
};

export function extractLineBehaviorIndicators(
    summary: WorkspaceBehaviorSummary,
    activeFilePath: string,
): BehaviorLineIndicator[] {
    const byLine = new Map<number, BehaviorLineIndicator>();

    for (const group of summary.groups) {
        const activeVersions = group.versions.filter((v) => v.sourcePath === activeFilePath);

        if (activeVersions.length === 0) {
            continue;
        }

        const isNew = !group.versions.some((v) => v.sourcePath !== activeFilePath);
        const previousSanctions = group.sanctionHistory
            .filter((v) => v.sourcePath !== activeFilePath)
            .map((v) => ({
                documentLabel: v.documentNumber ?? v.documentTitle,
                provisionRef: v.provisionRef,
                fineLabel: v.fineLabel,
                lifecycleStatus: v.lifecycleStatus,
            }));
        const previousDefinitions = group.definitionHistory
            .filter((v) => v.sourcePath !== activeFilePath)
            .map((v) => ({
                documentLabel: v.documentNumber ?? v.documentTitle,
                provisionRef: v.provisionRef,
                definitionText: v.definitionText ?? v.excerpt,
                lifecycleStatus: v.lifecycleStatus,
            }));

        for (const ver of activeVersions) {
            if (byLine.has(ver.line)) {
                continue;
            }

            byLine.set(ver.line, {
                id: ver.id,
                canonicalKey: group.canonicalKey,
                line: ver.line,
                isNew,
                behaviorTitle: ver.behaviorTitle,
                vehicleOrSubject: ver.vehicleOrSubject,
                modality: ver.modality,
                fineLabel: ver.fineLabel,
                pointsDeducted: ver.pointsDeducted,
                suspensionMonths: ver.suspensionMonths,
                provisionRef: ver.provisionRef,
                changeSummary: ver.changeSummary,
                hasExplicitSanction: ver.hasExplicitSanction,
                hasExplicitDefinition: ver.hasExplicitDefinition,
                definitionText: ver.definitionText,
                versionCount: group.versions.length,
                previousVersions: previousSanctions,
                previousSanctions,
                previousDefinitions,
            });
        }
    }

    return [...byLine.values()].sort((a, b) => a.line - b.line);
}
