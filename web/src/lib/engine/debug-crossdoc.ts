import type { LocalWorkspaceFile } from "./local-workspace";
import { extractDocumentMetadata, parseDraftDocument, type ParsedDraft, type ParsedNode } from "./parser";

export type CrossDocProvisionEffect = {
    kind: "REPEALED" | "AMENDED";
    targetKey: string;
    sourceDocLabel: string;
    sourceProvisionRef: string;
    verbatimQuote: string;
    amendedText: string | null;
    effectiveDate: string | null;
};

export type ExceptionEvalOutcome = "NONE" | "EXEMPT_VALID" | "EXEMPTION_OVERRIDDEN";

const SCENARIO_DATE_SLASH = /(?:ngày\s+)?(\d{1,2})\/(\d{1,2})\/(\d{4})/iu;
const SCENARIO_DATE_VN = /ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})/iu;
const DOC_NUM_REGEX = /\b(\d{1,4}\/\d{4}\/[A-ZĐ0-9\-]+)\b/iu;

const REPEAL_LINE = /bãi\s+bỏ\s+(?:(điểm)\s+([a-zđ])\s+)?(?:(khoản)\s+(\d+)\s+)?Điều\s+(\d+[a-zđ]?)/giu;
const AMEND_LINE = /sửa\s+đổi(?:,\s*bổ\s+sung)?\s+(?:(điểm)\s+([a-zđ])\s+)?(?:(khoản)\s+(\d+)\s+)?Điều\s+(\d+[a-zđ]?)[^:\n]*?(?:như\s+sau)?\s*:\s*(.+)$/iu;

const QUALIFIED_EXCEPTION_SPLIT = /(?<![\p{L}])trừ\s+(?:các\s+)?(?:trường\s+hợp|khi|lý\s+do|người|tổ\s+chức)\s+([^.;\n]+)(?:[;,]\s*(?:nhưng\s+)?(?:không\s+áp\s+dụng\s+(?:quy\s+định\s+)?miễn\s+trừ|vẫn\s+bị\s+xử\s+phạt)\s+(?:nếu|khi|đối\s+với\s+trường\s+hợp)\s+([^.\n]+))?/iu;
const OPEN_EXCEPTION_ONLY = /^(?:đặc\s+biệt|cần\s+thiết|bất\s+khả\s+kháng|khác|chính\s+đáng)\s*$/iu;

const EXCEPTION_STOPWORDS = new Set([
    "của", "các", "cơ", "quan", "nhà", "nước", "theo", "quy", "định", "pháp", "luật",
    "trường", "hợp", "bên", "người", "cho", "với", "trong", "được", "nếu", "khi",
    "hoặc", "và", "tại", "từ", "đến", "một", "có", "bị", "về", "hành", "vi",
    "không", "chưa", "gây", "mất", "làm", "nào", "vẫn", "nhưng",
]);

