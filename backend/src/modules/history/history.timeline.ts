import type { ChangeInstruction, ProvisionRelation } from "../changes/change.types";
import { locatorToProvisionId } from "../changes/change.locator";
import type { StoredDocumentRelation, StoredRelationCandidate } from "../documents/document-graph.repository";
import type { StoredViolationRule } from "../violations/violation.repository";
import type { SemanticValue } from "../violations/violation.types";
import type { EndType, IntervalEvidence, IntervalWarning, RuleInterval, RuleLineage, RuleStatus } from "./history.types";

export type HistoryInput = {
    rules: StoredViolationRule[];
    provisionRelations: ProvisionRelation[];
    documentRelations: StoredDocumentRelation[];
    effectiveByDocument: Map<string, string | null>;
    openInstructions: ChangeInstruction[];
    openDocumentCandidates: StoredRelationCandidate[];
};

type EndEvent = {
    type: EndType;
    date: string;
    evidence: IntervalEvidence;
};

const DOCUMENT_ENDINGS = new Set(["FULLY_REPLACES", "FULLY_REPEALS"]);
const IMPACT_TYPES = new Set(["AMENDS", "SUPPLEMENTS", "AMENDS_OR_SUPPLEMENTS", "PARTIALLY_REPLACES", "FULLY_REPLACES", "PARTIALLY_REPEALS", "FULLY_REPEALS", "SUSPENDS", "UNKNOWN"]);
const OPEN_CANDIDATE_STATUSES = new Set(["CANDIDATE", "AMBIGUOUS", "CONFLICT"]);

/**
 * Rebuilds rule lineages and validity intervals (FR-11/FR-12) from legal evidence only. Two rules join a
 * lineage when they are versions of the same provision (an accepted provision relation rewrote it) or
 * when an accepted full replacement/repeal of their document is followed by a rule of the same behaviour
 * and context in the replacing document. Sharing a TrafficViolation alone never links rules.
 */
export function buildHistory(input: HistoryInput): { lineages: RuleLineage[]; intervals: RuleInterval[] } {
    const rules = input.rules.filter((rule) => rule.trafficViolationId);
    const lineages = buildLineages(rules, input.documentRelations);
    const lineageByRule = new Map<string, RuleLineage>();

    for (const lineage of lineages) {
        for (const ruleId of lineage.ruleIds) {
            lineageByRule.set(ruleId, lineage);
        }
    }

    const intervals = rules.map((rule) => buildInterval(rule, lineageByRule.get(rule.id), rules, input));

    return { lineages, intervals };
}

/** The status of a rule at `date` (ISO yyyy-mm-dd), from its interval and the warnings that apply by then. */
export function statusAt(interval: RuleInterval, date: string): { status: RuleStatus; reasons: string[]; reasonCodes: IntervalWarning["code"][] } {
    if (!interval.validFrom) {
        return { status: "UNCERTAIN", reasons: interval.warnings.map((warning) => warning.message), reasonCodes: interval.warnings.map((warning) => warning.code) };
    }

    if (date < interval.validFrom) {
        return { status: "NOT_YET_EFFECTIVE", reasons: [], reasonCodes: [] };
    }

    if (interval.validTo && interval.endType && date >= interval.validTo) {
        return { status: interval.endType, reasons: [], reasonCodes: [] };
    }

    const open = interval.warnings.filter((warning) => !warning.effectiveFrom || warning.effectiveFrom <= date);

    if (open.length > 0) {
        return { status: "UNCERTAIN", reasons: open.map((warning) => warning.message), reasonCodes: open.map((warning) => warning.code) };
    }

    return { status: "CURRENT", reasons: [], reasonCodes: [] };
}

export function contextKeyOf(rule: StoredViolationRule): string {
    const context = contextOf(rule);

    return JSON.stringify([context.vehicles, context.subject, context.subjectScope]);
}

function contextOf(rule: StoredViolationRule): RuleLineage["contextIr"] {
    return {
        vehicles: rule.semanticIr.vehicles.map(valueKey).sort(),
        subject: rule.semanticIr.subject ? valueKey(rule.semanticIr.subject) : null,
        subjectScope: rule.subjectScope,
    };
}

