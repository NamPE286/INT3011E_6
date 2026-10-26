import { removeVietnameseAccents } from "../vocabulary/vocabulary.similarity";
import type { SemanticIr, SemanticValue } from "../violations/violation.types";

export type IdentityDecisionType = "MATCH_EXISTING" | "CREATE_NEW" | "AMBIGUOUS";

export type IdentityMethod = "ALIAS" | "STRUCTURED" | "AMENDED_PROVISION" | "LEXICAL" | "LLM" | "NONE";

/** A stored TrafficViolation as the resolver sees it. */
export type ViolationIdentity = {
    id: string;
    canonicalName: string;
    signatureKey: string | null;
    semanticIr: SemanticIr;
    normalizedAliases: string[];
};

export type IdentityRuleInput = {
    ruleId: string;
    behaviorText: string;
    semanticIr: SemanticIr;
    /** The violation of an earlier rule at the provision this rule's amendment rewrites, if any. */
    amendedProvisionViolationId: string | null;
};

export type IdentityCandidate = {
    violationId: string;
    method: IdentityMethod;
    score: number;
};

export type IdentityDecision = {
    decision: IdentityDecisionType;
    trafficViolationId: string | null;
    method: IdentityMethod;
    score: number | null;
    candidates: IdentityCandidate[];
    reasons: string[];
};

/** Above this, wording alone is close enough when the structured fields agree. */
const LEXICAL_MATCH = 0.92;
/** Below this, nothing in the registry is a plausible match: a new behaviour. */
const LEXICAL_FLOOR = 0.5;
/** An amendment of the same provision that keeps less than this of the wording may describe a new behaviour. */
const AMENDMENT_FLOOR = 0.35;

/**
 * Deterministic part of FR-10, in priority order: alias → structured signature → same amended provision
 * → lexical similarity. Text similarity alone never merges behaviours whose structured context differs
 * (polarity, target, location, conditions); a plausible but unproven match is returned as AMBIGUOUS with
 * its candidates so an LLM resolver or a reviewer can decide.
 */
export function resolveIdentity(rule: IdentityRuleInput, violations: ViolationIdentity[]): IdentityDecision {
    const aliasKeys = aliasesOf(rule);
    const signature = signatureKeyOf(rule.semanticIr);
    const compatible = violations.filter((violation) => isCompatible(rule.semanticIr, violation.semanticIr));
    const byAlias = compatible.filter((violation) => violation.normalizedAliases.some((alias) => aliasKeys.includes(alias)));

    if (byAlias.length === 1) {
        return match(byAlias[0].id, "ALIAS", 1, ["Behaviour wording equals a registered alias."]);
    }

    if (byAlias.length > 1) {
        return ambiguous(byAlias.map((violation) => ({ violationId: violation.id, method: "ALIAS", score: 1 })), "Wording equals aliases of several violations.");
    }

    const bySignature = signature ? compatible.filter((violation) => violation.signatureKey === signature) : [];

    if (bySignature.length === 1) {
        return match(bySignature[0].id, "STRUCTURED", 1, ["Canonical action, polarity, target, location and conditions are identical."]);
    }

    if (bySignature.length > 1) {
        return ambiguous(bySignature.map((violation) => ({ violationId: violation.id, method: "STRUCTURED", score: 1 })), "Several violations share the structured signature.");
    }

    const scored = compatible
        .map((violation) => ({ violationId: violation.id, method: "LEXICAL" as const, score: bestSimilarity(aliasKeys, violation.normalizedAliases) }))
        .sort((left, right) => right.score - left.score);

    if (rule.amendedProvisionViolationId) {
        return resolveAmendment(rule.amendedProvisionViolationId, violations, aliasKeys, scored);
    }

    const plausible = scored.filter((candidate) => candidate.score >= LEXICAL_FLOOR);

    if (plausible.length === 0) {
        return {
            decision: "CREATE_NEW",
            trafficViolationId: null,
            method: "NONE",
            score: scored[0]?.score ?? null,
            candidates: scored.slice(0, 3),
            reasons: ["No registered violation is structurally compatible and lexically close."],
        };
    }

    const [best, second] = plausible;

    if (best.score >= LEXICAL_MATCH && (!second || second.score < LEXICAL_MATCH)) {
        return match(best.violationId, "LEXICAL", best.score, ["Wording is nearly identical and the structured fields agree."]);
    }

    return ambiguous(plausible.slice(0, 5), "Similar wording, but not enough evidence that it is the same legal behaviour.");
}

