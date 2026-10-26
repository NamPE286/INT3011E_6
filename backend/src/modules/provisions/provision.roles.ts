import type { ContentRole, ProvisionLevel, Relevance } from "./provision.types";

export type RoleInput = {
    level: ProvisionLevel;
    title: string | null;
    /** The provision's own text, quotation marks included. */
    text: string;
    /** The text with quoted segments removed; instructions are read from here, never from inside a quote. */
    unquotedText: string;
    quotedSegments: string[];
    isQuotedNode: boolean;
    /** Title of the Điều this provision belongs to (its own title for an article). */
    articleTitle: string | null;
    /** The parent introduces a list of behaviours ("... một trong các hành vi sau đây:"). */
    parentIntroducesViolations: boolean;
    isUnreadable: boolean;
};

export type RoleResult = {
    contentRole: ContentRole;
    relevance: Relevance;
    /** This provision introduces a list whose points are violation behaviours. */
    introducesViolations: boolean;
};

type OperationKind = "AMEND" | "REPEAL" | "EFFECTIVE" | "TRANSITION";

// JavaScript's \b only understands ASCII letters, so Vietnamese words are closed with this lookahead instead.
const WORD_END = "(?=$|[\\s,.:;])";
const OPERATION_VERBS = "sửa đổi|bổ sung|thay thế|bãi bỏ|đính chính";
const DOCUMENT_NAMES = "Nghị định|Luật|Thông tư|Pháp lệnh|Nghị quyết|Quyết định";

// A verb only opens an instruction when a legal object follows it ("Bổ sung hồ sơ trong 05 ngày" is not one).
const OPERATION_OBJECT = [
    "(?:các\\s+|một số\\s+|những\\s+)?(?:điểm|khoản|điều|mục|chương|phần|phụ lục|cụm từ|từ ngữ|nội dung|quy định|tên|tiêu đề|biểu mẫu)",
    "toàn bộ",
    "như sau",
    "(?:nghị định|luật|bộ luật|thông tư|pháp lệnh|nghị quyết|quyết định)",
].join("|");
const OPERATION_START = new RegExp(
    `^(?:(?:${OPERATION_VERBS})(?:\\s*(?:,|và)\\s*(?:sửa đổi|bổ sung))?${WORD_END}\\s*(?=${OPERATION_OBJECT})|thay cụm từ${WORD_END}|bỏ cụm từ${WORD_END})`,
    "iu",
);
const REPEAL_START = new RegExp(`^bãi bỏ${WORD_END}(?!\\s+cụm từ)`, "iu");
const PASSIVE_OPERATION = new RegExp(
    `^(?:điểm|khoản|điều|mục|chương|phần)\\s[^.:;]{0,200}?(?<!đã\\s)(?:được|bị)\\s+(?:${OPERATION_VERBS})${WORD_END}`,
    "iu",
);
const PASSIVE_REPEAL = /(?<!đã\s)(?:được|bị)\s+bãi bỏ/iu;
const DOCUMENT_REPLACEMENT = new RegExp(`(?:thay thế|bãi bỏ)\\s+(?:các\\s+)?(?:${DOCUMENT_NAMES})${WORD_END}`, "iu");
const DOCUMENT_EXPIRY = /hết hiệu lực/iu;
const HISTORICAL = new RegExp(`đã\\s+(?:được|bị)\\s+(?:${OPERATION_VERBS})${WORD_END}`, "iu");
const EFFECTIVE_DATE = /(?:có hiệu lực|hiệu lực thi hành)\s+(?:kể\s+)?từ\s+ngày/iu;
const TRANSITION_TITLE = /chuyển tiếp/iu;

const FINE = /phạt\s+tiền\s+(?:từ\s+)?\d[\d.,]*\s*đồng/iu;
const LICENSE_SUSPENSION = /tước\s+quyền\s+sử\s+dụng\s+(?:giấy\s+phép|chứng\s+chỉ)/iu;
const POINT_DEDUCTION = /trừ\s+điểm\s+giấy\s+phép\s+lái\s+xe/iu;
const CONFISCATION = /tịch\s+thu\s+(?:tang\s+vật|phương\s+tiện)/iu;
const REMEDIAL_ORDER = /(?:^|[:;]\s*|(?<![\p{L}\p{N}])bị\s+)buộc\s/iu;
const ADDITIONAL_SANCTION_INTRO = /(?:hình thức xử phạt bổ sung|biện pháp khắc phục hậu quả)[^.]{0,80}(?:sau đây|như sau)/iu;
const SANCTION_PATTERNS: readonly RegExp[] = [FINE, LICENSE_SUSPENSION, POINT_DEDUCTION, CONFISCATION, REMEDIAL_ORDER, ADDITIONAL_SANCTION_INTRO];

const SANCTION_ARTICLE_TITLE = /^xử phạt(?:\s|,|$)/iu;
const REFERENCE_PHRASE = /quy định tại|theo quy định/iu;
const BEHAVIOUR_WORD = /hành vi/iu;

