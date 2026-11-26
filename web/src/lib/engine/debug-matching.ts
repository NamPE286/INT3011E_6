import type { ParsedNode } from "./parser";

export type VehicleKind = "CAR" | "MOTORBIKE" | "AUTONOMOUS" | null;

const CANONICAL_CONCEPT_RULES: readonly { key: string; pattern: RegExp }[] = [
    {
        key: "red_light",
        pattern: /đèn\s+tín\s+hiệu\s+giao\s+thông|hiệu\s+lệnh\s+của\s+đèn\s+tín\s+hiệu|vượt\s+đèn\s+đỏ|đèn\s+đỏ|tín\s+hiệu\s+đèn/iu,
    },
    {
        key: "helmet",
        pattern: /mũ\s+bảo\s+hiểm|nón\s+bảo\s+hiểm/iu,
    },
    {
        key: "alcohol",
        pattern: /nồng\s+độ\s+cồn|uống\s+rượu|uống\s+bia|say\s+rượu|say\s+xỉn|rượu\s+bia/iu,
    },
    {
        key: "wrong_way",
        pattern: /đi\s+ngược\s+chiều|chạy\s+ngược\s+chiều|ngược\s+chiều/iu,
    },
    {
        key: "phone",
        pattern: /sử\s+dụng\s+điện\s+thoại|dùng\s+điện\s+thoại|nghe\s+điện\s+thoại|cầm\s+điện\s+thoại|điện\s+thoại/iu,
    },
    {
        key: "speed",
        pattern: /quá\s+tốc\s+độ|vượt\s+tốc\s+độ|vượt\s+quá\s+tốc\s+độ/iu,
    },
    {
        key: "stopping",
        pattern: /dừng\s+xe|đỗ\s+xe|đậu\s+xe|biển\s+cấm\s+dừng|cấm\s+dừng|cấm\s+đỗ/iu,
    },
    {
        key: "expressway",
        pattern: /đường\s+cao\s+tốc|cao\s+tốc/iu,
    },
    {
        key: "autonomous_software",
        pattern: /can\s+thiệp\s+phần\s+mềm|hệ\s+thống\s+hỗ\s+trợ\s+lái|thiết\s+bị\s+giám\s+sát/iu,
    },
    {
        key: "severe_consequence",
        pattern: /hậu\s+quả\s+nghiêm\s+trọng|gây\s+hậu\s+quả/iu,
    },
    {
        key: "tax_late_filing",
        pattern: /(?:chậm|trễ|quá\s+hạn)\s+(?:nộp\s+)?(?:hồ\s+sơ\s+)?(?:kê\s+)?khai\s+thuế|(?:hồ\s+sơ\s+(?:kê\s+)?khai\s+thuế|tờ\s+khai\s+thuế)[^.\n]{0,40}(?:chậm|trễ|quá\s+hạn)/iu,
    },
    {
        key: "tax_no_invoice",
        pattern: /không\s+(?:lập|xuất)\s+hóa\s+đơn|bán\s+hàng[^.\n]{0,30}không\s+(?:lập|xuất)\s+hóa\s+đơn/iu,
    },
    {
        key: "labor_overtime",
        pattern: /làm\s+thêm|tăng\s+ca|làm\s+ngoài\s+giờ/iu,
    },
    {
        key: "land_encroachment",
        pattern: /lấn[,\s]+chiếm\s+đất|chiếm\s+dụng\s+trái\s+phép|lấn\s+sang\s+phần\s+đất|đất\s+nông\s+nghiệp|đất\s+trồng\s+lúa/iu,
    },
    {
        key: "lease_structural_mod",
        pattern: /(?:cải\s+tạo|sửa\s+đổi|chỉnh\s+sửa)\s+kết\s+cấu|đập\s+tường[^.\n]{0,30}kết\s+cấu/iu,
    },
];

// General Vietnamese legal & colloquial lexical normalization (domain-agnostic)
const LEXICAL_SYNONYM_MAP: readonly [RegExp, string][] = [
    [/\b(?:trễ\s+hạn|quá\s+hạn|nộp\s+trễ|giao\s+trễ|trễ\s+mất)\b/giu, "chậm"],
    [/\b(?:tăng\s+ca|làm\s+ngoài\s+giờ)\b/giu, "làm thêm"],
    [/\b(?:đất\s+trồng\s+lúa)\b/giu, "đất nông nghiệp"],
    [/\b(?:chiếm\s+dụng)\b/giu, "lấn chiếm"],
    [/\b(?:sửa\s+đổi|chỉnh\s+sửa)\s+kết\s+cấu\b/giu, "cải tạo kết cấu"],
    [/\b(?:tờ\s+khai\s+thuế|hồ\s+sơ\s+kê\s+khai\s+thuế)\b/giu, "hồ sơ khai thuế"],
    [/\b(?:chứng\s+chỉ|giấy\s+chứng\s+nhận)\b/giu, "giấy xác nhận"],
    [/\b(?:thải\s+ra)\b/giu, "xả"],
    [/\b(?:chưa\s+đạt\s+chuẩn|vượt\s+ngưỡng\s+quy\s+chuẩn)\b/giu, "vượt quy chuẩn"],
    [/\b(?:đầu\s+bếp|nhân\s+viên\s+trực\s+tiếp\s+chế\s+biến)\b/giu, "người chế biến"],
    [/\b(?:bên\s+thi\s+công|đơn\s+vị\s+tổng\s+thầu)\b/giu, "nhà thầu"],
    [/\b(?:công\s+trình|hạng\s+mục\s+thi\s+công)\b/giu, "tiến độ thi công"],
    [/\b(?:một\s+số\s+thùng\s+hàng|hỏng\s+hàng|thiệt\s+hại)\b/giu, "hậu quả"],
];

