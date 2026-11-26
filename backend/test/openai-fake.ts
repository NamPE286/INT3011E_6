import type { PageReport, TranscribedBlock } from "../src/modules/processing/legal-types";

export type FakeChunk = {
    pages: PageReport[];
    blocks: TranscribedBlock[];
};

export type FakeReply = FakeChunk | Response | string;

/** Fake Gemini Interactions API keyed by the chunk range ("1-2"); page numbers are chunk-relative. */
export function createFakeOpenAi(replies: Record<string, FakeReply | FakeReply[]>) {
    const calls: string[] = [];

    const fetcher = (async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
            input: { type?: string; text?: string }[];
        };
        const textPart = Array.isArray(body.input)
            ? body.input.find((part) => part.type === "text" && typeof part.text === "string")?.text ?? ""
            : "";
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

        const outputText = typeof reply === "string" ? reply : JSON.stringify(reply);

        return Response.json({
            status: "completed",
            steps: [{ type: "model_output", content: [{ type: "text", text: outputText }] }],
        });
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
