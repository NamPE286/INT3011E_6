import { resolveCandidate, type CorpusIndex } from "../documents/document-graph.resolver";
import { formatLocator, locatorToProvisionId, parentLocator, type ProvisionLocator } from "./change.locator";
import {
    ARTICLE_EXPANSION_METHOD,
    CHANGE_EXTRACTOR_VERSION,
    CHANGE_METHOD,
    DOCUMENT_EXPANSION_METHOD,
    type ChangeInstruction,
    type ChangeInstructionDraft,
    type ChangeOperation,
    type InstructionStatus,
    type ProvisionRelation,
    type ProvisionRelationType,
    type ProvisionUnit,
    type RelationVerification,
} from "./change.types";

export type DocumentResolution = {
    status: InstructionStatus;
    targetDocumentId: string | null;
    verification: RelationVerification | null;
    reason: string;
};

/** The stored text of a target document, indexed for linking addresses and expanding whole units to clauses. */
export type TargetProvisions = {
    ids: ReadonlySet<string>;
    /** The clauses of each article in reading order; an article without clauses stands for itself. */
    unitsByArticle: ReadonlyMap<string, LocatedUnit[]>;
};

type LocatedUnit = ProvisionUnit & { locator: ProvisionLocator };

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

/** Operations that end a whole document when it is the target: every clause of it is replaced or repealed. */
const WHOLE_DOCUMENT_ENDINGS = new Set<ChangeOperation>(["REPLACE", "REPEAL"]);

/** Operations that change every clause of an article named without a clause ("Sửa đổi Điều 6 như sau"). */
const WHOLE_ARTICLE_CHANGES = new Set<ChangeOperation>(["AMEND", "REPLACE", "REPEAL"]);

export function indexTargetProvisions(units: ProvisionUnit[]): TargetProvisions {
    const located = units.filter((unit): unit is LocatedUnit => unit.locator !== null);
    const articles = located.filter((unit) => unit.level === "ARTICLE");
    const articleIds = new Set(articles.map((article) => article.id));
    const clausesByArticle = new Map<string, LocatedUnit[]>();

    for (const unit of located) {
        if (unit.level !== "CLAUSE" || !unit.parentId || !articleIds.has(unit.parentId)) {
            continue;
        }

        const clauses = clausesByArticle.get(unit.parentId) ?? [];

        clauses.push(unit);
        clausesByArticle.set(unit.parentId, clauses);
    }

    return {
        ids: new Set(units.map((unit) => unit.id)),
        unitsByArticle: new Map(articles.map((article) => [article.id, clausesByArticle.get(article.id) ?? [article]])),
    };
}

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
 * Whole units are shown at clause level: replacing or repealing a whole document links to every clause of
 * it, and changing a whole article links to every clause of that article.
 */
export function resolveInstruction(
    draft: ChangeInstructionDraft,
    document: DocumentResolution,
    targets: TargetProvisions,
    effectiveFrom: string | null,
): { instruction: ChangeInstruction; relations: ProvisionRelation[] } {
    const base = { ...draft, targetDocumentId: document.targetDocumentId, effectiveFrom };

    if (!document.targetDocumentId || !document.verification) {
        return { instruction: { ...base, resolutionStatus: document.status, resolutionReason: document.reason }, relations: [] };
    }

    if (draft.targetScope === "SUB_INSTRUCTIONS") {
        const reason = "Introduces the instructions nested under it; they carry the provision-level edges.";

        return { instruction: { ...base, resolutionStatus: document.status, resolutionReason: reason }, relations: [] };
    }

    if (draft.targetScope === "DOCUMENT" && WHOLE_DOCUMENT_ENDINGS.has(draft.operation) && document.targetDocumentId !== draft.sourceDocumentId) {
        const units = [...targets.unitsByArticle.values()].flat();
        const relations = units.map((unit) => buildRelation(draft, document, RELATION_TYPE_BY_OPERATION[draft.operation], unit.id, unit.locator, null, effectiveFrom, DOCUMENT_EXPANSION_METHOD));
        const reason = `Instruction ends the whole document; shown on its ${relations.length} clause(s), with the document relation as evidence.`;

        return { instruction: { ...base, resolutionStatus: document.status, resolutionReason: reason }, relations };
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
        const linked = linkLocator(draft, document, locator, targets, effectiveFrom);

        if (linked.length > 0) {
            relations.push(...linked);
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
    targets: TargetProvisions,
    effectiveFrom: string | null,
): ProvisionRelation[] {
    const targetDocumentId = document.targetDocumentId ?? "";
    const provisionId = locatorToProvisionId(targetDocumentId, locator);
    const relationType = RELATION_TYPE_BY_OPERATION[draft.operation];
    const articleClauses = locator.clause === null && locator.point === null ? (targets.unitsByArticle.get(provisionId) ?? []) : [];

    if (WHOLE_ARTICLE_CHANGES.has(draft.operation) && articleClauses.some((unit) => unit.level === "CLAUSE")) {
        return articleClauses.map((unit) => buildRelation(draft, document, relationType, unit.id, unit.locator, null, effectiveFrom, ARTICLE_EXPANSION_METHOD));
    }

    if (targets.ids.has(provisionId)) {
        return [buildRelation(draft, document, relationType, provisionId, locator, null, effectiveFrom)];
    }

    if (draft.operation !== "SUPPLEMENT") {
        return [];
    }

    const container = parentLocator(locator);

    if (!container) {
        return [buildRelation(draft, document, relationType, null, locator, locator, effectiveFrom)];
    }

    const containerId = locatorToProvisionId(targetDocumentId, container);

    if (!targets.ids.has(containerId)) {
        return [];
    }

    return [buildRelation(draft, document, relationType, containerId, container, locator, effectiveFrom)];
}

function buildRelation(
    draft: ChangeInstructionDraft,
    document: DocumentResolution,
    relationType: ProvisionRelationType,
    toProvisionId: string | null,
    targetLocator: ProvisionLocator,
    insertionLocator: ProvisionLocator | null,
    effectiveFrom: string | null,
    method: string = CHANGE_METHOD,
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
        method,
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
