import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { SemanticIr } from "../violations/violation.types";
import type { IdentityCandidate, IdentityDecisionType, IdentityMethod, ViolationIdentity } from "./identity.resolver";

export type NewViolation = {
    id: string;
    canonicalName: string;
    signatureKey: string | null;
    semanticIr: SemanticIr;
    createdFromRuleId: string;
};

export type NewAlias = {
    trafficViolationId: string;
    alias: string;
    normalizedAlias: string;
    sourceRuleId: string;
    sourceDocumentId: string;
};

export type StoredIdentityDecision = {
    violationRuleId: string;
    sourceDocumentId: string;
    decision: IdentityDecisionType;
    trafficViolationId: string | null;
    method: IdentityMethod;
    score: number | null;
    candidates: IdentityCandidate[];
    reasons: string[];
    model: string | null;
};

export type ViolationSummary = {
    id: string;
    canonicalName: string;
    signatureKey: string | null;
    aliases: string[];
};

type ViolationRow = {
    id: string;
    canonical_name: string;
    signature_key: string | null;
    semantic_ir: string;
};

type DecisionRow = {
    violation_rule_id: string;
    source_document_id: string;
    decision: IdentityDecisionType;
    traffic_violation_id: string | null;
    method: IdentityMethod;
    score: number | null;
    candidates: string;
    reasons: string;
    model: string | null;
};

export async function listViolationIdentities(db: D1Database): Promise<ViolationIdentity[]> {
    const [violations, aliases] = await Promise.all([
        db.prepare("SELECT id, canonical_name, signature_key, semantic_ir FROM traffic_violations ORDER BY id").all<ViolationRow>(),
        db.prepare("SELECT traffic_violation_id, normalized_alias FROM violation_aliases ORDER BY id").all<{ traffic_violation_id: string; normalized_alias: string }>(),
    ]);
    const aliasesByViolation = new Map<string, string[]>();

    for (const alias of aliases.results) {
        const list = aliasesByViolation.get(alias.traffic_violation_id) ?? [];

        list.push(alias.normalized_alias);
        aliasesByViolation.set(alias.traffic_violation_id, list);
    }

    return violations.results.map((row) => ({
        id: row.id,
        canonicalName: row.canonical_name,
        signatureKey: row.signature_key,
        semanticIr: JSON.parse(row.semantic_ir) as SemanticIr,
        normalizedAliases: aliasesByViolation.get(row.id) ?? [],
    }));
}

/**
 * Forgets every identity result of a document before it is resolved again, then removes violations
 * no rule refers to any more (they are recreated with the same id when still needed).
 */
export async function clearDocumentIdentities(db: D1Database, documentId: string): Promise<void> {
    await db.batch([
        db.prepare("DELETE FROM violation_aliases WHERE source_document_id = ?").bind(documentId),
        db.prepare("DELETE FROM identity_decisions WHERE source_document_id = ?").bind(documentId),
        db.prepare("UPDATE violation_rules SET traffic_violation_id = NULL WHERE source_document_id = ?").bind(documentId),
        db.prepare(
            `DELETE FROM violation_aliases WHERE traffic_violation_id NOT IN (
                SELECT traffic_violation_id FROM violation_rules WHERE traffic_violation_id IS NOT NULL
            )`
        ),
        db.prepare(
            `DELETE FROM traffic_violations WHERE id NOT IN (
                SELECT traffic_violation_id FROM violation_rules WHERE traffic_violation_id IS NOT NULL
            )`
        ),
    ]);
}

export async function saveIdentityResults(
    db: D1Database,
    violations: NewViolation[],
    aliases: NewAlias[],
    decisions: StoredIdentityDecision[],
): Promise<void> {
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];

    for (const violation of violations) {
        statements.push(
            db.prepare(
                `INSERT INTO traffic_violations (id, canonical_name, signature_key, semantic_ir, created_from_rule_id, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                    canonical_name = excluded.canonical_name,
                    signature_key = excluded.signature_key,
                    semantic_ir = excluded.semantic_ir,
                    updated_at = excluded.updated_at`
            ).bind(violation.id, violation.canonicalName, violation.signatureKey, JSON.stringify(violation.semanticIr), violation.createdFromRuleId, now, now),
        );
    }

    for (const alias of aliases) {
        statements.push(
            db.prepare(
                `INSERT OR IGNORE INTO violation_aliases (id, traffic_violation_id, alias, normalized_alias, source_rule_id, source_document_id, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
            ).bind(`${alias.trafficViolationId}|${alias.normalizedAlias}`, alias.trafficViolationId, alias.alias, alias.normalizedAlias, alias.sourceRuleId, alias.sourceDocumentId, now),
        );
    }

    for (const decision of decisions) {
        statements.push(
            db.prepare(
                `INSERT OR REPLACE INTO identity_decisions (
                    violation_rule_id, source_document_id, decision, traffic_violation_id, method, score, candidates, reasons, model, decided_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                decision.violationRuleId,
                decision.sourceDocumentId,
                decision.decision,
                decision.trafficViolationId,
                decision.method,
                decision.score,
                JSON.stringify(decision.candidates),
                JSON.stringify(decision.reasons),
                decision.model,
                now,
            ),
            db.prepare("UPDATE violation_rules SET traffic_violation_id = ? WHERE id = ?").bind(decision.trafficViolationId, decision.violationRuleId),
        );
    }

    if (statements.length > 0) {
        await db.batch(statements);
    }
}

