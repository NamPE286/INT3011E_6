import { PDFDocument } from "pdf-lib";

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
