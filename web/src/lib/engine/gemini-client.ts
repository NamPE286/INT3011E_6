export const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const GEMINI_DECISION_MODEL = "gemini-decision-1";

export function isGeminiInvalidApiKeyError(input: unknown): boolean {
    const message = input instanceof Error
        ? input.message
        : typeof input === "string"
            ? input
            : "";
    if (!message) {
        return false;
    }

    return /api[_\s-]?key[_\s-]?invalid|api\s+key\s+(?:not\s+valid|is\s+invalid|expired)|invalid[_\s-]?api[_\s-]?key|api[_\s-]?key[_\s-]?expired|unauthenticated|unauthorized|\((?:401|403)\)|permission[_\s-]?denied/i.test(message);
}

export type GeminiUsage = {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
};

export type GeminiStructuredRequest = {
    apiKey: string;
    apiBaseUrl?: string;
    model?: string;
    systemInstruction: string;
    input: string | Record<string, unknown>[];
    schema: Record<string, unknown>;
    maxOutputTokens?: number;
    fetcher?: typeof fetch;
    signal?: AbortSignal;
};

export type DecisionQuestion =
    | {
        type: "noul";
        instructions: string;
        criteria?: { yes?: string; no?: string };
    }
    | {
        type: "choice";
        instructions: string;
        criteria: Record<string, string>;
    }
    | {
        type: "score";
        instructions: string;
        criteria: string[];
    };

export type DecisionAnswer =
    | { type: "noul"; noul: number; confidence: number }
    | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
    | { type: "score"; score: number; probabilities: Record<string, number>; confidence: number };

export type GeminiDecisionRequest = {
    apiKey: string;
    apiBaseUrl?: string;
    input: string | Record<string, unknown>[];
    questions: Record<string, DecisionQuestion>;
    fetcher?: typeof fetch;
    signal?: AbortSignal;
};

function normalizeGeminiBaseUrl(raw?: string): string {
    const trimmed = raw?.trim() ?? "";

    if (!trimmed || trimmed.includes("openai.com")) {
        return DEFAULT_GEMINI_BASE_URL;
    }

    return trimmed.replace(/\/+$/, "").replace(/\/v1(?:beta)?$/, "");
}

function extractGeminiOutputText(payload: Record<string, unknown>): string | null {
    const steps = Array.isArray(payload.steps) ? payload.steps : [];

    for (let i = steps.length - 1; i >= 0; i -= 1) {
        const step = steps[i];

        if (typeof step !== "object" || step === null) {
            continue;
        }

        const rec = step as { type?: unknown; content?: unknown };

        if (rec.type !== "model_output" || !Array.isArray(rec.content)) {
            continue;
        }

        const texts: string[] = [];

        for (const part of rec.content) {
            if (typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text") {
                const txt = (part as { text?: unknown }).text;

                if (typeof txt === "string") {
                    texts.push(txt);
                }
            }
        }

        if (texts.length > 0) {
            return texts.join("");
        }
    }

    if (typeof payload.output_text === "string" && payload.output_text.trim()) {
        return payload.output_text;
    }

    return null;
}

function extractGeminiUsage(payload: Record<string, unknown>): GeminiUsage {
    const usage = typeof payload.usage === "object" && payload.usage !== null
        ? (payload.usage as Record<string, unknown>)
        : {};
    const inputTokens = typeof usage.total_input_tokens === "number" ? usage.total_input_tokens : 0;
    const outputTokens = typeof usage.total_output_tokens === "number" ? usage.total_output_tokens : 0;
    const totalTokens = typeof usage.total_tokens === "number" ? usage.total_tokens : inputTokens + outputTokens;

    return { inputTokens, outputTokens, totalTokens };
}

async function fetchWithTransientRetry(
    url: string,
    init: RequestInit,
    fetcher: typeof fetch,
    allowRetry: boolean,
): Promise<Response> {
    const delays = allowRetry ? [1000, 2500] : [];

    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
        const res = await fetcher(url, init);

        if (res.ok || (res.status !== 503 && res.status !== 429) || attempt === delays.length) {
            return res;
        }

        await new Promise((resolveTimer) => setTimeout(resolveTimer, delays[attempt]));
    }

    return fetcher(url, init);
}

/**
 * Calls Gemini Interactions API (v1/interactions) with strict JSON schema output.
 */
export async function callGeminiStructuredInteraction(
    request: GeminiStructuredRequest,
): Promise<{ data: unknown; usage: GeminiUsage; rawText: string }> {
    const baseUrl = normalizeGeminiBaseUrl(request.apiBaseUrl);
    const model = request.model?.trim() || DEFAULT_GEMINI_MODEL;
    const fetcher = request.fetcher ?? fetch;

    const response = await fetchWithTransientRetry(`${baseUrl}/v1/interactions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": request.apiKey.trim(),
        },
        signal: request.signal,
        body: JSON.stringify({
            model,
            system_instruction: request.systemInstruction,
            input: request.input,
            store: false,
            generation_config: {
                max_output_tokens: request.maxOutputTokens ?? 1200,
            },
            response_format: {
                type: "text",
                mime_type: "application/json",
                schema: request.schema,
            },
        }),
    }, fetcher, !request.fetcher);

    if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`Gemini API lỗi (${response.status}): ${errText.slice(0, 180) || "Kiểm tra lại API Key / Model"}`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const rawText = extractGeminiOutputText(payload);

    if (!rawText) {
        throw new Error("Gemini API không trả về nội dung JSON hợp lệ.");
    }

    const usage = extractGeminiUsage(payload);

    return {
        data: JSON.parse(rawText) as unknown,
        usage,
        rawText,
    };
}

/**
 * Calls Gemini Decisions API (v1beta/decisions) with gemini-decision-1 (0 output tokens).
 */
export async function callGeminiDecisions(
    request: GeminiDecisionRequest,
): Promise<{ answers: Record<string, DecisionAnswer>; usage: GeminiUsage }> {
    const baseUrl = normalizeGeminiBaseUrl(request.apiBaseUrl);
    const fetcher = request.fetcher ?? fetch;
    const sanitizedQuestions: Record<string, Record<string, unknown>> = {};

    for (const [key, question] of Object.entries(request.questions)) {
        if (question.type === "noul") {
            sanitizedQuestions[key] = {
                type: "noul",
                instructions: question.instructions,
            };
        } else {
            sanitizedQuestions[key] = question;
        }
    }

    const response = await fetchWithTransientRetry(`${baseUrl}/v1beta/decisions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": request.apiKey.trim(),
        },
        signal: request.signal,
        body: JSON.stringify({
            model: GEMINI_DECISION_MODEL,
            input: request.input,
            questions: sanitizedQuestions,
        }),
    }, fetcher, !request.fetcher);

    if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`Gemini Decisions API lỗi (${response.status}): ${errText.slice(0, 180) || "Kiểm tra lại API Key"}`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const answers = (typeof payload.answers === "object" && payload.answers !== null
        ? payload.answers
        : {}) as Record<string, DecisionAnswer>;
    const usage = extractGeminiUsage(payload);

    return { answers, usage };
}
