import { extractMetadataFromDocument, normalizeDocNumber } from "./document.matcher";

export type DocumentMetadata = {
    documentId: string;
    documentNumber: string | null;
    normalizedNumber: string | null;
    documentType: string | null;
    agency: string | null;
    issuedAt: string | null;
    effectiveFrom: string | null;
    /** The sentence the effective date was read from, so the date can be checked against the source. */
    effectiveEvidence: string | null;
    metadataNotes: string[];
};

export type MetadataSource = {
    documentId: string;
    title: string | null;
    jsonContent: string;
    /** Provision texts in reading order; quoted new text of amendments must be left out by the caller. */
    provisionTexts: string[];
};

const VIETNAMESE_DATE = /ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})/iu;
const NUMERIC_DATE = /ngày\s+(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/iu;
const EFFECTIVE_CLAUSE = /(?:có hiệu lực|hiệu lực thi hành)(?:\s+thi hành)?\s+(?:kể\s+)?từ\s+ngày[^.;\n]*/iu;

/** Identity and effective-date metadata of one stored document, read from its own text only. */
export function readDocumentMetadata(source: MetadataSource): DocumentMetadata {
    const extracted = extractMetadataFromDocument(source.title ?? "", source.jsonContent);
    const effective = readEffectiveDate(source.provisionTexts);
    const notes = [...extracted.metadata_notes];

    if (!effective) {
        notes.push("Ngày có hiệu lực chưa đọc được từ điều khoản hiệu lực");
    }

    return {
        documentId: source.documentId,
        documentNumber: extracted.document_number,
        normalizedNumber: extracted.document_number ? normalizeDocNumber(extracted.document_number) : null,
        documentType: extracted.document_type,
        agency: extracted.agency,
        issuedAt: extracted.issued_at,
        effectiveFrom: effective?.date ?? null,
        effectiveEvidence: effective?.evidence ?? null,
        metadataNotes: notes,
    };
}

/** Reads "ngày 01 tháng 01 năm 2020" or "ngày 01/01/2020" as an ISO date; null when there is none. */
export function parseVietnameseDate(text: string): string | null {
    const match = VIETNAMESE_DATE.exec(text) ?? NUMERIC_DATE.exec(text);

    if (!match) {
        return null;
    }

    const day = Number(match[1]);
    const month = Number(match[2]);

    if (day < 1 || day > 31 || month < 1 || month > 12) {
        return null;
    }

    return `${match[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The first "có hiệu lực (thi hành) kể từ ngày …" clause that carries an explicit date. A clause such as
 * "kể từ ngày ký" has no calendar date and is skipped rather than guessed.
 */
function readEffectiveDate(provisionTexts: string[]): { date: string; evidence: string } | null {
    for (const text of provisionTexts) {
        const clause = EFFECTIVE_CLAUSE.exec(text);

        if (!clause) {
            continue;
        }

        const date = parseVietnameseDate(clause[0]);

        if (date) {
            return { date, evidence: clause[0].trim() };
        }
    }

    return null;
}
