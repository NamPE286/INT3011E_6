import { normalizeBehaviour } from "../identity/identity.resolver";
import type { StoredViolationRule } from "../violations/violation.repository";
import type { RuleEffect, SemanticValue } from "../violations/violation.types";
import type { IntervalEvidence, RuleInterval, RuleLineage } from "./history.types";

/** FR-13 change types. A transition may carry several. */
export type ChangeType =
    | "NO_SEMANTIC_CHANGE"
    | "VIOLATION_ADDED"
    | "VIOLATION_REMOVED"
    | "CONDITION_ADDED"
    | "CONDITION_REMOVED"
    | "CONDITION_CHANGED"
    | "EXCEPTION_ADDED"
    | "EXCEPTION_REMOVED"
    | "SUBJECT_CHANGED"
    | "VEHICLE_SCOPE_CHANGED"
    | "LOCATION_SCOPE_CHANGED"
    | "SANCTION_INCREASE"
    | "SANCTION_DECREASE"
    | "SANCTION_CHANGED"
    | "POINT_DEDUCTION_APPLICABILITY_CHANGED"
    | "POINT_DEDUCTION_CHANGED"
    | "LICENSE_SUSPENSION_CHANGED"
    | "VEHICLE_CONFISCATION_CHANGED"
    | "ADDITIONAL_SANCTION_CHANGED"
    | "REPEALED"
    | "REPLACED"
    | "UNKNOWN";

export type ChangeDetail = {
    field: string;
    before: unknown;
    after: unknown;
};

export type ChangeEvent = {
    id: string;
    trafficViolationId: string;
    lineageId: string;
    oldRuleId: string | null;
    newRuleId: string | null;
    changeTypes: ChangeType[];
    details: ChangeDetail[];
    evidence: IntervalEvidence | null;
    effectiveAt: string | null;
    notes: string[];
};

/**
 * Semantic diff between consecutive rules of one lineage (FR-13). Only rules the history linked with
 * legal evidence are compared. Structured fields decide the change types; when only the wording changed
 * and equivalence cannot be shown through canonical vocabulary, the transition is UNKNOWN, not "no change".
 */
export function detectChangeEvents(lineages: RuleLineage[], intervals: RuleInterval[], rules: StoredViolationRule[]): ChangeEvent[] {
    const intervalById = new Map(intervals.map((interval) => [interval.ruleId, interval]));
    const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
    const events: ChangeEvent[] = [];

    for (const lineage of lineages) {
        lineage.ruleIds.forEach((ruleId, index) => {
            const rule = ruleById.get(ruleId);
            const interval = intervalById.get(ruleId);

            if (!rule || !interval) {
                return;
            }

            if (index === 0 && rule.sourceDocumentId !== rule.governedDocumentId) {
                events.push(addedEvent(lineage, rule, interval));
            }

            if (interval.endType === "REPEALED" && !interval.successorRuleId) {
                events.push(repealedEvent(lineage, rule, interval));
            }

            const successor = interval.successorRuleId ? ruleById.get(interval.successorRuleId) : undefined;

            if (successor) {
                events.push(transitionEvent(lineage, rule, successor, interval));
            }
        });
    }

    return events;
}

