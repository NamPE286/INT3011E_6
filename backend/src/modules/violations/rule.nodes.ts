import { locatorToProvisionId, type ProvisionLocator } from "../changes/change.locator";
import type { ProvisionRelation } from "../changes/change.types";
import type { StoredProvision } from "../provisions/provision.repository";
import type { RuleNode } from "./violation.types";

const RULE_LEVELS = new Set(["ARTICLE", "CLAUSE", "POINT"]);
const SKIPPED_ROLES = new Set(["OPERATIVE_INSTRUCTION", "TITLE_REFERENCE", "HISTORICAL_DESCRIPTION", "PREAMBLE_BASIS", "QUOTED_OLD_TEXT"]);
const LEADING_MARKER = /^\s*[“"]?\s*(?:Điều\s+\d+[a-zđ]?\.|\d+[a-zđ]?\.|[a-zđ]\d*\))\s*/iu;
const SURROUNDING_QUOTES = /^[\s“"]+|[\s”"]+$/gu;

/**
 * Places every rule-bearing provision of one document at the address it governs. Ordinary text governs
 * its own address. Quoted new text of an amendment governs the address its instruction resolved to
 * (a quoted "a) …" under "Sửa đổi điểm a khoản 5 Điều 5" governs điểm a khoản 5 Điều 5 of the target);
 * quoted text whose instruction did not resolve to exactly one address cannot be placed and is skipped.
 */
export function buildRuleNodes(
    provisions: StoredProvision[],
    relationsByInstruction: Map<string, ProvisionRelation[]>,
    articleTitles: Map<string, string | null>,
): RuleNode[] {
    const nodes = new Map<string, RuleNode>();

    for (const provision of provisions) {
        if (!RULE_LEVELS.has(provision.level) || SKIPPED_ROLES.has(provision.contentRole) || !provision.text) {
            continue;
        }

        const position = provision.contentRole === "QUOTED_NEW_TEXT"
            ? placeQuoted(provision, nodes, relationsByInstruction)
            : placeOwn(provision);

        if (!position) {
            continue;
        }

        const governedArticleId = locatorToProvisionId(position.documentId, { article: position.locator.article, clause: null, point: null });

        nodes.set(provision.id, {
            provisionId: provision.id,
            sourceDocumentId: provision.documentId,
            level: provision.level,
            number: provision.number,
            title: provision.title,
            text: cleanRuleText(provision.text),
            parentProvisionId: provision.parentId,
            governedDocumentId: position.documentId,
            governedProvisionId: locatorToProvisionId(position.documentId, position.locator),
            article: position.locator.article,
            clause: position.locator.clause,
            point: position.locator.point,
            articleTitle: articleTitles.get(governedArticleId) ?? null,
            isQuoted: provision.contentRole === "QUOTED_NEW_TEXT",
            readQuality: provision.readQuality,
        });
    }

    return [...nodes.values()];
}

/** Text of a rule without the quotation marks and the "a)" / "5." marker the reader may have kept. */
export function cleanRuleText(text: string): string {
    return text.replace(SURROUNDING_QUOTES, "").replace(LEADING_MARKER, "").replace(SURROUNDING_QUOTES, "").trim();
}

function placeOwn(provision: StoredProvision): { documentId: string; locator: ProvisionLocator } | null {
    if (!provision.articleNo) {
        return null;
    }

    return {
        documentId: provision.documentId,
        locator: { article: provision.articleNo, clause: provision.paragraphNo, point: provision.pointNo },
    };
}

function placeQuoted(
    provision: StoredProvision,
    placed: Map<string, RuleNode>,
    relationsByInstruction: Map<string, ProvisionRelation[]>,
): { documentId: string; locator: ProvisionLocator } | null {
    const quotedParent = provision.parentId ? placed.get(provision.parentId) : undefined;

    if (quotedParent?.isQuoted) {
        return placeUnder(quotedParent, provision);
    }

    const relations = provision.containerProvisionId ? relationsByInstruction.get(provision.containerProvisionId) ?? [] : [];

    if (relations.length !== 1) {
        return null;
    }

    const [relation] = relations;
    const locator = relation.insertionLocator ?? relation.targetLocator;

    return { documentId: relation.toDocumentId, locator: deepenTo(locator, provision) };
}

function placeUnder(parent: RuleNode, provision: StoredProvision): { documentId: string; locator: ProvisionLocator } | null {
    if (!parent.article) {
        return null;
    }

    if (provision.level === "POINT" && parent.clause && !parent.point) {
        return { documentId: parent.governedDocumentId, locator: { article: parent.article, clause: parent.clause, point: provision.number } };
    }

    if (provision.level === "CLAUSE" && !parent.clause) {
        return { documentId: parent.governedDocumentId, locator: { article: parent.article, clause: provision.number, point: null } };
    }

    return null;
}

/** A quoted unit one level below the resolved address ("Sửa đổi khoản 5: “a) …”") sits inside it. */
function deepenTo(locator: ProvisionLocator, provision: StoredProvision): ProvisionLocator {
    if (provision.level === "POINT" && locator.clause && !locator.point) {
        return { ...locator, point: provision.number };
    }

    if (provision.level === "CLAUSE" && !locator.clause) {
        return { ...locator, clause: provision.number };
    }

    return locator;
}
