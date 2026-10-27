import type { D1Database } from "@cloudflare/workers-types";
import { getDocumentMetadata } from "../documents/document-graph.repository";
import { getRulesAsOf, type LineageAtDate, type RuleAtDate } from "../history/history.service";
import { searchViolations, type ViolationSummary } from "../identity/identity.repository";
import { normalizeBehaviour } from "../identity/identity.resolver";
import { describeUncertainty } from "./ask.reasons";
import type { AnswerEvidence } from "./ask.types";

const MIN_ALIAS_MATCH = 0.75;
const MIN_ALIAS_TOKENS = 2;
const MAX_VIOLATIONS = 3;
const NEAR_TOP_MARGIN = 0.15;
const VIOLATION_SCAN_LIMIT = 100;
const IGNORED_TOKENS = new Set(["cua", "va", "la", "bi", "khi", "co", "cho", "theo", "nhu", "sau", "day", "mot", "trong", "cac", "nay"]);

export type RetrievedViolation = {
    violation: ViolationSummary;
    score: number;
};

/**
 * Finds the stored behaviours a question is about by matching its words against canonical names and
 * aliases. Only strong matches are kept so an unrelated question retrieves nothing.
 */
export async function retrieveViolations(db: D1Database, question: string): Promise<RetrievedViolation[]> {
    const questionTokens = tokensOf(question);
    const violations = await searchViolations(db, "", VIOLATION_SCAN_LIMIT);
    const scored = violations
        .map((violation) => ({ violation, score: scoreViolation(violation, questionTokens) }))
        .filter((entry) => entry.score >= MIN_ALIAS_MATCH)
        .sort((left, right) => right.score - left.score || left.violation.id.localeCompare(right.violation.id));

    if (scored.length === 0) {
        return [];
    }

    const nearTop = scored.filter((entry) => entry.score >= scored[0].score - NEAR_TOP_MARGIN);

    return nearTop.slice(0, MAX_VIOLATIONS);
}

/** The rules of the retrieved behaviours that applied, or may have applied, on the date. */
export async function collectEvidence(db: D1Database, retrieved: RetrievedViolation[], question: string, asOf: string): Promise<AnswerEvidence[]> {
    const questionTokens = new Set(tokensOf(question));
    const documents = new Map<string, { number: string | null; title: string | null }>();
    const evidence: AnswerEvidence[] = [];

    for (const { violation } of retrieved) {
        const { lineages } = await getRulesAsOf(db, violation.id, asOf);

        for (const lineage of narrowByVehicle(lineages, questionTokens)) {
            for (const entry of [...lineage.applicable, ...lineage.uncertain]) {
                const source = await readDocument(db, documents, entry.rule.sourceDocumentId);

                evidence.push(toEvidence(`E${evidence.length + 1}`, violation, entry, source));
            }
        }
    }

    return evidence;
}

function scoreViolation(violation: ViolationSummary, questionTokens: string[]): number {
    const available = new Set(questionTokens);
    const phrases = [violation.canonicalName, ...violation.aliases];
    let best = 0;

    for (const phrase of phrases) {
        const tokens = tokensOf(phrase);

        if (tokens.length < MIN_ALIAS_TOKENS) {
            continue;
        }

        const matched = tokens.filter((token) => available.has(token)).length;

        best = Math.max(best, matched / tokens.length);
    }

    return best;
}

function tokensOf(text: string): string[] {
    return normalizeBehaviour(text)
        .split(" ")
        .filter((token) => token.length > 0 && !IGNORED_TOKENS.has(token));
}

/** When the question names a vehicle that some lineages govern, the other lineages are not asked about. */
function narrowByVehicle(lineages: LineageAtDate[], questionTokens: Set<string>): LineageAtDate[] {
    const mentioned = lineages.filter((lineage) => lineage.contextIr.vehicles.some((vehicle) => isMentioned(vehicle, questionTokens)));

    return mentioned.length > 0 ? mentioned : lineages;
}

function isMentioned(label: string, questionTokens: Set<string>): boolean {
    const tokens = tokensOf(label);

    return tokens.length > 0 && tokens.every((token) => questionTokens.has(token));
}

async function readDocument(db: D1Database, cache: Map<string, { number: string | null; title: string | null }>, documentId: string) {
    const cached = cache.get(documentId);

    if (cached) {
        return cached;
    }

    const [metadata, row] = await Promise.all([
        getDocumentMetadata(db, documentId),
        db.prepare("SELECT document_title FROM legal_documents WHERE id = ?").bind(documentId).first<{ document_title: string | null }>(),
    ]);
    const document = { number: metadata?.documentNumber ?? null, title: row?.document_title ?? null };

    cache.set(documentId, document);

    return document;
}

function toEvidence(id: string, violation: ViolationSummary, entry: RuleAtDate, source: { number: string | null; title: string | null }): AnswerEvidence {
    const { rule, interval } = entry;
    const fine = rule.sanction.fine;

    return {
        id,
        violationId: violation.id,
        violationName: violation.canonicalName,
        ruleId: rule.id,
        status: entry.status,
        behaviorText: rule.behaviorText,
        subjectScope: rule.subjectScope,
        vehicles: rule.semanticIr.vehicles.map((vehicle) => vehicle.label),
        fine: fine ? { min: fine.min, max: fine.max } : null,
        additionalPenalties: rule.sanction.effects.map((effect) => effect.rawText),
        validFrom: interval.validFrom,
        validTo: interval.validTo,
        uncertaintyReasons: [...new Set([...rule.uncertaintyReasons, ...entry.reasonCodes].map(describeUncertainty))],
        source: {
            documentId: rule.sourceDocumentId,
            documentNumber: source.number,
            documentTitle: source.title,
            provisionId: rule.provisionId,
        },
    };
}
