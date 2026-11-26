import type { Message, MessageBatch } from "@cloudflare/workers-types";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "../src/app";
import { handleProcessingBatch } from "../src/modules/processing/processing.consumer";
import type { BlockKind, TranscribedBlock } from "../src/modules/processing/legal-types";
import type { ProcessingQueueMessage } from "../src/types/env";
import { block, geminiInteractionResponse, goodPages, type FakeChunk } from "./openai-fake";
import { withEnv, type MockEnvironment } from "./mocks";

/** The invented decrees in test/fixtures/synthetic-law: each JSON is both the PDF wording and what the fake reader returns. */
export const FAKE_DECREES = ["nd-01-2030", "nd-02-2032"] as const;

export type FakeDecree = (typeof FAKE_DECREES)[number];

type DecreeBlock = {
    kind: BlockKind;
    number?: string;
    title?: string;
    text?: string;
};

type DecreeSource = {
    id: string;
    pages: DecreeBlock[][];
};

const FAKE_LAW_DIR = join(import.meta.dir, "fixtures/synthetic-law");

export function readFakeDecreePdf(decree: FakeDecree): Uint8Array<ArrayBuffer> {
    return new Uint8Array(readFileSync(join(FAKE_LAW_DIR, `${decree}.pdf`)));
}

/** The whole decree as one transcribed chunk (every fake decree fits in the default 3-page chunk). */
export function transcribeFakeDecree(decree: FakeDecree): FakeChunk {
    const source = JSON.parse(readFileSync(join(FAKE_LAW_DIR, `${decree}.json`), "utf-8")) as DecreeSource;
    const blocks: TranscribedBlock[] = source.pages.flatMap((pageBlocks, pageIndex) =>
        pageBlocks.map((decreeBlock) =>
            block(decreeBlock.kind, {
                number: decreeBlock.number ?? null,
                title: decreeBlock.title ?? null,
                text: decreeBlock.text ?? null,
                page: pageIndex + 1,
            }),
        ),
    );

    return { pages: goodPages(source.pages.length), blocks };
}

export function request(env: MockEnvironment, path: string, init?: RequestInit): Promise<Response> {
    return Promise.resolve(app.fetch(withEnv(new Request(`http://localhost${path}`, init), env)));
}

export async function uploadFakeDecree(env: MockEnvironment, decree: FakeDecree): Promise<string> {
    const form = new FormData();
    form.append("file", new File([readFakeDecreePdf(decree)], `${decree}.pdf`, { type: "application/pdf" }));

    const response = await request(env, "/api/uploads", { method: "POST", body: form });

    if (response.status !== 200) {
        throw new Error(`Upload of ${decree} failed with ${response.status}: ${await response.text()}`);
    }

    const body = (await response.json()) as { jobId: string };

    return body.jobId;
}

function isPdfTranscriptionRequest(init?: RequestInit): boolean {
    try {
        const parsed: unknown = JSON.parse(String(init?.body ?? "{}"));

        if (typeof parsed !== "object" || parsed === null || !("input" in parsed)) {
            return false;
        }

        const input = (parsed as { input?: unknown }).input;

        if (!Array.isArray(input)) {
            return false;
        }

        return input.some(
            (part) =>
                typeof part === "object"
                && part !== null
                && (part as { type?: unknown }).type === "document",
        );
    } catch {
        return false;
    }
}

/**
 * Delivers queued messages like the Workers runtime, with the Gemini Interactions boundary faked: PDF reads
 * return the decree's transcription. Preprocessing stages run without a key, so they take the deterministic
 * path; any other model call is refused.
 */
export async function drainQueueReading(env: MockEnvironment, decree: FakeDecree): Promise<void> {
    const realFetch = globalThis.fetch;
    const transcription = transcribeFakeDecree(decree);

    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
        if (!isPdfTranscriptionRequest(init)) {
            return Response.json({ error: { message: "model calls are disabled in this test" } }, { status: 400 });
        }

        return geminiInteractionResponse(transcription);
    }) as unknown as typeof fetch;

    try {
        while (env.queueMessages.length > 0) {
            const body = env.queueMessages.shift()!;
            const message = { body, ack() {}, retry() {} } as unknown as Message<ProcessingQueueMessage>;

            const target = body.stage === undefined
                ? env
                : { ...env, GEMINI_API_KEY: undefined, OPENAI_API_KEY: undefined };

            await handleProcessingBatch({ messages: [message] } as unknown as MessageBatch<ProcessingQueueMessage>, target);
        }
    } finally {
        globalThis.fetch = realFetch;
    }
}

export async function importFakeDecree(env: MockEnvironment, decree: FakeDecree): Promise<string> {
    const jobId = await uploadFakeDecree(env, decree);

    await drainQueueReading(env, decree);

    return jobId;
}
