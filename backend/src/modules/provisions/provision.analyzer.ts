import { flattenLegalDocument } from "./provision.flattener";
import { scanQuotes } from "./provision.quotes";
import { classifyRole } from "./provision.roles";
import type { Provision, ProvisionDraft, ProvisionFlag, ProvisionLevel } from "./provision.types";

type AnalysisState = {
    quoteDepth: number;
    lastInstructionId: string | null;
    introducesViolationsById: Map<string, boolean>;
    articleTitleById: Map<string, string | null>;
};

const STRUCTURE_LEVELS: readonly ProvisionLevel[] = ["PART", "CHAPTER", "SECTION", "ARTICLE"];

export function analyzeLegalDocument(documentId: string, legalDocument: unknown): Provision[] {
    const drafts = flattenLegalDocument(documentId, legalDocument);

    return analyzeProvisions(drafts);
}

/**
 * Assigns a content role and relevance to each draft, in reading order. Reading order matters because
 * an amendment opens a quotation in one provision and the quoted new text continues in the ones after it.
 */
export function analyzeProvisions(drafts: ProvisionDraft[]): Provision[] {
    const state: AnalysisState = {
        quoteDepth: 0,
        lastInstructionId: null,
        introducesViolationsById: new Map(),
        articleTitleById: new Map(),
    };
    const provisions = drafts.map((draft) => analyzeDraft(draft, state));

    if (state.quoteDepth > 0 && provisions.length > 0) {
        addFlag(provisions[provisions.length - 1], "UNBALANCED_QUOTE");
    }

    return provisions;
}

function analyzeDraft(draft: ProvisionDraft, state: AnalysisState): Provision {
    const flags: ProvisionFlag[] = [...draft.flags];

    // A new Điều/Chương cannot start inside a quotation, so a quote still open here was never closed (or misread).
    if (state.quoteDepth > 0 && STRUCTURE_LEVELS.includes(draft.level) && !startsWithQuoteMark(draft.text)) {
        state.quoteDepth = 0;
        flags.push("UNBALANCED_QUOTE");
    }

    const text = draft.text ?? "";
    const scan = scanQuotes(text, state.quoteDepth);
    const isQuotedNode = scan.startsInsideQuote || scan.startsWithQuote;
    const articleTitle = readArticleTitle(draft, state);
    const result = classifyRole({
        level: draft.level,
        title: draft.title,
        text,
        unquotedText: scan.unquotedText,
        quotedSegments: scan.segments,
        isQuotedNode,
        articleTitle,
        parentIntroducesViolations: readParentIntroducesViolations(draft, state),
        isUnreadable: draft.readQuality === "UNREADABLE",
    });

    state.introducesViolationsById.set(draft.id, result.introducesViolations);
    state.articleTitleById.set(draft.id, articleTitle);
    state.quoteDepth = scan.depthAfter;

    if (isQuotedNode && !state.lastInstructionId) {
        flags.push("QUOTE_WITHOUT_INSTRUCTION");
    }

    const containerProvisionId = isQuotedNode ? state.lastInstructionId : null;

    if (result.relevance === "AMENDMENT_INSTRUCTION" || result.relevance === "REPEAL_INSTRUCTION") {
        state.lastInstructionId = draft.id;
    }

    addQualityFlags(draft, scan.segments.length > 0, flags);

    return {
        ...draft,
        flags,
        contentRole: result.contentRole,
        relevance: result.relevance,
        containerProvisionId,
        quotedSegments: scan.segments,
    };
}

function addQualityFlags(draft: ProvisionDraft, hasQuotedText: boolean, flags: ProvisionFlag[]): void {
    if (hasQuotedText) {
        flags.push("HAS_QUOTED_TEXT");
    }

    if (draft.readQuality === "PARTIAL") {
        flags.push("LOW_READ_QUALITY");
    }

    if (draft.readQuality === "UNREADABLE") {
        flags.push("UNREADABLE");
    }
}

function readArticleTitle(draft: ProvisionDraft, state: AnalysisState): string | null {
    if (draft.level === "ARTICLE") {
        return draft.title;
    }

    if (!draft.parentId) {
        return null;
    }

    return state.articleTitleById.get(draft.parentId) ?? null;
}

function readParentIntroducesViolations(draft: ProvisionDraft, state: AnalysisState): boolean {
    if (!draft.parentId) {
        return false;
    }

    return state.introducesViolationsById.get(draft.parentId) ?? false;
}

function startsWithQuoteMark(text: string | null): boolean {
    if (!text) {
        return false;
    }

    const leading = text.trimStart();

    return leading.startsWith("“") || leading.startsWith("\"");
}

function addFlag(provision: Provision, flag: ProvisionFlag): void {
    if (!provision.flags.includes(flag)) {
        provision.flags.push(flag);
    }
}
