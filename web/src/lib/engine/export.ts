import { createZipArchive } from "./zip";

export type ExportLegalDocInput = {
    title: string;
    documentNumber?: string | null;
    documentType?: string | null;
    agency?: string | null;
    issuedLocation?: string | null;
    issuedDate?: string | null;
    content: string;
};

type LegalBlockKind = "BASIS" | "ENACTING" | "CHAPTER" | "ARTICLE" | "CLAUSE" | "POINT" | "PARAGRAPH";

type LegalBlock = {
    kind: LegalBlockKind;
    text: string;
    boldPrefix?: string;
    restText?: string;
};

type ResolvedExportMeta = {
    title: string;
    documentNumber: string;
    documentTypeUpper: string;
    agencyUpper: string;
    signerTitleUpper: string;
    issuedDateLine: string;
    blocks: LegalBlock[];
};

function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatVietnameseDateLine(location: string, rawDate?: string | null): string {
    if (rawDate && rawDate.trim().length > 0) {
        return rawDate.trim();
    }

    const now = new Date();
    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const year = String(now.getFullYear());

    return `${location}, ngày ${day} tháng ${month} năm ${year}`;
}

function inferDocumentType(input: ExportLegalDocInput): string {
    const explicit = input.documentType?.trim();

    if (explicit) {
        return explicit.toUpperCase();
    }

    const hint = `${input.documentNumber ?? ""} ${input.title}`;

    if (/Bộ luật/iu.test(hint)) {
        return "BỘ LUẬT";
    }

    if (/Luật|QH\d*/iu.test(hint)) {
        return "LUẬT";
    }

    if (/Nghị định|NĐ-CP/iu.test(hint)) {
        return "NGHỊ ĐỊNH";
    }

    if (/Thông tư|TT-/iu.test(hint)) {
        return "THÔNG TƯ";
    }

    if (/Nghị quyết|NQ/iu.test(hint)) {
        return "NGHỊ QUYẾT";
    }

    return "VĂN BẢN QUY PHẠM PHÁP LUẬT";
}

function inferAgency(input: ExportLegalDocInput, docTypeUpper: string): { agencyUpper: string; signerTitleUpper: string } {
    const explicit = input.agency?.trim();

    if (explicit) {
        const upper = explicit.toUpperCase();

        return {
            agencyUpper: upper,
            signerTitleUpper: upper === "QUỐC HỘI" ? "CHỦ TỊCH QUỐC HỘI" : `TM. ${upper}`,
        };
    }

    const hint = `${input.documentNumber ?? ""} ${docTypeUpper}`;

    if (/QH\d*|LUẬT|BỘ LUẬT/iu.test(hint)) {
        return {
            agencyUpper: "QUỐC HỘI",
            signerTitleUpper: "CHỦ TỊCH QUỐC HỘI",
        };
    }

    if (/BỘ\s+/iu.test(input.title)) {
        return {
            agencyUpper: "BỘ CHỦ QUẢN",
            signerTitleUpper: "BỘ TRƯỞNG",
        };
    }

    return {
        agencyUpper: "CHÍNH PHỦ",
        signerTitleUpper: "TM. CHÍNH PHỦ\nTHỦ TƯỚNG",
    };
}

