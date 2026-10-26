import { describe, expect, it } from "bun:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { findBlankPages } from "../src/modules/processing/pdf-document";

describe("findBlankPages", () => {
    it("reports pages that show no text or image, and only those", async () => {
        const pdf = await PDFDocument.create();
        const font = await pdf.embedFont(StandardFonts.Helvetica);

        pdf.addPage().drawText("Điều 1. Phạm vi điều chỉnh".replace(/[^\x20-\x7e]/g, "?"), { x: 50, y: 700, size: 12, font });
        pdf.addPage();
        pdf.addPage().drawText(" ", { x: 50, y: 700, size: 12, font });

        const reloaded = await PDFDocument.load(await pdf.save());

        expect(findBlankPages(reloaded)).toEqual([2, 3]);
    });
});
