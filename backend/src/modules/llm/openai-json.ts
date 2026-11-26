const GEMINI_INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1/interactions";
const GEMINI_DECISIONS_URL = "https://generativelanguage.googleapis.com/v1beta/decisions";

export type StructuredJsonRequest = {
    apiKey: string;
    model: string;
    schemaName: string;
    schema: Record<string, unknown>;
    systemPrompt: string;
    userText: string;
    maxOutputTokens: number;
    fetcher?: typeof fetch;
};

/** The provider answered, but not with usable JSON (refusal, truncation, malformed output). */
export class InvalidModelOutputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidModelOutputError";
    }
}

/**
 * One strict-JSON-schema call to the Gemini Interactions API (v1/interactions).
 * The parsed value is still untrusted: callers must validate every field before using it.
 */
export async function requestStructuredJson(request: StructuredJsonRequest): Promise<unknown> {
    const fetcher = request.fetcher ?? fetch;
    const response = await fetcher(GEMINI_INTERACTIONS_URL, {
        method: "POST",
        headers: {
            "x-goog-api-key": request.apiKey,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: request.model,
            system_instruction: request.systemPrompt,
            input: request.userText,
            store: false,
            generation_config: {
                max_output_tokens: request.maxOutputTokens,
            },
            response_format: {
                type: "text",
                mime_type: "application/json",
                schema: request.schema,
            },
        }),
    });

    if (!response.ok) {
        throw new Error(`LLM HTTP ${response.status}: ${await readProviderMessage(response)}`);
    }

    const outputText = readOutputText(await response.json());

    try {
        return JSON.parse(outputText);
    } catch {
        throw new InvalidModelOutputError("LLM output is not valid JSON");
    }
}

export async function requestDecisions(request: {
    apiKey: string;
    input: string;
    questions: Record<string, unknown>;
    fetcher?: typeof fetch;
}): Promise<Record<string, unknown>> {
    const fetcher = request.fetcher ?? fetch;
    const response = await fetcher(GEMINI_DECISIONS_URL, {
        method: "POST",
        headers: {
            "x-goog-api-key": request.apiKey,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "gemini-decision-1",
            input: request.input,
            questions: request.questions,
        }),
    });

    if (!response.ok) {
        throw new Error(`Decisions HTTP ${response.status}: ${await readProviderMessage(response)}`);
    }

    const body = (await response.json()) as unknown;

    return isRecord(body) ? body : {};
}

async function readProviderMessage(response: Response): Promise<string> {
    try {
        const body: unknown = await response.json();

        if (isRecord(body) && isRecord(body.error) && typeof body.error.message === "string") {
            return body.error.message.slice(0, 300);
        }
    } catch {
        return "unreadable error response";
    }

    return "unknown error";
}

function readOutputText(body: unknown): string {
    if (!isRecord(body)) {
        throw new InvalidModelOutputError("LLM response is not an object");
    }

    if (body.status === "incomplete" || body.status === "failed") {
        throw new InvalidModelOutputError(`LLM output status: ${String(body.status)}`);
    }

    const steps = Array.isArray(body.steps) ? body.steps : [];

    for (let i = steps.length - 1; i >= 0; i -= 1) {
        const step = steps[i];

        if (!isRecord(step) || step.type !== "model_output" || !Array.isArray(step.content)) {
            continue;
        }

        const texts: string[] = [];

        for (const part of step.content) {
            if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
                texts.push(part.text);
            }
        }

        if (texts.length > 0) {
            return texts.join("");
        }
    }

    if (typeof body.output_text === "string" && body.output_text.trim()) {
        return body.output_text;
    }

    throw new InvalidModelOutputError("LLM response has no output text");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
