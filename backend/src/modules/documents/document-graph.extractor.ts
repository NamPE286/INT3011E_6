import type {
    DocumentRelationCandidate,
    DocumentRelationType,
    ExtractDocumentRelationsInput,
    ExtractDocumentRelationsResult,
    RelationAction,
    RelationScope,
} from "./document-graph.types";

type CueDirection = "FORWARD" | "BACKWARD";

type RelationCue = {
    pattern: string;
    action: RelationAction;
    /** FORWARD: the affected document follows the cue; BACKWARD: it precedes it ("… hết hiệu lực"). */
    direction: CueDirection;
    /** The cue only counts at the start of a sentence (a "Căn cứ …" preamble line). */
    sentenceStartOnly: boolean;
};

type CueMatch = {
    cue: RelationCue;
    start: number;
    end: number;
    text: string;
};

type Sentence = {
    start: number;
    end: number;
};

type ReferenceMatch = {
    start: number;
    end: number;
    raw: string;
};

// JavaScript's \b only understands ASCII letters, so Vietnamese words are delimited with these instead.
const WORD_START = "(?<![\\p{L}\\p{N}])";
const WORD_END = "(?![\\p{L}\\p{N}])";

/**
 * Conservative phrase-based baseline for Vietnamese legal documents. Alternatives are ordered longest
 * first, so "sửa đổi, bổ sung" is one AMEND_OR_SUPPLEMENT cue rather than an AMEND and a SUPPLEMENT.
 * It produces candidates only and never decides legal validity.
 */
const RELATION_CUES: readonly RelationCue[] = [
    { pattern: "sửa đổi\\s*(?:,|và)\\s*bổ sung", action: "AMEND_OR_SUPPLEMENT", direction: "FORWARD", sentenceStartOnly: false },
    { pattern: "bổ sung\\s*(?:,|và)\\s*sửa đổi", action: "AMEND_OR_SUPPLEMENT", direction: "FORWARD", sentenceStartOnly: false },
    { pattern: "sửa đổi", action: "AMEND", direction: "FORWARD", sentenceStartOnly: false },
    { pattern: "bổ sung", action: "SUPPLEMENT", direction: "FORWARD", sentenceStartOnly: false },
    { pattern: "thay thế", action: "REPLACE", direction: "FORWARD", sentenceStartOnly: false },
    { pattern: "bãi bỏ", action: "REPEAL", direction: "FORWARD", sentenceStartOnly: false },
    { pattern: "hết hiệu lực", action: "REPEAL", direction: "BACKWARD", sentenceStartOnly: false },
    { pattern: "đính chính", action: "CORRECT", direction: "FORWARD", sentenceStartOnly: false },
    { pattern: "đình chỉ\\s+(?:việc\\s+)?thi hành", action: "SUSPEND", direction: "FORWARD", sentenceStartOnly: false },
    { pattern: "quy định chi tiết", action: "DETAIL", direction: "FORWARD", sentenceStartOnly: false },
    { pattern: "hướng dẫn(?:\\s+(?:thi hành|thực hiện))?", action: "GUIDE", direction: "FORWARD", sentenceStartOnly: false },
    { pattern: "căn cứ", action: "LEGAL_BASIS", direction: "FORWARD", sentenceStartOnly: true },
];

const CUE_REGEX = new RegExp(
    `${WORD_START}(?:${RELATION_CUES.map((cue) => `(${cue.pattern})`).join("|")})${WORD_END}`,
    "giu",
);

const DOCUMENT_TYPES = "Hiến pháp|Bộ luật|Luật|Nghị định|Thông tư liên tịch|Thông tư|Quyết định|Nghị quyết liên tịch|Nghị quyết|Pháp lệnh|Chỉ thị";
const CUE_WORDS = "sửa đổi|bổ sung|thay thế|bãi bỏ|hết hiệu lực|đính chính|đình chỉ|quy định chi tiết|hướng dẫn";

/**
 * A named legal instrument. Document types are matched case-sensitively: a specific instrument is
 * capitalized ("Luật Giao thông đường bộ"), while lower-case "luật" is ordinary prose. A reference
 * ends at the sentence end, at the next cue or where a second instrument starts ("Luật A và Luật B").
 */
const REFERENCE_REGEX = new RegExp(
    `${WORD_START}(?:${DOCUMENT_TYPES})${WORD_END}[^;.!?\\n]{0,180}?` +
        `(?=\\s*(?:,|và)?\\s+(?:${DOCUMENT_TYPES})${WORD_END}|\\s+(?:${CUE_WORDS})${WORD_END}|[;!?\\n]|\\.(?:\\s|$)|$)`,
    "gu",
);

