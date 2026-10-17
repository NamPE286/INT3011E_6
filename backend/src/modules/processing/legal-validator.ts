import type {
  Article, ArticleSegment, Chapter, ChapterSegment, Clause, ClauseSegment,
  LegalDocument, Locator, Part, PartSegment, PdfPage, Point, PointSegment,
  Section, SectionSegment, Segmentation, Segment, SourceLine,
} from "./legal-types";
import { NeedsReviewError } from "./legal-types";

type Kind = "part" | "chapter" | "section" | "article" | "clause" | "point";
const CHILDREN: Record<Kind, readonly string[]> = {
  part: ["chapters", "sections", "articles"],
  chapter: ["sections", "articles"],
  section: ["articles"],
  article: ["clauses"],
  clause: ["points"],
  point: [],
};
const CHILD_KIND: Record<string, Kind> = {
  parts: "part", chapters: "chapter", sections: "section", articles: "article",
  clauses: "clause", points: "point",
};
const RULES: Record<Kind, RegExp> = {
  part: /^Phần\s+([IVXLCDM\d]+)(?=\s|[.:–-]|$)/iu,
  chapter: /^Chương\s+([IVXLCDM\d]+)(?=\s|[.:–-]|$)/iu,
  section: /^Mục\s+([IVXLCDM\d]+)(?=\s|[.:–-]|$)/iu,
  article: /^Điều\s+(\d+[a-zA-Z]?)(?=\s|[.:–-]|$)/iu,
  clause: /^(\d+)[.)]\s*/u,
  point: /^([a-zđ])[.)]\s*/iu,
};
const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLocaleLowerCase("vi");
function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new NeedsReviewError(`Segmentation validation: ${message}`);
}

function assertShape(v: unknown, kind: Kind): asserts v is Segment {
  ensure(!!v && typeof v === "object" && !Array.isArray(v), `${kind} must be an object`);
  const node = v as unknown as Record<string, unknown>;
  const expected = ["number", "title", "start_line", "heading_end_line", "end_line", ...CHILDREN[kind]];
  ensure(Object.keys(node).length === expected.length && Object.keys(node).every((key) => expected.includes(key)), `${kind} has missing/extra keys`);
  ensure(typeof node.number === "string" && node.number.trim().length > 0, `${kind}.number missing`);
  ensure(node.title === null || typeof node.title === "string", `${kind}.title invalid`);
  ensure(Number.isInteger(node.start_line) && Number.isInteger(node.heading_end_line) && Number.isInteger(node.end_line), `${kind} line indexes invalid`);
  for (const key of CHILDREN[kind]) ensure(Array.isArray(node[key]), `${kind}.${key} must be array`);
}

function validateNodeTree(
  node: unknown, kind: Kind, lines: SourceLine[], parent?: Segment,
): { node: Segment; directLineIds: number[]; allChildren: { kind: Kind; node: Segment }[] } {
  assertShape(node, kind);
  const item = node;
  const n = lines.length;
  ensure(item.start_line >= 1 && item.heading_end_line >= item.start_line && item.end_line >= item.heading_end_line && item.end_line <= n, `${kind} range ${item.start_line}..${item.end_line} outside input`);
  if (parent) ensure(item.start_line > parent.heading_end_line && item.end_line <= parent.end_line, `${kind} outside parent heading/content range`);
  const heading = lines[item.start_line - 1].text.trim();
  const found = RULES[kind].exec(heading);
  ensure(found !== null && normalize(found[1]) === normalize(item.number), `${kind} ${item.number}: heading does not match source line ${item.start_line}`);
  const headingText = lines.slice(item.start_line - 1, item.heading_end_line).map((l) => l.text).join(" ");
  if (item.title !== null) {
    ensure(normalize(item.title).length > 0 && normalize(headingText).includes(normalize(item.title)), `${kind}.title cannot be verified against heading`);
  }

  const allChildren: { kind: Kind; node: Segment }[] = [];
  const raw = item as unknown as Record<string, unknown>;
  for (const key of CHILDREN[kind]) {
    for (const child of raw[key] as unknown[]) {
      const childKind = CHILD_KIND[key];
      validateNodeTree(child, childKind, lines, item);
      allChildren.push({ kind: childKind, node: child as Segment });
    }
  }
  allChildren.sort((a, b) => a.node.start_line - b.node.start_line);
  for (let i = 1; i < allChildren.length; i++) {
    ensure(allChildren[i].node.start_line > allChildren[i - 1].node.end_line, `${kind} has overlapping/duplicate children`);
  }
  const directLineIds: number[] = [];
  for (let id = item.heading_end_line + 1; id <= item.end_line; id++) {
    if (!allChildren.some((child) => id >= child.node.start_line && id <= child.node.end_line)) directLineIds.push(id);
  }
  return { node: item, directLineIds, allChildren };
}

