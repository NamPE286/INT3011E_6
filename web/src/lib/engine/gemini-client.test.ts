import { describe, expect, it } from "bun:test";
import { isGeminiInvalidApiKeyError } from "./gemini-client";
import { runNeuroSymbolicAudit } from "./llm-neurosymbolic";
import { parseDraftDocument } from "./parser";

describe("isGeminiInvalidApiKeyError", () => {
    it("detects Gemini 400 API_KEY_INVALID and invalid/expired key messages", () => {
        expect(isGeminiInvalidApiKeyError(new Error("Gemini API error (400): API key not valid. Please pass a valid API key. API_KEY_INVALID"))).toBe(true);
        expect(isGeminiInvalidApiKeyError("API key expired. Please renew the API key.")).toBe(true);
        expect(isGeminiInvalidApiKeyError("Gemini API error (401): UNAUTHENTICATED")).toBe(true);
        expect(isGeminiInvalidApiKeyError("Gemini API error (403): PERMISSION_DENIED")).toBe(true);
    });

    it("does not flag transient errors like 429, 503, or network timeouts", () => {
        expect(isGeminiInvalidApiKeyError(new Error("Gemini API error (429): RESOURCE_EXHAUSTED"))).toBe(false);
        expect(isGeminiInvalidApiKeyError(new Error("Gemini API error (503): UNAVAILABLE"))).toBe(false);
        expect(isGeminiInvalidApiKeyError("Failed to fetch")).toBe(false);
        expect(isGeminiInvalidApiKeyError(null)).toBe(false);
    });
});

describe("runNeuroSymbolicAudit fail-fast on invalid API key", () => {
    it("stops immediately without retrying fallback models when API_KEY_INVALID is returned", async () => {
        let fetchCalls = 0;
        const mockFetcher = (async () => {
            fetchCalls += 1;

            return new Response(
                JSON.stringify({
                    error: {
                        code: 400,
                        message: "API key not valid. Please pass a valid API key.",
                        status: "INVALID_ARGUMENT",
                        details: [{ reason: "API_KEY_INVALID" }],
                    },
                }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }) as unknown as typeof fetch;

        const draft = parseDraftDocument("Điều 1. Phạm vi\n1. Tổ chức, cá nhân vi phạm sẽ bị xử phạt.");
        const result = await runNeuroSymbolicAudit(draft, {
            apiKey: "AIzaSyInvalidKey",
            useDecisionApi: false,
            fetcher: mockFetcher,
        });

        expect(fetchCalls).toBe(1);
        expect(result.error).not.toBeNull();
        expect(isGeminiInvalidApiKeyError(result.error)).toBe(true);
    });
});
