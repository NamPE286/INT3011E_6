"""Renders each fake decree JSON in this folder to a PDF with the same wording, one PDF page per "pages" entry.

    python3 data/fake-law/generate_pdfs.py

Needs reportlab and the DejaVu Sans font (Vietnamese diacritics).
"""
import json
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import simpleSplit

FOLDER = Path(__file__).parent
FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
MARGIN = 56
FONT_SIZE = 11
LINE_HEIGHT = 16


def block_line(block: dict) -> str:
    kind = block["kind"]

    if kind == "article":
        return f"Điều {block['number']}. {block['title']}"

    if kind == "clause":
        return f"{block['number']}. {block['text']}"

    if kind == "point":
        return f"{block['number']}) {block['text']}"

    return block["text"]


def render(source: Path) -> None:
    decree = json.loads(source.read_text(encoding="utf-8"))
    target = source.with_suffix(".pdf")
    page_width, page_height = A4
    pdf = canvas.Canvas(str(target), pagesize=A4, invariant=1)
    pdf.setTitle(decree["id"])

    for page_blocks in decree["pages"]:
        y = page_height - MARGIN
        pdf.setFont("DejaVu", FONT_SIZE)

        for block in page_blocks:
            for line in simpleSplit(block_line(block), "DejaVu", FONT_SIZE, page_width - 2 * MARGIN):
                pdf.drawString(MARGIN, y, line)
                y -= LINE_HEIGHT

            y -= LINE_HEIGHT / 2

        pdf.showPage()

    pdf.save()
    print(f"wrote {target.name}")


if __name__ == "__main__":
    pdfmetrics.registerFont(TTFont("DejaVu", FONT_PATH))

    for source in sorted(FOLDER.glob("*.json")):
        render(source)
