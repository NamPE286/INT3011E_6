import { describeReason } from "../reasons";
import { isRecord, readNumber, readRows, readString, readStringList } from "./read";

export const RULE_STATUS_LABELS = {
    CURRENT: "Đang áp dụng",
    AMENDED: "Đã được sửa đổi",
    REPEALED: "Đã bị bãi bỏ",
    SUPERSEDED: "Đã bị thay thế",
    UNCERTAIN: "Chưa chắc chắn",
    NOT_YET_EFFECTIVE: "Chưa có hiệu lực",
} as const;

export type RuleStatus = keyof typeof RULE_STATUS_LABELS;

export const CHANGE_TYPE_LABELS = {
    NO_SEMANTIC_CHANGE: "Không đổi về nội dung",
    VIOLATION_ADDED: "Hành vi được bổ sung",
    VIOLATION_REMOVED: "Hành vi bị bãi bỏ",
    CONDITION_ADDED: "Thêm điều kiện",
    CONDITION_REMOVED: "Bỏ điều kiện",
    CONDITION_CHANGED: "Đổi điều kiện",
    EXCEPTION_ADDED: "Thêm ngoại lệ",
    EXCEPTION_REMOVED: "Bỏ ngoại lệ",
    SUBJECT_CHANGED: "Đổi đối tượng",
    VEHICLE_SCOPE_CHANGED: "Đổi phạm vi phương tiện",
    LOCATION_SCOPE_CHANGED: "Đổi phạm vi địa điểm",
    SANCTION_INCREASE: "Tăng mức phạt",
    SANCTION_DECREASE: "Giảm mức phạt",
    SANCTION_CHANGED: "Đổi mức phạt",
    POINT_DEDUCTION_APPLICABILITY_CHANGED: "Đổi việc trừ điểm giấy phép lái xe",
    POINT_DEDUCTION_CHANGED: "Đổi số điểm bị trừ",
    LICENSE_SUSPENSION_CHANGED: "Đổi thời hạn tước giấy phép lái xe",
    VEHICLE_CONFISCATION_CHANGED: "Đổi việc tịch thu phương tiện",
    ADDITIONAL_SANCTION_CHANGED: "Đổi hình thức xử phạt bổ sung",
    REPEALED: "Bị bãi bỏ",
    REPLACED: "Bị thay thế",
    UNKNOWN: "Chưa xác định được thay đổi",
} as const;

export type ChangeType = keyof typeof CHANGE_TYPE_LABELS;

export type ViolationSummary = {
    id: string;
    canonicalName: string;
    aliases: string[];
};

export type RuleCard = {
    ruleId: string;
    behaviorText: string;
    articleTitle: string | null;
    status: RuleStatus;
    subjectScope: "INDIVIDUAL" | "ORGANIZATION" | null;
    vehicles: string[];
    conditions: string[];
    exceptions: string[];
    fine: { min: number; max: number } | null;
    warningAllowed: boolean;
    pointDeductionApplicability: string;
    pointsDeducted: number | null;
    effects: string[];
    remedialMeasures: string[];
    validFrom: string | null;
    validTo: string | null;
    endType: string | null;
    reasons: string[];
    provisionId: string;
    sourceDocumentId: string;
};

export type LineageContext = {
    vehicles: string[];
    subject: string | null;
};

export type CorpusScope = {
    documentCount: number;
    lastImportedAt: string | null;
    frontier: string[];
};

export type LineageAtDate = LineageContext & {
    lineageId: string;
    applicable: RuleCard[];
    uncertain: RuleCard[];
};

export type ViolationRulesAsOf = {
    asOf: string;
    lineages: LineageAtDate[];
    scope: CorpusScope;
};

export type ChangeDetail = {
    field: string;
    before: unknown;
    after: unknown;
};

export type ChangeEventView = {
    id: string;
    oldRuleId: string | null;
    newRuleId: string | null;
    changeTypes: ChangeType[];
    details: ChangeDetail[];
    effectiveAt: string | null;
    evidenceDocumentId: string | null;
};

export type LineageHistory = LineageContext & {
    lineageId: string;
    rules: RuleCard[];
    changeEvents: ChangeEventView[];
};

export type ViolationHistory = {
    lineages: LineageHistory[];
    scope: CorpusScope;
};

export function parseViolationSearch(value: unknown): ViolationSummary[] | null {
    if (!isRecord(value) || !Array.isArray(value.violations)) {
        return null;
    }

    return readRows(value, "violations", parseSummary);
}

export function parseViolationSummary(value: unknown): ViolationSummary | null {
    return isRecord(value) ? parseSummary(value) : null;
}

export function parseViolationRulesAsOf(value: unknown): ViolationRulesAsOf | null {
    const asOf = isRecord(value) ? readString(value, "asOf") : null;

    if (!isRecord(value) || !asOf || !Array.isArray(value.lineages)) {
        return null;
    }

    return {
        asOf,
        lineages: readRows(value, "lineages", parseLineageAtDate),
        scope: parseCorpusScope(value.scope),
    };
}

export function parseViolationHistory(value: unknown): ViolationHistory | null {
    if (!isRecord(value) || !Array.isArray(value.lineages)) {
        return null;
    }

    return {
        lineages: readRows(value, "lineages", parseLineageHistory),
        scope: parseCorpusScope(value.scope),
    };
}

