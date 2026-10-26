import type { ChunkTranscription, IssueSeverity, ReadQuality, ValidationIssue } from "./legal-types";

/** The parts of an assembled node that numbering checks need. */
export type NumberedNode = {
    kind: string;
    number: string;
    pageStart: number;
    children: NumberedNode[];
};

const POINT_LETTERS = "a b c d đ e g h i k l m n o p q r s t u v x y".split(" ");
const ORDINALS = ["nhất", "hai", "ba", "tư", "năm", "sáu", "bảy", "tám", "chín", "mười"];

export function issue(severity: IssueSeverity, code: string, message: string, page: number | null): ValidationIssue {
    return { severity, code, message, page };
}

export function nextPointLetter(letter: string): string | undefined {
    const position = POINT_LETTERS.indexOf(letter);

    return position === -1 ? undefined : POINT_LETTERS[position + 1];
}

/** `blankPages`: pages the PDF itself shows as empty; the reader's UNREADABLE on them is only a warning. */
export function checkPageCoverage(chunks: ChunkTranscription[], pageCount: number, blankPages: readonly number[] = []): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const reportedPages = new Map<number, ReadQuality>();

    for (const chunk of chunks) {
        for (const page of chunk.pages) {
            reportedPages.set(page.page, page.quality);
        }
    }

    for (let page = 1; page <= pageCount; page++) {
        const quality = reportedPages.get(page);

        if (!quality) {
            issues.push(issue("ERROR", "PAGE_NOT_REPORTED", `Page ${page} was not reported by the LLM`, page));
            continue;
        }

        if (quality !== "GOOD" && blankPages.includes(page)) {
            issues.push(issue("WARNING", "PAGE_BLANK", `Page ${page} is marked ${quality}, but the PDF shows no text or image on it`, page));
            continue;
        }

        if (quality !== "GOOD") {
            issues.push(issue("ERROR", `PAGE_${quality}`, `Page ${page} is marked ${quality}`, page));
        }
    }

    return issues;
}

export function checkNumbering(root: NumberedNode): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const articles: NumberedNode[] = [];

    function visit(node: NumberedNode): void {
        const childKinds = new Set(node.children.map((child) => child.kind));

        for (const kind of childKinds) {
            if (kind === "article") {
                continue;
            }

            const siblings = node.children.filter((child) => child.kind === kind);
            issues.push(...checkSequence(siblings, kind === "point" ? letterIndex : numeralIndex));
        }

        for (const child of node.children) {
            if (child.kind === "article") {
                articles.push(child);
            }

            visit(child);
        }
    }

    visit(root);
    // Articles are numbered continuously across chapters and sections of one document.
    issues.push(...checkSequence(articles, numeralIndex));

    return issues;
}

function checkSequence(nodes: NumberedNode[], toIndex: (number: string) => number | null): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    let previous: number | null = null;

    for (const node of nodes) {
        const current = toIndex(node.number);

        if (current === null) {
            issues.push(issue("ERROR", "INVALID_NUMBER", `${node.kind} number "${node.number}" is not recognised`, node.pageStart));
            continue;
        }

        const isSuffixedRepeat = previous === current && /[a-z]$/i.test(node.number) && node.kind === "article";
        const expected: number = previous === null ? 1 : previous + 1;

        if (current !== expected && !isSuffixedRepeat) {
            issues.push(issue(
                "ERROR",
                "NUMBERING_GAP",
                `${node.kind} ${node.number} follows ${previous ?? "nothing"}; expected ${expected}`,
                node.pageStart,
            ));
        }

        previous = current;
    }

    return issues;
}

function numeralIndex(number: string): number | null {
    const arabic = /^(\d+)[a-zđ]?$/iu.exec(number);

    if (arabic) {
        return Number(arabic[1]);
    }

    const ordinal = /^thứ\s+(\p{L}+)$/iu.exec(number);

    if (ordinal) {
        const position = ORDINALS.indexOf(ordinal[1].toLocaleLowerCase("vi"));

        return position === -1 ? null : position + 1;
    }

    if (!/^[IVXLC]+$/i.test(number)) {
        return null;
    }

    const values: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
    const digits = number.toUpperCase().split("").map((digit) => values[digit]);
    let total = 0;

    for (let index = 0; index < digits.length; index++) {
        const isSubtractive = index + 1 < digits.length && digits[index] < digits[index + 1];
        total += isSubtractive ? -digits[index] : digits[index];
    }

    return total;
}

function letterIndex(number: string): number | null {
    const position = POINT_LETTERS.indexOf(number.toLocaleLowerCase("vi"));

    return position === -1 ? null : position + 1;
}
