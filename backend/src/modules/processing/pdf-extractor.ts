import { extractText, getDocumentProxy } from "unpdf";
import { NeedsReviewError, type PdfPage } from "./legal-types";

// Safety bounds for starter implementation; queue jobs above these limits go to review.
const MAX_PDF_BYTES = 12 * 1024 * 1024;
const MAX_PAGES = 35;
const MIN_TEXT_PER_PAGE = 18;

export async function extractPdfText(buffer: ArrayBuffer): Promise<PdfPage[]> {
  if (buffer.byteLength > MAX_PDF_BYTES) {
    throw new NeedsReviewError("PDF > 12 MB: needs an external extraction service");
  }
  const header = new TextDecoder().decode(buffer.slice(0, 8));
  if (!header.startsWith("%PDF-")) {
    throw new NeedsReviewError("File is not a valid PDF header");
  }

  // PDF.js may transfer/detach its input; keep the original bytes for the R2 snapshot.
  const pdf = await getDocumentProxy(new Uint8Array(buffer.slice(0)), {
    maxImageSize: 16_777_216,
  });
  try {
    if (pdf.numPages > MAX_PAGES) {
      throw new NeedsReviewError("PDF > 35 pages: split by legal boundary or use a long-document pipeline");
    }
    const extracted = await extractText(pdf, { mergePages: false });
    const texts = extracted.text;
    if (!Array.isArray(texts) || texts.length !== pdf.numPages) {
      throw new Error("PDF extractor returned an unexpected page structure");
    }
    return texts.map((text, index) => {
      // Do not pretend text-layer extraction worked for scans or empty pages.
      if (text.trim().length < MIN_TEXT_PER_PAGE) {
        throw new NeedsReviewError(`Page ${index + 1} has insufficient text; OCR is required`);
      }
      return {
        page_number: index + 1,
        text,
        method: "TEXT_LAYER" as const,
        quality: "GOOD" as const,
      };
    });
  } finally {
    await pdf.loadingTask.destroy();
  }
}

