import type { D1Database } from "@cloudflare/workers-types";
import { listProvisionRelationsFrom } from "../changes/change.repository";
import type { ProvisionRelation } from "../changes/change.types";
import { getDocumentMetadata } from "../documents/document-graph.repository";
import { listProvisions, type StoredProvision } from "../provisions/provision.repository";
import { VocabularyRepository } from "../vocabulary/vocabulary.repository";
import { VocabularyService } from "../vocabulary/vocabulary.service";
import { assembleRules } from "./rule.assembler";
import { buildRuleNodes } from "./rule.nodes";
import { readSemanticIr, TYPE_OF_DIMENSION, type SemanticReading } from "./semantic.llm";
import {
    deleteViolationRules,
    listExtractionRuns,
    listViolationRulesOf,
    replaceViolationRules,
    type ExtractionRun,
    type StoredViolationRule,
} from "./violation.repository";
import { RULE_EXTRACTOR_VERSION, SEMANTIC_PROMPT_VERSION, type SemanticValue, type ViolationRuleDraft } from "./violation.types";

export type ExtractionOptions = {
    apiKey?: string;
    model: string;
    fetcher?: typeof fetch;
};

export type RuleExtractionOutcome =
    | { outcome: "EXTRACTED"; documentId: string; ruleCount: number; run: ExtractionRun }
    | { outcome: "NOT_FOUND" }
    | { outcome: "REVIEW_REQUIRED" };

type VocabularyOutcome = {
    used: Set<string>;
    created: string[];
    rejected: string[];
    versionAfter: number;
};

/**
 * Extracts the ViolationRules and Sanctions a document states (FR-08/FR-09). Structure and sanctions are
 * read deterministically; when an API key is configured the behaviour signature is read by the LLM with
 * the vocabulary snapshot (FR-08.1) and new values go through add_vocab. Without a key, or when the
 * model call fails, the rule keeps its deterministic signature and the run records why.
 */
export async function extractViolationRules(db: D1Database, documentId: string, options: ExtractionOptions): Promise<RuleExtractionOutcome> {
    const record = await db
        .prepare("SELECT id, review_status FROM legal_documents WHERE id = ?")
        .bind(documentId)
        .first<{ id: string; review_status: string }>();

    if (!record) {
        return { outcome: "NOT_FOUND" };
    }

    if (record.review_status !== "ACCEPTED") {
        await deleteViolationRules(db, documentId);

        return { outcome: "REVIEW_REQUIRED" };
    }

    const startedAt = new Date().toISOString();
    const drafts = await readRuleDrafts(db, documentId);
    const run: ExtractionRun = {
        id: `${documentId}#rules#${startedAt}`,
        documentId,
        stage: "VIOLATION_RULES",
        method: "RULE",
        model: null,
        promptVersion: null,
        extractorVersion: RULE_EXTRACTOR_VERSION,
        vocabularyVersionBefore: null,
        vocabularyVersionAfter: null,
        vocabIdsUsed: [],
        vocabIdsCreated: [],
        rejectedValues: [],
        status: "SKIPPED",
        error: drafts.length === 0 ? null : "OPENAI_API_KEY is not configured; deterministic signature kept",
        ruleCount: drafts.length,
        startedAt,
        finishedAt: null,
    };

    if (options.apiKey && drafts.length > 0) {
        await enrichWithModel(db, drafts, run, { ...options, apiKey: options.apiKey });
    }

    run.finishedAt = new Date().toISOString();
    await replaceViolationRules(db, documentId, drafts, run);

    return { outcome: "EXTRACTED", documentId, ruleCount: drafts.length, run };
}

/**
 * Pipeline hook. Amendments imported earlier only place their rewritten rules once the document they
 * amend exists, so their rules are extracted again after this document's.
 */
export async function extractRulesAfterExtraction(db: D1Database, documentId: string, options: ExtractionOptions): Promise<void> {
    const amenders = await db
        .prepare("SELECT DISTINCT from_document_id FROM provision_relations WHERE to_document_id = ? AND from_document_id != ?")
        .bind(documentId, documentId)
        .all<{ from_document_id: string }>();

    for (const id of [documentId, ...amenders.results.map((row) => row.from_document_id)]) {
        await extractRulesLogged(db, id, options);
    }
}

