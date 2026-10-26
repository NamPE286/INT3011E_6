import { readFileSync } from "node:fs";
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from "pdf-lib";
const bytes = readFileSync("/root/.claude/uploads/12e9a016-d3ee-553c-9a86-79553288d92c/abad133f-168_2024_ND-CP_619502.pdf");
const pdf = await PDFDocument.load(bytes);
for (const index of [90]) {
    const page = pdf.getPage(index);
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => pdf.context.lookup(ref)) : [contents];
    let text = "";
    for (const stream of streams) {
        if (stream instanceof PDFRawStream) text += new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode());
    }
    console.log(index + 1, text.length, /\bT[jJ]\b|\bDo\b/.test(text), JSON.stringify(text));
}
