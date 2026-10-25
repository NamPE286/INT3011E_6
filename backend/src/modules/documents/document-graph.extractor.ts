import type {
    DocumentRelationCandidate,
    DocumentRelationType,
    ExtractDocumentRelationsInput,
    ExtractDocumentRelationsResult,
} from "./document-graph.types";

interface RelationCue {
    pattern: RegExp;
    type: DocumentRelationType;
    label: string;
}

/**
 * Conservative phrase-based baseline for Vietnamese legal documents.
 * This intentionally produces candidates only; it does not decide legal validity.
 */
const RELATION_CUES: RelationCue[] = [
    { pattern: /sửa đổi(?:,| và)?\s*bổ sung/giu, type: "AMENDS_OR_SUPPLEMENTS", label: "sửa đổi, bổ sung" },
    { pattern: /bổ sung(?:,| và)?\s*sửa đổi/giu, type: "AMENDS_OR_SUPPLEMENTS", label: "bổ sung, sửa đổi" },
    { pattern: /thay thế/giu, type: "REPLACES", label: "thay thế" },
    { pattern: /bãi bỏ/giu, type: "REPEALS", label: "bãi bỏ" },
    { pattern: /đình chỉ thi hành/giu, type: "SUSPENDS_EXECUTION", label: "đình chỉ thi hành" },
    { pattern: /quy định chi tiết(?:\s+thi hành)?/giu, type: "GUIDES", label: "quy định chi tiết" },
    { pattern: /hướng dẫn thi hành/giu, type: "GUIDES", label: "hướng dẫn thi hành" },
    { pattern: /căn cứ/giu, type: "LEGAL_BASIS", label: "căn cứ" },
];

/**
 * Recognizes common Vietnamese legal-document references.
 * This is a discovery regex, not a complete grammar for every historical format.
 */
const DOCUMENT_REFERENCE_REGEX =
    /\b(?:(?:Bộ\s+luật|Luật|Nghị\s+định|Thông\s+tư(?:\s+liên\s+tịch)?|Quyết\s+định|Nghị\s+quyết|Pháp\s+lệnh|Chỉ\s+thị)\s+(?:số\s+)?[^,;.!?\n]{1,140}?)(?=\s+(?:sửa đổi|bổ sung|thay thế|bãi bỏ|quy định chi tiết|hướng dẫn thi hành)|[,;.!?\n]|$)/giu;

const DOCUMENT_NUMBER_REGEX =
    /\b\d{1,4}\s*\/\s*\d{4}\s*\/[\p{L}\d_-]+(?:\/[\p{L}\d_-]+)?\b/iu;

function sentenceBounds(text: string, offset: number): { start: number; end: number } {
    const separators = /[.!?\n;]/g;
    let start = 0;
    let end = text.length;
    let match: RegExpExecArray | null;

    while ((match = separators.exec(text)) !== null) {
        const boundary = match.index + 1;
        if (boundary <= offset) start = boundary;
        else {
            end = match.index;
            break;
        }
    }

    while (start < end && /\s/.test(text[start] ?? "")) start++;
    while (end > start && /\s/.test(text[end - 1] ?? "")) end--;
    return { start, end };
}

function cleanReference(raw: string): string {
    return raw.replace(/\s+/g, " ").replace(/[,:;]+$/g, "").trim();
}

function extractDocumentNumber(reference: string): string | null {
    const match = DOCUMENT_NUMBER_REGEX.exec(reference);
    return match?.[0]?.replace(/\s+/g, "") ?? null;
}

function stableCandidateId(
    sourceId: string,
    type: DocumentRelationType,
    target: string,
    start: number,
): string {
    // Stable and dependency-free. This is a run-local identifier, not a security hash.
    return [sourceId, type, start, target.toLowerCase().replace(/\s+/g, " ")].join(":");
}

export function extractDocumentRelationCandidates(
    input: ExtractDocumentRelationsInput,
): ExtractDocumentRelationsResult {
    const text = input.text ?? "";
    const candidates: DocumentRelationCandidate[] = [];
    const seen = new Set<string>();
    const sentenceStarts = new Set<number>();

    for (const cue of RELATION_CUES) {
        cue.pattern.lastIndex = 0;
        let cueMatch: RegExpExecArray | null;

        while ((cueMatch = cue.pattern.exec(text)) !== null) {
            const cueOffset = cueMatch.index;
            const bounds = sentenceBounds(text, cueOffset);
            sentenceStarts.add(bounds.start);
            const sentence = text.slice(bounds.start, bounds.end);
            const localCueOffset = cueOffset - bounds.start;

            // References in the same sentence are only candidate targets.
            // A reviewer/resolver must determine whether each reference is the target.
            DOCUMENT_REFERENCE_REGEX.lastIndex = 0;
            let referenceMatch: RegExpExecArray | null;
            while ((referenceMatch = DOCUMENT_REFERENCE_REGEX.exec(sentence)) !== null) {
                const rawReference = cleanReference(referenceMatch[0]);
                if (!rawReference) continue;

                // For a legal-basis cue, retain the referenced legal instrument.
                // For change cues, do not assume every reference in the sentence is affected.
                const absoluteStart = bounds.start + referenceMatch.index;
                const absoluteEnd = absoluteStart + referenceMatch[0].length;
                const candidateId = stableCandidateId(
                    input.source_document_id,
                    cue.type,
                    rawReference,
                    absoluteStart,
                );
                if (seen.has(candidateId)) continue;
                seen.add(candidateId);

                const evidenceStart = Math.min(absoluteStart, cueOffset);
                const evidenceEnd = Math.max(absoluteEnd, cueOffset + cueMatch[0].length);
                const quote = text.slice(evidenceStart, evidenceEnd);
                candidates.push({
                    candidate_id: candidateId,
                    source_document_id: input.source_document_id,
                    target_reference_raw: rawReference,
                    target_document_number: extractDocumentNumber(rawReference),
                    relation_type: cue.type,
                    status: "UNRESOLVED",
                    evidence: {
                        start: evidenceStart,
                        end: evidenceEnd,
                        quote,
                        cue: cue.label,
                    },
                    resolution_reason:
                        "Reference detected by phrase rules; target identity and legal effect require verification.",
                });
            }

            // Keep the variable intentionally used to make it explicit that cue and
            // reference positions are in the same sentence coordinate space.
            void localCueOffset;
            if (cueMatch[0].length === 0) cue.pattern.lastIndex++;
        }
    }

    candidates.sort((a, b) => a.evidence.start - b.evidence.start || a.relation_type.localeCompare(b.relation_type));

    return {
        source_document_id: input.source_document_id,
        candidates,
        statistics: {
            sentences_scanned: sentenceStarts.size,
            candidate_count: candidates.length,
            unresolved_count: candidates.filter((item) => item.status === "UNRESOLVED").length,
        },
    };
}
