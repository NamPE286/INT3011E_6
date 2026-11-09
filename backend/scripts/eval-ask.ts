/**
 * Evaluates the AI answer endpoint (/api/ask) of a running backend on a labelled question set.
 *
 *   bun run eval:ask                                   # data/eval/ask-fake-law-v1.json against http://localhost:8787
 *   bun run eval:ask -- --repeat 3 --out <report.json> # ask each question 3 times to measure stability
 *   bun run eval:ask -- --url <backend> --dataset <file> --model <id>
 *
 * The backend must already hold the dataset's documents (upload them through /admin first).
 * A money amount in a claim counts as grounded only when it is a fine bound of evidence that claim cites.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type AnswerStatus = "ANSWERED" | "AMBIGUOUS" | "UNCERTAIN" | "NO_ANSWER";

type LabelledQuestion = {
    id: string;
    question: string;
    as_of: string;
    accept_status: AnswerStatus[];
    expect_violation: string | null;
    expect_amounts: number[];
    expect_terms: string[];
};

type AskDataset = {
    dataset: string;
    version: number;
    questions: LabelledQuestion[];
};

type Evidence = {
    id: string;
    violationName: string;
    fine: { min: number; max: number } | null;
};

type Claim = {
    text: string;
    evidenceIds: string[];
};

type Answer = {
    status: string;
    claims: Claim[];
    evidence: Evidence[];
    retrievalMethod: string | null;
};

type AttemptScore = {
    status: string;
    statusCorrect: boolean;
    retrievalHit: boolean | null;
    amountsFound: boolean | null;
    termsFound: boolean | null;
    claims: number;
    claimsWithValidCitation: number;
    amountsMentioned: number;
    amountsGrounded: number;
    retrievalMethod: string | null;
    latencyMs: number;
    claimText: string;
    error: string | null;
};

const args = process.argv.slice(2);
const datasetPath = readArg("--dataset") ?? join(import.meta.dir, "../../data/eval/ask-fake-law-v1.json");
const backendUrl = (readArg("--url") ?? "http://localhost:8787").replace(/\/$/, "");
const repeat = Number(readArg("--repeat") ?? "1");
const model = readArg("--model");
const outPath = readArg("--out");

const dataset = JSON.parse(readFileSync(datasetPath, "utf-8")) as AskDataset;
const startedAt = Date.now();
const results = [];

for (const item of dataset.questions) {
    const attempts: AttemptScore[] = [];

    for (let attempt = 0; attempt < repeat; attempt++) {
        attempts.push(await askAndScore(item));
    }

    results.push({ id: item.id, question: item.question, asOf: item.as_of, acceptStatus: item.accept_status, attempts });
    console.error(`${item.id}: ${attempts.map((score) => `${score.status}${score.statusCorrect ? "" : " ✗"} ${score.latencyMs}ms`).join(" | ")}`);
}

const allAttempts = results.flatMap((result) => result.attempts);
const report = {
    dataset: `${dataset.dataset}@${dataset.version}`,
    backendUrl,
    model: model ?? "server default",
    repeat,
    runtimeMs: Date.now() - startedAt,
    metrics: {
        questions: results.length,
        attempts: allAttempts.length,
        statusAccuracy: ratio(count(allAttempts, (score) => score.statusCorrect), allAttempts.length),
        retrievalHitRate: rateOf(allAttempts.map((score) => score.retrievalHit)),
        fineCorrectRate: rateOf(allAttempts.map((score) => score.amountsFound)),
        expectedTermRate: rateOf(allAttempts.map((score) => score.termsFound)),
        claimCitationValidity: ratio(sum(allAttempts, (score) => score.claimsWithValidCitation), sum(allAttempts, (score) => score.claims)),
        groundedAmountRate: ratio(sum(allAttempts, (score) => score.amountsGrounded), sum(allAttempts, (score) => score.amountsMentioned)),
        stableStatusRate: ratio(count(results, (result) => new Set(result.attempts.map((score) => score.status)).size === 1), results.length),
        latencyMs: summarizeLatency(allAttempts.map((score) => score.latencyMs)),
        errors: count(allAttempts, (score) => score.error !== null),
    },
    failures: results
        .flatMap((result) => result.attempts.map((score) => ({ id: result.id, question: result.question, asOf: result.asOf, ...score })))
        .filter((score) => !isPassing(score)),
    results,
};

console.log(JSON.stringify(report, null, 2));

if (outPath) {
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
}

async function askAndScore(item: LabelledQuestion): Promise<AttemptScore> {
    const started = Date.now();
    const answer = await ask(item);
    const latencyMs = Date.now() - started;

    if (typeof answer === "string") {
        return emptyScore(latencyMs, answer);
    }

    const evidenceById = new Map(answer.evidence.map((evidence) => [evidence.id, evidence]));
    const claimText = answer.claims.map((claim) => claim.text).join(" ");
    const claimAmounts = new Set(readMoneyAmounts(claimText));
    let claimsWithValidCitation = 0;
    let amountsMentioned = 0;
    let amountsGrounded = 0;

    for (const claim of answer.claims) {
        const cited = claim.evidenceIds.map((evidenceId) => evidenceById.get(evidenceId)).filter((evidence) => evidence !== undefined);

        if (claim.evidenceIds.length > 0 && cited.length === claim.evidenceIds.length) {
            claimsWithValidCitation++;
        }

        const citedBounds = new Set(cited.flatMap((evidence) => (evidence.fine ? [evidence.fine.min, evidence.fine.max] : [])));

        for (const amount of readMoneyAmounts(claim.text)) {
            amountsMentioned++;

            if (citedBounds.has(amount)) {
                amountsGrounded++;
            }
        }
    }

    const normalizedClaims = claimText.toLowerCase();
    const expectedViolation = item.expect_violation?.toLowerCase() ?? null;

    return {
        status: answer.status,
        statusCorrect: item.accept_status.some((status) => status === answer.status),
        retrievalHit: expectedViolation === null ? null : answer.evidence.some((evidence) => evidence.violationName.toLowerCase().includes(expectedViolation)),
        amountsFound: item.expect_amounts.length === 0 ? null : item.expect_amounts.every((amount) => claimAmounts.has(amount)),
        termsFound: item.expect_terms.length === 0 ? null : item.expect_terms.every((term) => normalizedClaims.includes(term.toLowerCase())),
        claims: answer.claims.length,
        claimsWithValidCitation,
        amountsMentioned,
        amountsGrounded,
        retrievalMethod: answer.retrievalMethod,
        latencyMs,
        claimText,
        error: null,
    };
}

async function ask(item: LabelledQuestion): Promise<Answer | string> {
    try {
        const response = await fetch(`${backendUrl}/api/ask`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ question: item.question, as_of: item.as_of, model: model ?? undefined }),
        });

        if (!response.ok) {
            return `HTTP ${response.status}`;
        }

        const answer = parseAnswer(await response.json());

        return answer ?? "invalid answer body";
    } catch (error) {
        return error instanceof Error ? error.message : "request failed";
    }
}

function parseAnswer(body: unknown): Answer | null {
    if (!isRecord(body) || typeof body.status !== "string" || !Array.isArray(body.claims) || !Array.isArray(body.evidence)) {
        return null;
    }

    const claims = body.claims.filter(isRecord).map((claim) => ({
        text: typeof claim.text === "string" ? claim.text : "",
        evidenceIds: Array.isArray(claim.evidenceIds) ? claim.evidenceIds.filter((evidenceId) => typeof evidenceId === "string") : [],
    }));
    const evidence = body.evidence.filter(isRecord).map((entry) => ({
        id: typeof entry.id === "string" ? entry.id : "",
        violationName: typeof entry.violationName === "string" ? entry.violationName : "",
        fine: readFine(entry.fine),
    }));
    const provenance = isRecord(body.provenance) ? body.provenance : {};
    const retrievalMethod = typeof provenance.retrievalMethod === "string" ? provenance.retrievalMethod : null;

    return { status: body.status, claims, evidence, retrievalMethod };
}

function readFine(value: unknown): { min: number; max: number } | null {
    if (!isRecord(value) || typeof value.min !== "number" || typeof value.max !== "number") {
        return null;
    }

    return { min: value.min, max: value.max };
}

/** Reads amounts written like "400.000" or "3.000.000"; plain numbers (dates, months, km/h) are ignored. */
function readMoneyAmounts(text: string): number[] {
    const matches = text.match(/\d{1,3}(?:\.\d{3})+/g) ?? [];

    return matches.map((match) => Number(match.replaceAll(".", "")));
}