const DOCUMENT_NUMBER_REGEX = /(?<![\p{L}\p{N}])\d{1,4}\s*\/\s*(?:\d{4}\s*\/\s*)?[\p{L}\d]+(?:-[\p{L}\d]+)*(?![\p{L}\p{N}])/u;
const SELF_REFERENCE_REGEX = new RegExp(`^(?:${DOCUMENT_TYPES})\\s+này${WORD_END}`, "u");
const PASSIVE_BEFORE_CUE = /(?:được|bị)\s*$/iu;
const PARTIAL_SCOPE_WORDS = /(?<![\p{L}\p{N}])(?:điều|khoản|điểm|chương|mục|phần|phụ lục|một số|cụm từ|tên)(?![\p{L}\p{N}])/iu;
const FULL_SCOPE_FILLER = /^(?:toàn bộ|các)?$/iu;
const SENTENCE_SEPARATOR = /[!?\n;]|\.(?=\s|$)/g;
const IMPACT_ACTIONS: readonly RelationAction[] = ["AMEND", "SUPPLEMENT", "AMEND_OR_SUPPLEMENT", "REPLACE", "REPEAL", "CORRECT", "SUSPEND"];

export function extractDocumentRelationCandidates(input: ExtractDocumentRelationsInput): ExtractDocumentRelationsResult {
    const text = input.text ?? "";
    const sentences = splitSentences(text);
    const candidates: DocumentRelationCandidate[] = [];
    const seenIds = new Set<string>();

    for (const sentence of sentences) {
        const cueMatches = findCues(text, sentence);

        cueMatches.forEach((cueMatch, index) => {
            const windowStart = cueMatch.cue.direction === "FORWARD" ? cueMatch.end : (cueMatches[index - 1]?.end ?? sentence.start);
            const windowEnd = cueMatch.cue.direction === "FORWARD" ? (cueMatches[index + 1]?.start ?? sentence.end) : cueMatch.start;

            for (const reference of findReferences(text, windowStart, windowEnd)) {
                const candidate = buildCandidate(input.source_document_id, text, cueMatch, reference, windowStart);

                if (seenIds.has(candidate.candidate_id)) {
                    continue;
                }

                seenIds.add(candidate.candidate_id);
                candidates.push(candidate);
            }
        });
    }

    candidates.sort((left, right) => left.evidence.start - right.evidence.start || left.relation_type.localeCompare(right.relation_type));

    return {
        source_document_id: input.source_document_id,
        candidates,
        statistics: {
            sentences_scanned: sentences.length,
            candidate_count: candidates.length,
            unresolved_count: candidates.filter((candidate) => candidate.status === "UNRESOLVED").length,
        },
    };
}

/** Extracts the normalized number/symbol ("100/2019/NĐ-CP") from a raw reference, if it has one. */
export function extractDocumentNumber(reference: string): string | null {
    const match = DOCUMENT_NUMBER_REGEX.exec(reference);

    if (!match) {
        return null;
    }

    return match[0].replace(/\s+/g, "");
}

function splitSentences(text: string): Sentence[] {
    const sentences: Sentence[] = [];
    let start = 0;

    for (const separator of text.matchAll(SENTENCE_SEPARATOR)) {
        pushTrimmedSentence(text, start, separator.index, sentences);
        start = separator.index + 1;
    }

    pushTrimmedSentence(text, start, text.length, sentences);

    return sentences;
}

function pushTrimmedSentence(text: string, rawStart: number, rawEnd: number, sentences: Sentence[]): void {
    let start = rawStart;
    let end = rawEnd;

    while (start < end && /\s/u.test(text[start])) {
        start++;
    }

    while (end > start && /\s/u.test(text[end - 1])) {
        end--;
    }

    if (end > start) {
        sentences.push({ start, end });
    }
}

function findCues(text: string, sentence: Sentence): CueMatch[] {
    const sentenceText = text.slice(sentence.start, sentence.end);
    const matches: CueMatch[] = [];

    for (const match of sentenceText.matchAll(CUE_REGEX)) {
        const cueIndex = match.slice(1).findIndex((group) => group !== undefined);
        const cue = RELATION_CUES[cueIndex];

        if (!cue) {
            continue;
        }

        if (cue.sentenceStartOnly && match.index !== 0) {
            continue;
        }

        // "… đã được sửa đổi bởi …" describes someone else's action; the direction is not this document's.
        if (PASSIVE_BEFORE_CUE.test(sentenceText.slice(0, match.index))) {
            continue;
        }

        matches.push({
            cue,
            start: sentence.start + match.index,
            end: sentence.start + match.index + match[0].length,
            text: match[0],
        });
    }

    return matches;
}

