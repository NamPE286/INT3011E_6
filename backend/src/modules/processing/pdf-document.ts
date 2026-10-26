import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream, type PDFObject } from "pdf-lib";

export const MAX_PDF_PAGES = 300;

export type PageRange = {
    pageStart: number;
    pageEnd: number;
};

export class InvalidPdfError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidPdfError";
    }
}

export async function loadPdf(pdfBytes: ArrayBuffer): Promise<PDFDocument> {
    const header = new TextDecoder().decode(pdfBytes.slice(0, 5));

    if (header !== "%PDF-") {
        throw new InvalidPdfError("File does not have a valid PDF header");
    }

    let pdf: PDFDocument;
    let pageCount: number;

    try {
        pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false });
        pageCount = pdf.getPageCount();
    } catch (error: unknown) {
        if (error instanceof Error && error.name === "EncryptedPDFError") {
            throw new InvalidPdfError("Encrypted or password-protected PDFs are not supported");
        }

        throw new InvalidPdfError("PDF structure cannot be parsed");
    }

    if (pageCount === 0) {
        throw new InvalidPdfError("PDF has no pages");
    }

    if (pageCount > MAX_PDF_PAGES) {
        throw new InvalidPdfError(`PDF has ${pageCount} pages; the limit is ${MAX_PDF_PAGES}`);
    }

    return pdf;
}

export function planPageRanges(pageCount: number, pagesPerChunk: number): PageRange[] {
    const ranges: PageRange[] = [];

    for (let pageStart = 1; pageStart <= pageCount; pageStart += pagesPerChunk) {
        ranges.push({
            pageStart,
            pageEnd: Math.min(pageCount, pageStart + pagesPerChunk - 1),
        });
    }

    return ranges;
}

/** Copies pages unchanged (no rendering or OCR) so the LLM reads exactly the snapshot pages. */
export async function extractPageRange(source: PDFDocument, range: PageRange): Promise<Uint8Array> {
    const chunk = await PDFDocument.create();
    const pageIndexes: number[] = [];

    for (let page = range.pageStart; page <= range.pageEnd; page++) {
        pageIndexes.push(page - 1);
    }

    const copiedPages = await chunk.copyPages(source, pageIndexes);

    for (const page of copiedPages) {
        chunk.addPage(page);
    }

    return chunk.save();
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", bytes);

    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Text-showing operators with their string operand: (literal) or <hex>.
const SHOWN_STRING = /(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>)\s*(?:Tj|'|")|\[([^\]]*)\]\s*TJ/g;
const MAX_BLANK_GLYPH_BYTES = 4;

/**
 * 1-based numbers of pages that show (almost) nothing: no image XObject and at most a few glyph bytes, as a
 * trailing empty page of an exported decree. The reader reports such a page UNREADABLE, which must not
 * block a document; anything with real text or an image is never treated as blank.
 */
export function findBlankPages(pdf: PDFDocument): number[] {
    const blank: number[] = [];

    pdf.getPages().forEach((page, index) => {
        const content = readPageContent(pdf, page.node.Contents());

        if (content !== null && !/\bDo\b/.test(content) && countShownBytes(content) <= MAX_BLANK_GLYPH_BYTES) {
            blank.push(index + 1);
        }
    });

    return blank;
}

function readPageContent(pdf: PDFDocument, contents: PDFObject | undefined): string | null {
    if (!contents) {
        return "";
    }

    const streams = contents instanceof PDFArray ? contents.asArray().map((reference) => pdf.context.lookup(reference)) : [contents];
    let text = "";

    for (const stream of streams) {
        if (!(stream instanceof PDFRawStream)) {
            return null;
        }

        try {
            text += new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode());
        } catch {
            return null;
        }
    }

    return text;
}

function countShownBytes(content: string): number {
    let total = 0;

    for (const match of content.matchAll(SHOWN_STRING)) {
        const operand = match[1] ?? match[2] ?? "";

        total += operand.startsWith("<") ? Math.ceil(operand.replace(/[<>\s]/g, "").length / 2) : Math.max(operand.length - 2, 0);
    }

    return total;
}
