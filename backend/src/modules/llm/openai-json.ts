const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

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
 * One strict-JSON-schema call to the OpenAI Responses API. The parsed value is still untrusted:
 * callers must validate every field against their own data before using it.
 */
export async function requestStructuredJson(request: StructuredJsonRequest): Promise<unknown> {
    const fetcher = request.fetcher ?? fetch;
    const response = await fetcher(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${request.apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: request.model,
            max_output_tokens: request.maxOutputTokens,
            text: {
                format: {
                    type: "json_schema",
                    name: request.schemaName,
                    strict: true,
                    schema: request.schema,
                },
            },
            input: [
                { role: "system", content: request.systemPrompt },
                { role: "user", content: [{ type: "input_text", text: request.userText }] },
            ],
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

    if (body.status === "incomplete") {
        throw new InvalidModelOutputError("LLM output is incomplete");
    }

    const outputItems = Array.isArray(body.output) ? body.output : [];

    for (const item of outputItems) {
        if (!isRecord(item) || item.type !== "message" || !Array.isArray(item.content)) {
            continue;
        }

        for (const part of item.content) {
            if (isRecord(part) && part.type === "refusal") {
                throw new InvalidModelOutputError("LLM refused the request");
            }

            if (isRecord(part) && part.type === "output_text" && typeof part.text === "string") {
                return part.text;
            }
        }
    }

    throw new InvalidModelOutputError("LLM response has no output text");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
