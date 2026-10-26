import { checkNumbering, checkPageCoverage, issue, nextPointLetter } from "./legal-validation";
import {
    NeedsReviewError,
    type ChunkTranscription,
    type LegalDocument,
    type NodeBase,
    type QuotedKind,
    type QuotedNode,
    type ReadQuality,
    type SourceLocator,
    type TranscribedBlock,
    type ValidationIssue,
} from "./legal-types";

type StructuralKind = "part" | "chapter" | "section" | "article" | "clause" | "point";
type ContainerKind = "document" | StructuralKind;

/** Wording quoted by an amendment, collected under the node whose text introduced it. */
type QuoteState = {
    host: DraftNode;
    /** stack[0] is a virtual root: quoted wording may start at any level (a whole Điều, one Điểm, plain text). */
    stack: DraftNode[];
};

type DraftNode = {
    kind: ContainerKind | "text";
    number: string;
    title: string | null;
    contentParts: string[];
    pageStart: number;
    pageEnd: number;
    quality: ReadQuality;
    sourceQuote: string | null;
    children: DraftNode[];
    quoted: DraftNode[];
};

export type AssemblySource = {
    snapshotId: string;
    pdfSha256: string;
    pageCount: number;
    /** Pages the PDF itself shows as empty (findBlankPages). */
    blankPages?: readonly number[];
};

export type AssemblyResult = {
    document: LegalDocument;
    issues: ValidationIssue[];
};

const RANK: Record<ContainerKind | "text", number> = {
    document: 0,
    part: 1,
    chapter: 2,
    section: 3,
    article: 4,
    clause: 5,
    point: 6,
    text: 7,
};

const ALLOWED_CHILDREN: Record<ContainerKind | "text", readonly StructuralKind[]> = {
    document: ["part", "chapter", "section", "article"],
    part: ["chapter", "section", "article"],
    chapter: ["section", "article"],
    section: ["article"],
    article: ["clause"],
    clause: ["point"],
    point: [],
    text: [],
};

const QUALITY_ORDER: readonly ReadQuality[] = ["GOOD", "PARTIAL", "UNREADABLE"];

