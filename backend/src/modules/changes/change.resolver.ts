import { resolveCandidate, type CorpusIndex } from "../documents/document-graph.resolver";
import { formatLocator, locatorToProvisionId, parentLocator, type ProvisionLocator } from "./change.locator";
import {
    CHANGE_EXTRACTOR_VERSION,
    CHANGE_METHOD,
    type ChangeInstruction,
    type ChangeInstructionDraft,
    type ChangeOperation,
    type InstructionStatus,
    type ProvisionRelation,
    type ProvisionRelationType,
    type RelationVerification,
} from "./change.types";

export type DocumentResolution = {
    status: InstructionStatus;
    targetDocumentId: string | null;
    verification: RelationVerification | null;
    reason: string;
};

export type ResolvedChanges = {
    instructions: ChangeInstruction[];
    relations: ProvisionRelation[];
};

const RELATION_TYPE_BY_OPERATION: Record<ChangeOperation, ProvisionRelationType> = {
    AMEND: "AMENDS",
    SUPPLEMENT: "SUPPLEMENTS",
    REPLACE: "REPLACES",
    REPEAL: "REPEALS",
    CORRECT: "CORRECTS",
    SUBSTITUTE_TEXT: "AMENDS",
};

/** Which stored document an instruction acts on, using the same identity rules as the document graph. */
export function resolveTargetDocument(draft: ChangeInstructionDraft, corpus: CorpusIndex): DocumentResolution {
    if (draft.targetIsSelf) {
        return { status: "RESOLVED", targetDocumentId: draft.sourceDocumentId, verification: "ACCEPTED", reason: "Instruction targets its own document." };
    }

    if (!draft.targetDocumentNumber) {
        return { status: "UNRESOLVED", targetDocumentId: null, verification: null, reason: "No target document named by the instruction or its enclosing provisions." };
    }

    const resolution = resolveCandidate(
        {
            sourceDocumentId: draft.sourceDocumentId,
            rawTargetCitation: draft.targetDocumentCitation ?? draft.targetDocumentNumber,
            targetDocumentNumber: draft.targetDocumentNumber,
            proposedRelationType: "AMENDS",
        },
        corpus,
    );

    if (resolution.status === "ACCEPTED") {
        return { status: "RESOLVED", targetDocumentId: resolution.resolvedTargetDocumentId, verification: "ACCEPTED", reason: resolution.reason };
    }

    if (resolution.status === "CANDIDATE") {
        return { status: "CANDIDATE", targetDocumentId: resolution.resolvedTargetDocumentId, verification: "CANDIDATE", reason: resolution.reason };
    }

    if (resolution.status === "REJECTED") {
        return { status: "UNRESOLVED", targetDocumentId: null, verification: null, reason: resolution.reason };
    }

    return { status: resolution.status, targetDocumentId: null, verification: null, reason: resolution.reason };
}

/**
 * Resolves each instruction's addresses to provisions of the target document (FR-07). An address that
 * is missing from the stored text stays unresolved instead of being linked to something nearby; a
 * SUPPLEMENT that adds a new unit links to its enclosing provision and keeps the insertion locator.
 */
export function resolveInstruction(
    draft: ChangeInstructionDraft,
    document: DocumentResolution,
    targetProvisionIds: ReadonlySet<string>,
    effectiveFrom: string | null,
): { instruction: ChangeInstruction; relations: ProvisionRelation[] } {
    const base = { ...draft, targetDocumentId: document.targetDocumentId, effectiveFrom };

    if (!document.targetDocumentId || !document.verification) {
        return { instruction: { ...base, resolutionStatus: document.status, resolutionReason: document.reason }, relations: [] };
    }

    if (draft.targetScope !== "PROVISIONS") {
        const reason = draft.targetScope === "DOCUMENT"
            ? "Instruction acts on the whole document; no provision-level edges are propagated."
            : "No provision address could be read from the instruction.";

        return { instruction: { ...base, resolutionStatus: draft.targetScope === "DOCUMENT" ? document.status : "UNRESOLVED", resolutionReason: reason }, relations: [] };
    }

    const relations: ProvisionRelation[] = [];
    const missing: string[] = [];

    for (const locator of draft.targetLocators) {
        const relation = linkLocator(draft, document, locator, targetProvisionIds, effectiveFrom);

        if (relation) {
            relations.push(relation);
        } else {
            missing.push(formatLocator(locator));
        }
    }

    return {
        instruction: { ...base, ...readInstructionStatus(document, relations.length, missing) },
        relations,
    };
}

function linkLocator(
    draft: ChangeInstructionDraft,
    document: DocumentResolution,
    locator: ProvisionLocator,
    targetProvisionIds: ReadonlySet<string>,
    effectiveFrom: string | null,
): ProvisionRelation | null {
    const targetDocumentId = document.targetDocumentId ?? "";
    const provisionId = locatorToProvisionId(targetDocumentId, locator);
    const exists = targetProvisionIds.has(provisionId);
    const relationType = RELATION_TYPE_BY_OPERATION[draft.operation];

    if (exists) {
        return buildRelation(draft, document, relationType, provisionId, locator, null, effectiveFrom);
    }

    if (draft.operation !== "SUPPLEMENT") {
        return null;
    }

    const container = parentLocator(locator);

    if (!container) {
        return buildRelation(draft, document, relationType, null, locator, locator, effectiveFrom);
    }

    const containerId = locatorToProvisionId(targetDocumentId, container);

    if (!targetProvisionIds.has(containerId)) {
        return null;
    }

    return buildRelation(draft, document, relationType, containerId, container, locator, effectiveFrom);
}

function buildRelation(
    draft: ChangeInstructionDraft,
    document: DocumentResolution,
    relationType: ProvisionRelationType,
    toProvisionId: string | null,
    targetLocator: ProvisionLocator,
    insertionLocator: ProvisionLocator | null,
    effectiveFrom: string | null,
): ProvisionRelation {
    const target = toProvisionId ?? `${document.targetDocumentId}:${formatLocator(targetLocator)}`;

    return {
        id: `${draft.id}->${insertionLocator ? `${target}+${formatLocator(insertionLocator)}` : target}`,
        changeInstructionId: draft.id,
        fromDocumentId: draft.sourceDocumentId,
        fromProvisionId: draft.sourceProvisionId,
        toDocumentId: document.targetDocumentId ?? "",
        toProvisionId,
        relationType,
        targetLocator,
        insertionLocator,
        newTextProvisionIds: draft.newTextProvisionIds,
        verificationStatus: document.verification ?? "CANDIDATE",
        evidenceLevel: "EXPLICIT_LEGAL_TEXT",
        evidenceText: draft.rawText,
        effectiveFrom,
        method: CHANGE_METHOD,
        extractorVersion: CHANGE_EXTRACTOR_VERSION,
    };
}

function readInstructionStatus(
    document: DocumentResolution,
    linkedCount: number,
    missing: string[],
): { resolutionStatus: InstructionStatus; resolutionReason: string } {
    if (missing.length === 0) {
        return { resolutionStatus: document.status, resolutionReason: document.reason };
    }

    const reason = `Not found in the stored target text: ${missing.join("; ")}.`;

    if (linkedCount === 0) {
        return { resolutionStatus: "UNRESOLVED", resolutionReason: reason };
    }

    return { resolutionStatus: "PARTIALLY_RESOLVED", resolutionReason: reason };
}
