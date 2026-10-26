import { extractDocumentRelationCandidates } from "../documents/document-graph.extractor";
import { maskQuotedText } from "../documents/document-graph.service";
import type { StoredProvision } from "../provisions/provision.repository";
import { parseLocators, type ProvisionLocator } from "./change.locator";
import type { ChangeInstructionDraft, ChangeOperation, TargetScope } from "./change.types";

type DocumentTarget = {
    citation: string;
    number: string | null;
    isSelf: boolean;
};

const INSTRUCTION_RELEVANCE = new Set(["AMENDMENT_INSTRUCTION", "REPEAL_INSTRUCTION"]);
const TARGET_ACTIONS = new Set(["AMEND", "SUPPLEMENT", "AMEND_OR_SUPPLEMENT", "REPLACE", "REPEAL", "CORRECT", "SUSPEND"]);
const SELF_REFERENCE = /(?:của|tại|trong)\s+(?:Bộ luật|Luật|Nghị định|Thông tư|Quyết định|Nghị quyết|Pháp lệnh)\s+này(?![\p{L}\p{N}])/u;
const SUBSTITUTE_TEXT = /(?<![\p{L}])(?:thay|bỏ)\s+(?:thế\s+)?(?:cụm\s+)?từ(?:\s+ngữ)?(?![\p{L}])/iu;
const EXCEPTION = /(?<![\p{L}])trừ\s+(?:trường hợp\s+)?[^.;:]+/giu;
const CITATION_END = /\s+như sau|:/iu;
const INSERTION_SPLIT = /\s+vào\s+/iu;

/**
 * Turns every amendment/repeal instruction provision of one document into a ChangeInstruction draft
 * (FR-06). Only the instruction's own words are read: quoted new text is masked, and the target
 * document comes from the instruction, then its enclosing provisions, then the document title.
 */
export function extractChangeInstructions(
    documentId: string,
    documentTitle: string | null,
    provisions: StoredProvision[],
): ChangeInstructionDraft[] {
    const byId = new Map(provisions.map((provision) => [provision.id, provision]));
    const drafts = new Map<string, ChangeInstructionDraft>();

    for (const provision of provisions) {
        if (provision.contentRole !== "OPERATIVE_INSTRUCTION" || !INSTRUCTION_RELEVANCE.has(provision.relevance) || !provision.text) {
            continue;
        }

        const masked = collapseSpaces(maskQuotedText(provision.text));
        const operation = readOperation(masked);

        if (!operation) {
            continue;
        }

        const context = readContextLocator(provision, byId, drafts);
        const locators = readTargetLocators(masked, operation, context);
        const target = readDocumentTarget(masked, provision, byId, documentTitle);

        drafts.set(provision.id, {
            id: `${provision.id}#change`,
            sourceDocumentId: documentId,
            sourceProvisionId: provision.id,
            sourceSnapshotId: provision.sourceSnapshotId,
            operation,
            rawText: provision.text,
            rawTargetCitation: readCitation(masked),
            targetDocumentCitation: target?.citation ?? null,
            targetDocumentNumber: target?.number ?? null,
            targetIsSelf: target?.isSelf ?? false,
            targetScope: readTargetScope(locators, target),
            targetLocators: locators,
            newTextProvisionIds: provisions.filter((candidate) => candidate.containerProvisionId === provision.id).map((candidate) => candidate.id),
            quotedSegments: provision.quotedSegments,
            exceptions: readExceptions(masked),
        });
    }

    return [...drafts.values()];
}

export function readOperation(instructionText: string): ChangeOperation | null {
    const text = instructionText.toLowerCase();

    if (SUBSTITUTE_TEXT.test(text)) {
        return "SUBSTITUTE_TEXT";
    }

    if (text.includes("bãi bỏ") || text.includes("hết hiệu lực")) {
        return "REPEAL";
    }

    if (text.includes("đính chính")) {
        return "CORRECT";
    }

    if (text.includes("thay thế")) {
        return "REPLACE";
    }

    if (text.includes("sửa đổi")) {
        return "AMEND";
    }

    if (text.includes("bổ sung")) {
        return "SUPPLEMENT";
    }

    return null;
}

/**
 * "Bổ sung điểm c vào khoản 4 Điều 7": the address after "vào" only gives context; the targets are the
 * new units named before it. Every other operation targets the units it names.
 */
function readTargetLocators(text: string, operation: ChangeOperation, context: ProvisionLocator | null): ProvisionLocator[] {
    const citation = readCitation(text);

    if (operation !== "SUPPLEMENT") {
        return parseLocators(citation, context);
    }

    const [newPart, containerPart] = citation.split(INSERTION_SPLIT, 2);

    if (!containerPart) {
        return parseLocators(citation, context);
    }

    const containers = parseLocators(containerPart, context);
    const insertionContext = containers.length === 1 ? containers[0] : context;

    return parseLocators(newPart, insertionContext);
}

/** The nearest enclosing address: an enclosing instruction's single target, or a single address its text names. */
function readContextLocator(
    provision: StoredProvision,
    byId: Map<string, StoredProvision>,
    drafts: Map<string, ChangeInstructionDraft>,
): ProvisionLocator | null {
    let parentId = provision.parentId;

    while (parentId) {
        const parentDraft = drafts.get(parentId);

        if (parentDraft && parentDraft.targetLocators.length === 1) {
            return parentDraft.targetLocators[0];
        }

        const parent = byId.get(parentId);

        if (!parent) {
            return null;
        }

        const named = parseLocators(collapseSpaces(maskQuotedText(`${parent.title ?? ""} ${parent.text ?? ""}`)));

        if (named.length === 1 && parent.level !== "ARTICLE") {
            return named[0];
        }

        parentId = parent.parentId;
    }

    return null;
}

function readDocumentTarget(
    ownText: string,
    provision: StoredProvision,
    byId: Map<string, StoredProvision>,
    documentTitle: string | null,
): DocumentTarget | null {
    if (SELF_REFERENCE.test(ownText)) {
        return { citation: "này", number: null, isSelf: true };
    }

    const texts = [ownText];
    let parentId = provision.parentId;

    while (parentId) {
        const parent = byId.get(parentId);

        if (!parent) {
            break;
        }

        texts.push(maskQuotedText(parent.title ?? ""), maskQuotedText(parent.text ?? ""));
        parentId = parent.parentId;
    }

    texts.push(documentTitle ?? "");

    for (const text of texts) {
        const target = readFirstTarget(text);

        if (target) {
            return target;
        }
    }

    return null;
}

function readFirstTarget(text: string): DocumentTarget | null {
    if (!text) {
        return null;
    }

    const { candidates } = extractDocumentRelationCandidates({ source_document_id: "instruction", text });

    for (const candidate of candidates) {
        if (TARGET_ACTIONS.has(candidate.action) && candidate.target_document_number) {
            return { citation: candidate.target_reference_raw, number: candidate.target_document_number, isSelf: false };
        }
    }

    return null;
}

function readTargetScope(locators: ProvisionLocator[], target: DocumentTarget | null): TargetScope {
    if (locators.length > 0) {
        return "PROVISIONS";
    }

    if (target) {
        return "DOCUMENT";
    }

    return "NONE";
}

function readCitation(text: string): string {
    const end = CITATION_END.exec(text);

    return (end ? text.slice(0, end.index) : text).trim();
}

function readExceptions(text: string): string[] {
    return [...text.matchAll(EXCEPTION)].map((match) => match[0].trim());
}

function collapseSpaces(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}
