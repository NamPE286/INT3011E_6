/**
 * Reproducible evaluation of the preprocessing epic (#38) on a labelled dataset (data/eval/*.json).
 *
 *   bun run eval                         # deterministic pipeline (no LLM)
 *   bun run eval -- --llm                # also LLM steps, with OPENAI_API_KEY from the environment
 *   bun run eval -- --dataset <path> --out <report.json>
 *
 * Every metric is computed against gold labels written from the legal wording, next to a simple baseline.
 */
import type { D1Database } from "@cloudflare/workers-types";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listAllProvisionRelations } from "../src/modules/changes/change.repository";
import { listAllDocumentRelations, listAllRelationCandidates } from "../src/modules/documents/document-graph.repository";
import { listChangeEventsOf } from "../src/modules/history/history.repository";
import { getRulesAsOf } from "../src/modules/history/history.service";
import { normalizeBehaviour } from "../src/modules/identity/identity.resolver";
import { DEFAULT_OPENAI_MODEL } from "../src/modules/processing/legal-llm.service";
import { runPreprocessing } from "../src/modules/processing/preprocessing";
import { listViolationRulesOf, type StoredViolationRule } from "../src/modules/violations/violation.repository";
import { createTestD1Database } from "../test/d1-test-db";
import { storeLegalDocument, type FixtureDocument } from "../test/legal-fixtures";

type Gold = {
    document_relations: { from: string; to: string; type: string }[];
    frontier: Record<string, string[]>;
    provision_relations: { from: string; to: string; type: string }[];
    provision_relevance: Record<string, string>;
    rules: { provision: string; governed: string; fine: [number, number] | null; suspension_months: [number, number] | null; points: number | null }[];
    identity_clusters: string[][];
    as_of: { anchor: string; date: string; rules: string[] }[];
    changes: { old: string | null; new: string | null; types: string[] }[];
};

type Dataset = {
    dataset: string;
    version: number;
    import_order: string[];
    documents: FixtureDocument[];
    gold: Gold;
};

type SetScore = { precision: number; recall: number; f1: number; truePositives: number; predicted: number; gold: number };

const args = process.argv.slice(2);
const datasetPath = readArg("--dataset") ?? join(import.meta.dir, "../../data/eval/preprocessing-dev-v1.json");
const outPath = readArg("--out");
const useLlm = args.includes("--llm");

const dataset = JSON.parse(readFileSync(datasetPath, "utf-8")) as Dataset;
const db = createTestD1Database({ seedSampleDocument: false });
const options = {
    apiKey: useLlm ? process.env.OPENAI_API_KEY : undefined,
    model: process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
};

if (useLlm && !options.apiKey) {
    throw new Error("--llm needs OPENAI_API_KEY in the environment");
}

const started = Date.now();

for (const documentId of dataset.import_order) {
    const document = dataset.documents.find((candidate) => candidate.id === documentId);

    if (!document) {
        throw new Error(`Document ${documentId} in import_order is not in the dataset`);
    }

    await storeLegalDocument(db, document);
    await runPreprocessing(db, document.id, options);
}

const rules = (await Promise.all(dataset.documents.map((document) => listViolationRulesOf(db, document.id)))).flat();
const report = {
    dataset: `${dataset.dataset}@${dataset.version}`,
    mode: useLlm ? `deterministic+LLM (${options.model})` : "deterministic",
    importOrder: dataset.import_order,
    runtimeMs: 0,
    metrics: {
        provisionRelevance: await scoreRelevance(db, dataset.gold),
        documentGraph: await scoreDocumentGraph(db, dataset.gold),
        provisionRelations: await scoreProvisionRelations(db, dataset.gold),
        violationRules: scoreRules(rules, dataset.gold),
        identity: scoreIdentity(rules, dataset.gold),
        asOf: await scoreAsOf(db, rules, dataset.gold),
        semanticChanges: await scoreChanges(db, rules, dataset.gold),
    },
};

report.runtimeMs = Date.now() - started;
console.log(JSON.stringify(report, null, 2));

if (outPath) {
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
}

async function scoreRelevance(database: D1Database, gold: Gold) {
    const rows = await database.prepare("SELECT id, relevance FROM provisions").all<{ id: string; relevance: string }>();
    const predicted = new Map(rows.results.map((row) => [row.id, row.relevance]));
    const errors: { provision: string; expected: string; predicted: string | null }[] = [];

    for (const [provision, expected] of Object.entries(gold.provision_relevance)) {
        const actual = predicted.get(provision) ?? null;

        if (actual !== expected) {
            errors.push({ provision, expected, predicted: actual });
        }
    }

    const total = Object.keys(gold.provision_relevance).length;

    return { accuracy: ratio(total - errors.length, total), labelled: total, errors };
}