async function extractRulesLogged(db: D1Database, documentId: string, options: ExtractionOptions): Promise<void> {
    try {
        const result = await extractViolationRules(db, documentId, options);

        console.log(JSON.stringify({
            level: "info",
            module: "violations",
            documentId,
            outcome: result.outcome,
            rules: result.outcome === "EXTRACTED" ? result.ruleCount : 0,
            semantic: result.outcome === "EXTRACTED" ? result.run.status : null,
        }));
    } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : "Unknown violation extraction error";

        console.error(`[Violations] Extraction failed for ${documentId}`, detail);
    }
}

export async function getViolationRules(db: D1Database, documentId: string): Promise<{ documentId: string; rules: StoredViolationRule[]; runs: ExtractionRun[] }> {
    const [rules, runs] = await Promise.all([listViolationRulesOf(db, documentId), listExtractionRuns(db, documentId)]);

    return { documentId, rules, runs };
}

async function readRuleDrafts(db: D1Database, documentId: string): Promise<ViolationRuleDraft[]> {
    const provisions = await listProvisions(db, documentId);
    const relations = await listProvisionRelationsFrom(db, documentId);
    const relationsByInstruction = groupByInstruction(relations);
    const governedIds = [...new Set(relations.map((relation) => relation.toDocumentId).filter((id) => id !== documentId))];
    const governedProvisions = (await Promise.all(governedIds.map((id) => listProvisions(db, id)))).flat();
    const articleTitles = readArticleTitles([...provisions, ...governedProvisions]);
    const ownNodes = buildRuleNodes(provisions, relationsByInstruction, articleTitles);
    const governedNodes = buildRuleNodes(governedProvisions, new Map(), articleTitles);
    const metadata = await getDocumentMetadata(db, documentId);

    return assembleRules(ownNodes, governedNodes, metadata?.effectiveFrom ?? null);
}

async function enrichWithModel(db: D1Database, drafts: ViolationRuleDraft[], run: ExtractionRun, options: ExtractionOptions & { apiKey: string }): Promise<void> {
    const vocabulary = new VocabularyService(new VocabularyRepository(db));
    const snapshot = await vocabulary.getSnapshot();

    run.method = "RULE+LLM";
    run.model = options.model;
    run.promptVersion = SEMANTIC_PROMPT_VERSION;
    run.vocabularyVersionBefore = snapshot.vocabulary_version;
    run.vocabularyVersionAfter = snapshot.vocabulary_version;

    let readings: Map<string, SemanticReading>;

    try {
        readings = await readSemanticIr({
            rules: drafts,
            vocabulary: snapshot.entries,
            vocabularyVersion: snapshot.vocabulary_version,
            apiKey: options.apiKey,
            model: options.model,
            fetcher: options.fetcher,
        });
    } catch (error: unknown) {
        run.status = "FAILED";
        run.error = (error instanceof Error ? error.message : "Unknown model error").slice(0, 500);

        return;
    }

    for (const draft of drafts) {
        applyReading(draft, readings.get(draft.id), run);
    }

    const outcome = await canonicalize(vocabulary, drafts, snapshot.vocabulary_version);

    run.vocabIdsUsed = [...outcome.used].sort();
    run.vocabIdsCreated = outcome.created;
    run.rejectedValues.push(...outcome.rejected);
    run.vocabularyVersionAfter = outcome.versionAfter;
    run.status = "COMPLETED";
    run.error = null;
}

function applyReading(draft: ViolationRuleDraft, reading: SemanticReading | undefined, run: ExtractionRun): void {
    if (!reading) {
        draft.uncertaintyReasons.push("SEMANTIC_NOT_RETURNED");
        draft.extractionStatus = "UNCERTAIN";

        return;
    }

    draft.semanticIr = reading.ir;
    draft.semanticMethod = "LLM";
    run.rejectedValues.push(...reading.rejected.map((reason) => `${draft.id} ${reason}`));

    if (!reading.isViolation) {
        draft.uncertaintyReasons.push("MODEL_NOT_A_VIOLATION");
    }

    if (reading.uncertainty) {
        draft.uncertaintyReasons.push(`MODEL: ${reading.uncertainty}`);
    }

    if (!reading.ir.action) {
        draft.uncertaintyReasons.push("NO_ACTION");
    }

    if (draft.uncertaintyReasons.length > 0) {
        draft.extractionStatus = "UNCERTAIN";
    }
}