function isRuleStatus(value: string | null): value is RuleStatus {
    return value !== null && Object.hasOwn(RULE_STATUS_LABELS, value);
}

function isChangeType(value: string): value is ChangeType {
    return Object.hasOwn(CHANGE_TYPE_LABELS, value);
}

function parseSummary(row: Record<string, unknown>): ViolationSummary | null {
    const id = readString(row, "id");
    const canonicalName = readString(row, "canonicalName");

    if (!id || canonicalName === null) {
        return null;
    }

    return { id, canonicalName, aliases: readStringList(row, "aliases") };
}

function parseContext(value: unknown): LineageContext {
    const context = isRecord(value) ? value : {};

    return { vehicles: readStringList(context, "vehicles"), subject: readString(context, "subject") };
}

function parseLineageAtDate(row: Record<string, unknown>): LineageAtDate | null {
    const lineageId = readString(row, "lineageId");

    if (!lineageId) {
        return null;
    }

    return {
        lineageId,
        ...parseContext(row.contextIr),
        applicable: readRows(row, "applicable", parseRuleCard),
        uncertain: readRows(row, "uncertain", parseRuleCard),
    };
}

function parseLineageHistory(row: Record<string, unknown>): LineageHistory | null {
    const lineageId = readString(row, "id");

    if (!lineageId) {
        return null;
    }

    return {
        lineageId,
        ...parseContext(row.contextIr),
        rules: readRows(row, "rules", parseRuleCard),
        changeEvents: readRows(row, "changeEvents", parseChangeEvent),
    };
}

function parseRuleCard(entry: Record<string, unknown>): RuleCard | null {
    const status = readString(entry, "status");

    if (!isRuleStatus(status) || !isRecord(entry.rule)) {
        return null;
    }

    const rule = entry.rule;
    const interval = isRecord(entry.interval) ? entry.interval : {};
    const sanction = isRecord(rule.sanction) ? rule.sanction : {};
    const semantics = isRecord(rule.semanticIr) ? rule.semanticIr : {};
    const ruleId = readString(rule, "id");
    const provisionId = readString(rule, "provisionId");
    const sourceDocumentId = readString(rule, "sourceDocumentId");

    if (!ruleId || !provisionId || !sourceDocumentId) {
        return null;
    }

    const subjectScope = readString(rule, "subjectScope");

    return {
        ruleId,
        behaviorText: readString(rule, "behaviorText") ?? "",
        articleTitle: readString(rule, "articleTitle"),
        status,
        subjectScope: subjectScope === "INDIVIDUAL" || subjectScope === "ORGANIZATION" ? subjectScope : null,
        vehicles: readLabels(semantics, "vehicles"),
        conditions: readLabels(semantics, "conditions"),
        exceptions: readLabels(semantics, "exceptions"),
        fine: parseFine(sanction.fine),
        warningAllowed: sanction.warningAllowed === true,
        pointDeductionApplicability: readString(sanction, "pointDeductionApplicability") ?? "UNKNOWN",
        pointsDeducted: readNumber(sanction, "pointsDeducted"),
        effects: readTexts(sanction, "effects", "rawText"),
        remedialMeasures: readTexts(sanction, "remedialMeasures", "text"),
        validFrom: readString(interval, "validFrom"),
        validTo: readString(interval, "validTo"),
        endType: readString(interval, "endType"),
        reasons: collectReasons(entry, rule),
        provisionId,
        sourceDocumentId,
    };
}

function parseFine(value: unknown): { min: number; max: number } | null {
    if (!isRecord(value)) {
        return null;
    }

    const min = readNumber(value, "min");
    const max = readNumber(value, "max");

    return min !== null && max !== null ? { min, max } : null;
}

function readLabels(source: Record<string, unknown>, key: string): string[] {
    return readRows(source, key, (item) => readString(item, "label"));
}

function readTexts(source: Record<string, unknown>, key: string, field: string): string[] {
    return readRows(source, key, (item) => readString(item, field));
}

function collectReasons(entry: Record<string, unknown>, rule: Record<string, unknown>): string[] {
    const codes = [...readStringList(rule, "uncertaintyReasons"), ...readStringList(entry, "reasonCodes")];

    return [...new Set(codes.map(describeReason))];
}

function parseChangeEvent(row: Record<string, unknown>): ChangeEventView | null {
    const id = readString(row, "id");

    if (!id) {
        return null;
    }

    const evidence = isRecord(row.evidence) ? row.evidence : {};

    return {
        id,
        oldRuleId: readString(row, "oldRuleId"),
        newRuleId: readString(row, "newRuleId"),
        changeTypes: readStringList(row, "changeTypes").filter(isChangeType),
        details: readRows(row, "details", parseChangeDetail),
        effectiveAt: readString(row, "effectiveAt"),
        evidenceDocumentId: readString(evidence, "fromDocumentId"),
    };
}

function parseChangeDetail(row: Record<string, unknown>): ChangeDetail | null {
    const field = readString(row, "field");

    return field ? { field, before: row.before, after: row.after } : null;
}

export function parseCorpusScope(value: unknown): CorpusScope {
    const scope = isRecord(value) ? value : {};

    return {
        documentCount: readNumber(scope, "documentCount") ?? 0,
        lastImportedAt: readString(scope, "lastImportedAt"),
        frontier: readStringList(scope, "frontier"),
    };
}