function parseContentBlocks(content: string, resolvedTitle?: string): LegalBlock[] {
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const blocks: LegalBlock[] = [];
    let skippedHeaderLine = false;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line) {
            continue;
        }

        if (
            !skippedHeaderLine
            && blocks.length === 0
            && resolvedTitle
            && line.replace(/^#+\s*/, "").trim().toLowerCase() === resolvedTitle.trim().toLowerCase()
            && !/^(?:Căn\s+cứ|Theo\s+đề\s+nghị|Chương\s+|Điều\s+\d+|\d+\.|[a-zđ]\))/iu.test(line)
        ) {
            skippedHeaderLine = true;
            continue;
        }

        if (/^(?:Căn\s+cứ|Theo\s+đề\s+nghị)\s+/iu.test(line)) {
            blocks.push({ kind: "BASIS", text: line });
            continue;
        }

        if (/^(?:Chính\s+phủ|Quốc\s+hội|Bộ\s+trưởng|Ủy\s+ban)\s+ban\s+hành\s+/iu.test(line)) {
            blocks.push({ kind: "ENACTING", text: line });
            continue;
        }

        if (/^Chương\s+[IVXLCDM\d]+/iu.test(line)) {
            blocks.push({ kind: "CHAPTER", text: line.toUpperCase() });
            continue;
        }

        const articleMatch = /^(Điều\s+\d+[a-zđ]?\.\s*[^\n.?!:;]*\.?)(.*)$/iu.exec(line);

        if (articleMatch && /^Điều\s+\d+/iu.test(line)) {
            blocks.push({
                kind: "ARTICLE",
                text: line,
                boldPrefix: articleMatch[1].trim(),
                restText: articleMatch[2].trim(),
            });
            continue;
        }

        if (/^\d+\.\s+/u.test(line)) {
            blocks.push({ kind: "CLAUSE", text: line });
            continue;
        }

        if (/^[a-zđ]\)\s+/iu.test(line)) {
            blocks.push({ kind: "POINT", text: line });
            continue;
        }

        blocks.push({ kind: "PARAGRAPH", text: line });
    }

    return blocks;
}

export function resolveExportMetadata(input: ExportLegalDocInput): ResolvedExportMeta {
    const documentTypeUpper = inferDocumentType(input);
    const { agencyUpper, signerTitleUpper } = inferAgency(input, documentTypeUpper);
    const location = input.issuedLocation?.trim() || "Hà Nội";
    const documentNumber = input.documentNumber?.trim() || ".../2026/...";
    const resolvedTitle = input.title.trim() || "Dự thảo văn bản quy phạm pháp luật";

    return {
        title: resolvedTitle,
        documentNumber,
        documentTypeUpper,
        agencyUpper,
        signerTitleUpper,
        issuedDateLine: formatVietnameseDateLine(location, input.issuedDate),
        blocks: parseContentBlocks(input.content, resolvedTitle),
    };
}

export function buildExportFilename(documentNumber: string | null | undefined, title: string, ext: "docx" | "html" | "pdf"): string {
    const source = (documentNumber && documentNumber.trim()) || title || "van-ban-phap-luat";
    const ascii = source
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/Đ/g, "D")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64);

    return `${ascii || "van-ban-phap-luat"}.${ext}`;
}

