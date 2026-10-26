import { normalizeDocNumber, removeVietnameseAccents } from "./document.matcher";
import type { DocumentMetadata } from "./document-metadata";
import { parseVietnameseDate } from "./document-metadata";
import type { DocumentRelationType, RelationCandidateStatus } from "./document-graph.types";

export type ResolvableCandidate = {
    sourceDocumentId: string;
    rawTargetCitation: string;
    targetDocumentNumber: string | null;
    proposedRelationType: DocumentRelationType;
};

export type CandidateResolution = {
    status: RelationCandidateStatus;
    resolvedTargetDocumentId: string | null;
    reason: string;
};

/** Stored documents grouped by normalized number, the only key an identity match may start from. */
export type CorpusIndex = Map<string, DocumentMetadata[]>;

const REFERENCE_TYPES = ["Thông tư liên tịch", "Nghị quyết liên tịch", "Hiến pháp", "Bộ luật", "Luật", "Nghị định", "Thông tư", "Quyết định", "Nghị quyết", "Pháp lệnh", "Chỉ thị"];

export function buildCorpusIndex(metadata: DocumentMetadata[]): CorpusIndex {
    const index: CorpusIndex = new Map();

    for (const entry of metadata) {
        if (!entry.normalizedNumber) {
            continue;
        }

        const documents = index.get(entry.normalizedNumber) ?? [];

        documents.push(entry);
        index.set(entry.normalizedNumber, documents);
    }

    return index;
}

/**
 * Deterministic identity resolution (SRS §4.1, FR-03 step 3–5). A number alone never accepts an edge:
 * the document type named in the citation must agree with the stored document, a cited issue date
 * must not contradict it, and the action must have a definite type. Anything less stays a candidate.
 */
export function resolveCandidate(candidate: ResolvableCandidate, corpus: CorpusIndex): CandidateResolution {
    if (!candidate.targetDocumentNumber) {
        return unresolved("Citation has no document number; identity needs number, type, issuer and date.");
    }

    const matches = corpus.get(normalizeDocNumber(candidate.targetDocumentNumber)) ?? [];

    if (matches.length === 0) {
        return unresolved("Target is not in the stored corpus yet (discovery frontier).");
    }

    if (matches.length > 1) {
        return {
            status: "AMBIGUOUS",
            resolvedTargetDocumentId: null,
            reason: `${matches.length} stored documents share number ${candidate.targetDocumentNumber}.`,
        };
    }

    const target = matches[0];

    if (target.documentId === candidate.sourceDocumentId) {
        return { status: "REJECTED", resolvedTargetDocumentId: target.documentId, reason: "Citation resolves to the source document itself." };
    }

    const citedType = readCitedType(candidate.rawTargetCitation);

    if (citedType && target.documentType && !sameText(citedType, target.documentType)) {
        return conflict(target, `Citation names a ${citedType} but the stored document is a ${target.documentType}.`);
    }

    const citedDate = parseVietnameseDate(candidate.rawTargetCitation);

    if (citedDate && target.issuedAt && citedDate !== target.issuedAt) {
        return conflict(target, `Citation dates the document ${citedDate} but it was issued ${target.issuedAt}.`);
    }

    if (candidate.proposedRelationType === "UNKNOWN") {
        return candidateOnly(target, "Target identified, but the wording does not state the scope of the action.");
    }

    if (!citedType || !target.documentType) {
        return candidateOnly(target, "Number matches, but the document type could not be compared.");
    }

    return {
        status: "ACCEPTED",
        resolvedTargetDocumentId: target.documentId,
        reason: "Number and document type match one stored document; action read from explicit legal text.",
    };
}

function readCitedType(citation: string): string | null {
    for (const type of REFERENCE_TYPES) {
        if (citation.startsWith(type)) {
            return type;
        }
    }

    return null;
}

function sameText(left: string, right: string): boolean {
    return removeVietnameseAccents(left).toLowerCase() === removeVietnameseAccents(right).toLowerCase();
}

function unresolved(reason: string): CandidateResolution {
    return { status: "UNRESOLVED", resolvedTargetDocumentId: null, reason };
}

function conflict(target: DocumentMetadata, reason: string): CandidateResolution {
    return { status: "CONFLICT", resolvedTargetDocumentId: target.documentId, reason };
}

function candidateOnly(target: DocumentMetadata, reason: string): CandidateResolution {
    return { status: "CANDIDATE", resolvedTargetDocumentId: target.documentId, reason };
}
