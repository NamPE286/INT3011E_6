import { isRecord } from "../llm/openai-json";
import type { AnswerClaim, AnswerEvidence, ComposedAnswer } from "./ask.types";

const MAX_CLAIM_LENGTH = 600;
const MAX_CLAIMS = 12;

const AMBIGUOUS_CLARIFICATION =
    "Có nhiều quy định cùng áp dụng tại thời điểm này, khác nhau theo hành vi, phương tiện hoặc đối tượng bị xử phạt. Hãy nêu rõ phương tiện và đối tượng (cá nhân hay tổ chức) để xác định đúng quy định.";

const SUBJECT_LABELS = {
    INDIVIDUAL: "cá nhân",
    ORGANIZATION: "tổ chức",
} as const;

/** Deterministic answer built only from the stored rules. The status never depends on a model. */
export function composeAnswer(evidence: AnswerEvidence[]): ComposedAnswer {
    if (evidence.length === 0) {
        return { status: "NO_ANSWER", claims: [], clarification: null };
    }

    const current = evidence.filter((item) => item.status === "CURRENT");
    const uncertain = evidence.filter((item) => item.status === "UNCERTAIN");
    const uncertainClaims = uncertain.map(describeUncertainRule);

    if (current.length === 0) {
        return { status: "UNCERTAIN", claims: uncertainClaims, clarification: null };
    }

    const currentClaims = current.map(describeRule);

    if (current.length > 1) {
        return { status: "AMBIGUOUS", claims: [...currentClaims, ...uncertainClaims], clarification: AMBIGUOUS_CLARIFICATION };
    }

    return { status: "ANSWERED", claims: [...currentClaims, ...uncertainClaims], clarification: null };
}

/**
 * Keeps only the model claims that cite known evidence and repeat only numbers present in that evidence.
 * Everything the model returns is untrusted; a malformed payload yields no claims.
 */
export function validateModelClaims(output: unknown, evidence: AnswerEvidence[]): { claims: AnswerClaim[]; dropped: number } {
    if (!isRecord(output) || !Array.isArray(output.claims)) {
        return { claims: [], dropped: 0 };
    }

    const evidenceById = new Map(evidence.map((item) => [item.id, item]));
    const claims: AnswerClaim[] = [];
    let dropped = 0;

    for (const candidate of output.claims.slice(0, MAX_CLAIMS)) {
        const claim = readClaim(candidate, evidenceById);

        if (claim) {
            claims.push(claim);
        } else {
            dropped += 1;
        }
    }

    return { claims, dropped };
}

export function formatMoney(amount: number): string {
    return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function readClaim(candidate: unknown, evidenceById: Map<string, AnswerEvidence>): AnswerClaim | null {
    if (!isRecord(candidate) || typeof candidate.text !== "string" || !Array.isArray(candidate.evidence_ids)) {
        return null;
    }

    const text = candidate.text.trim();
    const evidenceIds = candidate.evidence_ids.filter((id): id is string => typeof id === "string");

    if (text.length === 0 || text.length > MAX_CLAIM_LENGTH || evidenceIds.length === 0 || evidenceIds.length !== candidate.evidence_ids.length) {
        return null;
    }

    const cited = evidenceIds.map((id) => evidenceById.get(id));

    if (cited.some((item) => item === undefined)) {
        return null;
    }

    const allowedNumbers = new Set(cited.flatMap((item) => numbersIn(factsOf(item as AnswerEvidence))));

    if (numbersIn(text).some((value) => !allowedNumbers.has(value))) {
        return null;
    }

    return { text, evidenceIds: [...new Set(evidenceIds)] };
}

function factsOf(item: AnswerEvidence): string {
    return [
        item.behaviorText,
        item.fine ? `${item.fine.min} ${item.fine.max}` : "",
        item.validFrom ?? "",
        item.validTo ?? "",
        item.additionalPenalties.join(" "),
        item.source.documentNumber ?? "",
        item.vehicles.join(" "),
    ].join(" ");
}

function numbersIn(text: string): string[] {
    const withoutSeparators = text.replace(/(?<=\d)[.,](?=\d{3}(?!\d))/g, "");

    return (withoutSeparators.match(/\d+/g) ?? []).map((value) => String(Number(value)));
}

function describeRule(item: AnswerEvidence): AnswerClaim {
    const subject = describeContext(item);
    const penalty = item.fine ? `phạt tiền từ ${formatMoney(item.fine.min)} đồng đến ${formatMoney(item.fine.max)} đồng` : "chưa đọc được mức phạt tiền từ văn bản";
    const additional = item.additionalPenalties.length > 0 ? `; hình thức bổ sung: ${item.additionalPenalties.join("; ")}` : "";
    const period = describePeriod(item);

    return { text: `${subject}${cleanBehaviour(item.behaviorText)}: ${penalty}${additional}${period}.`, evidenceIds: [item.id] };
}

function describeUncertainRule(item: AnswerEvidence): AnswerClaim {
    const reasons = item.uncertaintyReasons.length > 0 ? item.uncertaintyReasons.join("; ") : "thiếu căn cứ pháp lý đã xác minh";

    return { text: `${describeContext(item)}${cleanBehaviour(item.behaviorText)}: chưa thể khẳng định quy định tại thời điểm này vì ${reasons}.`, evidenceIds: [item.id] };
}

function describeContext(item: AnswerEvidence): string {
    const parts = [...item.vehicles, item.subjectScope ? SUBJECT_LABELS[item.subjectScope] : ""].filter((part) => part.length > 0);

    return parts.length > 0 ? `Đối với ${parts.join(", ")}, hành vi "` : 'Hành vi "';
}

function cleanBehaviour(text: string): string {
    return `${text.replace(/[;.:,\s]+$/u, "")}"`;
}

function describePeriod(item: AnswerEvidence): string {
    if (item.validFrom && item.validTo) {
        return `; hiệu lực từ ${item.validFrom} đến ${item.validTo}`;
    }

    if (item.validFrom) {
        return `; hiệu lực từ ${item.validFrom}`;
    }

    return "";
}