export function diffRules(before: StoredViolationRule, after: StoredViolationRule): { changeTypes: ChangeType[]; details: ChangeDetail[]; notes: string[] } {
    const changeTypes = new Set<ChangeType>();
    const details: ChangeDetail[] = [];
    const notes: string[] = [];
    const record = (type: ChangeType, field: string, previous: unknown, next: unknown): void => {
        changeTypes.add(type);
        details.push({ field, before: previous, after: next });
    };

    diffSets(before.semanticIr.conditions, after.semanticIr.conditions, "conditions", "CONDITION", record);
    diffSets(before.semanticIr.exceptions, after.semanticIr.exceptions, "exceptions", "EXCEPTION", record);

    if (differs(before.semanticIr.subject, after.semanticIr.subject) || before.subjectScope !== after.subjectScope) {
        record("SUBJECT_CHANGED", "subject", labelOf(before.semanticIr.subject) ?? before.subjectScope, labelOf(after.semanticIr.subject) ?? after.subjectScope);
    }

    if (keysOf(before.semanticIr.vehicles).join(",") !== keysOf(after.semanticIr.vehicles).join(",")) {
        record("VEHICLE_SCOPE_CHANGED", "vehicles", labelsOf(before.semanticIr.vehicles), labelsOf(after.semanticIr.vehicles));
    }

    if (differs(before.semanticIr.location, after.semanticIr.location)) {
        record("LOCATION_SCOPE_CHANGED", "location", labelOf(before.semanticIr.location), labelOf(after.semanticIr.location));
    }

    diffSanction(before, after, record);

    if (changeTypes.size > 0) {
        return { changeTypes: [...changeTypes], details, notes };
    }

    if (normalizeBehaviour(before.behaviorText) === normalizeBehaviour(after.behaviorText)) {
        return { changeTypes: ["NO_SEMANTIC_CHANGE"], details, notes };
    }

    if (sameCanonicalAction(before, after)) {
        notes.push("Wording changed; the canonical action and every structured field are unchanged.");

        return { changeTypes: ["NO_SEMANTIC_CHANGE"], details, notes };
    }

    notes.push("Wording changed and semantic equivalence could not be established from canonical vocabulary.");
    details.push({ field: "behavior_text", before: before.behaviorText, after: after.behaviorText });

    return { changeTypes: ["UNKNOWN"], details, notes };
}

function transitionEvent(lineage: RuleLineage, before: StoredViolationRule, after: StoredViolationRule, interval: RuleInterval): ChangeEvent {
    const diff = diffRules(before, after);
    const replaced = interval.endType === "SUPERSEDED" || interval.endEvidence?.relationType === "REPLACES";
    const changeTypes = replaced ? ["REPLACED" as const, ...diff.changeTypes.filter((type) => type !== "NO_SEMANTIC_CHANGE")] : diff.changeTypes;

    return {
        id: `ce:${before.id}->${after.id}`,
        trafficViolationId: lineage.trafficViolationId,
        lineageId: lineage.id,
        oldRuleId: before.id,
        newRuleId: after.id,
        changeTypes: changeTypes.length > 0 ? changeTypes : ["NO_SEMANTIC_CHANGE"],
        details: diff.details,
        evidence: interval.endEvidence,
        effectiveAt: interval.validTo,
        notes: diff.notes,
    };
}

function addedEvent(lineage: RuleLineage, rule: StoredViolationRule, interval: RuleInterval): ChangeEvent {
    return {
        id: `ce:+${rule.id}`,
        trafficViolationId: lineage.trafficViolationId,
        lineageId: lineage.id,
        oldRuleId: null,
        newRuleId: rule.id,
        changeTypes: ["VIOLATION_ADDED"],
        details: [],
        evidence: null,
        effectiveAt: interval.validFrom,
        notes: ["The lineage starts with a rule added by an amending document."],
    };
}

function repealedEvent(lineage: RuleLineage, rule: StoredViolationRule, interval: RuleInterval): ChangeEvent {
    return {
        id: `ce:-${rule.id}`,
        trafficViolationId: lineage.trafficViolationId,
        lineageId: lineage.id,
        oldRuleId: rule.id,
        newRuleId: null,
        changeTypes: ["REPEALED", "VIOLATION_REMOVED"],
        details: [],
        evidence: interval.endEvidence,
        effectiveAt: interval.validTo,
        notes: [],
    };
}

type Recorder = (type: ChangeType, field: string, before: unknown, after: unknown) => void;

function diffSets(before: SemanticValue[], after: SemanticValue[], field: string, prefix: "CONDITION" | "EXCEPTION", record: Recorder): void {
    const beforeKeys = new Set(keysOf(before));
    const afterKeys = new Set(keysOf(after));
    const added = [...afterKeys].filter((key) => !beforeKeys.has(key));
    const removed = [...beforeKeys].filter((key) => !afterKeys.has(key));

    if (prefix === "CONDITION" && added.length > 0 && removed.length > 0) {
        record("CONDITION_CHANGED", field, labelsOf(before), labelsOf(after));

        return;
    }

    if (added.length > 0) {
        record(`${prefix}_ADDED`, field, labelsOf(before), labelsOf(after));
    }

    if (removed.length > 0) {
        record(`${prefix}_REMOVED`, field, labelsOf(before), labelsOf(after));
    }
}