function docxRun(text: string, opts: { bold?: boolean; italic?: boolean; sizeHalfPt?: number; underline?: boolean } = {}): string {
    const size = opts.sizeHalfPt ?? 28;
    const rPr = [
        `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/>`,
        opts.bold ? "<w:b/>" : "",
        opts.italic ? "<w:i/>" : "",
        opts.underline ? `<w:u w:val="single"/>` : "",
        `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`,
    ].join("");

    return `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function docxParagraph(
    runs: string,
    opts: {
        align?: "left" | "center" | "right" | "both";
        firstLine?: number;
        before?: number;
        after?: number;
        line?: number;
        bottomBorder?: boolean;
    } = {},
): string {
    const jc = opts.align ? `<w:jc w:val="${opts.align}"/>` : `<w:jc w:val="both"/>`;
    const ind = opts.firstLine ? `<w:ind w:firstLine="${opts.firstLine}"/>` : "";
    const spacing = `<w:spacing w:before="${opts.before ?? 0}" w:after="${opts.after ?? 120}" w:line="${opts.line ?? 276}" w:lineRule="auto"/>`;
    const pBdr = opts.bottomBorder
        ? `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="000000"/></w:pBdr>`
        : "";

    return `<w:p><w:pPr>${pBdr}${spacing}${ind}${jc}</w:pPr>${runs}</w:p>`;
}

function buildBodyParagraphsXml(meta: ResolvedExportMeta): string {
    const out: string[] = [];

    for (const block of meta.blocks) {
        if (block.kind === "BASIS") {
            out.push(docxParagraph(docxRun(block.text, { italic: true, sizeHalfPt: 28 }), { align: "both", firstLine: 720, after: 100 }));
            continue;
        }

        if (block.kind === "ENACTING") {
            out.push(docxParagraph(docxRun(block.text, { italic: true, sizeHalfPt: 28 }), { align: "both", firstLine: 720, after: 140 }));
            continue;
        }

        if (block.kind === "CHAPTER") {
            out.push(docxParagraph(docxRun(block.text, { bold: true, sizeHalfPt: 28 }), { align: "center", before: 180, after: 120 }));
            continue;
        }

        if (block.kind === "ARTICLE" && block.boldPrefix) {
            const runs =
                docxRun(block.boldPrefix, { bold: true, sizeHalfPt: 28 }) +
                (block.restText ? docxRun(` ${block.restText}`, { sizeHalfPt: 28 }) : "");
            out.push(docxParagraph(runs, { align: "both", firstLine: 720, before: 120, after: 100 }));
            continue;
        }

        out.push(docxParagraph(docxRun(block.text, { sizeHalfPt: 28 }), { align: "both", firstLine: 720, after: 100 }));
    }

    return out.join("");
}

/**
 * Generates an OOXML (.docx) file formatted according to Decree 30/2020/ND-CP
 * with Times New Roman 14pt body text and standard A4 Vietnamese legal margins.
 */
export function buildVietnameseLegalDocx(input: ExportLegalDocInput): Uint8Array {
    const meta = resolveExportMetadata(input);

    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
</Types>`;

    const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

    const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
</Relationships>`;

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/>
        <w:sz w:val="28"/>
        <w:szCs w:val="28"/>
        <w:lang w:val="vi-VN"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="120" w:line="276" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr>
      <w:spacing w:after="120" w:line="276" w:lineRule="auto"/>
      <w:ind w:firstLine="720"/>
      <w:jc w:val="both"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/>
      <w:sz w:val="28"/>
      <w:szCs w:val="28"/>
    </w:rPr>
  </w:style>
</w:styles>`;

    const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr><w:jc w:val="center"/></w:pPr>
    <w:r><w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
    <w:r><w:fldChar w:fldCharType="separate"/></w:r>
    <w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr><w:t>2</w:t></w:r>
    <w:r><w:fldChar w:fldCharType="end"/></w:r>
  </w:p>
</w:hdr>`;

    const noBorders = `<w:tblBorders>
      <w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>
      <w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>
      <w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>
      <w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>
      <w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>
      <w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>
    </w:tblBorders>`;

    const headerTableXml = `<w:tbl>
  <w:tblPr><w:tblW w:w="9355" w:type="dxa"/>${noBorders}</w:tblPr>
  <w:tblGrid><w:gridCol w:w="3930"/><w:gridCol w:w="5425"/></w:tblGrid>
  <w:tr>
    <w:tc>
      <w:tcPr><w:tcW w:w="3930" w:type="dxa"/></w:tcPr>
      ${docxParagraph(docxRun(meta.agencyUpper, { bold: true, sizeHalfPt: 26 }), { align: "center", after: 40 })}
      ${docxParagraph(docxRun("____________", { bold: true, sizeHalfPt: 20 }), { align: "center", after: 80 })}
      ${docxParagraph(docxRun(`Số: ${meta.documentNumber}`, { sizeHalfPt: 26 }), { align: "center", after: 40 })}
    </w:tc>
    <w:tc>
      <w:tcPr><w:tcW w:w="5425" w:type="dxa"/></w:tcPr>
      ${docxParagraph(docxRun("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", { bold: true, sizeHalfPt: 25 }), { align: "center", after: 40 })}
      ${docxParagraph(docxRun("Độc lập - Tự do - Hạnh phúc", { bold: true, sizeHalfPt: 27 }), { align: "center", after: 40 })}
      ${docxParagraph(docxRun("____________________", { bold: true, sizeHalfPt: 20 }), { align: "center", after: 80 })}
      ${docxParagraph(docxRun(meta.issuedDateLine, { italic: true, sizeHalfPt: 27 }), { align: "center", after: 40 })}
    </w:tc>
  </w:tr>
</w:tbl>`;

    const titleSectionXml = [
        docxParagraph(docxRun(meta.documentTypeUpper, { bold: true, sizeHalfPt: 28 }), { align: "center", before: 240, after: 60 }),
        docxParagraph(docxRun(meta.title, { bold: true, sizeHalfPt: 28 }), { align: "center", after: 60 }),
        docxParagraph(docxRun("_______________", { bold: true, sizeHalfPt: 22 }), { align: "center", after: 180 }),
    ].join("");

    const signerLines = meta.signerTitleUpper.split("\n");
    const signerXml = signerLines
        .map((line) => docxParagraph(docxRun(line, { bold: true, sizeHalfPt: 28 }), { align: "center", after: 40 }))
        .join("");

    const footerTableXml = `<w:tbl>
  <w:tblPr><w:tblW w:w="9355" w:type="dxa"/>${noBorders}</w:tblPr>
  <w:tblGrid><w:gridCol w:w="4800"/><w:gridCol w:w="4555"/></w:tblGrid>
  <w:tr>
    <w:tc>
      <w:tcPr><w:tcW w:w="4800" w:type="dxa"/></w:tcPr>
      ${docxParagraph(docxRun("Nơi nhận:", { bold: true, italic: true, sizeHalfPt: 24 }), { align: "left", before: 200, after: 40 })}
      ${docxParagraph(docxRun("- Như Điều ...;", { sizeHalfPt: 22 }), { align: "left", after: 20 })}
      ${docxParagraph(docxRun("- Các cơ quan, đơn vị liên quan;", { sizeHalfPt: 22 }), { align: "left", after: 20 })}
      ${docxParagraph(docxRun("- Lưu: VT, PC.", { sizeHalfPt: 22 }), { align: "left", after: 40 })}
    </w:tc>
    <w:tc>
      <w:tcPr><w:tcW w:w="4555" w:type="dxa"/></w:tcPr>
      ${signerXml}
      ${docxParagraph(docxRun("", { sizeHalfPt: 28 }), { align: "center", before: 420, after: 40 })}
      ${docxParagraph(docxRun("(Đã ký)", { italic: true, sizeHalfPt: 26 }), { align: "center", after: 40 })}
    </w:tc>
  </w:tr>
</w:tbl>`;

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${headerTableXml}
    ${titleSectionXml}
    ${buildBodyParagraphsXml(meta)}
    ${footerTableXml}
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rId2"/>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="567" w:footer="567" w:gutter="0"/>
      <w:titlePg/>
    </w:sectPr>
  </w:body>
</w:document>`;

    return createZipArchive([
        { path: "[Content_Types].xml", content: contentTypesXml },
        { path: "_rels/.rels", content: rootRelsXml },
        { path: "word/_rels/document.xml.rels", content: docRelsXml },
        { path: "word/styles.xml", content: stylesXml },
        { path: "word/header1.xml", content: headerXml },
        { path: "word/document.xml", content: documentXml },
    ]);
}

