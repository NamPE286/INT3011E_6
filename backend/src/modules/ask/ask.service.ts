import type { D1Database } from "@cloudflare/workers-types";
import { readScope } from "../history/history.service";
import { composeAnswer, validateModelClaims } from "./ask.answer";
import { requestAnswerClaims } from "./ask.llm";
import { collectEvidence, retrieveViolations, retrieveViolationsWithModel, type RetrievedViolation } from "./ask.retrieval";
import { ASK_PROMPT_VERSION, type AnswerClaim, type AnswerEvidence, type AnswerProvenance, type AskAnswer } from "./ask.types";

export type AskInput = {
    question: string;
    asOf: string;
};

export type AskOptions = {
    apiKey?: string;
    model: string;
    fetcher?: typeof fetch;
};

type ModelOutcome = { claims: AnswerClaim[]; dropped: number; fallbackReason: string | null };

/**
 * FR-16.2/16.3: retrieves the matching rules first, derives status and clarification from them without a
 * model, and lets the model only rephrase claims that cite that evidence. Without a usable model answer
 * the rule-based claims are returned.
 */
export async function answerQuestion(db: D1Database, input: AskInput, options: AskOptions): Promise<AskAnswer> {
    const { retrieved, retrievalMethod } = await retrieve(db, input.question, options);
    const evidence = await collectEvidence(db, retrieved, input.question, input.asOf);
    const composed = composeAnswer(evidence);
    const scope = await readScope(db, []);
    const base = { question: input.question, asOf: input.asOf, evidence, scope };
    const retrievedViolationIds = retrieved.map((entry) => entry.violation.id);

    if (!options.apiKey || composed.claims.length === 0) {
        return { ...base, ...composed, provenance: ruleOnlyProvenance(retrievalMethod, retrievedViolationIds, 0, null) };
    }

    const outcome = await phraseWithModel(input, evidence, { ...options, apiKey: options.apiKey });

    if (outcome.fallbackReason) {
        return { ...base, ...composed, provenance: ruleOnlyProvenance(retrievalMethod, retrievedViolationIds, outcome.dropped, outcome.fallbackReason) };
    }

    return {
        ...base,
        ...composed,
        claims: outcome.claims,
        provenance: {
            method: "LLM",
            model: options.model,
            promptVersion: ASK_PROMPT_VERSION,
            retrievalMethod,
            retrievedViolationIds,
            droppedClaims: outcome.dropped,
            fallbackReason: null,
        },
    };
}

async function phraseWithModel(input: AskInput, evidence: AnswerEvidence[], options: AskOptions & { apiKey: string }): Promise<ModelOutcome> {
    try {
        const output = await requestAnswerClaims({ question: input.question, asOf: input.asOf, evidence, apiKey: options.apiKey, model: options.model, fetcher: options.fetcher });
        const { claims, dropped } = validateModelClaims(output, evidence);

        if (claims.length === 0) {
            return { claims, dropped, fallbackReason: "Model returned no claim that is supported by the evidence" };
        }

        const cited = new Set(claims.flatMap((claim) => claim.evidenceIds));

        if (evidence.some((item) => !cited.has(item.id))) {
            return { claims, dropped, fallbackReason: "Model claims do not cover all evidence" };
        }

        return { claims, dropped, fallbackReason: null };
    } catch (error: unknown) {
        console.error("[Ask] Model call failed", error instanceof Error ? error.message : "unknown error");

        return { claims: [], dropped: 0, fallbackReason: "Model call failed" };
    }
}

/** Word matching first; only when it finds nothing, and a model is configured, the model picks from the stored behaviours. */
async function retrieve(db: D1Database, question: string, options: AskOptions): Promise<{ retrieved: RetrievedViolation[]; retrievalMethod: AnswerProvenance["retrievalMethod"] }> {
    const lexical = await retrieveViolations(db, question);

    if (lexical.length > 0 || !options.apiKey) {
        return { retrieved: lexical, retrievalMethod: "LEXICAL" };
    }

    const chosen = await retrieveViolationsWithModel(db, question, { apiKey: options.apiKey, model: options.model, fetcher: options.fetcher });

    return chosen.length > 0 ? { retrieved: chosen, retrievalMethod: "MODEL" } : { retrieved: [], retrievalMethod: "LEXICAL" };
}

function ruleOnlyProvenance(
    retrievalMethod: AnswerProvenance["retrievalMethod"],
    retrievedViolationIds: string[],
    droppedClaims: number,
    fallbackReason: string | null,
): AnswerProvenance {
    return { method: "RULE_ONLY", model: null, promptVersion: null, retrievalMethod, retrievedViolationIds, droppedClaims, fallbackReason };
}