const PROHIBITION_MODALITY = /\b(?:nghiêm\s+cấm|cấm|không\s+được(?:\s+phép)?)\b/iu;
const PERMISSION_MODALITY = /(?<!không\s+)\b(?:cho\s+phép|được\s+phép)\b/iu;
const CONDITIONAL_PERMISSION = /\b(?:trừ\s+trường\s+hợp|khi\s+có\s+giấy\s+phép|khi\s+được\s+cơ\s+quan|trong\s+trường\s+hợp\s+khẩn\s+cấp|nếu\s+đáp\s+ứng)\b/iu;

const TOKEN_STOPWORDS = new Set([
    "người", "điều", "khiển", "phương", "tiện", "tham", "giao", "thông", "trên", "đường",
    "hành", "vi", "phạm", "thực", "hiện", "trong", "trường", "hợp", "của", "và", "hoặc",
    "với", "tại", "theo", "cho", "khi", "đang", "này", "đó", "một", "các", "cá", "nhân",
    "tổ", "chức", "phạt", "tiền", "đồng", "đối", "bị", "từ", "đến", "về", "quy", "định",
    "nhưng", "không", "chưa", "vừa", "đồng", "thời", "ngày", "tháng", "năm", "triệu",
    "là", "có", "để", "nào", "thì", "mà", "còn", "bằng", "sau", "đây", "như", "tại",
    "anh", "chị", "ông", "bà", "công", "ty", "doanh", "nghiệp", "hộ", "kinh",
]);

const GENERIC_LEGAL_WORDS = new Set([
    "phạm", "tội", "trái", "phép", "chế", "tạo", "khối", "lượng", "số", "diện", "tích",
    "mức", "vượt", "quá", "thời", "gian", "hồ", "sơ", "lao", "động", "hàng", "hóa",
    "bên", "thuê", "bán", "mua", "nhà", "thầu", "cơ", "sở", "tài", "sản", "giá", "trị",
    "dưới", "trở", "lên", "kèm", "nếu", "trừ", "ngoài", "tù", "cải", "tịch", "thu",
    "xử", "lỗi", "vụ", "việc", "loại", "các", "đơn", "vị", "dùng", "sử", "dụng",
]);

export function normalizeVietnameseLegalText(text: string): string {
    let normalized = text.toLowerCase();

    for (const [pattern, replacement] of LEXICAL_SYNONYM_MAP) {
        normalized = normalized.replace(pattern, replacement);
    }

    return normalized;
}

export function detectVehicleKind(text: string): VehicleKind {
    if (/(?<![\p{L}])xe\s*tự\s*hành(?![\p{L}])/iu.test(text)) {
        return "AUTONOMOUS";
    }

    if (/(?<![\p{L}])(?:xe\s*mô\s*tô|xe\s*máy|xe\s*gắn\s*máy|mô\s*tô)(?![\p{L}])/iu.test(text)) {
        return "MOTORBIKE";
    }

    if (/(?<![\p{L}])(?:xe\s*ô\s*tô|xe\s*hơi|ô\s*tô|xe\s*con|xe\s*bốn\s*bánh)(?![\p{L}])/iu.test(text)) {
        return "CAR";
    }

    return null;
}

export function extractCanonicalConcepts(text: string): string[] {
    const normalized = normalizeVietnameseLegalText(text);
    const concepts: string[] = [];

    for (const rule of CANONICAL_CONCEPT_RULES) {
        if (rule.pattern.test(text) || rule.pattern.test(normalized)) {
            concepts.push(rule.key);
        }
    }

    return concepts;
}

export function findParentArticle(nodes: readonly ParsedNode[], node: ParsedNode): ParsedNode | null {
    if (node.level === "ARTICLE") {
        return node;
    }

    if (!node.articleNo) {
        return null;
    }

    return nodes.find((candidate) => candidate.level === "ARTICLE" && candidate.articleNo === node.articleNo) ?? null;
}

export function tokenizeContentWords(text: string): string[] {
    const normalized = normalizeVietnameseLegalText(text);
    const words = normalized
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((word) => word.length >= 2 && !TOKEN_STOPWORDS.has(word));

    return [...new Set(words)];
}

export function tokenizeDistinctiveWords(text: string): string[] {
    return tokenizeContentWords(text).filter((w) => !GENERIC_LEGAL_WORDS.has(w) && !/^\d+$/.test(w));
}