async function scoreDocumentGraph(database: D1Database, gold: Gold) {
    const relations = await listAllDocumentRelations(database);
    const candidates = await listAllRelationCandidates(database);
    const key = (relation: { from: string; to: string; type: string }): string => `${relation.from}->${relation.to}:${relation.type}`;
    const predicted = relations.map((relation) => key({ from: relation.fromDocumentId, to: relation.toDocumentId, type: relation.relationType }));
    const goldKeys = gold.document_relations.map(key);
    // Baseline: what a header/preamble-only reader finds (legal-basis edges), as in research/traffic-header-completeness.md.
    const baseline = predicted.filter((relation) => relation.endsWith(":LEGAL_BASIS"));
    const frontierGold = Object.entries(gold.frontier).flatMap(([document, numbers]) => numbers.map((number) => `${document}:${number}`));
    const frontierPredicted = candidates.filter((candidate) => candidate.status === "UNRESOLVED" && candidate.targetDocumentNumber).map((candidate) => `${candidate.sourceDocumentId}:${candidate.targetDocumentNumber}`);

    return {
        acceptedEdges: scoreSets(predicted, goldKeys),
        baselineHeaderOnly: scoreSets(baseline, goldKeys),
        frontierRecall: scoreSets(frontierPredicted, frontierGold).recall,
        candidateStatusCounts: countBy(candidates.map((candidate) => candidate.status)),
        errors: diffSets(predicted, goldKeys),
    };
}

async function scoreProvisionRelations(database: D1Database, gold: Gold) {
    const relations = await listAllProvisionRelations(database);
    const predicted = relations.filter((relation) => relation.verificationStatus === "ACCEPTED").map((relation) => `${relation.fromProvisionId}->${relation.toProvisionId}:${relation.relationType}`);
    const goldKeys = gold.provision_relations.map((relation) => `${relation.from}->${relation.to}:${relation.type}`);

    return { ...scoreSets(predicted, goldKeys), errors: diffSets(predicted, goldKeys) };
}

function scoreRules(predictedRules: StoredViolationRule[], gold: Gold) {
    const predicted = predictedRules.map((rule) => `${rule.provisionId}=>${rule.governedProvisionId}`);
    const goldKeys = gold.rules.map((rule) => `${rule.provision}=>${rule.governed}`);
    const fields = { fine: 0, suspension: 0, points: 0, compared: 0 };
    const fieldErrors: string[] = [];

    for (const expected of gold.rules) {
        const actual = predictedRules.find((rule) => rule.provisionId === expected.provision && rule.governedProvisionId === expected.governed);

        if (!actual) {
            continue;
        }

        fields.compared++;

        const fine = actual.sanction.fine ? [actual.sanction.fine.min, actual.sanction.fine.max] : null;
        const suspension = actual.sanction.effects.find((effect) => effect.effectType === "LICENSE_SUSPENSION");
        const suspensionMonths = suspension ? [suspension.durationMin, suspension.durationMax] : null;

        tally(JSON.stringify(fine) === JSON.stringify(expected.fine), "fine", expected.provision);
        tally(JSON.stringify(suspensionMonths) === JSON.stringify(expected.suspension_months), "suspension", expected.provision);
        tally(actual.sanction.pointsDeducted === expected.points, "points", expected.provision);
    }

    function tally(correct: boolean, field: "fine" | "suspension" | "points", provision: string): void {
        if (correct) {
            fields[field]++;
        } else {
            fieldErrors.push(`${provision}: ${field}`);
        }
    }

    return {
        ruleDetection: scoreSets(predicted, goldKeys),
        fineAccuracy: ratio(fields.fine, fields.compared),
        suspensionAccuracy: ratio(fields.suspension, fields.compared),
        pointDeductionAccuracy: ratio(fields.points, fields.compared),
        uncertainRules: predictedRules.filter((rule) => rule.extractionStatus === "UNCERTAIN").length,
        errors: [...diffSets(predicted, goldKeys), ...fieldErrors],
    };
}

/** Pairwise identity F1: every pair of rules is a same/different decision. */
function scoreIdentity(predictedRules: StoredViolationRule[], gold: Gold) {
    const byProvision = new Map(predictedRules.map((rule) => [rule.provisionId, rule]));
    const goldCluster = new Map<string, number>();

    gold.identity_clusters.forEach((cluster, index) => cluster.forEach((provision) => goldCluster.set(provision, index)));

    const provisions = [...goldCluster.keys()];
    const system = (provision: string): string | null => byProvision.get(provision)?.trafficViolationId ?? null;
    const exactText = (provision: string): string | null => {
        const rule = byProvision.get(provision);

        return rule ? normalizeBehaviour(rule.behaviorText) : null;
    };

    return {
        pairwise: scorePairs(provisions, goldCluster, system),
        baselineExactText: scorePairs(provisions, goldCluster, exactText),
        ambiguousRules: provisions.filter((provision) => byProvision.has(provision) && !system(provision)),
    };
}