function buildLineages(rules: StoredViolationRule[], documentRelations: StoredDocumentRelation[]): RuleLineage[] {
    const parent = new Map(rules.map((rule) => [rule.id, rule.id]));
    const links: RuleLineage["links"] = [];
    const find = (id: string): string => {
        let root = id;

        while (parent.get(root) !== root) {
            root = parent.get(root) ?? root;
        }

        parent.set(id, root);

        return root;
    };
    const union = (from: StoredViolationRule, to: StoredViolationRule, link: RuleLineage["links"][number]["link"], evidenceId: string): void => {
        const fromRoot = find(from.id);
        const toRoot = find(to.id);

        if (fromRoot !== toRoot) {
            parent.set(toRoot, fromRoot);
            links.push({ fromRuleId: from.id, toRuleId: to.id, link, evidenceId });
        }
    };

    const byPosition = groupBy(rules, (rule) => [rule.trafficViolationId, rule.governedProvisionId, rule.subjectScope ?? ""].join("|"));

    for (const versions of byPosition.values()) {
        const ordered = orderByDate(versions);

        for (let index = 1; index < ordered.length; index++) {
            union(ordered[index - 1], ordered[index], "PROVISION_RELATION", ordered[index].governedProvisionId);
        }
    }

    for (const relation of documentRelations) {
        if (!DOCUMENT_ENDINGS.has(relation.relationType)) {
            continue;
        }

        linkReplacement(relation, rules, find, union);
    }

    const groups = groupBy(rules, (rule) => find(rule.id));

    return [...groups.values()].map((members) => {
        const ordered = orderByDate(members);
        const first = ordered[0];
        const ruleIds = new Set(ordered.map((rule) => rule.id));

        return {
            id: `ln:${first.id}`,
            trafficViolationId: first.trafficViolationId ?? "",
            lineageKey: `${first.trafficViolationId}|${contextKeyOf(first)}`,
            contextIr: contextOf(first),
            ruleIds: ordered.map((rule) => rule.id),
            links: links.filter((link) => ruleIds.has(link.toRuleId)),
        };
    });
}

/**
 * "Nghị định B thay thế Nghị định A": a lineage of A continues in B when the behaviour is the same, the
 * subject scope is the same and the context is compatible (overlapping vehicles, else the same subject), and the
 * pairing is one-to-one. Model-read vehicle lists vary between documents, so exact equality is not required.
 */
function linkReplacement(
    relation: StoredDocumentRelation,
    rules: StoredViolationRule[],
    find: (id: string) => string,
    union: (from: StoredViolationRule, to: StoredViolationRule, link: "DOCUMENT_REPLACEMENT", evidenceId: string) => void,
): void {
    const replaced = groupBy(rules.filter((rule) => rule.governedDocumentId === relation.toDocumentId), (rule) => find(rule.id));
    const replacing = groupBy(
        rules.filter((rule) => rule.sourceDocumentId === relation.fromDocumentId && rule.governedDocumentId === relation.fromDocumentId),
        (rule) => find(rule.id),
    );
    const pairs: { oldGroup: string; newGroup: string }[] = [];

    for (const [oldGroup, oldRules] of replaced) {
        const latestOld = orderByDate(oldRules)[oldRules.length - 1];

        for (const [newGroup, newRules] of replacing) {
            if (newRules.some((candidate) => continuesContext(latestOld, candidate))) {
                pairs.push({ oldGroup, newGroup });
            }
        }
    }

    for (const pair of pairs) {
        const oneToOne = pairs.filter((other) => other.oldGroup === pair.oldGroup).length === 1
            && pairs.filter((other) => other.newGroup === pair.newGroup).length === 1;

        if (!oneToOne) {
            continue;
        }

        const oldRules = orderByDate(replaced.get(pair.oldGroup) ?? []);
        const newRules = orderByDate(replacing.get(pair.newGroup) ?? []);

        union(oldRules[oldRules.length - 1], newRules[0], "DOCUMENT_REPLACEMENT", relation.id);
    }
}