function isPassing(score: AttemptScore): boolean {
    if (!score.statusCorrect || score.error !== null) {
        return false;
    }

    if (score.retrievalHit === false || score.amountsFound === false || score.termsFound === false) {
        return false;
    }

    return score.amountsGrounded === score.amountsMentioned;
}

function emptyScore(latencyMs: number, error: string): AttemptScore {
    return {
        status: "ERROR",
        statusCorrect: false,
        retrievalHit: null,
        amountsFound: null,
        termsFound: null,
        claims: 0,
        claimsWithValidCitation: 0,
        amountsMentioned: 0,
        amountsGrounded: 0,
        retrievalMethod: null,
        latencyMs,
        claimText: "",
        error,
    };
}

function summarizeLatency(values: number[]): { p50: number; p90: number; max: number; mean: number } {
    const sorted = [...values].sort((left, right) => left - right);
    const at = (fraction: number): number => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? 0;

    return { p50: at(0.5), p90: at(0.9), max: sorted[sorted.length - 1] ?? 0, mean: Math.round(sum(values, (value) => value) / Math.max(values.length, 1)) };
}

function rateOf(values: (boolean | null)[]): number | null {
    const applicable = values.filter((value) => value !== null);

    if (applicable.length === 0) {
        return null;
    }

    return ratio(count(applicable, (value) => value), applicable.length);
}

function count<T>(items: T[], predicate: (item: T) => boolean): number {
    return items.filter(predicate).length;
}

function sum<T>(items: T[], value: (item: T) => number): number {
    return items.reduce((total, item) => total + value(item), 0);
}

function ratio(part: number, whole: number): number {
    if (whole === 0) {
        return 0;
    }

    return Math.round((part / whole) * 1000) / 1000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readArg(name: string): string | null {
    const index = args.indexOf(name);

    if (index === -1) {
        return null;
    }

    return args[index + 1] ?? null;
}