function toIsoDate(year: string, month: string, day: string): string {
    return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function extractScenarioDateIso(scenario: string): string | null {
    const slash = SCENARIO_DATE_SLASH.exec(scenario);

    if (slash) {
        return toIsoDate(slash[3], slash[2], slash[1]);
    }

    const vn = SCENARIO_DATE_VN.exec(scenario);

    if (vn) {
        return toIsoDate(vn[3], vn[2], vn[1]);
    }

    return null;
}

export function buildProvisionKey(node: Pick<ParsedNode, "articleNo" | "clauseNo" | "pointNo">): string | null {
    if (!node.articleNo) {
        return null;
    }

    const art = node.articleNo.toLowerCase();

    if (node.clauseNo && node.pointNo) {
        return `d:${art}|k:${node.clauseNo}|p:${node.pointNo.toLowerCase()}`;
    }

    if (node.clauseNo) {
        return `d:${art}|k:${node.clauseNo}`;
    }

    return `d:${art}`;
}

function makeTargetKey(articleNo: string, clauseNo?: string, pointNo?: string): string {
    const art = articleNo.toLowerCase();

    if (clauseNo && pointNo) {
        return `d:${art}|k:${clauseNo}|p:${pointNo.toLowerCase()}`;
    }

    if (clauseNo) {
        return `d:${art}|k:${clauseNo}`;
    }

    return `d:${art}`;
}

function fileTargetsDraft(
    wsFile: LocalWorkspaceFile,
    draftDocNum: string | null,
    draftTitleLower: string,
): boolean {
    const wsLower = wsFile.content.toLowerCase();

    if (draftDocNum && wsLower.includes(draftDocNum.toLowerCase())) {
        return true;
    }

    const cleanTitle = draftTitleLower
        .replace(/^(?:dự thảo\s+)?(?:luật|bộ luật|nghị định|thông tư|quyết định)\s+(?:số\s+\S+\s+)?/iu, "")
        .trim();

    return cleanTitle.length >= 16 && wsLower.includes(cleanTitle.slice(0, 32));
}

/**
 * Resolves cross-document repeals and amendments from workspace files targeting the active draft,
 * respecting effective dates when the scenario provides a violation date.
 */
export function resolveWorkspaceProvisionEffects(
    draft: ParsedDraft,
    workspaceFiles: readonly LocalWorkspaceFile[],
    currentPath?: string,
    scenarioDateIso?: string | null,
): Map<string, CrossDocProvisionEffect> {
    const effects = new Map<string, CrossDocProvisionEffect>();

    if (workspaceFiles.length === 0) {
        return effects;
    }

    const draftMeta = extractDocumentMetadata(draft.content, currentPath);
    const firstLine = draft.content.split("\n").find((l) => l.trim().length > 0)?.trim().toLowerCase() ?? "";
    const draftDocNum = draftMeta.documentNumber ?? DOC_NUM_REGEX.exec(draft.content.slice(0, 400))?.[1] ?? null;

    const candidateFiles = workspaceFiles
        .filter((f) => (!currentPath || f.path !== currentPath) && fileTargetsDraft(f, draftDocNum, firstLine))
        .map((f) => ({
            file: f,
            meta: extractDocumentMetadata(f.content, f.path),
        }))
        .sort((a, b) => (a.meta.effectiveDate ?? "").localeCompare(b.meta.effectiveDate ?? ""));

    for (const { file, meta } of candidateFiles) {
        if (scenarioDateIso && meta.effectiveDate && scenarioDateIso < meta.effectiveDate) {
            continue;
        }

        const parsedWs = parseDraftDocument(file.content);
        const docLabel = file.documentNumber ?? meta.documentNumber ?? file.title;

        for (const node of parsedWs.nodes) {
            if (node.level !== "CLAUSE" && node.level !== "POINT") {
                continue;
            }

            const amendMatch = AMEND_LINE.exec(node.text);

            if (amendMatch) {
                const targetKey = makeTargetKey(amendMatch[5], amendMatch[4], amendMatch[2]);
                effects.set(targetKey, {
                    kind: "AMENDED",
                    targetKey,
                    sourceDocLabel: docLabel,
                    sourceProvisionRef: node.refLabel,
                    verbatimQuote: node.text.split("\n")[0]?.trim() ?? node.text,
                    amendedText: amendMatch[6].trim(),
                    effectiveDate: meta.effectiveDate,
                });

                continue;
            }

            for (const repealMatch of node.text.matchAll(REPEAL_LINE)) {
                const targetKey = makeTargetKey(repealMatch[5], repealMatch[4], repealMatch[2]);
                effects.set(targetKey, {
                    kind: "REPEALED",
                    targetKey,
                    sourceDocLabel: docLabel,
                    sourceProvisionRef: node.refLabel,
                    verbatimQuote: node.text.split("\n")[0]?.trim() ?? node.text,
                    amendedText: null,
                    effectiveDate: meta.effectiveDate,
                });
            }
        }
    }

    return effects;
}

function tokenizeCondition(text: string): string[] {
    const tokens = text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 2 && !EXCEPTION_STOPWORDS.has(w));

    return [...new Set(tokens)];
}

