import type { D1Database } from "@cloudflare/workers-types";
import { listAllProvisionRelations, listProvisionRelationsByIds } from "../changes/change.repository";
import type { ProvisionRelation, ProvisionRelationType } from "../changes/change.types";
import { listProvisions, type StoredProvision } from "../provisions/provision.repository";
import { extractDocumentRelationCandidates } from "./document-graph.extractor";
import {
    deleteDocumentGraph,
    getDocumentMetadata,
    listAllRelationCandidates,
    listDocumentMetadata,
    listDocumentRelationsTouching,
    listRelationCandidatesByIds,
    listRelationCandidatesFrom,
    replaceDocumentRelations,
    replaceRelationCandidates,
    updateCandidateResolutions,
    upsertDocumentMetadata,
    type EvidenceField,
    type StoredDocumentRelation,
    type StoredRelationCandidate,
} from "./document-graph.repository";
import { buildCorpusIndex, resolveCandidate } from "./document-graph.resolver";
import type { DocumentRelationType, RelationCandidateStatus } from "./document-graph.types";
import { readDocumentMetadata, type DocumentMetadata } from "./document-metadata";

export const GRAPH_METHOD = "RULE_CUE";
export const GRAPH_EXTRACTOR_VERSION = "document-graph-v1";
const DERIVED_METHOD = "PROVISION_RELATION";

/** Document-level type of an edge summarized from provision relations: they never cover the whole document. */
const DOCUMENT_TYPE_OF_PROVISION_RELATION: Record<ProvisionRelationType, DocumentRelationType> = {
    AMENDS: "AMENDS",
    SUPPLEMENTS: "SUPPLEMENTS",
    REPLACES: "PARTIALLY_REPLACES",
    REPEALS: "PARTIALLY_REPEALS",
    CORRECTS: "CORRECTS",
};

const GRAPH_DISCLAIMER =
    "Graph built from the stored corpus only. Candidates are not legal relations, and a missing edge or an empty frontier does not prove that no relation exists.";

// Text inside quotation marks is new or old wording of another provision, not an action of this document.
const SKIPPED_CONTENT_ROLES = new Set(["QUOTED_NEW_TEXT", "QUOTED_OLD_TEXT", "HISTORICAL_DESCRIPTION"]);

type LegalDocumentRow = {
    id: string;
    document_title: string | null;
    json_content: string;
    review_status: string;
};

type TextSource = {
    field: EvidenceField;
    text: string;
    provision: StoredProvision | null;
};

export type GraphBuildOutcome =
    | { outcome: "BUILT"; documentId: string; candidateCount: number; statusCounts: Partial<Record<RelationCandidateStatus, number>> }
    | { outcome: "NOT_FOUND" }
    | { outcome: "REVIEW_REQUIRED" };

export type RelationEdgeView = StoredDocumentRelation & {
    direction: "OUTGOING" | "INCOMING";
    otherDocumentId: string;
    evidence: StoredRelationCandidate[];
    provisionEvidence: ProvisionRelation[];
};

export type DocumentRelationsView = {
    documentId: string;
    metadata: DocumentMetadata | null;
    outgoing: RelationEdgeView[];
    incoming: RelationEdgeView[];
    candidates: StoredRelationCandidate[];
    coverage: {
        statusCounts: Partial<Record<RelationCandidateStatus, number>>;
        frontier: string[];
    };
    disclaimer: string;
};

/**
 * Builds the evidence-backed graph for one document (FR-03): reads its identity metadata, extracts
 * reference + action candidates from the title and every provision, then re-resolves the whole corpus
 * so earlier documents whose targets were outside the corpus pick up this document as an incoming edge.
 */