function diffSanction(before: StoredViolationRule, after: StoredViolationRule, record: Recorder): void {
    const oldFine = before.sanction.fine;
    const newFine = after.sanction.fine;

    if (oldFine && newFine && (oldFine.min !== newFine.min || oldFine.max !== newFine.max)) {
        const up = newFine.min >= oldFine.min && newFine.max >= oldFine.max;
        const down = newFine.min <= oldFine.min && newFine.max <= oldFine.max;

        record(up ? "SANCTION_INCREASE" : down ? "SANCTION_DECREASE" : "SANCTION_CHANGED", "fine", oldFine, newFine);
    } else if (Boolean(oldFine) !== Boolean(newFine)) {
        record("SANCTION_CHANGED", "fine", oldFine, newFine);
    }

    if (before.sanction.pointDeductionApplicability !== after.sanction.pointDeductionApplicability) {
        record("POINT_DEDUCTION_APPLICABILITY_CHANGED", "point_deduction_applicability", before.sanction.pointDeductionApplicability, after.sanction.pointDeductionApplicability);
    } else if (before.sanction.pointsDeducted !== after.sanction.pointsDeducted) {
        record("POINT_DEDUCTION_CHANGED", "points_deducted", before.sanction.pointsDeducted, after.sanction.pointsDeducted);
    }

    compareEffects(before.sanction.effects, after.sanction.effects, "LICENSE_SUSPENSION", "LICENSE_SUSPENSION_CHANGED", record);
    compareEffects(before.sanction.effects, after.sanction.effects, "VEHICLE_CONFISCATION", "VEHICLE_CONFISCATION_CHANGED", record);
    compareEffects(before.sanction.effects, after.sanction.effects, "OTHER", "ADDITIONAL_SANCTION_CHANGED", record);

    const oldMeasures = before.sanction.remedialMeasures.map((measure) => normalizeBehaviour(measure.text)).sort().join("|");
    const newMeasures = after.sanction.remedialMeasures.map((measure) => normalizeBehaviour(measure.text)).sort().join("|");

    if (oldMeasures !== newMeasures) {
        record("ADDITIONAL_SANCTION_CHANGED", "remedial_measures", before.sanction.remedialMeasures, after.sanction.remedialMeasures);
    }
}

function compareEffects(before: RuleEffect[], after: RuleEffect[], type: RuleEffect["effectType"], change: ChangeType, record: Recorder): void {
    const describe = (effects: RuleEffect[]): string =>
        effects
            .filter((effect) => effect.effectType === type)
            .map((effect) => `${effect.durationMin}-${effect.durationMax}-${effect.durationUnit}-${type === "OTHER" ? normalizeBehaviour(effect.rawText) : ""}`)
            .sort()
            .join("|");
    const oldEffects = describe(before);
    const newEffects = describe(after);

    if (oldEffects !== newEffects) {
        record(change, type.toLowerCase(), before.filter((effect) => effect.effectType === type), after.filter((effect) => effect.effectType === type));
    }
}

function sameCanonicalAction(before: StoredViolationRule, after: StoredViolationRule): boolean {
    const oldAction = before.semanticIr.action?.vocabId;

    return Boolean(oldAction) && oldAction === after.semanticIr.action?.vocabId && before.semanticIr.polarity === after.semanticIr.polarity;
}

function differs(before: SemanticValue | null, after: SemanticValue | null): boolean {
    return keyOf(before) !== keyOf(after);
}

function keyOf(value: SemanticValue | null): string {
    if (!value) {
        return "";
    }

    return value.vocabId ?? normalizeBehaviour(value.label);
}

function keysOf(values: SemanticValue[]): string[] {
    return values.map(keyOf).sort();
}

function labelOf(value: SemanticValue | null): string | null {
    return value?.label ?? null;
}

function labelsOf(values: SemanticValue[]): string[] {
    return values.map((value) => value.label);
}
