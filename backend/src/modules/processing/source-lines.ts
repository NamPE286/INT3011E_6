import type { PdfPage, SourceLine } from "./legal-types";

/** The offset convention is UTF-16 within each page's exact extracted `text` string. */
export function createSourceLines(pages: PdfPage[]): SourceLine[] {
  const lines: SourceLine[] = [];
  for (const page of pages) {
    const regex = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
    for (const match of page.text.matchAll(regex)) {
      const segment = match[0];
      if (segment.length === 0) continue;
      const actual = segment.replace(/[\r\n]+$/, "");
      if (!actual.trim()) continue;
      const start = match.index;
      lines.push({
        id: lines.length + 1,
        page: page.page_number,
        start_offset: start,
        end_offset: start + actual.length,
        text: actual,
      });
    }
  }
  return lines;
}