export async function buildDocumentGraph(db: D1Database, documentId: string): Promise<GraphBuildOutcome> {
    const record = await db
        .prepare("SELECT id, document_title, json_content, review_status FROM legal_documents WHERE id = ?")
        .bind(documentId)
        .first<LegalDocumentRow>();

    if (!record) {
        return { outcome: "NOT_FOUND" };
    }

    if (record.review_status !== "ACCEPTED") {
        await deleteDocumentGraph(db, documentId);
        await refreshCorpusGraph(db);

        return { outcome: "REVIEW_REQUIRED" };
    }

    const provisions = await listProvisions(db, documentId);
    const operativeProvisions = provisions.filter((provision) => !SKIPPED_CONTENT_ROLES.has(provision.contentRole));
    const metadata = readDocumentMetadata({
        documentId,
        title: record.document_title,
        jsonContent: record.json_content,
        provisionTexts: operativeProvisions.map((provision) => provision.text ?? ""),
    });

    await upsertDocumentMetadata(db, metadata);

    const candidates = extractCandidates(documentId, record.document_title, operativeProvisions);

    await replaceRelationCandidates(db, documentId, candidates);

    const resolved = await refreshCorpusGraph(db);
    const ownCandidates = resolved.filter((candidate) => candidate.sourceDocumentId === documentId);

    return {
        outcome: "BUILT",
        documentId,
        candidateCount: ownCandidates.length,
        statusCounts: countStatuses(ownCandidates),
    };
}

/** Pipeline hook: a graph failure is logged and can be repaired by the rebuild endpoint; the job stays finished. */
export async function buildGraphAfterExtraction(db: D1Database, documentId: string): Promise<void> {
    try {
        const result = await buildDocumentGraph(db, documentId);

        console.log(JSON.stringify({
            level: "info",
            module: "document-graph",
            documentId,
            outcome: result.outcome,
            candidates: result.outcome === "BUILT" ? result.candidateCount : 0,
        }));
    } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : "Unknown document graph error";

        console.error(`[DocumentGraph] Build failed for ${documentId}`, detail);
    }
}

export async function getDocumentRelations(db: D1Database, documentId: string): Promise<DocumentRelationsView> {
    const [metadata, relations, candidates] = await Promise.all([
        getDocumentMetadata(db, documentId),
        listDocumentRelationsTouching(db, documentId),
        listRelationCandidatesFrom(db, documentId),
    ]);
    const evidenceIds = relations.flatMap((relation) => relation.evidenceCandidateIds);
    const provisionEvidenceIds = relations.flatMap((relation) => relation.evidenceProvisionRelationIds);
    const [evidenceRows, provisionEvidenceRows] = await Promise.all([
        listRelationCandidatesByIds(db, evidenceIds),
        listProvisionRelationsByIds(db, provisionEvidenceIds),
    ]);
    const evidenceById = new Map(evidenceRows.map((candidate) => [candidate.id, candidate]));
    const provisionEvidenceById = new Map(provisionEvidenceRows.map((relation) => [relation.id, relation]));
    const edges = relations.map((relation) => toEdgeView(relation, documentId, evidenceById, provisionEvidenceById));
    const openCandidates = candidates.filter((candidate) => candidate.status !== "ACCEPTED");

    return {
        documentId,
        metadata,
        outgoing: edges.filter((edge) => edge.direction === "OUTGOING"),
        incoming: edges.filter((edge) => edge.direction === "INCOMING"),
        candidates: openCandidates,
        coverage: {
            statusCounts: countStatuses(candidates),
            frontier: readFrontier(candidates),
        },
        disclaimer: GRAPH_DISCLAIMER,
    };
}

