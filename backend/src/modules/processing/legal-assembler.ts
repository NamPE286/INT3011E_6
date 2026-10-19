import { checkNumbering, checkPageCoverage, issue, nextPointLetter } from "./legal-validation";
import {
    NeedsReviewError,
    type ChunkTranscription,
    type LegalDocument,
    type NodeBase,
    type ReadQuality,
    type SourceLocator,
    type TranscribedBlock,
    type ValidationIssue,
} from "./legal-types";

type StructuralKind = "part" | "chapter" | "section" | "article" | "clause" | "point";
type ContainerKind = "document" | StructuralKind;

type DraftNode = {
    kind: ContainerKind;
    number: string;
    title: string | null;
    contentParts: string[];
    pageStart: number;
    pageEnd: number;
    quality: ReadQuality;
    sourceQuote: string | null;
    children: DraftNode[];
};

export type AssemblySource = {
    snapshotId: string;
    pdfSha256: string;
    pageCount: number;
};

export type AssemblyResult = {
    document: LegalDocument;
    issues: ValidationIssue[];
};

const RANK: Record<ContainerKind, number> = {
    document: 0,
    part: 1,
    chapter: 2,
    section: 3,
    article: 4,
    clause: 5,
    point: 6,
};

const ALLOWED_CHILDREN: Record<ContainerKind, readonly StructuralKind[]> = {
    document: ["part", "chapter", "section", "article"],
    part: ["chapter", "section", "article"],
    chapter: ["section", "article"],
    section: ["article"],
    article: ["clause"],
    clause: ["point"],
    point: [],
};

const QUALITY_ORDER: readonly ReadQuality[] = ["GOOD", "PARTIAL", "UNREADABLE"];

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
            const block = correctCommonMisreads(stack, splitInlineMarker(transcribed), issues);

            if (isContinuation(block) && lastContent && lastContent.parts.length > 0) {
                if (block.marker) {
                    issues.push(issue(
                        "WARNING",
                        "MARKER_DROPPED",
                        `Marker "${block.marker}" ignored: the text continues the previous page`,
                        block.page_start,
                    ));
                }

                const lastIndex = lastContent.parts.length - 1;
                lastContent.parts[lastIndex] = `${lastContent.parts[lastIndex]} ${block.text}`;
                extendNodes(lastContent.nodes, block);
                continue;
            }

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

    if (!hasStructure(root)) {
        throw new NeedsReviewError("No Phần/Chương/Mục/Điều headings were identified in the PDF");
    }

    issues.push(...checkPageCoverage(orderedChunks, source.pageCount));
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

/** A text block that starts with "a) " or "1. " is a point/clause whose marker was left inside the text. */
function splitInlineMarker(block: TranscribedBlock): TranscribedBlock {
    if (block.kind !== "text" || block.marker !== null || !block.text) {
        return block;
    }

    const point = /^([a-zđ])\)\s+(.+)$/su.exec(block.text);

    if (point) {
        return { ...block, kind: "point", marker: `${point[1]})`, number: point[1], text: point[2], continues_previous: false };
    }

    const clause = /^(\d{1,2})\.\s+(\p{Lu}.+)$/su.exec(block.text);

    if (clause) {
        return { ...block, kind: "clause", marker: `${clause[1]}.`, number: clause[1], text: clause[2], continues_previous: false };
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
    kind: ContainerKind,
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
    return kind in RANK && kind !== "document";
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

    return {
        number: node.number,
        title: node.title,
        content: content || null,
        source_locator: locator,
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
