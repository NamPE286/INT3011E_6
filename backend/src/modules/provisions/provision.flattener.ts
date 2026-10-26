import type { ReadQuality, SourceRegion } from "../processing/legal-types";
import type { ProvisionDraft, ProvisionLevel } from "./provision.types";

type JsonRecord = Record<string, unknown>;

type StructureKey = "parts" | "chapters" | "sections" | "articles";

type ParentNode = {
    id: string | null;
    stem: string;
    articleNo: string | null;
    paragraphNo: string | null;
};

type FlattenState = {
    documentId: string;
    drafts: ProvisionDraft[];
    usedIds: Set<string>;
};

type NodeSource = {
    number: string;
    title: string | null;
    text: string | null;
    pageStart: number | null;
    pageEnd: number | null;
    sourceQuote: string | null;
    readQuality: ReadQuality | null;
    sourceRegions: SourceRegion[];
};

const STRUCTURE_KEYS: readonly { key: StructureKey; level: ProvisionLevel; prefix: string }[] = [
    { key: "parts", level: "PART", prefix: "phan" },
    { key: "chapters", level: "CHAPTER", prefix: "chuong" },
    { key: "sections", level: "SECTION", prefix: "muc" },
    { key: "articles", level: "ARTICLE", prefix: "dieu" },
];

const READ_QUALITIES: readonly ReadQuality[] = ["GOOD", "PARTIAL", "UNREADABLE"];
const LEGAL_BASIS_LINE = /^Căn\s+cứ\s/iu;
const ROOT_PARENT: ParentNode = { id: null, stem: "", articleNo: null, paragraphNo: null };

/**
 * Walks the stored legal JSON (contract legal-json-v1) in reading order and returns one draft per
 * addressable provision. The JSON comes from D1, so every field is narrowed instead of trusted.
 * Ids follow "<document_id>:dieu_6_khoan_1_diem_a", the same scheme the MCP vocabulary tools verify.
 */
export function flattenLegalDocument(documentId: string, legalDocument: unknown): ProvisionDraft[] {
    const root = asRecord(legalDocument);

    if (!root) {
        return [];
    }

    const state: FlattenState = { documentId, drafts: [], usedIds: new Set() };

    addLegalBasisLines(state, readString(root.content));
    walkStructure(state, root, ROOT_PARENT);

    return state.drafts;
}

function addLegalBasisLines(state: FlattenState, rootContent: string | null): void {
    if (!rootContent) {
        return;
    }

    const lines = rootContent.split("\n").map((line) => line.trim()).filter((line) => LEGAL_BASIS_LINE.test(line));

    lines.forEach((line, index) => {
        const source: NodeSource = {
            number: String(index + 1),
            title: null,
            text: line,
            pageStart: null,
            pageEnd: null,
            sourceQuote: null,
            readQuality: null,
            sourceRegions: [],
        };

        addDraft(state, "PREAMBLE", `can_cu_${index + 1}`, source, ROOT_PARENT, { articleNo: null, paragraphNo: null, pointNo: null });
    });
}

type StructureEntry = {
    node: JsonRecord;
    level: ProvisionLevel;
    prefix: string;
};
function walkStructure(state: FlattenState, container: JsonRecord, parent: ParentNode): void {
    for (const { node, level, prefix } of readStructureEntries(container)) {
        const source = readNodeSource(node);
        const stem = level === "ARTICLE" ? `dieu_${slug(source.number)}` : joinStem(parent.stem, `${prefix}_${slug(source.number)}`);
        const articleNo = level === "ARTICLE" ? source.number : null;
        const draft = addDraft(state, level, stem, source, parent, { articleNo, paragraphNo: null, pointNo: null });

        addQuoted(state, node, draft);
        const nodeParent: ParentNode = { id: draft.id, stem: stemOf(state, draft), articleNo, paragraphNo: null };

        if (level === "ARTICLE") {
            walkClauses(state, node, nodeParent);
        } else {
            walkStructure(state, node, nodeParent);
        }
    }
}

/**
 * The legal JSON keeps Mục and Điều of one container in separate arrays, so their reading order is lost.
 * Điều numbers rise through a document, so a Mục is placed by the first Điều it contains and loose Điều
 * sit among the Mục by their own number. Phần and Chương keep their stored order.
 */
