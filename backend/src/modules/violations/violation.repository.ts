import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { FineRange } from "./sanction.parser";
import type { RuleEffect, RuleExtractionStatus, RuleSanction, SemanticIr, ViolationRuleDraft } from "./violation.types";

export type StoredViolationRule = ViolationRuleDraft & {
    evidenceLevel: string;
    extractionRunId: string;
    trafficViolationId: string | null;
};

export type ExtractionRun = {
    id: string;
    documentId: string;
    stage: string;
    method: string;
    model: string | null;
    promptVersion: string | null;
    extractorVersion: string;
    vocabularyVersionBefore: number | null;
    vocabularyVersionAfter: number | null;
    vocabIdsUsed: string[];
    vocabIdsCreated: string[];
    rejectedValues: string[];
    status: "COMPLETED" | "FAILED" | "SKIPPED";
    error: string | null;
    ruleCount: number;
    startedAt: string;
    finishedAt: string | null;
};

type RuleRow = {
    id: string;
    source_document_id: string;
    provision_id: string;
    governed_document_id: string;
    governed_provision_id: string;
    sanction_provision_id: string | null;
    behavior_text: string;
    article_title: string | null;
    subject_scope: FineRange["subject"];
    semantic_ir: string;
    semantic_method: "RULE" | "LLM";
    extraction_status: RuleExtractionStatus;
    uncertainty_reasons: string;
    evidence_level: string;
    extraction_run_id: string;
    effective_from: string | null;
    traffic_violation_id: string | null;
    fine_min: number | null;
    fine_max: number | null;
    warning_allowed: number;
    point_deduction_applicability: RuleSanction["pointDeductionApplicability"];
    points_deducted: number | null;
    remedial_measures_json: string;
    evidence_provision_ids: string;
};

type EffectRow = {
    violation_rule_id: string;
    effect_type: RuleEffect["effectType"];
    duration_min: number | null;
    duration_max: number | null;
    duration_unit: RuleEffect["durationUnit"];
    points: number | null;
    raw_text: string;
    source_provision_id: string;
};

type RunRow = {
    id: string;
    document_id: string;
    stage: string;
    method: string;
    model: string | null;
    prompt_version: string | null;
    extractor_version: string;
    vocabulary_version_before: number | null;
    vocabulary_version_after: number | null;
    vocab_ids_used: string;
    vocab_ids_created: string;
    rejected_values: string;
    status: ExtractionRun["status"];
    error: string | null;
    rule_count: number;
    started_at: string;
    finished_at: string | null;
};

const RULE_SELECT = `SELECT r.*, s.fine_min, s.fine_max, s.warning_allowed, s.point_deduction_applicability, s.points_deducted,
        s.remedial_measures_json, s.evidence_provision_ids
    FROM violation_rules r JOIN sanctions s ON s.violation_rule_id = r.id`;

