import { parseLocators, type ProvisionLocator } from "../changes/change.locator";
import { allowsWarning, parseEffects, parseFines, parseRemedialMeasures, type FineRange } from "./sanction.parser";
import { readHeuristicIr } from "./semantic.heuristics";
import type { RuleEffect, RuleNode, RuleSanction, ViolationRuleDraft } from "./violation.types";

type NodeIndex = {
    byPosition: Map<string, RuleNode>;
    all: RuleNode[];
};

const LIST_INTRO = /hành vi[^:]*:\s*$/iu;
const REFERENCE_INTRO = /quy định tại/iu;

/**
 * Builds the ViolationRules a document states (FR-08/FR-09). `ownNodes` are the document's placed
 * provisions; `governedNodes` are the current text of the documents it amends, used for what an
 * amendment leaves unchanged (the fine of the clause around a rewritten point, the additional
 * sanctions that cite it). A provision may yield no rule, one rule, or one rule per subject.
 */
export function assembleRules(ownNodes: RuleNode[], governedNodes: RuleNode[], effectiveFrom: string | null): ViolationRuleDraft[] {
    const rules: ViolationRuleDraft[] = [];

    for (const node of ownNodes) {
        const view = mergedView(node, ownNodes, governedNodes);

        for (const behaviour of readBehaviours(node, view)) {
            rules.push(...buildRules(behaviour.node, behaviour.fineNode, view, effectiveFrom));
        }
    }

    return rules;
}

/** Positions governed by `node`'s document, with this document's own text overriding the governed one. */
function mergedView(node: RuleNode, ownNodes: RuleNode[], governedNodes: RuleNode[]): NodeIndex {
    const byPosition = new Map<string, RuleNode>();

    for (const candidate of governedNodes) {
        if (candidate.governedDocumentId === node.governedDocumentId) {
            byPosition.set(candidate.governedProvisionId, candidate);
        }
    }

    for (const candidate of ownNodes) {
        if (candidate.governedDocumentId === node.governedDocumentId) {
            byPosition.set(candidate.governedProvisionId, candidate);
        }
    }

    return { byPosition, all: [...byPosition.values()] };
}

/**
 * Which behaviours `node` states. A fine clause listing behaviours ("… một trong các hành vi vi phạm sau
 * đây:") yields its points; a fine clause naming one behaviour yields itself; a rewritten point whose
 * clause the amendment left alone yields itself with the governed clause's fine.
 */
function readBehaviours(node: RuleNode, view: NodeIndex): { node: RuleNode; fineNode: RuleNode | null }[] {
    if (node.level === "POINT") {
        const parent = view.all.find((candidate) => candidate.level === "CLAUSE" && candidate.article === node.article && candidate.clause === node.clause);

        // Points of an own fine clause are produced by that clause; only an orphan rewritten point is read here.
        if (!node.isQuoted || !parent || parent.sourceDocumentId === node.sourceDocumentId) {
            return [];
        }

        return parseFines(parent.text).length > 0 && LIST_INTRO.test(parent.text) ? [{ node, fineNode: parent }] : [];
    }

    if (parseFines(node.text).length === 0) {
        return [];
    }

    if (!LIST_INTRO.test(node.text)) {
        return [{ node, fineNode: node }];
    }

    return view.all
        .filter((candidate) => candidate.level === "POINT" && candidate.article === node.article && candidate.clause === node.clause)
        .filter((candidate) => candidate.sourceDocumentId === node.sourceDocumentId)
        .map((point) => ({ node: point, fineNode: node }));
}

function buildRules(node: RuleNode, fineNode: RuleNode | null, view: NodeIndex, effectiveFrom: string | null): ViolationRuleDraft[] {
    const fines: (FineRange | null)[] = fineNode ? parseFines(fineNode.text) : [];
    const ranges = fines.length > 0 ? fines : [null];
    const subjectsDiffer = ranges.length > 1 && ranges.every((range) => range?.subject);

    return ranges.slice(0, subjectsDiffer ? ranges.length : 1).map((fine) => {
        const sanction = readSanction(node, fineNode, fine, view);
        const uncertainty = readUncertainty(node, fine, ranges.length, subjectsDiffer, sanction);
        const suffix = subjectsDiffer && fine?.subject ? `#${fine.subject.toLowerCase()}` : "";

        return {
            id: `${node.provisionId}#rule${suffix}`,
            sourceDocumentId: node.sourceDocumentId,
            provisionId: node.provisionId,
            governedDocumentId: node.governedDocumentId,
            governedProvisionId: node.governedProvisionId,
            sanctionProvisionId: fineNode?.provisionId ?? null,
            behaviorText: node.text,
            articleTitle: node.articleTitle,
            subjectScope: fine?.subject ?? null,
            sanction,
            semanticIr: readHeuristicIr(node.text, node.articleTitle, fineNode?.text ?? null, fine?.subject ?? null),
            semanticMethod: "RULE",
            extractionStatus: uncertainty.length === 0 ? "EXTRACTED" : "UNCERTAIN",
            uncertaintyReasons: uncertainty,
            effectiveFrom,
        };
    });
}

