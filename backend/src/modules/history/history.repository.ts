import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { HISTORY_VERSION, type RuleInterval, type RuleLineage } from "./history.types";

type LineageRow = {
    id: string;
    traffic_violation_id: string;
    lineage_key: string;
    context_ir: string;
    rule_ids: string;
    links: string;
};

type IntervalRow = {
    rule_id: string;
    lineage_id: string;
    valid_from: string | null;
    valid_to: string | null;
    end_type: RuleInterval["endType"];
    end_evidence: string | null;
    successor_rule_id: string | null;
    warnings: string;
};

/** The history is always derived from the whole corpus, so it is rewritten in one batch. */
export async function replaceHistory(db: D1Database, lineages: RuleLineage[], intervals: RuleInterval[]): Promise<void> {
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [db.prepare("DELETE FROM rule_lineages"), db.prepare("DELETE FROM rule_intervals")];

    for (const lineage of lineages) {
        statements.push(
            db.prepare(
                `INSERT INTO rule_lineages (id, traffic_violation_id, lineage_key, context_ir, rule_ids, links, history_version, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                lineage.id,
                lineage.trafficViolationId,
                lineage.lineageKey,
                JSON.stringify(lineage.contextIr),
                JSON.stringify(lineage.ruleIds),
                JSON.stringify(lineage.links),
                HISTORY_VERSION,
                now,
            ),
        );
    }

    for (const interval of intervals) {
        statements.push(
            db.prepare(
                `INSERT INTO rule_intervals (rule_id, lineage_id, valid_from, valid_to, end_type, end_evidence, successor_rule_id, warnings, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                interval.ruleId,
                interval.lineageId,
                interval.validFrom,
                interval.validTo,
                interval.endType,
                interval.endEvidence ? JSON.stringify(interval.endEvidence) : null,
                interval.successorRuleId,
                JSON.stringify(interval.warnings),
                now,
            ),
        );
    }

    await db.batch(statements);
}

export async function listLineagesOf(db: D1Database, violationId: string): Promise<RuleLineage[]> {
    const result = await db
        .prepare("SELECT * FROM rule_lineages WHERE traffic_violation_id = ? ORDER BY id")
        .bind(violationId)
        .all<LineageRow>();

    return result.results.map((row) => ({
        id: row.id,
        trafficViolationId: row.traffic_violation_id,
        lineageKey: row.lineage_key,
        contextIr: JSON.parse(row.context_ir),
        ruleIds: JSON.parse(row.rule_ids),
        links: JSON.parse(row.links),
    }));
}

export async function listIntervals(db: D1Database, ruleIds: string[]): Promise<RuleInterval[]> {
    if (ruleIds.length === 0) {
        return [];
    }

    const result = await db
        .prepare("SELECT * FROM rule_intervals WHERE rule_id IN (SELECT value FROM json_each(?))")
        .bind(JSON.stringify(ruleIds))
        .all<IntervalRow>();

    return result.results.map((row) => ({
        ruleId: row.rule_id,
        lineageId: row.lineage_id,
        validFrom: row.valid_from,
        validTo: row.valid_to,
        endType: row.end_type,
        endEvidence: row.end_evidence ? JSON.parse(row.end_evidence) : null,
        successorRuleId: row.successor_rule_id,
        warnings: JSON.parse(row.warnings),
    }));
}