async function scoreAsOf(database: D1Database, predictedRules: StoredViolationRule[], gold: Gold) {
    let correct = 0;
    let baselineCorrect = 0;
    const errors: { anchor: string; date: string; expected: string[]; predicted: string[] }[] = [];

    for (const query of gold.as_of) {
        const anchor = predictedRules.find((rule) => rule.provisionId === query.anchor);
        const expected = [...query.rules].sort();
        const violationId = anchor?.trafficViolationId ?? null;
        const result = violationId ? await getRulesAsOf(database, violationId, query.date) : null;
        const predicted = (result?.lineages.flatMap((lineage) => lineage.applicable.map((entry) => provisionOf(entry.rule.id))) ?? []).sort();

        if (JSON.stringify(predicted) === JSON.stringify(expected)) {
            correct++;
        } else {
            errors.push({ anchor: query.anchor, date: query.date, expected, predicted });
        }

        // Baseline: the newest rule of the same violation already in force, ignoring lineages and repeals.
        const sameViolation = predictedRules.filter((rule) => violationId && rule.trafficViolationId === violationId && rule.effectiveFrom && rule.effectiveFrom <= query.date);
        const newest = sameViolation.sort((left, right) => (right.effectiveFrom ?? "").localeCompare(left.effectiveFrom ?? ""))[0];
        const baseline = newest ? [provisionOf(newest.id)] : [];

        if (JSON.stringify(baseline) === JSON.stringify(expected)) {
            baselineCorrect++;
        }
    }

    return { exactMatchAccuracy: ratio(correct, gold.as_of.length), baselineNewestRule: ratio(baselineCorrect, gold.as_of.length), queries: gold.as_of.length, errors };
}

async function scoreChanges(database: D1Database, predictedRules: StoredViolationRule[], gold: Gold) {
    const violationIds = [...new Set(predictedRules.map((rule) => rule.trafficViolationId).filter((id): id is string => Boolean(id)))];
    const events = (await Promise.all(violationIds.map((id) => listChangeEventsOf(database, id)))).flat();
    const predictedPairs: string[] = [];
    const goldPairs: string[] = [];
    const typeKeys = { predicted: [] as string[], gold: [] as string[] };

    for (const event of events) {
        const pair = `${provisionOf(event.oldRuleId)}->${provisionOf(event.newRuleId)}`;

        predictedPairs.push(pair);
        typeKeys.predicted.push(...event.changeTypes.map((type) => `${pair}:${type}`));
    }

    for (const change of gold.changes) {
        const pair = `${change.old ?? "-"}->${change.new ?? "-"}`;

        goldPairs.push(pair);
        typeKeys.gold.push(...change.types.map((type) => `${pair}:${type}`));
    }

    return {
        transitions: scoreSets(predictedPairs, goldPairs),
        changeTypesMicro: scoreSets(typeKeys.predicted, typeKeys.gold),
        errors: diffSets(typeKeys.predicted, typeKeys.gold),
    };
}

function scorePairs(items: string[], gold: Map<string, number>, predictedLabel: (item: string) => string | null) {
    let truePositives = 0;
    let predictedPositives = 0;
    let goldPositives = 0;

    for (let left = 0; left < items.length; left++) {
        for (let right = left + 1; right < items.length; right++) {
            const sameGold = gold.get(items[left]) === gold.get(items[right]);
            const leftLabel = predictedLabel(items[left]);
            const samePredicted = leftLabel !== null && leftLabel === predictedLabel(items[right]);

            truePositives += sameGold && samePredicted ? 1 : 0;
            predictedPositives += samePredicted ? 1 : 0;
            goldPositives += sameGold ? 1 : 0;
        }
    }

    return toScore(truePositives, predictedPositives, goldPositives);
}

function scoreSets(predicted: string[], gold: string[]): SetScore {
    const predictedSet = new Set(predicted);
    const goldSet = new Set(gold);
    const truePositives = [...predictedSet].filter((item) => goldSet.has(item)).length;

    return toScore(truePositives, predictedSet.size, goldSet.size);
}

function toScore(truePositives: number, predicted: number, gold: number): SetScore {
    const precision = ratio(truePositives, predicted);
    const recall = ratio(truePositives, gold);
    const f1 = precision + recall === 0 ? 0 : round((2 * precision * recall) / (precision + recall));

    return { precision, recall, f1, truePositives, predicted, gold };
}

function diffSets(predicted: string[], gold: string[]): string[] {
    const predictedSet = new Set(predicted);
    const goldSet = new Set(gold);

    return [
        ...[...predictedSet].filter((item) => !goldSet.has(item)).map((item) => `unexpected ${item}`),
        ...[...goldSet].filter((item) => !predictedSet.has(item)).map((item) => `missing ${item}`),
    ];
}

function provisionOf(ruleId: string | null): string {
    return ruleId ? ruleId.replace(/#rule(?:#.*)?$/u, "") : "-";
}

function countBy(values: string[]): Record<string, number> {
    const counts: Record<string, number> = {};

    for (const value of values) {
        counts[value] = (counts[value] ?? 0) + 1;
    }

    return counts;
}

function ratio(part: number, whole: number): number {
    return whole === 0 ? 0 : round(part / whole);
}

function round(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function readArg(name: string): string | null {
    const index = args.indexOf(name);

    return index >= 0 ? args[index + 1] ?? null : null;
}