/** Rule-based role and relevance for one provision. Pure: the same input always gives the same result. */
export function classifyRole(input: RoleInput): RoleResult {
    const text = normalizeSpaces(input.text);
    const instructionText = normalizeSpaces(input.unquotedText);
    const ruleText = normalizeSpaces(ruleTextOf(input));
    const introducesViolations = readIntroducesViolations(ruleText);

    if (input.level === "PREAMBLE") {
        return { contentRole: "PREAMBLE_BASIS", relevance: "REFERENCE", introducesViolations: false };
    }

    if (input.isUnreadable) {
        return { contentRole: "ORDINARY_TEXT", relevance: "UNCERTAIN", introducesViolations: false };
    }

    // New wording only shows its role in the provision it rewrites, which is not known yet: a quoted unit
    // that names no sanction stays UNCERTAIN (not IRRELEVANT) until rule placement (#15) can tell.
    if (input.isQuotedNode) {
        const relevance = readRuleRelevance(input, text) ?? (REFERENCE_PHRASE.test(text) ? "REFERENCE" : "UNCERTAIN");

        return { contentRole: "QUOTED_NEW_TEXT", relevance, introducesViolations };
    }

    const operation = readOperationKind(instructionText, input.articleTitle);

    if (operation) {
        return { contentRole: "OPERATIVE_INSTRUCTION", relevance: relevanceOfOperation(operation), introducesViolations };
    }

    if (HISTORICAL.test(instructionText)) {
        return { contentRole: "HISTORICAL_DESCRIPTION", relevance: "REFERENCE", introducesViolations: false };
    }

    if (!instructionText && isOperationTitle(input)) {
        return { contentRole: "TITLE_REFERENCE", relevance: "REFERENCE", introducesViolations: false };
    }

    const relevance = readRuleRelevance(input, text) ?? readFallbackRelevance(instructionText);

    return { contentRole: "ORDINARY_TEXT", relevance, introducesViolations };
}

/** Quoted segments are the new rule text of an instruction; for any other node the node's own text is the rule text. */
function ruleTextOf(input: RoleInput): string {
    if (input.quotedSegments.length > 0 && !input.isQuotedNode) {
        return input.quotedSegments.join(" ");
    }

    return input.text;
}

function readIntroducesViolations(ruleText: string): boolean {
    if (!ruleText.endsWith(":")) {
        return false;
    }

    return BEHAVIOUR_WORD.test(ruleText);
}

function readOperationKind(instructionText: string, articleTitle: string | null): OperationKind | null {
    if (OPERATION_START.test(instructionText)) {
        return REPEAL_START.test(instructionText) ? "REPEAL" : "AMEND";
    }

    if (PASSIVE_OPERATION.test(instructionText)) {
        return PASSIVE_REPEAL.test(instructionText) ? "REPEAL" : "AMEND";
    }

    if (DOCUMENT_REPLACEMENT.test(instructionText)) {
        return /bãi bỏ/iu.test(instructionText) ? "REPEAL" : "AMEND";
    }

    if (HISTORICAL.test(instructionText)) {
        return null;
    }

    if (DOCUMENT_EXPIRY.test(instructionText)) {
        return "REPEAL";
    }

    if (EFFECTIVE_DATE.test(instructionText)) {
        return "EFFECTIVE";
    }

    if (articleTitle && TRANSITION_TITLE.test(articleTitle) && instructionText) {
        return "TRANSITION";
    }

    return null;
}

function relevanceOfOperation(operation: OperationKind): Relevance {
    if (operation === "REPEAL") {
        return "REPEAL_INSTRUCTION";
    }

    if (operation === "AMEND") {
        return "AMENDMENT_INSTRUCTION";
    }

    if (operation === "EFFECTIVE") {
        return "REFERENCE";
    }

    return "UNCERTAIN";
}

function isOperationTitle(input: RoleInput): boolean {
    if (input.level === "CLAUSE" || input.level === "POINT" || !input.title) {
        return false;
    }

    return OPERATION_START.test(normalizeSpaces(input.title));
}

function readRuleRelevance(input: RoleInput, text: string): Relevance | null {
    if (SANCTION_PATTERNS.some((pattern) => pattern.test(text))) {
        return "SANCTION_RULE";
    }

    if (input.level === "ARTICLE" && input.title && SANCTION_ARTICLE_TITLE.test(normalizeSpaces(input.title))) {
        return "SANCTION_RULE";
    }

    if (input.level === "POINT" && input.parentIntroducesViolations) {
        return "VIOLATION_RULE";
    }

    return null;
}

function readFallbackRelevance(text: string): Relevance {
    if (REFERENCE_PHRASE.test(text)) {
        return "REFERENCE";
    }

    return "IRRELEVANT";
}

function normalizeSpaces(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}
