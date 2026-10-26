import type { D1Database } from "@cloudflare/workers-types";
import { listDocumentMetadata } from "../documents/document-graph.repository";
import { buildCorpusIndex } from "../documents/document-graph.resolver";
import { refreshCorpusGraph } from "../documents/document-graph.service";
import { listProvisions } from "../provisions/provision.repository";
import { extractChangeInstructions } from "./change.extractor";
import {
    deleteChangeInstructions,
    listAllChangeInstructions,
    listChangeInstructionsByIds,
    listChangeInstructionsFrom,
    listProvisionIdsOf,
    listProvisionRelationsFrom,
    listProvisionRelationsTouching,
    replaceChangeInstructions,
    saveResolvedChanges,
} from "./change.repository";
import { resolveInstruction, resolveTargetDocument } from "./change.resolver";
import type { ChangeInstruction, InstructionStatus, ProvisionRelation } from "./change.types";

type LegalDocumentRow = {
    id: string;
    document_title: string | null;
    review_status: string;
};

export type ChangeBuildOutcome =
    | { outcome: "BUILT"; documentId: string; instructionCount: number; relationCount: number; statusCounts: Partial<Record<InstructionStatus, number>> }
    | { outcome: "NOT_FOUND" }
    | { outcome: "REVIEW_REQUIRED" };

export type DocumentChangesView = {
    documentId: string;
    instructions: (ChangeInstruction & { relations: ProvisionRelation[] })[];
};

export type ProvisionRelationView = ProvisionRelation & {
    direction: "OUTGOING" | "INCOMING";
    instruction: ChangeInstruction | null;
};

/**
 * Extracts the change instructions of one document (FR-06), then re-resolves every instruction in the
 * corpus (FR-07): an amendment imported before its target links up once the target arrives.
 */
export async function buildChangeGraph(db: D1Database, documentId: string): Promise<ChangeBuildOutcome> {
    const record = await db
        .prepare("SELECT id, document_title, review_status FROM legal_documents WHERE id = ?")
        .bind(documentId)
        .first<LegalDocumentRow>();

    if (!record) {
        return { outcome: "NOT_FOUND" };
    }

    if (record.review_status !== "ACCEPTED") {
        await deleteChangeInstructions(db, documentId);
        await refreshChanges(db);

        return { outcome: "REVIEW_REQUIRED" };
    }

    const provisions = await listProvisions(db, documentId);
    const drafts = extractChangeInstructions(documentId, record.document_title, provisions);
    const pending: ChangeInstruction[] = drafts.map((draft) => ({
        ...draft,
        targetDocumentId: null,
        effectiveFrom: null,
        resolutionStatus: "UNRESOLVED",
        resolutionReason: "Not resolved yet.",
    }));

    await replaceChangeInstructions(db, documentId, pending);

    const { instructions, relations } = await refreshChanges(db);
    const own = instructions.filter((instruction) => instruction.sourceDocumentId === documentId);

    return {
        outcome: "BUILT",
        documentId,
        instructionCount: own.length,
        relationCount: relations.filter((relation) => relation.fromDocumentId === documentId).length,
        statusCounts: countStatuses(own),
    };
}

export async function buildChangesAfterExtraction(db: D1Database, documentId: string): Promise<void> {
    try {
        const result = await buildChangeGraph(db, documentId);

        console.log(JSON.stringify({
            level: "info",
            module: "changes",
            documentId,
            outcome: result.outcome,
            instructions: result.outcome === "BUILT" ? result.instructionCount : 0,
            relations: result.outcome === "BUILT" ? result.relationCount : 0,
        }));
    } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : "Unknown change graph error";

        console.error(`[Changes] Build failed for ${documentId}`, detail);
    }
}

/** Re-resolves all instructions, rewrites provision relations and re-derives the document graph from both. */
export async function refreshChanges(db: D1Database): Promise<{ instructions: ChangeInstruction[]; relations: ProvisionRelation[] }> {
    const [stored, metadata] = await Promise.all([listAllChangeInstructions(db), listDocumentMetadata(db)]);
    const corpus = buildCorpusIndex(metadata);
    const effectiveByDocument = new Map(metadata.map((entry) => [entry.documentId, entry.effectiveFrom]));
    const documentResolutions = stored.map((instruction) => resolveTargetDocument(instruction, corpus));
    const targetIds = documentResolutions.flatMap((resolution) => (resolution.targetDocumentId ? [resolution.targetDocumentId] : []));
    const provisionIds = await listProvisionIdsOf(db, [...new Set(targetIds)]);
    const instructions: ChangeInstruction[] = [];
    const relations: ProvisionRelation[] = [];

    stored.forEach((instruction, index) => {
        const resolution = documentResolutions[index];
        const targets = provisionIds.get(resolution.targetDocumentId ?? "") ?? new Set<string>();
        const resolved = resolveInstruction(instruction, resolution, targets, effectiveByDocument.get(instruction.sourceDocumentId) ?? null);

        instructions.push(resolved.instruction);
        relations.push(...resolved.relations);
    });

    await saveResolvedChanges(db, instructions, relations);
    await refreshCorpusGraph(db);

    return { instructions, relations };
}

export async function getDocumentChanges(db: D1Database, documentId: string): Promise<DocumentChangesView> {
    const [instructions, relations] = await Promise.all([
        listChangeInstructionsFrom(db, documentId),
        listProvisionRelationsFrom(db, documentId),
    ]);

    return {
        documentId,
        instructions: instructions.map((instruction) => ({
            ...instruction,
            relations: relations.filter((relation) => relation.changeInstructionId === instruction.id),
        })),
    };
}

/** FR-07 view of one provision: what it changes and what changed it, each with its instruction as evidence. */
export async function getProvisionRelations(db: D1Database, provisionId: string): Promise<{ provisionId: string; outgoing: ProvisionRelationView[]; incoming: ProvisionRelationView[] }> {
    const relations = await listProvisionRelationsTouching(db, provisionId);
    const instructions = await listChangeInstructionsByIds(db, [...new Set(relations.map((relation) => relation.changeInstructionId))]);
    const instructionById = new Map(instructions.map((instruction) => [instruction.id, instruction]));
    const views: ProvisionRelationView[] = relations.map((relation) => ({
        ...relation,
        direction: relation.fromProvisionId === provisionId ? "OUTGOING" : "INCOMING",
        instruction: instructionById.get(relation.changeInstructionId) ?? null,
    }));

    return {
        provisionId,
        outgoing: views.filter((view) => view.direction === "OUTGOING"),
        incoming: views.filter((view) => view.direction === "INCOMING"),
    };
}

function countStatuses(instructions: ChangeInstruction[]): Partial<Record<InstructionStatus, number>> {
    const counts: Partial<Record<InstructionStatus, number>> = {};

    for (const instruction of instructions) {
        counts[instruction.resolutionStatus] = (counts[instruction.resolutionStatus] ?? 0) + 1;
    }

    return counts;
}