/**
 * FR-08.1: every value the model did not map to the registry goes through add_vocab, in order, with the
 * rule's provision as evidence. EXISTING/CREATED attach the canonical id; AMBIGUOUS keeps the value
 * unresolved; STALE_VERSION reloads the version and retries once.
 */
async function canonicalize(vocabulary: VocabularyService, drafts: ViolationRuleDraft[], startVersion: number): Promise<VocabularyOutcome> {
    const outcome: VocabularyOutcome = { used: new Set(), created: [], rejected: [], versionAfter: startVersion };
    const resolvedLabels = new Map<string, { id: string; label: string } | null>();

    for (const draft of drafts) {
        if (draft.semanticMethod !== "LLM") {
            continue;
        }

        for (const [dimension, value] of semanticValues(draft)) {
            const type = TYPE_OF_DIMENSION[dimension];

            if (value.vocabId) {
                outcome.used.add(value.vocabId);

                continue;
            }

            if (!type || !value.evidence) {
                continue;
            }

            const cacheKey = `${type}|${value.label.toLowerCase()}`;

            if (!resolvedLabels.has(cacheKey)) {
                resolvedLabels.set(cacheKey, await addValue(vocabulary, draft, type, value, outcome));
            }

            const resolved = resolvedLabels.get(cacheKey);

            if (resolved) {
                value.vocabId = resolved.id;
                value.label = resolved.label;
                outcome.used.add(resolved.id);
            }
        }
    }

    return outcome;
}

async function addValue(
    vocabulary: VocabularyService,
    draft: ViolationRuleDraft,
    type: NonNullable<(typeof TYPE_OF_DIMENSION)[string]>,
    value: SemanticValue,
    outcome: VocabularyOutcome,
): Promise<{ id: string; label: string } | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const response = await vocabulary.addVocab({
                type,
                canonical_label: value.label,
                evidence: value.evidence ?? value.label,
                source_provision_id: draft.provisionId,
                source_document_id: draft.sourceDocumentId,
                base_vocabulary_version: outcome.versionAfter,
            });

            outcome.versionAfter = Math.max(outcome.versionAfter, response.vocabulary_version);

            if (response.status === "STALE_VERSION") {
                continue;
            }

            if ((response.status === "CREATED" || response.status === "EXISTING") && response.canonical_id) {
                if (response.status === "CREATED") {
                    outcome.created.push(response.canonical_id);
                }

                return { id: response.canonical_id, label: response.entry?.canonical_label ?? value.label };
            }

            outcome.rejected.push(`${draft.id} ${type} "${value.label}": ${response.status}`);

            return null;
        } catch (error: unknown) {
            outcome.rejected.push(`${draft.id} ${type} "${value.label}": ${error instanceof Error ? error.message : "add_vocab failed"}`);

            return null;
        }
    }

    return null;
}

function semanticValues(draft: ViolationRuleDraft): [string, SemanticValue][] {
    const ir = draft.semanticIr;
    const values: [string, SemanticValue][] = [];
    const push = (dimension: string, value: SemanticValue | null): void => {
        if (value) {
            values.push([dimension, value]);
        }
    };

    push("action", ir.action);
    push("subject", ir.subject);
    ir.vehicles.forEach((value) => push("vehicles", value));
    push("target", ir.target);
    push("location", ir.location);
    ir.conditions.forEach((value) => push("conditions", value));
    ir.exceptions.forEach((value) => push("exceptions", value));

    return values;
}

function groupByInstruction(relations: ProvisionRelation[]): Map<string, ProvisionRelation[]> {
    const grouped = new Map<string, ProvisionRelation[]>();

    for (const relation of relations) {
        const list = grouped.get(relation.fromProvisionId) ?? [];

        list.push(relation);
        grouped.set(relation.fromProvisionId, list);
    }

    return grouped;
}

function readArticleTitles(provisions: StoredProvision[]): Map<string, string | null> {
    const titles = new Map<string, string | null>();

    for (const provision of provisions) {
        if (provision.level === "ARTICLE") {
            titles.set(provision.id, provision.title);
        }
    }

    return titles;
}