export async function listIdentityDecisions(db: D1Database, ruleIds: string[]): Promise<StoredIdentityDecision[]> {
    if (ruleIds.length === 0) {
        return [];
    }

    const result = await db
        .prepare("SELECT * FROM identity_decisions WHERE violation_rule_id IN (SELECT value FROM json_each(?)) ORDER BY violation_rule_id")
        .bind(JSON.stringify(ruleIds))
        .all<DecisionRow>();

    return result.results.map((row) => ({
        violationRuleId: row.violation_rule_id,
        sourceDocumentId: row.source_document_id,
        decision: row.decision,
        trafficViolationId: row.traffic_violation_id,
        method: row.method,
        score: row.score,
        candidates: JSON.parse(row.candidates),
        reasons: JSON.parse(row.reasons),
        model: row.model,
    }));
}

/** At most this many query words are matched; longer queries rarely add precision and grow the statement. */
const MAX_QUERY_WORDS = 12;

/**
 * Full-text search over aliases (FR-16.1): a violation matches when one of its aliases contains every
 * word of the (accent-insensitive) query as a whole word, in any order. Aliases holding the query as one
 * contiguous phrase rank first. All violations when the query is empty.
 */
export async function searchViolations(db: D1Database, normalizedQuery: string, limit: number): Promise<ViolationSummary[]> {
    const words = [...new Set(normalizedQuery.split(" ").filter((word) => word.length > 0))].slice(0, MAX_QUERY_WORDS);

    if (words.length === 0) {
        const all = await db
            .prepare("SELECT id, canonical_name, signature_key, semantic_ir FROM traffic_violations ORDER BY canonical_name LIMIT ?")
            .bind(limit)
            .all<ViolationRow>();

        return attachAliases(db, all.results);
    }

    const wordConditions = words.map(() => "(' ' || a.normalized_alias || ' ') LIKE ?").join(" AND ");
    const violations = await db
        .prepare(
            `SELECT v.id, v.canonical_name, v.signature_key, v.semantic_ir,
                    MIN(CASE WHEN (' ' || a.normalized_alias || ' ') LIKE ? THEN 0 ELSE 1 END) AS phrase_rank
             FROM traffic_violations v JOIN violation_aliases a ON a.traffic_violation_id = v.id
             WHERE ${wordConditions}
             GROUP BY v.id
             ORDER BY phrase_rank, v.canonical_name
             LIMIT ?`
        )
        .bind(`% ${normalizedQuery} %`, ...words.map((word) => `% ${word} %`), limit)
        .all<ViolationRow>();

    return attachAliases(db, violations.results);
}

export async function getViolationSummary(db: D1Database, id: string): Promise<ViolationSummary | null> {
    const row = await db.prepare("SELECT id, canonical_name, signature_key, semantic_ir FROM traffic_violations WHERE id = ?").bind(id).first<ViolationRow>();

    if (!row) {
        return null;
    }

    const [summary] = await attachAliases(db, [row]);

    return summary;
}

async function attachAliases(db: D1Database, rows: ViolationRow[]): Promise<ViolationSummary[]> {
    if (rows.length === 0) {
        return [];
    }

    const aliases = await db
        .prepare("SELECT traffic_violation_id, alias FROM violation_aliases WHERE traffic_violation_id IN (SELECT value FROM json_each(?)) ORDER BY alias")
        .bind(JSON.stringify(rows.map((row) => row.id)))
        .all<{ traffic_violation_id: string; alias: string }>();

    return rows.map((row) => ({
        id: row.id,
        canonicalName: row.canonical_name,
        signatureKey: row.signature_key,
        aliases: aliases.results.filter((alias) => alias.traffic_violation_id === row.id).map((alias) => alias.alias),
    }));
}