/** The stable key of a behaviour (SRS §4.6.2): no vehicle, subject, sanction or date. Null without a canonical action. */
export function signatureKeyOf(ir: SemanticIr): string | null {
    if (!ir.action?.vocabId) {
        return null;
    }

    const conditions = ir.conditions.map(keyOf).sort().join(",");

    return [ir.action.vocabId, ir.polarity ?? "", keyOf(ir.target), keyOf(ir.location), conditions].join("|");
}

export function normalizeBehaviour(text: string): string {
    return removeVietnameseAccents(text.toLowerCase())
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export function aliasesOf(rule: { behaviorText: string; semanticIr: SemanticIr }): string[] {
    const aliases = new Set<string>();
    const fromText = normalizeBehaviour(rule.behaviorText);

    if (fromText) {
        aliases.add(fromText);
    }

    if (rule.semanticIr.action) {
        aliases.add(normalizeBehaviour(rule.semanticIr.action.label));
    }

    return [...aliases].filter(Boolean);
}

function resolveAmendment(
    violationId: string,
    violations: ViolationIdentity[],
    aliasKeys: string[],
    scored: IdentityCandidate[],
): IdentityDecision {
    const amended = violations.find((violation) => violation.id === violationId);
    const score = amended ? bestSimilarity(aliasKeys, amended.normalizedAliases) : 0;

    // Structured fields may differ here on purpose: what an amendment changed is #19's semantic diff.
    if (amended && score >= AMENDMENT_FLOOR) {
        return match(violationId, "AMENDED_PROVISION", score, ["The rule rewrites the provision of an earlier rule of this violation, and the wording still overlaps."]);
    }

    return ambiguous(
        [{ violationId, method: "AMENDED_PROVISION", score }, ...scored.filter((candidate) => candidate.violationId !== violationId).slice(0, 3)],
        "The rule rewrites a provision of a known violation, but the behaviour may have changed.",
    );
}

/**
 * Structured context that makes two behaviours legally different even with similar wording.
 * A field only conflicts when both sides state it.
 */
function isCompatible(left: SemanticIr, right: SemanticIr): boolean {
    if (left.polarity && right.polarity && left.polarity !== right.polarity) {
        return false;
    }

    if (left.target && right.target && keyOf(left.target) !== keyOf(right.target)) {
        return false;
    }

    if (left.location && right.location && keyOf(left.location) !== keyOf(right.location)) {
        return false;
    }

    const leftConditions = left.conditions.map(keyOf).sort().join(",");
    const rightConditions = right.conditions.map(keyOf).sort().join(",");

    return leftConditions === rightConditions;
}

function keyOf(value: SemanticValue | null): string {
    if (!value) {
        return "";
    }

    return value.vocabId ?? normalizeBehaviour(value.label);
}

function bestSimilarity(left: string[], right: string[]): number {
    let best = 0;

    for (const a of left) {
        for (const b of right) {
            best = Math.max(best, behaviourSimilarity(a, b));
        }
    }

    return best;
}

/**
 * Dice coefficient over word bigrams. Vietnamese words are single syllables, so single-token overlap is
 * dominated by boilerplate ("không chấp hành hiệu lệnh … giao thông"); bigrams compare phrases instead.
 */
export function behaviourSimilarity(left: string, right: string): number {
    if (left === right) {
        return 1;
    }

    const leftBigrams = bigramsOf(left);
    const rightBigrams = bigramsOf(right);

    if (leftBigrams.length === 0 || rightBigrams.length === 0) {
        return 0;
    }

    const remaining = new Map<string, number>();

    for (const bigram of rightBigrams) {
        remaining.set(bigram, (remaining.get(bigram) ?? 0) + 1);
    }

    let shared = 0;

    for (const bigram of leftBigrams) {
        const count = remaining.get(bigram) ?? 0;

        if (count > 0) {
            shared++;
            remaining.set(bigram, count - 1);
        }
    }

    return (2 * shared) / (leftBigrams.length + rightBigrams.length);
}

function bigramsOf(text: string): string[] {
    const words = text.split(" ").filter(Boolean);

    if (words.length === 1) {
        return words;
    }

    return words.slice(1).map((word, index) => `${words[index]} ${word}`);
}

function match(violationId: string, method: IdentityMethod, score: number, reasons: string[]): IdentityDecision {
    return {
        decision: "MATCH_EXISTING",
        trafficViolationId: violationId,
        method,
        score,
        candidates: [{ violationId, method, score }],
        reasons,
    };
}

function ambiguous(candidates: IdentityCandidate[], reason: string): IdentityDecision {
    return {
        decision: "AMBIGUOUS",
        trafficViolationId: null,
        method: candidates[0]?.method ?? "NONE",
        score: candidates[0]?.score ?? null,
        candidates,
        reasons: [reason],
    };
}