/**
 * Generates a print-ready A4 HTML document formatted according to Decree 30/2020/ND-CP
 * with Times New Roman 14pt typography for browser PDF export and A4 preview.
 */
export function buildVietnameseLegalHtml(input: ExportLegalDocInput): string {
    const meta = resolveExportMetadata(input);

    const bodyHtml = meta.blocks
        .map((block) => {
            if (block.kind === "BASIS" || block.kind === "ENACTING") {
                return `<p class="legal-basis">${escapeHtml(block.text)}</p>`;
            }

            if (block.kind === "CHAPTER") {
                return `<p class="legal-chapter">${escapeHtml(block.text)}</p>`;
            }

            if (block.kind === "ARTICLE" && block.boldPrefix) {
                const rest = block.restText ? ` ${escapeHtml(block.restText)}` : "";

                return `<p class="legal-para"><strong>${escapeHtml(block.boldPrefix)}</strong>${rest}</p>`;
            }

            return `<p class="legal-para">${escapeHtml(block.text)}</p>`;
        })
        .join("\n");

    const signerHtml = meta.signerTitleUpper
        .split("\n")
        .map((line) => `<div>${escapeHtml(line)}</div>`)
        .join("");

    return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(meta.title)}</title>
<style>
  @page {
    size: A4;
    margin: 20mm 15mm 20mm 30mm;
    @top-center {
      content: counter(page);
      font-family: "Times New Roman", "Liberation Serif", Times, serif;
      font-size: 13pt;
    }
  }
  @page :first {
    @top-center { content: none; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0 auto;
    max-width: 210mm;
    padding: 20mm 15mm 20mm 30mm;
    background: #ffffff;
    color: #000000;
    font-family: "Times New Roman", "Liberation Serif", Times, serif;
    font-size: 14pt;
    line-height: 1.35;
  }
  @media print {
    body { padding: 0; max-width: none; }
  }
  .header-grid {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 16pt;
  }
  .header-grid td {
    vertical-align: top;
    text-align: center;
    padding: 0;
  }
  .col-left { width: 42%; }
  .col-right { width: 58%; }
  .agency-name {
    font-size: 13pt;
    font-weight: bold;
    text-transform: uppercase;
  }
  .doc-number {
    font-size: 13pt;
    margin-top: 6pt;
  }
  .motto-top {
    font-size: 12.5pt;
    font-weight: bold;
    text-transform: uppercase;
  }
  .motto-sub {
    font-size: 13.5pt;
    font-weight: bold;
  }
  .rule-short {
    width: 36%;
    border: 0;
    border-top: 1px solid #000000;
    margin: 3pt auto 4pt auto;
  }
  .rule-motto {
    width: 58%;
    border: 0;
    border-top: 1px solid #000000;
    margin: 3pt auto 4pt auto;
  }
  .date-line {
    font-size: 13.5pt;
    font-style: italic;
    margin-top: 6pt;
  }
  .title-block {
    text-align: center;
    margin: 14pt 0 14pt 0;
  }
  .doc-type {
    font-size: 14pt;
    font-weight: bold;
    text-transform: uppercase;
    margin: 0;
  }
  .doc-title {
    font-size: 14pt;
    font-weight: bold;
    margin: 4pt 0 0 0;
  }
  .rule-title {
    width: 28%;
    border: 0;
    border-top: 1px solid #000000;
    margin: 6pt auto 14pt auto;
  }
  .legal-basis {
    margin: 0 0 6pt 0;
    text-indent: 1.27cm;
    text-align: justify;
    font-style: italic;
  }
  .legal-chapter {
    margin: 14pt 0 8pt 0;
    text-align: center;
    font-weight: bold;
    text-transform: uppercase;
  }
  .legal-para {
    margin: 0 0 6pt 0;
    text-indent: 1.27cm;
    text-align: justify;
  }
  .footer-grid {
    width: 100%;
    border-collapse: collapse;
    margin-top: 18pt;
    page-break-inside: avoid;
  }
  .footer-grid td {
    vertical-align: top;
    padding: 0;
  }
  .recipients { width: 52%; text-align: left; }
  .recipients-title { font-size: 12pt; font-weight: bold; font-style: italic; margin-bottom: 3pt; }
  .recipients-item { font-size: 11pt; line-height: 1.25; }
  .signature { width: 48%; text-align: center; font-weight: bold; }
  .signature-note { margin-top: 44pt; font-style: italic; font-weight: normal; font-size: 13pt; }
</style>
</head>
<body>
  <table class="header-grid">
    <tr>
      <td class="col-left">
        <div class="agency-name">${escapeHtml(meta.agencyUpper)}</div>
        <hr class="rule-short" />
        <div class="doc-number">Số: ${escapeHtml(meta.documentNumber)}</div>
      </td>
      <td class="col-right">
        <div class="motto-top">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
        <div class="motto-sub">Độc lập - Tự do - Hạnh phúc</div>
        <hr class="rule-motto" />
        <div class="date-line">${escapeHtml(meta.issuedDateLine)}</div>
      </td>
    </tr>
  </table>

  <div class="title-block">
    <p class="doc-type">${escapeHtml(meta.documentTypeUpper)}</p>
    <p class="doc-title">${escapeHtml(meta.title)}</p>
    <hr class="rule-title" />
  </div>

  ${bodyHtml}

  <table class="footer-grid">
    <tr>
      <td class="recipients">
        <div class="recipients-title">Nơi nhận:</div>
        <div class="recipients-item">- Như Điều ...;</div>
        <div class="recipients-item">- Các cơ quan, đơn vị liên quan;</div>
        <div class="recipients-item">- Lưu: VT, PC.</div>
      </td>
      <td class="signature">
        ${signerHtml}
        <div class="signature-note">(Đã ký)</div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