/** Replaces the rules a document states, with their sanctions and effects, in one atomic batch. */
export async function replaceViolationRules(db: D1Database, documentId: string, rules: ViolationRuleDraft[], run: ExtractionRun): Promise<void> {
    const createdAt = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
        ...deleteStatements(db, documentId),
        insertRunStatement(db, run),
    ];

    for (const rule of rules) {
        const sanctionId = `${rule.id}#sanction`;

        statements.push(
            db.prepare(
                `INSERT INTO violation_rules (
                    id, source_document_id, provision_id, governed_document_id, governed_provision_id, sanction_provision_id,
                    behavior_text, article_title, subject_scope, semantic_ir, semantic_method, extraction_status,
                    uncertainty_reasons, evidence_level, extraction_run_id, effective_from, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                rule.id,
                rule.sourceDocumentId,
                rule.provisionId,
                rule.governedDocumentId,
                rule.governedProvisionId,
                rule.sanctionProvisionId,
                rule.behaviorText,
                rule.articleTitle,
                rule.subjectScope,
                JSON.stringify(rule.semanticIr),
                rule.semanticMethod,
                rule.extractionStatus,
                JSON.stringify(rule.uncertaintyReasons),
                "EXPLICIT_LEGAL_TEXT",
                run.id,
                rule.effectiveFrom,
                createdAt,
            ),
            db.prepare(
                `INSERT INTO sanctions (
                    id, violation_rule_id, fine_min, fine_max, currency, warning_allowed, point_deduction_applicability,
                    points_deducted, remedial_measures_json, evidence_provision_ids
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                sanctionId,
                rule.id,
                rule.sanction.fine?.min ?? null,
                rule.sanction.fine?.max ?? null,
                rule.sanction.currency,
                rule.sanction.warningAllowed ? 1 : 0,
                rule.sanction.pointDeductionApplicability,
                rule.sanction.pointsDeducted,
                JSON.stringify(rule.sanction.remedialMeasures),
                JSON.stringify(rule.sanction.evidenceProvisionIds),
            ),
        );

        rule.sanction.effects.forEach((effect, index) => {
            statements.push(
                db.prepare(
                    `INSERT INTO sanction_effects (
                        id, sanction_id, effect_type, duration_min, duration_max, duration_unit, points, raw_text, source_provision_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                    `${sanctionId}#effect${index + 1}`,
                    sanctionId,
                    effect.effectType,
                    effect.durationMin,
                    effect.durationMax,
                    effect.durationUnit,
                    effect.points,
                    effect.rawText,
                    effect.sourceProvisionId,
                ),
            );
        });
    }

    await db.batch(statements);
}

export async function deleteViolationRules(db: D1Database, documentId: string): Promise<void> {
    await db.batch(deleteStatements(db, documentId));
}

export async function listViolationRulesOf(db: D1Database, documentId: string): Promise<StoredViolationRule[]> {
    return readRules(db, `${RULE_SELECT} WHERE r.source_document_id = ? ORDER BY r.id`, [documentId]);
}

export async function listAllViolationRules(db: D1Database): Promise<StoredViolationRule[]> {
    return readRules(db, `${RULE_SELECT} ORDER BY r.id`, []);
}

export async function listViolationRulesByIds(db: D1Database, ids: string[]): Promise<StoredViolationRule[]> {
    if (ids.length === 0) {
        return [];
    }

    return readRules(db, `${RULE_SELECT} WHERE r.id IN (SELECT value FROM json_each(?)) ORDER BY r.id`, [JSON.stringify(ids)]);
}

export async function listExtractionRuns(db: D1Database, documentId: string): Promise<ExtractionRun[]> {
    const result = await db
        .prepare("SELECT * FROM extraction_runs WHERE document_id = ? ORDER BY started_at DESC")
        .bind(documentId)
        .all<RunRow>();

    return result.results.map(toRun);
}

export async function insertExtractionRun(db: D1Database, run: ExtractionRun): Promise<void> {
    await insertRunStatement(db, run).run();
}