export function computeClauseSpecificity(
    clauseText: string,
    scenario: string,
): { matchedDistinctive: number; totalDistinctive: number; ratio: number } {
    const clauseDistinctive = tokenizeDistinctiveWords(clauseText);

    if (clauseDistinctive.length === 0) {
        return { matchedDistinctive: 0, totalDistinctive: 0, ratio: 0 };
    }

    const scenarioSet = new Set(tokenizeDistinctiveWords(scenario));
    const matchedDistinctive = clauseDistinctive.filter((w) => scenarioSet.has(w)).length;
    const denom = Math.min(clauseDistinctive.length, 6);

    return {
        matchedDistinctive,
        totalDistinctive: clauseDistinctive.length,
        ratio: matchedDistinctive / denom,
    };
}

export function scoreArticleTopicMatch(
    articleTitle: string | null,
    clauseText: string,
    scenario: string,
): number {
    const targetText = `${articleTitle ?? ""} ${clauseText}`;
    const targetConcepts = extractCanonicalConcepts(targetText);
    const scenarioConcepts = extractCanonicalConcepts(scenario);
    const conceptHits = scenarioConcepts.filter((c) => targetConcepts.includes(c)).length;

    const targetTokens = new Set(tokenizeDistinctiveWords(targetText));
    const scenarioTokens = tokenizeDistinctiveWords(scenario);
    const tokenHits = scenarioTokens.filter((t) => targetTokens.has(t)).length;

    return conceptHits * 5 + tokenHits * 2;
}

export function scoreClauseMatch(
    node: ParsedNode,
    parentArticle: ParsedNode | null,
    scenarioKeywords: readonly string[],
    scenarioConcepts: readonly string[],
    scenarioVehicle: VehicleKind,
): number {
    const clauseVehicle = detectVehicleKind(`${parentArticle?.title ?? ""} ${node.text}`);

    if (scenarioVehicle !== null && clauseVehicle !== null && scenarioVehicle !== clauseVehicle) {
        return 0;
    }

    const clauseConcepts = extractCanonicalConcepts(node.text);
    const conceptHits = scenarioConcepts.filter((concept) => clauseConcepts.includes(concept)).length;
    const clauseTokenSet = new Set(tokenizeContentWords(node.text));
    const titleTokenSet = new Set(tokenizeContentWords(parentArticle?.title ?? ""));
    const distinctiveSet = new Set(tokenizeDistinctiveWords(node.text));

    const keywordHits = scenarioKeywords.filter((kw) => clauseTokenSet.has(kw)).length;
    const distinctiveHits = scenarioKeywords.filter((kw) => distinctiveSet.has(kw)).length;
    const titleOnlyHits = scenarioKeywords.filter((kw) => !clauseTokenSet.has(kw) && titleTokenSet.has(kw)).length;

    if (conceptHits < 1 && distinctiveHits < 2 && (keywordHits + titleOnlyHits) < 3) {
        return 0;
    }

    const vehicleBonus = scenarioVehicle !== null && clauseVehicle === scenarioVehicle ? 1 : 0;

    return conceptHits * 5 + distinctiveHits * 3 + keywordHits + titleOnlyHits + vehicleBonus;
}

export function detectDeonticConflictInNodes(
    nodes: readonly ParsedNode[],
    allNodes: readonly ParsedNode[],
): { prohibitedNode: ParsedNode; permittedNode: ParsedNode } | null {
    for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i];
        const aHasProhibition = PROHIBITION_MODALITY.test(a.text);
        const aHasPermission = PERMISSION_MODALITY.test(a.text);

        if (!aHasProhibition || aHasPermission) {
            continue;
        }

        for (let j = 0; j < nodes.length; j += 1) {
            if (i === j) {
                continue;
            }

            const b = nodes[j];

            if (PROHIBITION_MODALITY.test(b.text) || !PERMISSION_MODALITY.test(b.text)) {
                continue;
            }

            if (CONDITIONAL_PERMISSION.test(b.text)) {
                continue;
            }

            const aParent = findParentArticle(allNodes, a);
            const bParent = findParentArticle(allNodes, b);
            const aVehicle = detectVehicleKind(`${aParent?.title ?? ""} ${a.text}`);
            const bVehicle = detectVehicleKind(`${bParent?.title ?? ""} ${b.text}`);

            if (aVehicle !== null && bVehicle !== null && aVehicle !== bVehicle) {
                continue;
            }

            const aConcepts = extractCanonicalConcepts(a.text);
            const bConcepts = extractCanonicalConcepts(b.text);
            const sharedConcepts = aConcepts.filter((concept) => bConcepts.includes(concept));

            if (sharedConcepts.length >= 1) {
                return { prohibitedNode: a, permittedNode: b };
            }

            const aTokens = tokenizeContentWords(a.text);
            const bTokenSet = new Set(tokenizeContentWords(b.text));
            const sharedTokens = aTokens.filter((token) => bTokenSet.has(token));

            if (sharedTokens.length >= 2) {
                return { prohibitedNode: a, permittedNode: b };
            }
        }
    }

    return null;
}