function continuesContext(previous: StoredViolationRule, next: StoredViolationRule): boolean {
    if (previous.trafficViolationId !== next.trafficViolationId || previous.subjectScope !== next.subjectScope) {
        return false;
    }

    const previousContext = contextOf(previous);
    const nextContext = contextOf(next);

    // Vehicles separate parallel rules most reliably; the subject ("người điều khiển") is often generic.
    if (previousContext.vehicles.length > 0 && nextContext.vehicles.length > 0) {
        return previousContext.vehicles.some((vehicle) => nextContext.vehicles.includes(vehicle));
    }

    if (previousContext.subject && nextContext.subject) {
        return previousContext.subject === nextContext.subject;
    }

    return true;
}

function buildInterval(rule: StoredViolationRule, lineage: RuleLineage | undefined, rules: StoredViolationRule[], input: HistoryInput): RuleInterval {
    const warnings: IntervalWarning[] = [];
    const validFrom = rule.effectiveFrom;

    if (!validFrom) {
        warnings.push({ code: "EFFECTIVE_DATE_UNKNOWN", message: `The effective date of ${rule.sourceDocumentId} could not be read.`, effectiveFrom: null });
    }

    const events = [
        ...provisionEndings(rule, input, warnings),
        ...documentEndings(rule, lineage, rules, input, warnings),
    ].sort((left, right) => left.date.localeCompare(right.date));
    const end = events[0] ?? null;

    warnings.push(...openWarnings(rule, input));

    return {
        ruleId: rule.id,
        lineageId: lineage?.id ?? `ln:${rule.id}`,
        validFrom,
        validTo: end?.date ?? null,
        endType: end?.type ?? null,
        endEvidence: end?.evidence ?? null,
        successorRuleId: end ? findSuccessor(rule, end, lineage, rules) : null,
        warnings,
    };
}

/** Accepted relations from a later document that rewrite or repeal this rule's provision or its fine clause. */
function provisionEndings(rule: StoredViolationRule, input: HistoryInput, warnings: IntervalWarning[]): EndEvent[] {
    const events: EndEvent[] = [];

    for (const relation of input.provisionRelations) {
        if (relation.toDocumentId !== rule.governedDocumentId || relation.fromDocumentId === rule.sourceDocumentId || relation.insertionLocator || !relation.toProvisionId) {
            continue;
        }

        const touchesRule = covers(relation.toProvisionId, rule.governedProvisionId) || relation.toProvisionId === rule.sanctionProvisionId;

        if (!touchesRule || !isLater(relation.fromDocumentId, rule, input.effectiveByDocument)) {
            continue;
        }

        const date = input.effectiveByDocument.get(relation.fromDocumentId) ?? null;
        const evidence: IntervalEvidence = {
            kind: "PROVISION_RELATION",
            relationId: relation.id,
            relationType: relation.relationType,
            fromDocumentId: relation.fromDocumentId,
            effectiveFrom: date,
        };

        if (relation.verificationStatus !== "ACCEPTED") {
            warnings.push({ code: "UNVERIFIED_RELATION", message: `Unverified ${relation.relationType} from ${relation.fromDocumentId} may affect this rule.`, effectiveFrom: date });

            continue;
        }

        if (!date) {
            warnings.push({ code: "END_DATE_UNKNOWN", message: `${relation.fromDocumentId} ${relation.relationType.toLowerCase()} this rule, but its effective date is unknown.`, effectiveFrom: null });

            continue;
        }

        events.push({ type: relation.relationType === "REPEALS" ? "REPEALED" : "AMENDED", date, evidence });
    }

    return events;
}

