import type { D1Database } from "@cloudflare/workers-types";
import { listAllViolationRules, listViolationRulesOf, type StoredViolationRule } from "../violations/violation.repository";
import { IDENTITY_PROMPT_VERSION, resolveWithModel } from "./identity.llm";
import {
    clearDocumentIdentities,
    getViolationSummary,
    listIdentityDecisions,
    listViolationIdentities,
    saveIdentityResults,
    searchViolations,
    type NewAlias,
    type NewViolation,
    type StoredIdentityDecision,
    type ViolationSummary,
} from "./identity.repository";
import {
    aliasesOf,
    normalizeBehaviour,
    resolveIdentity,
    signatureKeyOf,
    type IdentityDecision,
    type IdentityDecisionType,
    type ViolationIdentity,
} from "./identity.resolver";

export type IdentityOptions = {
    apiKey?: string;
    model: string;
    fetcher?: typeof fetch;
};

export type IdentityOutcome = {
    documentId: string;
    counts: Partial<Record<IdentityDecisionType, number>>;
    decisions: StoredIdentityDecision[];
};

export type ViolationDetail = ViolationSummary & {
    rules: StoredViolationRule[];
    decisions: StoredIdentityDecision[];
};

/**
 * Resolves every rule of a document to a TrafficViolation (FR-10), oldest rule first so the earliest
 * wording becomes the canonical name. Each decision is kept with its candidates and reasons; an
 * AMBIGUOUS rule stays without a violation instead of being forced into one.
 */
export async function resolveDocumentIdentities(db: D1Database, documentId: string, options: IdentityOptions): Promise<IdentityOutcome> {
    await clearDocumentIdentities(db, documentId);

    const [rules, allRules, violations] = await Promise.all([
        listViolationRulesOf(db, documentId),
        listAllViolationRules(db),
        listViolationIdentities(db),
    ]);
    const ordered = [...rules].sort((left, right) => (left.effectiveFrom ?? "").localeCompare(right.effectiveFrom ?? "") || left.id.localeCompare(right.id));
    const assigned = new Map(allRules.filter((rule) => rule.trafficViolationId).map((rule) => [rule.id, rule]));
    const newViolations: NewViolation[] = [];
    const aliases: NewAlias[] = [];
    const decisions: StoredIdentityDecision[] = [];

    for (const rule of ordered) {
        const samePosition = findSamePositionViolation(rule, [...assigned.values()]);
        const deterministic = resolveIdentity(
            { ruleId: rule.id, behaviorText: rule.behaviorText, semanticIr: rule.semanticIr, amendedProvisionViolationId: samePosition },
            violations,
        );
        const decision = await refineWithModel(rule, deterministic, violations, options);
        const violationId = applyDecision(rule, decision, violations, newViolations, aliases);

        decisions.push({
            violationRuleId: rule.id,
            sourceDocumentId: documentId,
            decision: decision.decision,
            trafficViolationId: violationId,
            method: decision.method,
            score: decision.score,
            candidates: decision.candidates,
            reasons: decision.reasons,
            model: decision.method === "LLM" ? `${options.model};prompt=${IDENTITY_PROMPT_VERSION}` : null,
        });

        if (violationId) {
            assigned.set(rule.id, { ...rule, trafficViolationId: violationId });
        }
    }

    await saveIdentityResults(db, newViolations, aliases, decisions);

    return { documentId, counts: countDecisions(decisions), decisions };
}

export async function resolveIdentitiesAfterExtraction(db: D1Database, documentIds: string[], options: IdentityOptions): Promise<void> {
    for (const documentId of documentIds) {
        try {
            const result = await resolveDocumentIdentities(db, documentId, options);

            console.log(JSON.stringify({ level: "info", module: "identity", documentId, counts: result.counts }));
        } catch (error: unknown) {
            const detail = error instanceof Error ? error.message : "Unknown identity resolution error";

            console.error(`[Identity] Resolution failed for ${documentId}`, detail);
        }
    }
}

export async function findViolations(db: D1Database, query: string, limit = 20): Promise<ViolationSummary[]> {
    return searchViolations(db, normalizeBehaviour(query), Math.min(Math.max(limit, 1), 100));
}

