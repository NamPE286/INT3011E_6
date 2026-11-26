import type { PageReport, TranscribedBlock } from "../src/modules/processing/legal-types";

export type FakeChunk = {
    pages: PageReport[];
    blocks: TranscribedBlock[];
};

export type FakeReply = FakeChunk | Response | string;

/** Builds a mock Gemini Interactions API response with a text payload. */
export function geminiInteractionResponse(payload: unknown): Response {
    const outputText = typeof payload === "string" ? payload : JSON.stringify(payload);

    return Response.json({
        status: "completed",
        steps: [{ type: "model_output", content: [{ type: "text", text: outputText }] }],
    });
}

/** Extracts the user text sent in a Gemini Interactions request body (`input` as string or content-part array). */
export function readInteractionUserText(init?: RequestInit): string {
    const parsed: unknown = JSON.parse(String(init?.body ?? "{}"));

    if (typeof parsed !== "object" || parsed === null || !("input" in parsed)) {
        return "";
    }

    const input = (parsed as { input?: unknown }).input;

    if (typeof input === "string") {
        return input;
    }

    if (Array.isArray(input)) {
        const textPart = input.find(
            (part): part is { type: string; text: string } =>
                typeof part === "object"
                && part !== null
                && (part as { type?: unknown }).type === "text"
                && typeof (part as { text?: unknown }).text === "string",
        );

        return textPart?.text ?? "";
    }

    return "";
}

/** Fake Gemini Interactions API keyed by the chunk range ("1-2"); page numbers are chunk-relative. */
export function createFakeOpenAi(replies: Record<string, FakeReply | FakeReply[]>) {
    const calls: string[] = [];

    const fetcher = (async (_url: unknown, init?: RequestInit) => {
        const textPart = readInteractionUserText(init);
        const rangeMatch = /pages-(\d+-\d+)\.pdf/.exec(textPart);
        const range = rangeMatch?.[1] ?? "1-1";
        calls.push(range);

        const scripted = replies[range];
        const reply = Array.isArray(scripted) ? scripted.shift() : scripted;

        if (reply === undefined) {
            throw new Error(`No fake reply scripted for pages ${range}`);
        }

        if (reply instanceof Response) {
            return reply;
        }

        return geminiInteractionResponse(reply);
    }) as unknown as typeof fetch;

    return { fetcher, calls };
}

export function block(
    kind: TranscribedBlock["kind"],
    fields: Partial<TranscribedBlock> & { page?: number } = {},
): TranscribedBlock {
    const page = fields.page ?? 1;
    const number = fields.number ?? null;

    return {
        kind,
        marker: fields.marker ?? markerFor(kind, number),
        number,
        title: fields.title ?? null,
        text: fields.text ?? null,
        page_start: fields.page_start ?? page,
        page_end: fields.page_end ?? page,
        continues_previous: fields.continues_previous ?? false,
        quality: fields.quality ?? "GOOD",
    };
}

export function goodPages(count: number): PageReport[] {
    return Array.from({ length: count }, (_, index) => ({ page: index + 1, quality: "GOOD" as const, note: null }));
}

function markerFor(kind: TranscribedBlock["kind"], number: string | null): string | null {
    if (number === null) {
        return null;
    }

    const markers: Partial<Record<TranscribedBlock["kind"], string>> = {
        part: `Phần ${number}`,
        chapter: `Chương ${number}`,
        section: `Mục ${number}`,
        article: `Điều ${number}.`,
        clause: `${number}.`,
        point: `${number})`,
    };

    return markers[kind] ?? null;
}
