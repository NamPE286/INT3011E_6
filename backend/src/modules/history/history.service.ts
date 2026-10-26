import type { D1Database } from "@cloudflare/workers-types";
import { listAllChangeInstructions, listAllProvisionRelations } from "../changes/change.repository";
import { listAllDocumentRelations, listAllRelationCandidates, listDocumentMetadata } from "../documents/document-graph.repository";
import { listAllViolationRules, type StoredViolationRule } from "../violations/violation.repository";
import { detectChangeEvents, type ChangeEvent } from "./change-events";
import { listChangeEventsOf, listIntervals, listLineagesOf, replaceHistory } from "./history.repository";
import { buildHistory, statusAt } from "./history.timeline";
import type { RuleInterval, RuleLineage, RuleStatus } from "./history.types";

export type RuleAtDate = {
    rule: StoredViolationRule;
    interval: RuleInterval;
    status: RuleStatus;
    reasons: string[];
};

export type LineageAtDate = {
    lineageId: string;
    contextIr: RuleLineage["contextIr"];
    /** Rules in force on the date. Several only when the corpus itself contains overlapping versions. */
    applicable: RuleAtDate[];
    /** Rules whose state on the date depends on unverified or missing evidence. */
    uncertain: RuleAtDate[];
};

export type CorpusScope = {
    documentCount: number;
    lastImportedAt: string | null;
    /** Documents cited by the rules' documents that are not in the corpus yet (from the document graph). */
    frontier: string[];
    disclaimer: string;
};

const SCOPE_DISCLAIMER =
    "Computed from the imported corpus only. A rule without a recorded amendment may still have been changed by a document that is not imported.";

/** Rebuilds lineages and validity intervals for the whole corpus from the stored evidence. */
export async function refreshHistory(db: D1Database): Promise<{ lineages: number; intervals: number; changeEvents: number }> {
    const [rules, provisionRelations, documentRelations, metadata, instructions, candidates] = await Promise.all([
        listAllViolationRules(db),
        listAllProvisionRelations(db),
        listAllDocumentRelations(db),
        listDocumentMetadata(db),
        listAllChangeInstructions(db),
        listAllRelationCandidates(db),
    ]);
    const { lineages, intervals } = buildHistory({
        rules,
        provisionRelations,
        documentRelations,
        effectiveByDocument: new Map(metadata.map((entry) => [entry.documentId, entry.effectiveFrom])),
        openInstructions: instructions.filter((instruction) => instruction.resolutionStatus === "UNRESOLVED" || instruction.resolutionStatus === "PARTIALLY_RESOLVED"),
        openDocumentCandidates: candidates.filter((candidate) => candidate.status !== "ACCEPTED" && candidate.status !== "REJECTED"),
    });

    const events = detectChangeEvents(lineages, intervals, rules);

    await replaceHistory(db, lineages, intervals, events);

    return { lineages: lineages.length, intervals: intervals.length, changeEvents: events.length };
}

export async function refreshHistoryAfterExtraction(db: D1Database): Promise<void> {
    try {
        const result = await refreshHistory(db);

        console.log(JSON.stringify({ level: "info", module: "history", ...result }));
    } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : "Unknown history error";

        console.error("[History] Refresh failed", detail);
    }
}

/**
 * FR-12.2: the rules of a violation that apply on `date`, per lineage. Lineages with different context
 * (vehicle, subject) are all returned; nothing is picked arbitrarily.
 */
export async function getRulesAsOf(db: D1Database, violationId: string, date: string): Promise<{ violationId: string; asOf: string; lineages: LineageAtDate[]; scope: CorpusScope }> {
    const { lineages, rulesById, intervalsById } = await loadViolationHistory(db, violationId);
    const result: LineageAtDate[] = [];

    for (const lineage of lineages) {
        const entries = lineage.ruleIds.flatMap((ruleId) => toRuleAtDate(rulesById.get(ruleId), intervalsById.get(ruleId), date));

        result.push({
            lineageId: lineage.id,
            contextIr: lineage.contextIr,
            applicable: entries.filter((entry) => entry.status === "CURRENT"),
            uncertain: entries.filter((entry) => entry.status === "UNCERTAIN"),
        });
    }

    return { violationId, asOf: date, lineages: result, scope: await readScope(db, [...rulesById.values()]) };
}

/** FR-11/FR-13: every lineage of a violation with its rules in order, their intervals, today's status and the semantic changes between them. */
export async function getViolationHistory(
    db: D1Database,
    violationId: string,
): Promise<{ violationId: string; lineages: (RuleLineage & { rules: RuleAtDate[]; changeEvents: ChangeEvent[] })[]; scope: CorpusScope }> {
    const { lineages, rulesById, intervalsById } = await loadViolationHistory(db, violationId);
    const events = await listChangeEventsOf(db, violationId);
    const today = new Date().toISOString().slice(0, 10);

    return {
        violationId,
        lineages: lineages.map((lineage) => ({
            ...lineage,
            rules: lineage.ruleIds.flatMap((ruleId) => toRuleAtDate(rulesById.get(ruleId), intervalsById.get(ruleId), today)),
            changeEvents: events.filter((event) => event.lineageId === lineage.id),
        })),
        scope: await readScope(db, [...rulesById.values()]),
    };
}

export async function getViolationChanges(db: D1Database, violationId: string): Promise<{ violationId: string; changeEvents: ChangeEvent[] }> {
    return { violationId, changeEvents: await listChangeEventsOf(db, violationId) };
}

async function loadViolationHistory(db: D1Database, violationId: string) {
    const lineages = await listLineagesOf(db, violationId);
    const ruleIds = lineages.flatMap((lineage) => lineage.ruleIds);
    const rules = (await listAllViolationRules(db)).filter((rule) => ruleIds.includes(rule.id));
    const intervals = await listIntervals(db, ruleIds);

    return {
        lineages,
        rulesById: new Map(rules.map((rule) => [rule.id, rule])),
        intervalsById: new Map(intervals.map((interval) => [interval.ruleId, interval])),
    };
}

function toRuleAtDate(rule: StoredViolationRule | undefined, interval: RuleInterval | undefined, date: string): RuleAtDate[] {
    if (!rule || !interval) {
        return [];
    }

    const { status, reasons } = statusAt(interval, date);

    return [{ rule, interval, status, reasons }];
}

export async function readScope(db: D1Database, rules: StoredViolationRule[]): Promise<CorpusScope> {
    const corpus = await db.prepare("SELECT COUNT(*) AS total, MAX(created_at) AS last_imported_at FROM legal_documents WHERE review_status = 'ACCEPTED'").first<{ total: number; last_imported_at: string | null }>();
    const documentIds = [...new Set(rules.flatMap((rule) => [rule.sourceDocumentId, rule.governedDocumentId]))];
    const frontier = documentIds.length === 0
        ? { results: [] as { target_document_number: string }[] }
        : await db
            .prepare(
                `SELECT DISTINCT target_document_number FROM document_relation_candidates
                 WHERE status = 'UNRESOLVED' AND target_document_number IS NOT NULL
                   AND source_document_id IN (SELECT value FROM json_each(?))
                 ORDER BY target_document_number`
            )
            .bind(JSON.stringify(documentIds))
            .all<{ target_document_number: string }>();

    return {
        documentCount: corpus?.total ?? 0,
        lastImportedAt: corpus?.last_imported_at ?? null,
        frontier: frontier.results.map((row) => row.target_document_number),
        disclaimer: SCOPE_DISCLAIMER,
    };
}