function readStructureEntries(container: JsonRecord): StructureEntry[] {
    const entries: StructureEntry[] = [];
    const interleaved: (StructureEntry & { sortKey: number })[] = [];
    let carriedKey = 0;

    for (const { key, level, prefix } of STRUCTURE_KEYS) {
        for (const node of readNodes(container, key)) {
            if (level === "PART" || level === "CHAPTER") {
                entries.push({ node, level, prefix });

                continue;
            }

            carriedKey = readFirstArticleNumber(node, level) ?? carriedKey;
            interleaved.push({ node, level, prefix, sortKey: carriedKey });
        }
    }

    // Array.prototype.sort is stable, so equal keys keep the stored Mục-before-Điều order.
    interleaved.sort((left, right) => left.sortKey - right.sortKey);

    for (const { node, level, prefix } of interleaved) {
        entries.push({ node, level, prefix });
    }

    return entries;
}

function readFirstArticleNumber(node: JsonRecord, level: ProvisionLevel): number | null {
    if (level === "ARTICLE") {
        return readLeadingInteger(readString(node.number));
    }

    for (const article of readNodes(node, "articles")) {
        const articleNumber = readLeadingInteger(readString(article.number));

        if (articleNumber !== null) {
            return articleNumber;
        }
    }

    return null;
}

function readLeadingInteger(value: string | null): number | null {
    const match = value ? /\d+/u.exec(value) : null;

    return match ? Number(match[0]) : null;
}

function walkClauses(state: FlattenState, article: JsonRecord, articleParent: ParentNode): void {
    for (const clause of readNodes(article, "clauses")) {
        const source = readNodeSource(clause);
        const stem = `${articleParent.stem}_khoan_${slug(source.number)}`;
        const locator = { articleNo: articleParent.articleNo, paragraphNo: source.number, pointNo: null };
        const draft = addDraft(state, "CLAUSE", stem, source, articleParent, locator);

        addQuoted(state, clause, draft);
        const clauseParent: ParentNode = { id: draft.id, stem: stemOf(state, draft), articleNo: articleParent.articleNo, paragraphNo: source.number };

        walkPoints(state, clause, clauseParent);
    }
}

function walkPoints(state: FlattenState, clause: JsonRecord, clauseParent: ParentNode): void {
    for (const point of readNodes(clause, "points")) {
        const source = readNodeSource(point);
        const stem = `${clauseParent.stem}_diem_${slug(source.number)}`;
        const locator = { articleNo: clauseParent.articleNo, paragraphNo: clauseParent.paragraphNo, pointNo: source.number };

        const draft = addDraft(state, "POINT", stem, source, clauseParent, locator);

        addQuoted(state, point, draft);
    }
}

type Locator = Pick<ProvisionDraft, "articleNo" | "paragraphNo" | "pointNo">;

const QUOTED_LEVELS: Record<string, { level: ProvisionLevel; segment: string }> = {
    part: { level: "PART", segment: "phan" },
    chapter: { level: "CHAPTER", segment: "chuong" },
    section: { level: "SECTION", segment: "muc" },
    article: { level: "ARTICLE", segment: "dieu" },
    clause: { level: "CLAUSE", segment: "khoan" },
    point: { level: "POINT", segment: "diem" },
    text: { level: "TEXT", segment: "doan" },
};
const NO_LOCATOR: Locator = { articleNo: null, paragraphNo: null, pointNo: null };

/**
 * Quoted new wording of an amendment follows its instruction in reading order, under the instruction's id:
 * "Sửa đổi, bổ sung Điều 20 như sau: “Điều 20 … 1. …”" gives "<doc>:dieu_1_khoan_12_q_dieu_20_khoan_1".
 * It has no Điều/Khoản/Điểm of this document, so its locator stays empty.
 */
function addQuoted(state: FlattenState, node: JsonRecord, host: ProvisionDraft): void {
    for (const quoted of readNodes(node, "quoted")) {
        addQuotedNode(state, quoted, host, `${stemOf(state, host)}_q`, host.id);
    }
}

