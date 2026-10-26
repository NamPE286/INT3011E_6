import type { CorpusScope } from "../history/history.service";
import type { RuleStatus } from "../history/history.types";

export const ASK_PROMPT_VERSION = "grounded-answer-v1";

export type AnswerStatus = "ANSWERED" | "AMBIGUOUS" | "UNCERTAIN" | "NO_ANSWER";

export type AnswerEvidence = {
    /** Short id the claims cite ("E1"); only valid inside one answer. */
    id: string;
    violationId: string;
    violationName: string;
    ruleId: string;
    status: RuleStatus;
    behaviorText: string;
    subjectScope: "INDIVIDUAL" | "ORGANIZATION" | null;
    vehicles: string[];
    fine: { min: number; max: number } | null;
    additionalPenalties: string[];
    validFrom: string | null;
    validTo: string | null;
    uncertaintyReasons: string[];
    source: {
        documentId: string;
        documentNumber: string | null;
        documentTitle: string | null;
        provisionId: string;
    };
};

export type AnswerClaim = {
    text: string;
    evidenceIds: string[];
};

export type ComposedAnswer = {
    status: AnswerStatus;
    claims: AnswerClaim[];
    clarification: string | null;
};

export type AnswerProvenance = {
    method: "RULE_ONLY" | "LLM";
    model: string | null;
    promptVersion: string | null;
    retrievedViolationIds: string[];
    droppedClaims: number;
    fallbackReason: string | null;
};

export type AskAnswer = ComposedAnswer & {
    question: string;
    asOf: string;
    evidence: AnswerEvidence[];
    scope: CorpusScope;
    provenance: AnswerProvenance;
};