function makeLocator(seg: Segment, lines: SourceLine[], pages: PdfPage[]): Locator {
  const first = lines[seg.start_line - 1];
  const last = lines[seg.end_line - 1];
  const covered = pages.slice(first.page - 1, last.page);
  return {
    page_start: first.page,
    page_end: last.page,
    start_offset: first.start_offset,
    end_offset: last.end_offset,
    method: covered.some((p) => p.method === "OCR") ? "OCR" : "TEXT_LAYER",
    quality: covered.some((p) => p.quality !== "GOOD") ? "LOW" : "GOOD",
  };
}

function directContent(seg: Segment, kind: Kind, lines: SourceLine[], pages: PdfPage[]): string | null {
  const { directLineIds } = validateNodeTree(seg, kind, lines);
  const parts: string[] = [];
  const heading = lines[seg.start_line - 1].text.trim();
  // Numbered Khoản/Điểm often have the entire first sentence on their heading line.
  // Strip ONLY the numbering marker; keep its legal wording verbatim.
  if (kind === "clause" || kind === "point" || (kind === "article" && seg.title === null)) {
    const match = RULES[kind].exec(heading);
    const tail = match ? heading.slice(match[0].length) : "";
    if (tail && (kind !== "article" || seg.title === null)) parts.push(tail);
  }
  // Wrapped Khoản/Điểm heading lines are legal content, not just presentation.
  // Children must begin after heading_end_line, so these lines cannot be duplicated.
  if (kind === "clause" || kind === "point" || (kind === "article" && seg.title === null)) {
    for (let id = seg.start_line + 1; id <= seg.heading_end_line; id++) {
      parts.push(lines[id - 1].text);
    }
  }
  for (const id of directLineIds) parts.push(lines[id - 1].text);
  const content = parts.join("\n").trim();
  return content || null;
}

function point(s: PointSegment, l: SourceLine[], p: PdfPage[]): Point {
  return { number: s.number, title: s.title, content: directContent(s, "point", l, p), source_locator: makeLocator(s, l, p) };
}
function clause(s: ClauseSegment, l: SourceLine[], p: PdfPage[]): Clause {
  return { number: s.number, title: s.title, content: directContent(s, "clause", l, p), source_locator: makeLocator(s, l, p), points: s.points.map((x) => point(x, l, p)) };
}
function article(s: ArticleSegment, l: SourceLine[], p: PdfPage[]): Article {
  return { number: s.number, title: s.title, content: directContent(s, "article", l, p), source_locator: makeLocator(s, l, p), clauses: s.clauses.map((x) => clause(x, l, p)) };
}
function section(s: SectionSegment, l: SourceLine[], p: PdfPage[]): Section {
  return { number: s.number, title: s.title, content: directContent(s, "section", l, p), source_locator: makeLocator(s, l, p), articles: s.articles.map((x) => article(x, l, p)) };
}
function chapter(s: ChapterSegment, l: SourceLine[], p: PdfPage[]): Chapter {
  return { number: s.number, title: s.title, content: directContent(s, "chapter", l, p), source_locator: makeLocator(s, l, p), sections: s.sections.map((x) => section(x, l, p)), articles: s.articles.map((x) => article(x, l, p)) };
}
function part(s: PartSegment, l: SourceLine[], p: PdfPage[]): Part {
  return { number: s.number, title: s.title, content: directContent(s, "part", l, p), source_locator: makeLocator(s, l, p), chapters: s.chapters.map((x) => chapter(x, l, p)), sections: s.sections.map((x) => section(x, l, p)), articles: s.articles.map((x) => article(x, l, p)) };
}