/** Accepted full replacement or repeal of the document whose text the rule belongs to. */
function documentEndings(
    rule: StoredViolationRule,
    lineage: RuleLineage | undefined,
    rules: StoredViolationRule[],
    input: HistoryInput,
    warnings: IntervalWarning[],
): EndEvent[] {
    const events: EndEvent[] = [];

    for (const relation of input.documentRelations) {
        if (!DOCUMENT_ENDINGS.has(relation.relationType) || relation.toDocumentId !== rule.governedDocumentId || relation.fromDocumentId === rule.sourceDocumentId) {
            continue;
        }

        const date = input.effectiveByDocument.get(relation.fromDocumentId) ?? null;

        if (!date) {
            warnings.push({ code: "END_DATE_UNKNOWN", message: `${relation.fromDocumentId} ends ${relation.toDocumentId}, but its effective date is unknown.`, effectiveFrom: null });

            continue;
        }

        const continued = lineage?.ruleIds.some((id) => rules.find((other) => other.id === id)?.sourceDocumentId === relation.fromDocumentId) ?? false;

        events.push({
            type: continued ? "SUPERSEDED" : "REPEALED",
            date,
            evidence: { kind: "DOCUMENT_RELATION", relationId: relation.id, relationType: relation.relationType, fromDocumentId: relation.fromDocumentId, effectiveFrom: date },
        });
    }

    return events;
}

/** Open evidence that could change the conclusion: unresolved instructions naming this provision and unverified document candidates. */
function openWarnings(rule: StoredViolationRule, input: HistoryInput): IntervalWarning[] {
    const warnings: IntervalWarning[] = [];

    for (const instruction of input.openInstructions) {
        if (instruction.targetDocumentId !== rule.governedDocumentId || instruction.sourceDocumentId === rule.sourceDocumentId) {
            continue;
        }

        const named = instruction.targetLocators.some((locator) => covers(locatorToProvisionId(rule.governedDocumentId, locator), rule.governedProvisionId));

        if (named) {
            warnings.push({
                code: "UNRESOLVED_INSTRUCTION",
                message: `An instruction of ${instruction.sourceDocumentId} names this provision but could not be resolved: ${instruction.resolutionReason}`,
                effectiveFrom: instruction.effectiveFrom,
            });
        }
    }

    for (const candidate of input.openDocumentCandidates) {
        if (candidate.resolvedTargetDocumentId !== rule.governedDocumentId || !OPEN_CANDIDATE_STATUSES.has(candidate.status) || !IMPACT_TYPES.has(candidate.proposedRelationType)) {
            continue;
        }

        warnings.push({
            code: "OPEN_DOCUMENT_CANDIDATE",
            message: `Unverified ${candidate.proposedRelationType} of this document by ${candidate.sourceDocumentId} (${candidate.status}).`,
            effectiveFrom: input.effectiveByDocument.get(candidate.sourceDocumentId) ?? null,
        });
    }

    return warnings;
}

function findSuccessor(rule: StoredViolationRule, end: EndEvent, lineage: RuleLineage | undefined, rules: StoredViolationRule[]): string | null {
    if (!lineage || end.type === "REPEALED") {
        return null;
    }

    const successor = lineage.ruleIds
        .map((id) => rules.find((other) => other.id === id))
        .find((other) => other && other.sourceDocumentId === end.evidence.fromDocumentId && other.id !== rule.id);

    return successor?.id ?? null;
}

/** Base text always predates amendments to it; otherwise compare the documents' effective dates. */
function isLater(documentId: string, rule: StoredViolationRule, effectiveByDocument: Map<string, string | null>): boolean {
    if (rule.sourceDocumentId === rule.governedDocumentId) {
        return true;
    }

    const relationDate = effectiveByDocument.get(documentId) ?? null;

    return Boolean(relationDate && rule.effectiveFrom && relationDate > rule.effectiveFrom);
}

/** A relation on a provision also covers every unit inside it ("khoản 5" covers "điểm a khoản 5"). */
function covers(targetId: string, provisionId: string): boolean {
    return provisionId === targetId || provisionId.startsWith(`${targetId}_`);
}

function orderByDate(rules: StoredViolationRule[]): StoredViolationRule[] {
    return [...rules].sort((left, right) => (left.effectiveFrom ?? "").localeCompare(right.effectiveFrom ?? "") || left.id.localeCompare(right.id));
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
    const groups = new Map<string, T[]>();

    for (const item of items) {
        const key = keyOf(item);
        const group = groups.get(key) ?? [];

        group.push(item);
        groups.set(key, group);
    }

    return groups;
}

/** Labels, not vocab ids: the same vehicle may be canonical in one rule and still unresolved in another. */
function valueKey(value: SemanticValue): string {
    return value.label.replace(/\s+/g, " ").trim().toLowerCase();
}
