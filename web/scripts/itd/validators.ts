import type { LocalWorkspaceFile } from "../../src/lib/engine/local-workspace";
import { parseDraftDocument } from "../../src/lib/engine/parser";
import type { DiagnosticCategory, VerdictOutcome } from "../../src/lib/engine/types";
import {
    MODEL_PRICING_USD_PER_1M,
    type GroundedCitation,
    type LiveJudgeOutput,
    type LoopholeDetectorOutput,
} from "./types";

const VALID_CATEGORIES = new Set<DiagnosticCategory>(["LOOPHOLE", "AMBIGUITY", "LOGIC"]);
const VALID_OUTCOMES = new Set<VerdictOutcome>([
    "GUILTY_SANCTIONED",
    "ACQUITTED_LOOPHOLE",
    "CONFLICT_AMBIGUOUS",
    "PARTIALLY_ENFORCEABLE",
    "NOT_COVERED",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateLoopholeOutputSchema(value: unknown): {
    valid: boolean;
    errors: string[];
    parsed: LoopholeDetectorOutput | null;
} {
    const errors: string[] = [];

    if (!isRecord(value)) {
        return { valid: false, errors: ["Root value must be an object"], parsed: null };
    }

    if (typeof value.caseId !== "string" || value.caseId.trim().length === 0) {
        errors.push("caseId must be a non-empty string");
    }

    if (typeof value.hasLoophole !== "boolean") {
        errors.push("hasLoophole must be a boolean");
    }

    if (typeof value.workspaceOnly !== "boolean") {
        errors.push("workspaceOnly must be a boolean");
    }

    if (!Array.isArray(value.findings)) {
        errors.push("findings must be an array");
    } else {
        for (let idx = 0; idx < value.findings.length; idx += 1) {
            const item = value.findings[idx];

            if (!isRecord(item)) {
                errors.push(`findings[${idx}] must be an object`);
                continue;
            }

            if (typeof item.code !== "string" || item.code.trim().length === 0) {
                errors.push(`findings[${idx}].code must be non-empty string`);
            }

            if (typeof item.category !== "string" || !VALID_CATEGORIES.has(item.category as DiagnosticCategory)) {
                errors.push(`findings[${idx}].category invalid`);
            }

            if (typeof item.provisionRef !== "string" || item.provisionRef.trim().length === 0) {
                errors.push(`findings[${idx}].provisionRef must be non-empty string`);
            }

            if (typeof item.verbatimQuote !== "string" || item.verbatimQuote.trim().length === 0) {
                errors.push(`findings[${idx}].verbatimQuote must be non-empty string`);
            }

            if (typeof item.exploitScenario !== "string" || item.exploitScenario.trim().length === 0) {
                errors.push(`findings[${idx}].exploitScenario must be non-empty string`);
            }
        }
    }

    if (errors.length > 0) {
        return { valid: false, errors, parsed: null };
    }

    return {
        valid: true,
        errors: [],
        parsed: value as LoopholeDetectorOutput,
    };
}

export function validateJudgeOutputSchema(value: unknown): {
    valid: boolean;
    errors: string[];
    parsed: LiveJudgeOutput | null;
} {
    const errors: string[] = [];

    if (!isRecord(value)) {
        return { valid: false, errors: ["Root value must be an object"], parsed: null };
    }

    if (typeof value.caseId !== "string" || value.caseId.trim().length === 0) {
        errors.push("caseId must be a non-empty string");
    }

    if (typeof value.outcome !== "string" || !VALID_OUTCOMES.has(value.outcome as VerdictOutcome)) {
        errors.push("outcome must be a valid VerdictOutcome");
    }

    if (typeof value.abstained !== "boolean") {
        errors.push("abstained must be a boolean");
    }

    if (typeof value.workspaceOnly !== "boolean") {
        errors.push("workspaceOnly must be a boolean");
    }

    if (value.applicableFine !== null) {
        if (!isRecord(value.applicableFine)) {
            errors.push("applicableFine must be null or {min, max}");
        } else {
            if (typeof value.applicableFine.min !== "number" || !Number.isFinite(value.applicableFine.min)) {
                errors.push("applicableFine.min must be a finite number");
            }

            if (typeof value.applicableFine.max !== "number" || !Number.isFinite(value.applicableFine.max)) {
                errors.push("applicableFine.max must be a finite number");
            }
        }
    }

    if (!Array.isArray(value.nonMonetarySanctions) || !value.nonMonetarySanctions.every((s) => typeof s === "string")) {
        errors.push("nonMonetarySanctions must be string[]");
    }

    if (!Array.isArray(value.detectedDefectCodes) || !value.detectedDefectCodes.every((s) => typeof s === "string")) {
        errors.push("detectedDefectCodes must be string[]");
    }

    if (!Array.isArray(value.citations)) {
        errors.push("citations must be an array");
    } else {
        for (let idx = 0; idx < value.citations.length; idx += 1) {
            const cit = value.citations[idx];

            if (!isRecord(cit)) {
                errors.push(`citations[${idx}] must be an object`);
                continue;
            }

            if (typeof cit.provisionRef !== "string" || cit.provisionRef.trim().length === 0) {
                errors.push(`citations[${idx}].provisionRef must be non-empty string`);
            }

            if (typeof cit.verbatimQuote !== "string" || cit.verbatimQuote.trim().length === 0) {
                errors.push(`citations[${idx}].verbatimQuote must be non-empty string`);
            }
        }
    }

    if (typeof value.reasoning !== "string" || value.reasoning.trim().length === 0) {
        errors.push("reasoning must be a non-empty string");
    }

    if (errors.length > 0) {
        return { valid: false, errors, parsed: null };
    }

    return {
        valid: true,
        errors: [],
        parsed: value as LiveJudgeOutput,
    };
}

function normalizeWhitespace(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

function collectValidProvisionKeys(
    draftContent: string,
    workspaceFiles: readonly LocalWorkspaceFile[],
): Set<string> {
    const keys = new Set<string>();
    const allTexts = [draftContent, ...workspaceFiles.map((f) => f.content)];

    for (const content of allTexts) {
        const parsed = parseDraftDocument(content);

        for (const node of parsed.nodes) {
            keys.add(node.refLabel.toLowerCase());

            if (node.articleNo) {
                keys.add(`điều ${node.articleNo}`.toLowerCase());

                if (node.clauseNo) {
                    keys.add(`khoản ${node.clauseNo} điều ${node.articleNo}`.toLowerCase());
                }

                if (node.pointNo && node.clauseNo) {
                    keys.add(`điểm ${node.pointNo} khoản ${node.clauseNo} điều ${node.articleNo}`.toLowerCase());
                }
            }
        }
    }

    return keys;
}

function provisionRefExistsInCorpus(provisionRef: string, validKeys: ReadonlySet<string>): boolean {
    const lower = normalizeWhitespace(provisionRef).toLowerCase();

    if (
        lower.startsWith("dòng ")
        || lower.startsWith("phần ")
        || lower === "dự thảo"
        || lower === "toàn văn"
    ) {
        return true;
    }

    if (validKeys.has(lower)) {
        return true;
    }

    const pointClauseArt = /điểm\s+([a-zđ])\s+khoản\s+(\d+)\s+điều\s+(\d+[a-zđ]?)/iu.exec(lower);

    if (pointClauseArt) {
        const key = `điểm ${pointClauseArt[1]} khoản ${pointClauseArt[2]} điều ${pointClauseArt[3]}`;

        return validKeys.has(key);
    }

    const clauseArt = /khoản\s+(\d+)\s+điều\s+(\d+[a-zđ]?)/iu.exec(lower);

    if (clauseArt) {
        const key = `khoản ${clauseArt[1]} điều ${clauseArt[2]}`;

        return validKeys.has(key);
    }

    const artClause = /điều\s+(\d+[a-zđ]?)\s*(?:,?\s*khoản\s+|\.)(\d+)/iu.exec(lower);

    if (artClause) {
        const key = `khoản ${artClause[2]} điều ${artClause[1]}`;

        return validKeys.has(key);
    }

    const artOnly = /điều\s+(\d+[a-zđ]?)/iu.exec(lower);

    if (artOnly) {
        const key = `điều ${artOnly[1]}`;

        return validKeys.has(key);
    }

    return false;
}

/**
 * Code/Regex Anti-Hallucination Gate: verifies that EVERY cited quote appears verbatim
 * inside the provided draft or workspace documents, and every cited Điều/Khoản/Điểm exists.
 */
export function verifyCitationsVerbatim(
    citations: readonly GroundedCitation[],
    draftContent: string,
    workspaceFiles: readonly LocalWorkspaceFile[],
): {
    totalChecked: number;
    hallucinatedCount: number;
    hallucinatedDetails: string[];
} {
    if (citations.length === 0) {
        return { totalChecked: 0, hallucinatedCount: 0, hallucinatedDetails: [] };
    }

    const normalizedSources = [draftContent, ...workspaceFiles.map((f) => f.content)].map((text) => ({
        raw: text,
        norm: normalizeWhitespace(text),
        lowerNorm: normalizeWhitespace(text).toLowerCase(),
    }));
    const validKeys = collectValidProvisionKeys(draftContent, workspaceFiles);
    const hallucinatedDetails: string[] = [];

    for (const cit of citations) {
        const quoteNorm = normalizeWhitespace(cit.verbatimQuote);
        const quoteLower = quoteNorm.toLowerCase();

        if (quoteNorm.length < 2) {
            hallucinatedDetails.push(`Empty/too-short quote for ${cit.provisionRef}`);
            continue;
        }

        const quoteFound = normalizedSources.some(
            (src) => src.raw.includes(cit.verbatimQuote) || src.norm.includes(quoteNorm) || src.lowerNorm.includes(quoteLower),
        );

        if (!quoteFound) {
            hallucinatedDetails.push(`Quote not found verbatim: "${cit.verbatimQuote.slice(0, 60)}"`);
            continue;
        }

        if (!provisionRefExistsInCorpus(cit.provisionRef, validKeys)) {
            hallucinatedDetails.push(`ProvisionRef not found in corpus: "${cit.provisionRef}"`);
        }
    }

    return {
        totalChecked: citations.length,
        hallucinatedCount: hallucinatedDetails.length,
        hallucinatedDetails,
    };
}

export function verifyNoInvertedBounds(output: LiveJudgeOutput): boolean {
    if (output.applicableFine !== null && output.applicableFine.min > output.applicableFine.max) {
        return false;
    }

    for (const sanction of output.nonMonetarySanctions) {
        const prisonMatch = /tù\s+từ\s+(\d+)\s+(năm|tháng)\s+đến\s+(\d+)\s+(năm|tháng)/iu.exec(sanction);

        if (prisonMatch) {
            const minMonths = Number(prisonMatch[1]) * (prisonMatch[2].toLowerCase() === "năm" ? 12 : 1);
            const maxMonths = Number(prisonMatch[3]) * (prisonMatch[4].toLowerCase() === "năm" ? 12 : 1);

            if (minMonths > maxMonths) {
                return false;
            }
        }
    }

    return true;
}

export function computePercentile(values: readonly number[], percentile: number): number {
    if (values.length === 0) {
        return 0;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1));

    return sorted[index];
}

export function estimateCostUsd(
    model: string,
    inputTokens: number,
    outputTokens: number,
    decisionInputTokens = 0,
): number {
    const rate = MODEL_PRICING_USD_PER_1M[model] ?? MODEL_PRICING_USD_PER_1M["gemini-3.5-flash-lite"];
    const decisionRate = MODEL_PRICING_USD_PER_1M["gemini-decision-1"];
    const mainCost = (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
    const decCost = (decisionInputTokens * decisionRate.input) / 1_000_000;

    return Number((mainCost + decCost).toFixed(8));
}