function findReferences(text: string, windowStart: number, windowEnd: number): ReferenceMatch[] {
    const windowText = text.slice(windowStart, windowEnd);
    const references: ReferenceMatch[] = [];

    for (const match of windowText.matchAll(REFERENCE_REGEX)) {
        const raw = cleanReference(match[0]);

        if (!raw || SELF_REFERENCE_REGEX.test(raw)) {
            continue;
        }

        const start = windowStart + match.index;

        references.push({ start, end: start + match[0].trimEnd().length, raw });
    }

    return references;
}

function buildCandidate(
    sourceDocumentId: string,
    text: string,
    cueMatch: CueMatch,
    reference: ReferenceMatch,
    windowStart: number,
): DocumentRelationCandidate {
    const scope = readScope(text, cueMatch, reference, windowStart);
    const relationType = relationTypeOf(cueMatch.cue.action, scope);
    const evidenceStart = Math.min(reference.start, cueMatch.start);
    const evidenceEnd = Math.max(reference.end, cueMatch.end);

    return {
        candidate_id: [sourceDocumentId, relationType, reference.start, reference.raw.toLowerCase()].join(":"),
        source_document_id: sourceDocumentId,
        target_reference_raw: reference.raw,
        target_document_number: extractDocumentNumber(reference.raw),
        action: cueMatch.cue.action,
        relation_type: relationType,
        scope,
        status: "UNRESOLVED",
        evidence: {
            start: evidenceStart,
            end: evidenceEnd,
            quote: text.slice(evidenceStart, evidenceEnd),
            cue: cueMatch.text.replace(/\s+/g, " ").toLowerCase(),
        },
        resolution_reason: "Reference detected by phrase rules; target identity and legal effect require verification.",
    };
}

/**
 * Scope comes only from the wording between cue and reference: "bãi bỏ Nghị định X" covers the
 * whole document, "bãi bỏ Điều 5 của Nghị định X" part of it. Anything else stays UNKNOWN.
 */
function readScope(text: string, cueMatch: CueMatch, reference: ReferenceMatch, windowStart: number): RelationScope {
    if (!IMPACT_ACTIONS.includes(cueMatch.cue.action)) {
        return "UNKNOWN";
    }

    const between = cueMatch.cue.direction === "FORWARD"
        ? text.slice(cueMatch.end, reference.start)
        : text.slice(windowStart, reference.start);
    const normalized = between.replace(/\s+/g, " ").trim();

    if (PARTIAL_SCOPE_WORDS.test(normalized)) {
        return "PARTIAL";
    }

    if (FULL_SCOPE_FILLER.test(normalized)) {
        return "FULL";
    }

    return "UNKNOWN";
}

function relationTypeOf(action: RelationAction, scope: RelationScope): DocumentRelationType {
    switch (action) {
        case "AMEND":
            return "AMENDS";
        case "SUPPLEMENT":
            return "SUPPLEMENTS";
        case "AMEND_OR_SUPPLEMENT":
            return "AMENDS_OR_SUPPLEMENTS";
        case "REPLACE":
            return scopedType(scope, "FULLY_REPLACES", "PARTIALLY_REPLACES");
        case "REPEAL":
            return scopedType(scope, "FULLY_REPEALS", "PARTIALLY_REPEALS");
        case "CORRECT":
            return "CORRECTS";
        case "SUSPEND":
            return "SUSPENDS";
        case "GUIDE":
            return "GUIDES";
        case "DETAIL":
            return "DETAILS";
        case "LEGAL_BASIS":
            return "LEGAL_BASIS";
    }
}

/** Replacement and repeal have no scope-free type in §4.3, so an unknown scope keeps the type UNKNOWN. */
function scopedType(scope: RelationScope, fullType: DocumentRelationType, partialType: DocumentRelationType): DocumentRelationType {
    if (scope === "FULL") {
        return fullType;
    }

    if (scope === "PARTIAL") {
        return partialType;
    }

    return "UNKNOWN";
}

function cleanReference(raw: string): string {
    return raw.replace(/\s+/g, " ").replace(/[,:;]+$/g, "").trim();
}
