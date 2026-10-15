import { describe, expect, test } from "bun:test";
import { createSourceLines } from "../src/modules/processing/source-lines";
import { buildLegalDocument } from "../src/modules/processing/legal-validator";
import type { PdfPage, Segmentation } from "../src/modules/processing/legal-types";

const input = [
  "LUẬT VÍ DỤ",
  "Căn cứ Hiến pháp nước Cộng hòa xã hội chủ nghĩa Việt Nam;",
  "Chương I. QUY ĐỊNH CHUNG",
  "Điều 1. Phạm vi điều chỉnh",
  "1. Áp dụng đối với hoạt động A.",
  "2. Các trường hợp bao gồm:",
  "a) Trường hợp thứ nhất.",
  "b) Trường hợp thứ hai.",
  "Điều 2. Đối tượng áp dụng",
  "Nội dung của Điều 2 không chia khoản.",
].join("\n");
const pages: PdfPage[] = [{ page_number: 1, text: input, method: "TEXT_LAYER", quality: "GOOD" }];
const lines = createSourceLines(pages);
const SHA = "a".repeat(64);

const structure: Segmentation = {
  document_title: "LUẬT VÍ DỤ",
  parts: [],
  chapters: [{
    number: "I", title: "QUY ĐỊNH CHUNG", start_line: 3, heading_end_line: 3, end_line: 10,
    sections: [],
    articles: [
      { number: "1", title: "Phạm vi điều chỉnh", start_line: 4, heading_end_line: 4, end_line: 8,
        clauses: [
          { number: "1", title: null, start_line: 5, heading_end_line: 5, end_line: 5, points: [] },
          { number: "2", title: null, start_line: 6, heading_end_line: 6, end_line: 8,
            points: [
              { number: "a", title: null, start_line: 7, heading_end_line: 7, end_line: 7 },
              { number: "b", title: null, start_line: 8, heading_end_line: 8, end_line: 8 },
            ],
          },
        ],
      },
      { number: "2", title: "Đối tượng áp dụng", start_line: 9, heading_end_line: 9,
        end_line: 10, clauses: [] },
    ],
  }],
  sections: [], articles: [],
};

describe("Legal text segmentation and evidence", () => {
  test("keeps preamble and exact text, with nonduplicated nested content", () => {
    const doc = buildLegalDocument(structure, pages, lines, "snap-1", SHA);
    expect(doc.content).toContain("Căn cứ Hiến pháp");
    const a1 = doc.chapters[0].articles[0];
    expect(a1.content).toBeNull();
    expect(a1.clauses[0].content).toBe("Áp dụng đối với hoạt động A.");
    expect(a1.clauses[1].content).toBe("Các trường hợp bao gồm:");
    expect(a1.clauses[1].points[0].content).toBe("Trường hợp thứ nhất.");
    expect(doc.chapters[0].articles[1].content).toBe("Nội dung của Điều 2 không chia khoản.");
    expect(doc.chapters[0].articles[1].clauses).toEqual([]);
    expect(doc.chapters[0].articles[1].source_locator.page_start).toBe(1);
  });
  test("rejects fabricated legal numbering", () => {
    const bad = structuredClone(structure);
    bad.chapters[0].articles[0].number = "99";
    expect(() => buildLegalDocument(bad, pages, lines, "snap", SHA)).toThrow("heading does not match");
  });
  test("rejects overlapping sibling spans", () => {
    const bad = structuredClone(structure);
    bad.chapters[0].articles[1].start_line = 8;
    expect(() => buildLegalDocument(bad, pages, lines, "snap", SHA)).toThrow();
  });
});

test("root article without chapter/mục is valid and no fake nodes appear", () => {
  const smallPages: PdfPage[] = [{
    page_number: 1, method: "TEXT_LAYER", quality: "GOOD",
    text: "NGHỊ ĐỊNH VÍ DỤ\nCăn cứ luật hiện hành;\nĐiều 1. Phạm vi điều chỉnh\nQuy định này áp dụng trực tiếp.",
  }];
  const smallLines = createSourceLines(smallPages);
  const root = {
    document_title: "NGHỊ ĐỊNH VÍ DỤ", parts: [], chapters: [], sections: [],
    articles: [{ number: "1", title: "Phạm vi điều chỉnh", start_line: 3,
      heading_end_line: 3, end_line: 4, clauses: [] }],
  };
  const doc = buildLegalDocument(root, smallPages, smallLines, "snap-2", SHA);
  expect(doc.chapters).toEqual([]);
  expect(doc.articles[0].content).toBe("Quy định này áp dụng trực tiếp.");
});

test("source locators resolve exact offsets on multiple pages", () => {
  const multiPages: PdfPage[] = [
    { page_number: 1, method: "TEXT_LAYER", quality: "GOOD", text: "NGHỊ ĐỊNH VÍ DỤ\nĐiều 1. Mục đích" },
    { page_number: 2, method: "TEXT_LAYER", quality: "GOOD", text: "Văn bản này hướng dẫn chi tiết." },
  ];
  const multi = {
    document_title: "NGHỊ ĐỊNH VÍ DỤ", parts: [], chapters: [], sections: [],
    articles: [{ number: "1", title: "Mục đích", start_line: 2,
      heading_end_line: 2, end_line: 3, clauses: [] }],
  };
  const doc = buildLegalDocument(multi, multiPages, createSourceLines(multiPages), "snap-3", SHA);
  expect(doc.articles[0].source_locator.page_start).toBe(1);
  expect(doc.articles[0].source_locator.page_end).toBe(2);
  expect(doc.articles[0].source_locator.end_offset).toBe(multiPages[1].text.length);
});


test("rejects an article heading silently dropped by the LLM", () => {
  const bad = structuredClone(structure);
  bad.chapters[0].articles.pop();
  expect(() => buildLegalDocument(bad, pages, lines, "snap", SHA))
    .toThrow("not assigned to a node");
});