function readSanction(node: RuleNode, fineNode: RuleNode | null, fine: FineRange | null, view: NodeIndex): RuleSanction {
    const effects: RuleEffect[] = [];
    const remedialMeasures: { text: string; sourceProvisionId: string }[] = [];
    const evidence = new Set<string>(fineNode ? [fineNode.provisionId] : []);
    const position: ProvisionLocator = { article: node.article ?? "", clause: node.clause, point: node.point };

    for (const candidate of view.all) {
        const ownEffect = candidate === node || candidate === fineNode;

        if (!ownEffect && !citesPosition(candidate, position)) {
            continue;
        }

        for (const effect of parseEffects(candidate.text)) {
            effects.push({ ...effect, sourceProvisionId: candidate.provisionId });
            evidence.add(candidate.provisionId);
        }

        for (const measure of parseRemedialMeasures(candidate.text)) {
            remedialMeasures.push({ text: measure, sourceProvisionId: candidate.provisionId });
            evidence.add(candidate.provisionId);
        }
    }

    const deductions = effects.filter((effect) => effect.effectType === "LICENSE_POINT_DEDUCTION" && effect.points);
    const distinctPoints = new Set(deductions.map((effect) => effect.points));

    return {
        fine,
        warningAllowed: fineNode ? allowsWarning(fineNode.text) : false,
        currency: "VND",
        pointDeductionApplicability: distinctPoints.size === 1 ? "APPLIES" : "UNKNOWN",
        pointsDeducted: distinctPoints.size === 1 ? deductions[0].points : null,
        effects,
        remedialMeasures,
        evidenceProvisionIds: [...evidence],
    };
}

/** Does an additional-sanction provision cite this address ("Thực hiện hành vi quy định tại điểm a khoản 5 Điều này …")? */
function citesPosition(candidate: RuleNode, position: ProvisionLocator): boolean {
    if (!REFERENCE_INTRO.test(candidate.text) || !candidate.article) {
        return false;
    }

    const cited = parseLocators(candidate.text, { article: candidate.article, clause: null, point: null });

    return cited.some((locator) => covers(locator, position));
}

function covers(cited: ProvisionLocator, position: ProvisionLocator): boolean {
    if (cited.article !== position.article) {
        return false;
    }

    if (cited.clause === null) {
        return true;
    }

    if (cited.clause !== position.clause) {
        return false;
    }

    return cited.point === null || cited.point === position.point;
}

function readUncertainty(node: RuleNode, fine: FineRange | null, rangeCount: number, subjectsDiffer: boolean, sanction: RuleSanction): string[] {
    const reasons: string[] = [];

    if (!fine) {
        reasons.push("NO_FINE");
    }

    if (rangeCount > 1 && !subjectsDiffer) {
        reasons.push("MULTIPLE_FINE_RANGES");
    }

    if (node.readQuality === "PARTIAL" || node.readQuality === "UNREADABLE") {
        reasons.push("LOW_READ_QUALITY");
    }

    const suspensions = new Set(
        sanction.effects
            .filter((effect) => effect.effectType === "LICENSE_SUSPENSION")
            .map((effect) => `${effect.durationMin}-${effect.durationMax}`),
    );

    if (suspensions.size > 1) {
        reasons.push("CONFLICTING_SUSPENSIONS");
    }

    const deductionPoints = new Set(sanction.effects.filter((effect) => effect.effectType === "LICENSE_POINT_DEDUCTION").map((effect) => effect.points));

    if (deductionPoints.size > 1) {
        reasons.push("CONFLICTING_POINT_DEDUCTIONS");
    }

    return reasons;
}