function addQuotedNode(state: FlattenState, node: JsonRecord, parent: ProvisionDraft, parentStem: string, hostId: string): void {
    const kind = QUOTED_LEVELS[readString(node.kind) ?? ""];

    if (!kind) {
        return;
    }

    const source = readNodeSource(node);
    const stem = `${parentStem}_${kind.segment}_${slug(source.number)}`;
    const draft = addDraft(state, kind.level, stem, source, { id: parent.id, stem: parentStem, articleNo: null, paragraphNo: null }, NO_LOCATOR, hostId);

    for (const child of readNodes(node, "children")) {
        addQuotedNode(state, child, draft, stemOf(state, draft), hostId);
    }
}

function addDraft(
    state: FlattenState,
    level: ProvisionLevel,
    stem: string,
    source: NodeSource,
    parent: ParentNode,
    locator: Locator,
    quoteHostId: string | null = null,
): ProvisionDraft {
    const { uniqueStem, isDuplicate } = reserveStem(state, stem);
    const draft: ProvisionDraft = {
        id: `${state.documentId}:${uniqueStem}`,
        documentId: state.documentId,
        parentId: parent.id,
        ordinal: state.drafts.length,
        level,
        number: source.number,
        title: source.title,
        text: source.text,
        ...locator,
        pageStart: source.pageStart,
        pageEnd: source.pageEnd,
        sourceQuote: source.sourceQuote,
        readQuality: source.readQuality,
        sourceRegions: source.sourceRegions,
        flags: isDuplicate ? ["DUPLICATE_ID"] : [],
        quoteHostId,
    };

    state.drafts.push(draft);

    return draft;
}

function reserveStem(state: FlattenState, stem: string): { uniqueStem: string; isDuplicate: boolean } {
    let uniqueStem = stem;
    let attempt = 1;

    while (state.usedIds.has(uniqueStem)) {
        attempt++;
        uniqueStem = `${stem}_dup${attempt}`;
    }

    state.usedIds.add(uniqueStem);

    return { uniqueStem, isDuplicate: attempt > 1 };
}

function stemOf(state: FlattenState, draft: ProvisionDraft): string {
    return draft.id.slice(state.documentId.length + 1);
}

function joinStem(parentStem: string, segment: string): string {
    if (!parentStem) {
        return segment;
    }

    return `${parentStem}_${segment}`;
}

function slug(value: string): string {
    const cleaned = value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");

    return cleaned || "unnumbered";
}

function readNodeSource(node: JsonRecord): NodeSource {
    const locator = asRecord(node.source_locator);
    const quality = locator?.quality;

    return {
        number: readString(node.number) ?? "",
        title: readString(node.title),
        text: readString(node.content),
        pageStart: readInteger(locator?.page_start),
        pageEnd: readInteger(locator?.page_end),
        sourceQuote: readString(locator?.source_quote),
        readQuality: readReadQuality(quality),
        sourceRegions: readSourceRegions(locator?.regions),
    };
}

function readReadQuality(value: unknown): ReadQuality | null {
    for (const quality of READ_QUALITIES) {
        if (quality === value) {
            return quality;
        }
    }

    return null;
}

function readSourceRegions(value: unknown): SourceRegion[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const regions: SourceRegion[] = [];

    for (const item of value) {
        const record = asRecord(item);
        const page = readInteger(record?.page);
        const bbox = record?.bbox;

        if (page === null || !Array.isArray(bbox) || bbox.length !== 4 || !bbox.every((edge) => typeof edge === "number")) {
            continue;
        }

        regions.push({ page, bbox: [bbox[0], bbox[1], bbox[2], bbox[3]] });
    }

    return regions;
}

function readNodes(container: JsonRecord, key: string): JsonRecord[] {
    const value = container[key];

    if (!Array.isArray(value)) {
        return [];
    }

    const nodes: JsonRecord[] = [];

    for (const item of value) {
        const record = asRecord(item);

        if (record) {
            nodes.push(record);
        }
    }

    return nodes;
}

function asRecord(value: unknown): JsonRecord | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null;
    }

    return value as JsonRecord;
}

function readString(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();

    return trimmed ? trimmed : null;
}

function readInteger(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isInteger(value)) {
        return null;
    }

    return value;
}
