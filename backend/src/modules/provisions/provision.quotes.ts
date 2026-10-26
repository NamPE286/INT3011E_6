export type QuoteScan = {
    /** The text begins inside a quotation opened by an earlier provision. */
    startsInsideQuote: boolean;
    /** The text itself begins with an opening quotation mark. */
    startsWithQuote: boolean;
    /** Quotation depth left open at the end of the text. */
    depthAfter: number;
    /** Everything that sits between quotation marks. */
    segments: string[];
    /** The text with every quoted segment removed. */
    unquotedText: string;
};

const OPENING_MARK = "“";
const CLOSING_MARK = "”";
const STRAIGHT_MARK = "\"";

/**
 * Splits a provision's text into quoted and unquoted parts. Quotation state carries over from the
 * previous provision (`depthBefore`) because an amendment opens a quote in one node and closes it in a later one.
 */
export function scanQuotes(text: string, depthBefore: number): QuoteScan {
    const leadingText = text.trimStart();
    const startsWithQuote = depthBefore === 0 && (leadingText.startsWith(OPENING_MARK) || leadingText.startsWith(STRAIGHT_MARK));
    const segments: string[] = [];
    let depth = depthBefore;
    let quoted = "";
    let unquoted = "";

    for (const character of text) {
        const opensQuote = character === OPENING_MARK || (character === STRAIGHT_MARK && depth === 0);
        const closesQuote = depth > 0 && (character === CLOSING_MARK || character === STRAIGHT_MARK);

        if (opensQuote) {
            depth++;

            continue;
        }

        if (closesQuote) {
            depth--;

            if (depth === 0) {
                segments.push(quoted);
                quoted = "";
                unquoted += " ";
            }

            continue;
        }

        if (depth > 0) {
            quoted += character;
        } else {
            unquoted += character;
        }
    }

    if (depth > 0 && quoted) {
        segments.push(quoted);
    }

    return {
        startsInsideQuote: depthBefore > 0,
        startsWithQuote,
        depthAfter: depth,
        segments: segments.map((segment) => segment.trim()).filter((segment) => segment.length > 0),
        unquotedText: unquoted,
    };
}