export async function getViolationDetail(db: D1Database, violationId: string): Promise<ViolationDetail | null> {
    const summary = await getViolationSummary(db, violationId);

    if (!summary) {
        return null;
    }

    const rules = (await listAllViolationRules(db)).filter((rule) => rule.trafficViolationId === violationId);
    const decisions = await listIdentityDecisions(db, rules.map((rule) => rule.id));

    return { ...summary, rules, decisions };
}

/** A rule elsewhere in the corpus that governs the same provision, i.e. the version this rule amends or is amended by. */
function findSamePositionViolation(rule: StoredViolationRule, assigned: StoredViolationRule[]): string | null {
    const samePosition = assigned.filter(
        (other) => other.governedProvisionId === rule.governedProvisionId && other.sourceDocumentId !== rule.sourceDocumentId && other.subjectScope === rule.subjectScope,
    );
    const violationIds = new Set(samePosition.map((other) => other.trafficViolationId));

    return violationIds.size === 1 ? samePosition[0].trafficViolationId : null;
}

async function refineWithModel(
    rule: StoredViolationRule,
    deterministic: IdentityDecision,
    violations: ViolationIdentity[],
    options: IdentityOptions,
): Promise<IdentityDecision> {
    const registryConflict = deterministic.method === "ALIAS" || deterministic.method === "STRUCTURED";

    if (deterministic.decision !== "AMBIGUOUS" || !options.apiKey || registryConflict) {
        return deterministic;
    }

    const candidateIds = new Set(deterministic.candidates.map((candidate) => candidate.violationId));
    const candidates = violations.filter((violation) => candidateIds.has(violation.id));

    try {
        return await resolveWithModel(
            {
                rule: { ruleId: rule.id, behaviorText: rule.behaviorText, semanticIr: rule.semanticIr },
                candidates,
                apiKey: options.apiKey,
                model: options.model,
                fetcher: options.fetcher,
            },
            deterministic,
        );
    } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : "model call failed";

        return { ...deterministic, reasons: [...deterministic.reasons, `LLM resolver unavailable: ${detail.slice(0, 200)}`] };
    }
}

/** Applies a decision to the in-memory registry so later rules of the same run can match it. */
function applyDecision(
    rule: StoredViolationRule,
    decision: IdentityDecision,
    violations: ViolationIdentity[],
    newViolations: NewViolation[],
    aliases: NewAlias[],
): string | null {
    if (decision.decision === "AMBIGUOUS") {
        return null;
    }

    let violation = decision.trafficViolationId ? violations.find((candidate) => candidate.id === decision.trafficViolationId) : undefined;

    if (!violation) {
        const created: NewViolation = {
            id: `tv:${rule.id}`,
            canonicalName: rule.semanticIr.action?.label ?? rule.behaviorText.replace(/[;.:,\s]+$/u, ""),
            signatureKey: signatureKeyOf(rule.semanticIr),
            semanticIr: rule.semanticIr,
            createdFromRuleId: rule.id,
        };

        violation = { id: created.id, canonicalName: created.canonicalName, signatureKey: created.signatureKey, semanticIr: created.semanticIr, normalizedAliases: [] };
        violations.push(violation);
        newViolations.push(created);
    }

    for (const alias of rawAliases(rule)) {
        const normalizedAlias = normalizeBehaviour(alias);

        if (!violation.normalizedAliases.includes(normalizedAlias)) {
            violation.normalizedAliases.push(normalizedAlias);
        }

        aliases.push({ trafficViolationId: violation.id, alias, normalizedAlias, sourceRuleId: rule.id, sourceDocumentId: rule.sourceDocumentId });
    }

    return violation.id;
}

function rawAliases(rule: StoredViolationRule): string[] {
    const values = [rule.behaviorText.replace(/[;.:,\s]+$/u, ""), rule.semanticIr.action?.label ?? ""];
    const normalized = new Set(aliasesOf(rule));

    return [...new Set(values.filter((value) => value && normalized.has(normalizeBehaviour(value))))];
}

function countDecisions(decisions: StoredIdentityDecision[]): Partial<Record<IdentityDecisionType, number>> {
    const counts: Partial<Record<IdentityDecisionType, number>> = {};

    for (const decision of decisions) {
        counts[decision.decision] = (counts[decision.decision] ?? 0) + 1;
    }

    return counts;
}