/** Re-resolves every stored candidate against the current corpus and re-derives the accepted edges. */
export async function refreshCorpusGraph(db: D1Database): Promise<StoredRelationCandidate[]> {
    const [metadata, candidates, provisionRelations] = await Promise.all([
        listDocumentMetadata(db),
        listAllRelationCandidates(db),
        listAllProvisionRelations(db),
    ]);
    const corpus = buildCorpusIndex(metadata);
    const changed: StoredRelationCandidate[] = [];
    const resolved = candidates.map((candidate) => {
        const resolution = resolveCandidate(candidate, corpus);
        const next: StoredRelationCandidate = {
            ...candidate,
            status: resolution.status,
            resolvedTargetDocumentId: resolution.resolvedTargetDocumentId,
            resolutionReason: resolution.reason,
        };

        if (next.status !== candidate.status || next.resolvedTargetDocumentId !== candidate.resolvedTargetDocumentId) {
            changed.push(next);
        }

        return next;
    });

    await updateCandidateResolutions(db, changed);
    await replaceDocumentRelations(db, deriveAcceptedRelations(resolved, provisionRelations));

    return resolved;
}

/**
 * One edge per (from, to, type, scope). Its evidence is every ACCEPTED text candidate and every accepted
 * cross-document provision relation with that key, so dedup never drops a multi-edge or its evidence.
 */
export function deriveAcceptedRelations(
    candidates: StoredRelationCandidate[],
    provisionRelations: ProvisionRelation[] = [],
): StoredDocumentRelation[] {
    const relations = new Map<string, StoredDocumentRelation>();

    for (const candidate of candidates) {
        if (candidate.status !== "ACCEPTED" || !candidate.resolvedTargetDocumentId) {
            continue;
        }

        const id = [candidate.sourceDocumentId, candidate.resolvedTargetDocumentId, candidate.proposedRelationType, candidate.scope].join("|");
        const existing = relations.get(id);

        if (existing) {
            existing.evidenceCandidateIds.push(candidate.id);

            continue;
        }

        relations.set(id, {
            id,
            fromDocumentId: candidate.sourceDocumentId,
            toDocumentId: candidate.resolvedTargetDocumentId,
            relationType: candidate.proposedRelationType,
            scope: candidate.scope,
            verificationStatus: "ACCEPTED",
            evidenceLevel: "EXPLICIT_LEGAL_TEXT",
            evidenceCandidateIds: [candidate.id],
            evidenceProvisionRelationIds: [],
            method: GRAPH_METHOD,
        });
    }

    for (const relation of provisionRelations) {
        if (relation.verificationStatus !== "ACCEPTED" || relation.fromDocumentId === relation.toDocumentId) {
            continue;
        }

        const relationType = DOCUMENT_TYPE_OF_PROVISION_RELATION[relation.relationType];
        const id = [relation.fromDocumentId, relation.toDocumentId, relationType, "PARTIAL"].join("|");
        const existing = relations.get(id);

        if (existing) {
            existing.evidenceProvisionRelationIds.push(relation.id);

            continue;
        }

        relations.set(id, {
            id,
            fromDocumentId: relation.fromDocumentId,
            toDocumentId: relation.toDocumentId,
            relationType,
            scope: "PARTIAL",
            verificationStatus: "ACCEPTED",
            evidenceLevel: "STRUCTURED_DERIVATION",
            evidenceCandidateIds: [],
            evidenceProvisionRelationIds: [relation.id],
            method: DERIVED_METHOD,
        });
    }

    return [...relations.values()];
}

function extractCandidates(documentId: string, documentTitle: string | null, provisions: StoredProvision[]): StoredRelationCandidate[] {
    const sources: TextSource[] = [];

    if (documentTitle) {
        sources.push({ field: "DOCUMENT_TITLE", text: documentTitle, provision: null });
    }

    for (const provision of provisions) {
        if (provision.title) {
            sources.push({ field: "PROVISION_TITLE", text: provision.title, provision });
        }

        if (provision.text) {
            sources.push({ field: "PROVISION_TEXT", text: provision.text, provision });
        }
    }

    return sources.flatMap((source) => extractFromSource(documentId, source));
}

