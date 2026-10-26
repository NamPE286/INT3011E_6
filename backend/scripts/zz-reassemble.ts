import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assembleLegalDocument } from "../src/modules/processing/legal-assembler";
import { findBlankPages } from "../src/modules/processing/pdf-document";
import { PDFDocument } from "pdf-lib";
const PDFS: Record<string, string> = { "nd-123-2021": "/root/.claude/uploads/12e9a016-d3ee-553c-9a86-79553288d92c/13fa7574-123_2021_ND-CP_477975.pdf", "nd-168-2024": "/root/.claude/uploads/12e9a016-d3ee-553c-9a86-79553288d92c/abad133f-168_2024_ND-CP_619502.pdf" };
const R = "/tmp/claude-0/-home-user-INT3011E-6/12e9a016-d3ee-553c-9a86-79553288d92c/scratchpad/real-run/r2/runs";
for (const doc of ["nd-123-2021", "nd-168-2024"]) {
    const run = join(R, doc, readdirSync(join(R, doc))[0], "chunks");
    const chunks = readdirSync(run).map((f) => JSON.parse(readFileSync(join(run, f), "utf-8")));
    const pageCount = Math.max(...chunks.map((c) => c.page_end));
    const blankPages = findBlankPages(await PDFDocument.load(readFileSync(PDFS[doc])));
    const { document, issues } = assembleLegalDocument(chunks, { snapshotId: doc, pdfSha256: "x", pageCount, blankPages });
    console.log(doc, "blank pages", blankPages);
    const counts: Record<string, number> = {};
    for (const i of issues) counts[`${i.severity}:${i.code}`] = (counts[`${i.severity}:${i.code}`] ?? 0) + 1;
    const articles = [...document.articles, ...document.chapters.flatMap((c) => [...c.articles, ...c.sections.flatMap((s) => s.articles)])];
    const quoted = JSON.stringify(document).split('"quoted"').length - 1;
    console.log(doc, "articles", articles.length, articles.map((a) => a.number).join(","), "hosts-with-quotes", quoted, counts);
    for (const i of issues.filter((x) => x.severity === "ERROR" || x.code === "QUOTE_NOT_CLOSED").slice(0, 60)) console.log("  ", i.code, i.page, i.message.slice(0, 120));
    if (process.argv[2] === doc) console.log(JSON.stringify(articles.find((a) => a.number === process.argv[3]), null, 1).slice(0, 6000));
}
if (process.argv[2] === "hosts") {
    const run = join(R, "nd-168-2024", readdirSync(join(R, "nd-168-2024"))[0], "chunks");
    const chunks = readdirSync(run).map((f) => JSON.parse(readFileSync(join(run, f), "utf-8")));
    const { document } = assembleLegalDocument(chunks, { snapshotId: "x", pdfSha256: "x", pageCount: 91 });
    const visit = (node: any, path: string): void => {
        if (node.quoted) {
            const size = JSON.stringify(node.quoted).length;
            console.log("HOST", path, node.source_locator.page_start, "quotedNodes", node.quoted.length, "chars", size, "|", String(node.content ?? "").slice(-90));
        }
        for (const key of ["chapters", "sections", "articles", "clauses", "points"]) for (const child of node[key] ?? []) visit(child, `${path}/${key.slice(0, 2)}${child.number}`);
    };
    visit(document, "");
}