function findAllWholeWordOffsets(text: string, token: string): number[] {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu");
    const offsets: number[] = [];

    for (const match of text.matchAll(regex)) {
        offsets.push(match.index);
    }

    return offsets;
}

function isNegatedBefore(lowerText: string, offset: number): boolean {
    const prefix = lowerText.slice(Math.max(0, offset - 26), offset);

    return /(?:không\s+(?:có|gây|bị|được|thuộc)|chưa\s+(?:có|được)|mà\s+không|thiếu|vắng)\s*(?:[\p{L}\s]{0,12})?$/iu.test(prefix);
}

function scenarioSatisfiesSingleBranch(
    scenario: string,
    branchText: string,
    excludeTokens: ReadonlySet<string>,
): boolean {
    const rawTokens = tokenizeCondition(branchText);
    const filteredTokens = rawTokens.filter((t) => !excludeTokens.has(t));
    const condTokens = filteredTokens.length > 0 ? filteredTokens : rawTokens;

    if (condTokens.length === 0) {
        return false;
    }

    const lowerScenario = scenario.toLowerCase();
    const matchedTokens: { token: string; offset: number; negated: boolean }[] = [];

    for (const token of condTokens) {
        const offsets = findAllWholeWordOffsets(lowerScenario, token);

        if (offsets.length === 0) {
            continue;
        }

        // Prefer the last occurrence (closer to the exception/qualifier clause in Vietnamese sentences)
        const offset = offsets[offsets.length - 1];
        matchedTokens.push({
            token,
            offset,
            negated: isNegatedBefore(lowerScenario, offset),
        });
    }

    const requiredHits = condTokens.length >= 2 ? 2 : 1;

    if (matchedTokens.length < requiredHits) {
        return false;
    }

    if (matchedTokens.some((m) => m.negated)) {
        return false;
    }

    return true;
}

function scenarioSatisfiesCondition(
    scenario: string,
    conditionText: string,
    excludeTokens: ReadonlySet<string>,
): boolean {
    const branches = conditionText
        .split(/\s+hoặc\s+/iu)
        .map((b) => b.trim())
        .filter((b) => b.length > 0);

    return branches.some((branch) => scenarioSatisfiesSingleBranch(scenario, branch, excludeTokens));
}

/**
 * Evaluates qualified exceptions ("trừ trường hợp <A>") and nested double negation
 * ("không áp dụng miễn trừ nếu/khi <B>") structurally without domain hardcoding.
 */
export function evaluateQualifiedAndNestedException(
    clauseText: string,
    scenario: string,
): { outcome: ExceptionEvalOutcome; exceptionText: string | null; overrideText: string | null } {
    const match = QUALIFIED_EXCEPTION_SPLIT.exec(clauseText);

    if (!match) {
        return { outcome: "NONE", exceptionText: null, overrideText: null };
    }

    const mainClauseBeforeException = clauseText.slice(0, match.index);
    const mainTokens = new Set(tokenizeCondition(mainClauseBeforeException));
    const exceptionText = match[1].trim();
    const overrideText = match[2]?.trim() ?? null;

    // Open unbounded exceptions (like "trường hợp đặc biệt") are handled by LP001 loophole flow
    if (OPEN_EXCEPTION_ONLY.test(exceptionText)) {
        return { outcome: "NONE", exceptionText, overrideText };
    }

    const exceptionMet = scenarioSatisfiesCondition(scenario, exceptionText, mainTokens);

    if (!exceptionMet) {
        return { outcome: "NONE", exceptionText, overrideText };
    }

    if (overrideText && scenarioSatisfiesCondition(scenario, overrideText, new Set())) {
        return { outcome: "EXEMPTION_OVERRIDDEN", exceptionText, overrideText };
    }

    return { outcome: "EXEMPT_VALID", exceptionText, overrideText };
}