// "Sửa đổi, bổ sung Điều 20 như sau:" and "Điều 5 được sửa đổi như sau:" introduce quoted new wording;
// "… các hình thức xử phạt bổ sung như sau:" does not: the verb must open the sentence or be passive.
const AMENDMENT_LEAD_IN = /^(?:(?:sửa đổi|bổ sung|thay thế|đính chính)(?![\p{L}])|[^.;]*được\s+(?:sửa đổi|bổ sung|thay thế|đính chính)(?![\p{L}]))[^.;]*như sau\s*:?\s*$/iu;
const AMENDMENT_START = /^(?:sửa đổi|bổ sung|bãi bỏ|thay thế|bỏ|thay|đính chính)(?![\p{L}])/iu;
const LATIN_OF: Record<string, string> = { "а": "a", "с": "c", "е": "e", "о": "o", "р": "p", "х": "x", "у": "y", "і": "i", "к": "k", "т": "t", "м": "m", "н": "h" };
const CYRILLIC_LOOKALIKES = /[асеорхуікмтн]/gu;
const OPENING_QUOTE = /^[\s]*[“"]/u;
const CLOSING_QUOTE = /[”"]\s*[.;,:]*\s*$/u;

/** Deterministically turns reading-order blocks into the nested legal JSON and reports what could not be verified. */
export function assembleLegalDocument(chunks: ChunkTranscription[], source: AssemblySource): AssemblyResult {
    const issues: ValidationIssue[] = [];
    const orderedChunks = [...chunks].sort((first, second) => first.page_start - second.page_start);
    const root = createDraft("document", "", null, 1, 1, "GOOD", null);
    const stack: DraftNode[] = [root];
    const titleParts: string[] = [];
    const closingParts: string[] = [];
    let lastContent: { parts: string[]; nodes: DraftNode[] } | null = null;
    let isClosing = false;
    let quote: QuoteState | null = null;

    for (const chunk of orderedChunks) {
        if (chunk.error) {
            issues.push(issue(
                "ERROR",
                "CHUNK_FAILED",
                `Pages ${chunk.page_start}-${chunk.page_end} could not be transcribed: ${chunk.error}`,
                chunk.page_start,
            ));
        }

        for (const transcribed of chunk.blocks) {
            const unmarked = splitInlineMarker(normalizeHomoglyphs(transcribed));

            if (isContinuation(unmarked) && lastContent && lastContent.parts.length > 0) {
                if (unmarked.marker) {
                    issues.push(issue(
                        "WARNING",
                        "MARKER_DROPPED",
                        `Marker "${unmarked.marker}" ignored: the text continues the previous page`,
                        unmarked.page_start,
                    ));
                }

                const lastIndex = lastContent.parts.length - 1;
                lastContent.parts[lastIndex] = `${lastContent.parts[lastIndex]} ${unmarked.text}`;
                extendNodes(lastContent.nodes, unmarked);

                if (quote && closesQuote(unmarked)) {
                    finishQuote(quote);
                    quote = null;
                }

                continue;
            }

            if (quote && leavesQuote(quote, unmarked)) {
                issues.push(issue("WARNING", "QUOTE_NOT_CLOSED", "Quoted wording had no closing quotation mark; closed before the next instruction", unmarked.page_start));
                finishQuote(quote);
                quote = null;
            }

            if (!quote && opensQuote(stack[stack.length - 1], unmarked)) {
                quote = { host: stack[stack.length - 1], stack: [createDraft("document", "", null, unmarked.page_start, unmarked.page_end, unmarked.quality, null)] };
            }

            if (quote) {
                const quotedNode = addQuotedBlock(quote, unmarked);

                extendNodes(stack, unmarked);
                lastContent = { parts: quotedNode.contentParts, nodes: [...stack, ...quote.stack.slice(1), quotedNode] };

                if (closesQuote(unmarked)) {
                    finishQuote(quote);
                    quote = null;
                }

                continue;
            }

            const block = correctCommonMisreads(stack, unmarked, issues);

            if (block.kind === "title" && !hasStructure(root)) {
                appendIfPresent(titleParts, block.text ?? block.title);
                continue;
            }

            if (block.kind === "closing" || (isClosing && !isStructuralKind(block.kind))) {
                isClosing = true;
                appendIfPresent(closingParts, block.text);
                lastContent = { parts: closingParts, nodes: [root] };
                continue;
            }

            if (isStructuralKind(block.kind)) {
                const opened = openStructuralNode(stack, block, block.kind, issues);

                if (opened) {
                    isClosing = false;
                    lastContent = { parts: opened.contentParts, nodes: [...stack] };
                    continue;
                }
            }

            const target = stack[stack.length - 1];

            if (isUntitledHeading(target) && block.kind === "text" && block.text) {
                // Chương/Mục/Phần names are printed on the line after the numbered heading.
                target.title = block.text;
                target.sourceQuote = `${target.sourceQuote} ${block.text}`.slice(0, 160);
                continue;
            }

            appendIfPresent(target.contentParts, blockText(block));
            extendNodes(stack, block);
            lastContent = { parts: target.contentParts, nodes: [...stack] };
        }
    }

    if (quote) {
        issues.push(issue("WARNING", "QUOTE_NOT_CLOSED", "Quoted wording was still open at the end of the document", source.pageCount));
        finishQuote(quote);
    }

    if (!hasStructure(root)) {
        throw new NeedsReviewError("No Phần/Chương/Mục/Điều headings were identified in the PDF");
    }

    issues.push(...checkPageCoverage(orderedChunks, source.pageCount, source.blankPages));
    issues.push(...checkNumbering(root));

    const documentTitle = titleParts.length > 0 ? titleParts.join(" ") : null;

    if (!documentTitle) {
        issues.push(issue("ERROR", "TITLE_MISSING", "Document title was not identified", 1));
    }

    if (closingParts.length === 0) {
        issues.push(issue(
            "ERROR",
            "CLOSING_MISSING",
            "No signature block or closing section was found; the PDF may be only one part of the document",
            source.pageCount,
        ));
    }

    const rootContent = [...root.contentParts, ...closingParts].join("\n").trim();

    return {
        document: {
            document_title: documentTitle,
            content: rootContent || null,
            source: {
                snapshot_id: source.snapshotId,
                pdf_sha256: source.pdfSha256,
                part_index: 1,
            },
            parts: root.children.filter((child) => child.kind === "part").map(toPart),
            chapters: root.children.filter((child) => child.kind === "chapter").map(toChapter),
            sections: root.children.filter((child) => child.kind === "section").map(toSection),
            articles: root.children.filter((child) => child.kind === "article").map(toArticle),
        },
        issues,
    };
}

function openStructuralNode(
    stack: DraftNode[],
    block: TranscribedBlock,
    kind: StructuralKind,
    issues: ValidationIssue[],
): DraftNode | null {
    if (!block.number) {
        issues.push(issue("ERROR", "MISSING_NUMBER", `A ${kind} heading has no number`, block.page_start));

        return null;
    }

    while (stack.length > 1 && RANK[stack[stack.length - 1].kind] >= RANK[kind]) {
        stack.pop();
    }

    const parent = stack[stack.length - 1];

    if (!ALLOWED_CHILDREN[parent.kind].includes(kind)) {
        issues.push(issue(
            "ERROR",
            "ORPHAN_NODE",
            `${kind} ${block.number} has no valid parent; kept as text of ${parent.kind}`,
            block.page_start,
        ));

        return null;
    }

    const node = createDraft(kind, block.number, block.title, block.page_start, block.page_end, block.quality, sourceQuote(kind, block));
    appendIfPresent(node.contentParts, block.text);
    parent.children.push(node);
    stack.push(node);
    extendNodes(stack, block);

    return node;
}

/**
 * Quoted wording starts right after an amendment lead-in ("… như sau:"), or with an opening quotation mark
 * on a heading. The reader often drops the opening “ but keeps the closing ”, so the lead-in is the main
 * signal. A lead-in is used once: after its quote closes, the next block belongs to the document again.
 */
function opensQuote(host: DraftNode, block: TranscribedBlock): boolean {
    if (host.kind === "document" || block.kind === "title" || block.kind === "closing") {
        return false;
    }

    if (isStructuralKind(block.kind) && OPENING_QUOTE.test(visibleText(block))) {
        return true;
    }

    // "Sửa đổi một số điểm của khoản 6 Điều 28 như sau: a) Sửa đổi điểm i … như sau:" lists sub-instructions.
    if (AMENDMENT_START.test(block.text ?? "")) {
        return false;
    }

    const lastText = host.contentParts[host.contentParts.length - 1] ?? host.title ?? "";

    return host.quoted.length === 0 && AMENDMENT_LEAD_IN.test(lastText);
}

function closesQuote(block: TranscribedBlock): boolean {
    return CLOSING_QUOTE.test(visibleText(block));
}

/** A quote left open by a misread closing mark ends at the host's next sibling instruction ("13. Sửa đổi …"). */
function leavesQuote(quote: QuoteState, block: TranscribedBlock): boolean {
    if (block.kind === "closing") {
        return true;
    }

    if (block.kind !== quote.host.kind || !block.number || !AMENDMENT_START.test(block.text ?? "")) {
        return false;
    }

    if (block.kind === "point") {
        return nextPointLetter(quote.host.number) === block.number;
    }

    return Number(block.number) === Number(quote.host.number) + 1;
}

/** Quoted headings nest among themselves; quoted text without a heading becomes a text node. */
function addQuotedBlock(quote: QuoteState, block: TranscribedBlock): DraftNode {
    const stack = quote.stack;

    if (isStructuralKind(block.kind) && block.number) {
        while (stack.length > 1 && RANK[stack[stack.length - 1].kind] >= RANK[block.kind]) {
            stack.pop();
        }

        const parent = stack[stack.length - 1];

        if (parent.kind === "document" || ALLOWED_CHILDREN[parent.kind].includes(block.kind)) {
            const node = createDraft(block.kind, block.number, block.title, block.page_start, block.page_end, block.quality, sourceQuote(block.kind, block));

            appendIfPresent(node.contentParts, block.text);
            parent.children.push(node);
            stack.push(node);

            return node;
        }
    }

    const target = stack[stack.length - 1];

    if (target.kind !== "document") {
        appendIfPresent(target.contentParts, blockText(block));
        extendNodes([target], block);

        return target;
    }

    const textNode = createDraft("text", String(target.children.length + 1), null, block.page_start, block.page_end, block.quality, null);

    appendIfPresent(textNode.contentParts, blockText(block));
    target.children.push(textNode);

    return textNode;
}

function finishQuote(quote: QuoteState): void {
    quote.host.quoted.push(...quote.stack[0].children);
}

function visibleText(block: TranscribedBlock): string {
    return [block.marker, block.title, block.text].filter((value) => value).join(" ").trim();
}

/**
 * Repairs the two misreads seen on scanned decrees, only when the sequence makes the intent unambiguous:
 * point "l)" read as clause "1." and a second point "d)" that must be "đ)". Each repair is reported.
 */
function correctCommonMisreads(stack: DraftNode[], block: TranscribedBlock, issues: ValidationIssue[]): TranscribedBlock {
    const current = stack[stack.length - 1];

    if (current.kind !== "point") {
        return block;
    }

    const expectedLetter = nextPointLetter(current.number);
    const isLetterL = block.kind === "clause" && block.number === "1" && expectedLetter === "l";
    const isLetterDStroke = block.kind === "point" && block.number === "d" && current.number === "d";

    if (!isLetterL && !isLetterDStroke) {
        return block;
    }

    const number = isLetterL ? "l" : "đ";
    issues.push(issue("WARNING", "MARKER_REPAIRED", `Marker "${block.marker}" read as point ${number}) from the sequence`, block.page_start));

    return { ...block, kind: "point", number };
}

/**
 * The reader sometimes returns Cyrillic look-alikes in point markers ("р)", "с)"). Markers are only ever
 * Latin/Vietnamese letters, so a look-alike in a marker or number is mapped back; body text is untouched.
 */
function normalizeHomoglyphs(block: TranscribedBlock): TranscribedBlock {
    const fix = (value: string | null): string | null => (value === null ? null : value.replace(CYRILLIC_LOOKALIKES, (character) => LATIN_OF[character] ?? character));
    const markerAtTextStart = block.marker === null && block.text ? /^\S{1,3}\)\s/u.exec(block.text) : null;
    const text = markerAtTextStart && block.text ? `${fix(markerAtTextStart[0])}${block.text.slice(markerAtTextStart[0].length)}` : block.text;

    const marker = fix(block.marker);
    const derived = marker && !block.number ? /^[“"]?(?:Điều\s+)?(\d{1,3}[a-zđ]?|[a-zđ])[.)]$/u.exec(marker)?.[1] ?? null : null;

    return { ...block, marker, number: fix(block.number) ?? derived, text };
}

/** A text block that starts with "a) " or "1. " is a point/clause whose marker was left inside the text. */
function splitInlineMarker(block: TranscribedBlock): TranscribedBlock {
    if (block.kind !== "text" || block.marker !== null || !block.text) {
        return block;
    }

    // Quoted new wording keeps its opening mark in the marker, so the quote is still visible to the assembler.
    const article = /^([“"]?)Điều\s+(\d{1,3}[a-zđ]?)\.\s*(\S.*)$/su.exec(block.text);

    if (article) {
        return { ...block, kind: "article", marker: `${article[1]}Điều ${article[2]}.`, number: article[2], title: article[3], text: null, continues_previous: false };
    }

    const point = /^([“"]?)([a-zđ])\)\s+(.+)$/su.exec(block.text);

    if (point) {
        return { ...block, kind: "point", marker: `${point[1]}${point[2]})`, number: point[2], text: point[3], continues_previous: false };
    }

    const clause = /^([“"]?)(\d{1,2}[a-zđ]?)\.\s+(\p{Lu}.+)$/su.exec(block.text);

    if (clause) {
        return { ...block, kind: "clause", marker: `${clause[1]}${clause[2]}.`, number: clause[2], text: clause[3], continues_previous: false };
    }

    return block;
}

/**
 * The model's continuation flag is trusted for unnumbered text (it may start with a capitalised word such as
 * "Điều này"). Lowercase text cannot open a Vietnamese provision, so a marker attached to it is a misread.
 */
function isContinuation(block: TranscribedBlock): boolean {
    if (!block.continues_previous || !block.text) {
        return false;
    }

    if (block.kind === "text") {
        return true;
    }

    return /^\p{Ll}/u.test(block.text);
}

function isUntitledHeading(node: DraftNode): boolean {
    const isHeadingKind = node.kind === "part" || node.kind === "chapter" || node.kind === "section";

    return isHeadingKind && node.title === null && node.contentParts.length === 0 && node.children.length === 0;
}

function createDraft(
    kind: ContainerKind | "text",
    number: string,
    title: string | null,
    pageStart: number,
    pageEnd: number,
    quality: ReadQuality,
    quote: string | null,
): DraftNode {
    return {
        kind,
        number,
        title,
        contentParts: [],
        pageStart,
        pageEnd,
        quality,
        sourceQuote: quote,
        children: [],
        quoted: [],
    };
}

function extendNodes(nodes: DraftNode[], block: TranscribedBlock): void {
    for (const node of nodes) {
        if (node.kind === "document") {
            continue;
        }

        node.pageEnd = Math.max(node.pageEnd, block.page_end);
        node.quality = worstQuality(node.quality, block.quality);
    }
}

function sourceQuote(kind: StructuralKind, block: TranscribedBlock): string {
    const heading = {
        part: `Phần ${block.number}`,
        chapter: `Chương ${block.number}`,
        section: `Mục ${block.number}`,
        article: `Điều ${block.number}.`,
        clause: `${block.number}.`,
        point: `${block.number})`,
    }[kind];
    const detail = block.title ?? block.text ?? "";

    return `${heading} ${detail.slice(0, 120)}`.trim();
}

function blockText(block: TranscribedBlock): string | null {
    if (block.kind === "text" || block.kind === "title") {
        return block.text;
    }

    // Structural blocks that could not be attached keep their visible heading as plain text.
    return [block.marker, block.title, block.text].filter((value) => value !== null).join(" ") || null;
}

function worstQuality(first: ReadQuality, second: ReadQuality): ReadQuality {
    return QUALITY_ORDER.indexOf(first) >= QUALITY_ORDER.indexOf(second) ? first : second;
}

function hasStructure(root: DraftNode): boolean {
    return root.children.length > 0;
}

function isStructuralKind(kind: string): kind is StructuralKind {
    return kind in RANK && kind !== "document" && kind !== "text";
}

function appendIfPresent(parts: string[], text: string | null): void {
    if (text) {
        parts.push(text);
    }
}

function toNodeBase(node: DraftNode): NodeBase {
    const content = node.contentParts.join("\n").trim();
    const locator: SourceLocator = {
        page_start: node.pageStart,
        page_end: node.pageEnd,
        regions: [],
        source_quote: node.sourceQuote,
        method: "LLM",
        quality: node.quality,
    };

    const base: NodeBase = {
        number: node.number,
        title: node.title,
        content: content || null,
        source_locator: locator,
    };

    if (node.quoted.length > 0) {
        base.quoted = node.quoted.map(toQuoted);
    }

    return base;
}

function toQuoted(node: DraftNode): QuotedNode {
    const { number, title, content, source_locator: locator } = toNodeBase(node);

    return {
        kind: node.kind as QuotedKind,
        number,
        title,
        content,
        source_locator: locator,
        children: node.children.map(toQuoted),
    };
}

function childrenOf(node: DraftNode, kind: StructuralKind): DraftNode[] {
    return node.children.filter((child) => child.kind === kind);
}

function toPart(node: DraftNode) {
    return {
        ...toNodeBase(node),
        chapters: childrenOf(node, "chapter").map(toChapter),
        sections: childrenOf(node, "section").map(toSection),
        articles: childrenOf(node, "article").map(toArticle),
    };
}

function toChapter(node: DraftNode) {
    return {
        ...toNodeBase(node),
        sections: childrenOf(node, "section").map(toSection),
        articles: childrenOf(node, "article").map(toArticle),
    };
}

function toSection(node: DraftNode) {
    return {
        ...toNodeBase(node),
        articles: childrenOf(node, "article").map(toArticle),
    };
}

function toArticle(node: DraftNode) {
    return {
        ...toNodeBase(node),
        clauses: childrenOf(node, "clause").map(toClause),
    };
}

function toClause(node: DraftNode) {
    return {
        ...toNodeBase(node),
        points: childrenOf(node, "point").map(toNodeBase),
    };
}