function insertRunStatement(db: D1Database, run: ExtractionRun): D1PreparedStatement {
    return db.prepare(
        `INSERT OR REPLACE INTO extraction_runs (
            id, document_id, stage, method, model, prompt_version, extractor_version, vocabulary_version_before,
            vocabulary_version_after, vocab_ids_used, vocab_ids_created, rejected_values, status, error, rule_count,
            started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        run.id,
        run.documentId,
        run.stage,
        run.method,
        run.model,
        run.promptVersion,
        run.extractorVersion,
        run.vocabularyVersionBefore,
        run.vocabularyVersionAfter,
        JSON.stringify(run.vocabIdsUsed),
        JSON.stringify(run.vocabIdsCreated),
        JSON.stringify(run.rejectedValues),
        run.status,
        run.error,
        run.ruleCount,
        run.startedAt,
        run.finishedAt,
    );
}

function deleteStatements(db: D1Database, documentId: string): D1PreparedStatement[] {
    const rulesOfDocument = "SELECT id FROM violation_rules WHERE source_document_id = ?";

    return [
        db.prepare(`DELETE FROM sanction_effects WHERE sanction_id IN (SELECT id FROM sanctions WHERE violation_rule_id IN (${rulesOfDocument}))`).bind(documentId),
        db.prepare(`DELETE FROM sanctions WHERE violation_rule_id IN (${rulesOfDocument})`).bind(documentId),
        db.prepare("DELETE FROM violation_rules WHERE source_document_id = ?").bind(documentId),
    ];
}

async function readRules(db: D1Database, query: string, params: unknown[]): Promise<StoredViolationRule[]> {
    const rows = await db.prepare(query).bind(...params).all<RuleRow>();

    if (rows.results.length === 0) {
        return [];
    }

    const effects = await db
        .prepare(
            `SELECT s.violation_rule_id, e.effect_type, e.duration_min, e.duration_max, e.duration_unit, e.points, e.raw_text, e.source_provision_id
             FROM sanction_effects e JOIN sanctions s ON s.id = e.sanction_id
             WHERE s.violation_rule_id IN (SELECT value FROM json_each(?))
             ORDER BY e.id`
        )
        .bind(JSON.stringify(rows.results.map((row) => row.id)))
        .all<EffectRow>();
    const effectsByRule = new Map<string, RuleEffect[]>();

    for (const effect of effects.results) {
        const list = effectsByRule.get(effect.violation_rule_id) ?? [];

        list.push({
            effectType: effect.effect_type,
            durationMin: effect.duration_min,
            durationMax: effect.duration_max,
            durationUnit: effect.duration_unit,
            points: effect.points,
            rawText: effect.raw_text,
            sourceProvisionId: effect.source_provision_id,
        });
        effectsByRule.set(effect.violation_rule_id, list);
    }

    return rows.results.map((row) => toRule(row, effectsByRule.get(row.id) ?? []));
}

function toRule(row: RuleRow, effects: RuleEffect[]): StoredViolationRule {
    const fine = row.fine_min === null || row.fine_max === null ? null : { min: row.fine_min, max: row.fine_max, subject: row.subject_scope };

    return {
        id: row.id,
        sourceDocumentId: row.source_document_id,
        provisionId: row.provision_id,
        governedDocumentId: row.governed_document_id,
        governedProvisionId: row.governed_provision_id,
        sanctionProvisionId: row.sanction_provision_id,
        behaviorText: row.behavior_text,
        articleTitle: row.article_title,
        subjectScope: row.subject_scope,
        sanction: {
            fine,
            warningAllowed: row.warning_allowed === 1,
            currency: "VND",
            pointDeductionApplicability: row.point_deduction_applicability,
            pointsDeducted: row.points_deducted,
            effects,
            remedialMeasures: JSON.parse(row.remedial_measures_json),
            evidenceProvisionIds: JSON.parse(row.evidence_provision_ids),
        },
        semanticIr: JSON.parse(row.semantic_ir) as SemanticIr,
        semanticMethod: row.semantic_method,
        extractionStatus: row.extraction_status,
        uncertaintyReasons: JSON.parse(row.uncertainty_reasons),
        effectiveFrom: row.effective_from,
        evidenceLevel: row.evidence_level,
        extractionRunId: row.extraction_run_id,
        trafficViolationId: row.traffic_violation_id,
    };
}

function toRun(row: RunRow): ExtractionRun {
    return {
        id: row.id,
        documentId: row.document_id,
        stage: row.stage,
        method: row.method,
        model: row.model,
        promptVersion: row.prompt_version,
        extractorVersion: row.extractor_version,
        vocabularyVersionBefore: row.vocabulary_version_before,
        vocabularyVersionAfter: row.vocabulary_version_after,
        vocabIdsUsed: JSON.parse(row.vocab_ids_used),
        vocabIdsCreated: JSON.parse(row.vocab_ids_created),
        rejectedValues: JSON.parse(row.rejected_values),
        status: row.status,
        error: row.error,
        ruleCount: row.rule_count,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
    };
}