/** Throws NeedsReviewError if line segmentation / locator cannot be verified. */
export function buildLegalDocument(
  segmentation: unknown, pages: PdfPage[], lines: SourceLine[],
  snapshotId: string, sha256: string,
): LegalDocument {
  const data = segmentation as Partial<Segmentation> | null;
  ensure(!!data && typeof data === "object" && !Array.isArray(data), "root must be object");
  const expected = ["document_title", "parts", "chapters", "sections", "articles"];
  ensure(Object.keys(data).length === expected.length && Object.keys(data).every((key) => expected.includes(key)), "wrong root keys");
  ensure(typeof data.document_title === "string" && !!data.document_title.trim(), "document_title missing");
  ensure([data.parts, data.chapters, data.sections, data.articles].every(Array.isArray), "root arrays missing");
  ensure(lines.length > 0 && /^[0-9a-f]{64}$/.test(sha256), "source metadata invalid");
  const sourceText = normalize(pages.map((p) => p.text).join(" "));
  ensure(sourceText.includes(normalize(data.document_title)), "document_title not found verbatim in source");
  const roots: { kind: Kind; node: Segment }[] = [];
  for (const key of ["parts", "chapters", "sections", "articles"] as const) {
    for (const node of data[key]!) {
      validateNodeTree(node, CHILD_KIND[key], lines);
      roots.push({ kind: CHILD_KIND[key], node });
    }
  }
  ensure(roots.length > 0, "no legal provisions identified");
  roots.sort((a, b) => a.node.start_line - b.node.start_line);
  for (let i = 1; i < roots.length; i++) {
    ensure(roots[i].node.start_line > roots[i - 1].node.end_line, "overlapping/duplicated root nodes");
  }
  // A missing top-level structural heading must not be silently flattened into content.
  const knownStarts = new Set<number>();
  function collectStarts(node: Segment, kind: Kind): void {
    knownStarts.add(node.start_line);
    const record = node as unknown as Record<string, unknown>;
    for (const key of CHILDREN[kind]) {
      for (const child of record[key] as Segment[]) collectStarts(child, CHILD_KIND[key]);
    }
  }
  for (const root of roots) collectStarts(root.node, root.kind);
  for (const line of lines) {
    const isMajorHeading = (["part", "chapter", "section", "article"] as Kind[])
      .some((kind) => RULES[kind].test(line.text.trim()));
    ensure(!isMajorHeading || knownStarts.has(line.id),
      `legal heading on source line ${line.id} is not assigned to a node`);
  }
  const rootText: string[] = [];
  for (const line of lines) {
    if (!roots.some((r) => line.id >= r.node.start_line && line.id <= r.node.end_line)) rootText.push(line.text);
  }
  const preamble = rootText.join("\n").trim();
  return {
    document_title: data.document_title,
    content: preamble || null,
    source: { snapshot_id: snapshotId, pdf_sha256: sha256 },
    parts: data.parts!.map((x) => part(x, lines, pages)),
    chapters: data.chapters!.map((x) => chapter(x, lines, pages)),
    sections: data.sections!.map((x) => section(x, lines, pages)),
    articles: data.articles!.map((x) => article(x, lines, pages)),
  };
}
