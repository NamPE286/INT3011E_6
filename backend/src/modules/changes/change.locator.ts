/** A provision address inside one document: Điều → Khoản → Điểm. Missing lower levels mean the whole unit. */
export type ProvisionLocator = {
    article: string;
    clause: string | null;
    point: string | null;
};

type Level = "ARTICLE" | "CLAUSE" | "POINT";

type LocatorGroup = {
    level: Level;
    ids: string[];
};

type PendingClause = {
    clause: string;
    points: string[];
};

const LEVEL_WORDS: Record<string, Level> = {
    "điều": "ARTICLE",
    "khoản": "CLAUSE",
    "điểm": "POINT",
};

const POINT_LETTERS = ["a", "b", "c", "d", "đ", "e", "g", "h", "i", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "x", "y"];
const NUMBER_ID = /^\d+[a-zđ]?$/u;
const POINT_ID = /^[a-zđ]\d*$/u;
const LIST_SEPARATORS = new Set([",", "và", "hoặc"]);
const TOKEN_REGEX = /[\p{L}\p{N}]+|[,;.:]/gu;

/**
 * Reads every provision address named in an instruction ("điểm a, điểm b khoản 5 và khoản 7 Điều 5",
 * "các điểm a, b và c khoản 2 Điều 7", "từ khoản 1 đến khoản 3 Điều 6"). Vietnamese names the lower
 * level first, so points bind to the next clause and clauses to the next article. Addresses that never
 * reach an article take it (and, for bare points, the clause) from `context` — the address an enclosing
 * instruction targets — or are dropped.
 */
export function parseLocators(text: string, context: ProvisionLocator | null = null): ProvisionLocator[] {
    const groups = readGroups(text);
    const locators: ProvisionLocator[] = [];
    let pendingPoints: string[] = [];
    let pendingClauses: PendingClause[] = [];

    const flush = (article: string | null): void => {
        if (!article) {
            return;
        }

        if (pendingClauses.length === 0 && pendingPoints.length === 0) {
            locators.push({ article, clause: null, point: null });
        }

        for (const pending of pendingClauses) {
            if (pending.points.length === 0) {
                locators.push({ article, clause: pending.clause, point: null });
            }

            for (const point of pending.points) {
                locators.push({ article, clause: pending.clause, point });
            }
        }

        pendingPoints = [];
        pendingClauses = [];
    };

    for (const group of groups) {
        if (group.level === "POINT") {
            pendingPoints.push(...group.ids);

            continue;
        }

        if (group.level === "CLAUSE") {
            group.ids.forEach((clause, index) => {
                pendingClauses.push({ clause, points: index === 0 ? pendingPoints : [] });
            });
            pendingPoints = [];

            continue;
        }

        // "khoản 2 Điều 5 và Điều 6": the pending clauses belong to the first article only.
        const [firstArticle, ...otherArticles] = group.ids;

        flush(firstArticle);

        for (const article of otherArticles) {
            locators.push({ article, clause: null, point: null });
        }
    }

    if (pendingClauses.length > 0) {
        flush(context?.article ?? null);
    }

    if (pendingPoints.length > 0 && context?.clause) {
        pendingClauses = [{ clause: context.clause, points: pendingPoints }];
        flush(context.article);
    }

    return dedupe(locators);
}

/** Formats a locator the way the text names it: "điểm a khoản 2 Điều 6". */
export function formatLocator(locator: ProvisionLocator): string {
    const parts: string[] = [];

    if (locator.point) {
        parts.push(`điểm ${locator.point}`);
    }

    if (locator.clause) {
        parts.push(`khoản ${locator.clause}`);
    }

    parts.push(`Điều ${locator.article}`);

    return parts.join(" ");
}

/** The provision id the flattener gives this address in `documentId` ("<doc>:dieu_6_khoan_2_diem_a"). */
export function locatorToProvisionId(documentId: string, locator: ProvisionLocator): string {
    let stem = `dieu_${slug(locator.article)}`;

    if (locator.clause) {
        stem += `_khoan_${slug(locator.clause)}`;
    }

    if (locator.point) {
        stem += `_diem_${slug(locator.point)}`;
    }

    return `${documentId}:${stem}`;
}

/** The enclosing unit of an address: a point's clause, a clause's article; an article has none. */
export function parentLocator(locator: ProvisionLocator): ProvisionLocator | null {
    if (locator.point) {
        return { ...locator, point: null };
    }

    if (locator.clause) {
        return { ...locator, clause: null };
    }

    return null;
}

function readGroups(text: string): LocatorGroup[] {
    const tokens = (text.match(TOKEN_REGEX) ?? []).map((token) => token.toLowerCase());
    const groups: LocatorGroup[] = [];
    let index = 0;

    while (index < tokens.length) {
        const level = LEVEL_WORDS[tokens[index]];

        if (!level) {
            index++;

            continue;
        }

        const read = readIds(tokens, index + 1, level);

        if (read.ids.length > 0) {
            groups.push({ level, ids: read.ids });
        }

        index = Math.max(read.next, index + 1);
    }

    return groups;
}

function readIds(tokens: string[], start: number, level: Level): { ids: string[]; next: number } {
    const ids: string[] = [];
    let index = start;

    while (index < tokens.length && isId(tokens[index], level)) {
        ids.push(tokens[index]);
        index++;

        const separator = tokens[index];

        if (separator === "đến") {
            const rangeEnd = skipLevelWord(tokens, index + 1, level);

            if (isId(tokens[rangeEnd], level)) {
                ids.push(...expandRange(ids[ids.length - 1], tokens[rangeEnd], level).slice(1));
                index = rangeEnd + 1;
            }

            continue;
        }

        if (!LIST_SEPARATORS.has(separator)) {
            break;
        }

        const nextId = skipLevelWord(tokens, index + 1, level);

        if (!isId(tokens[nextId], level)) {
            break;
        }

        index = nextId;
    }

    return { ids, next: index };
}

function skipLevelWord(tokens: string[], index: number, level: Level): number {
    return LEVEL_WORDS[tokens[index]] === level ? index + 1 : index;
}

function isId(token: string | undefined, level: Level): boolean {
    if (!token) {
        return false;
    }

    return level === "POINT" ? POINT_ID.test(token) : NUMBER_ID.test(token);
}

function expandRange(first: string, last: string, level: Level): string[] {
    if (level === "POINT") {
        const from = POINT_LETTERS.indexOf(first);
        const to = POINT_LETTERS.indexOf(last);

        return from >= 0 && to > from ? POINT_LETTERS.slice(from, to + 1) : [first, last];
    }

    const from = Number(first);
    const to = Number(last);

    if (!Number.isInteger(from) || !Number.isInteger(to) || to <= from || to - from > 50) {
        return [first, last];
    }

    return Array.from({ length: to - from + 1 }, (_, offset) => String(from + offset));
}

function dedupe(locators: ProvisionLocator[]): ProvisionLocator[] {
    const seen = new Set<string>();

    return locators.filter((locator) => {
        const key = formatLocator(locator);

        if (seen.has(key)) {
            return false;
        }

        seen.add(key);

        return true;
    });
}

function slug(value: string): string {
    const cleaned = value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");

    return cleaned || "unnumbered";
}