function extractFromSource(documentId: string, source: TextSource): StoredRelationCandidate[] {
    const result = extractDocumentRelationCandidates({ source_document_id: documentId, text: maskQuotedText(source.text) });
    const locator = source.provision?.id ?? "title";

    return result.candidates.map((candidate) => ({
        id: `${documentId}|${locator}|${source.field}|${candidate.evidence.start}|${candidate.relation_type}|${candidate.target_reference_raw.toLowerCase()}`,
        sourceDocumentId: documentId,
        sourceSnapshotId: source.provision?.sourceSnapshotId ?? null,
        sourceProvisionId: source.provision?.id ?? null,
        evidenceField: source.field,
        contentRole: source.provision?.contentRole ?? null,
        pageStart: source.provision?.pageStart ?? null,
        pageEnd: source.provision?.pageEnd ?? null,
        startOffset: candidate.evidence.start,
        endOffset: candidate.evidence.end,
        // Quote from the original text: masking only blanks characters, so offsets are unchanged.
        quotedText: source.text.slice(candidate.evidence.start, candidate.evidence.end),
        cue: candidate.evidence.cue,
        rawTargetCitation: candidate.target_reference_raw,
        targetDocumentNumber: candidate.target_document_number,
        action: candidate.action,
        proposedRelationType: candidate.relation_type,
        scope: candidate.scope,
        resolvedTargetDocumentId: null,
        status: candidate.status,
        resolutionReason: candidate.resolution_reason,
        method: GRAPH_METHOD,
        extractorVersion: GRAPH_EXTRACTOR_VERSION,
    }));
}

/**
 * Blanks quoted text but keeps every offset: "Thay cụm từ “Nghị định 100” bằng …" must not read
 * "Nghị định 100" inside the quote as a target of this document's action.
 */
export function maskQuotedText(text: string): string {
    let depth = 0;
    let masked = "";

    for (const character of text) {
        if (character === "“") {
            depth++;
            masked += character;

            continue;
        }

        if (character === "”" && depth > 0) {
            depth--;
            masked += character;

            continue;
        }

        masked += depth > 0 ? " ".repeat(character.length) : character;
    }

    return masked;
}

function toEdgeView(
    relation: StoredDocumentRelation,
    documentId: string,
    evidenceById: Map<string, StoredRelationCandidate>,
    provisionEvidenceById: Map<string, ProvisionRelation>,
): RelationEdgeView {
    const isOutgoing = relation.fromDocumentId === documentId;
    const evidence: StoredRelationCandidate[] = [];

    for (const candidateId of relation.evidenceCandidateIds) {
        const candidate = evidenceById.get(candidateId);

        if (candidate) {
            evidence.push(candidate);
        }
    }

    const provisionEvidence: ProvisionRelation[] = [];

    for (const relationId of relation.evidenceProvisionRelationIds) {
        const provisionRelation = provisionEvidenceById.get(relationId);

        if (provisionRelation) {
            provisionEvidence.push(provisionRelation);
        }
    }

    return {
        ...relation,
        direction: isOutgoing ? "OUTGOING" : "INCOMING",
        otherDocumentId: isOutgoing ? relation.toDocumentId : relation.fromDocumentId,
        evidence,
        provisionEvidence,
    };
}

function countStatuses(candidates: StoredRelationCandidate[]): Partial<Record<RelationCandidateStatus, number>> {
    const counts: Partial<Record<RelationCandidateStatus, number>> = {};

    for (const candidate of candidates) {
        counts[candidate.status] = (counts[candidate.status] ?? 0) + 1;
    }

    return counts;
}

/** Citations whose target is not in the corpus yet: the documents discovery would acquire next. */
function readFrontier(candidates: StoredRelationCandidate[]): string[] {
    const frontier = new Set<string>();

    for (const candidate of candidates) {
        if (candidate.status === "UNRESOLVED" && candidate.targetDocumentNumber) {
            frontier.add(candidate.targetDocumentNumber);
        }
    }

    return [...frontier].sort();
}
