import { normalizeText, removeVietnameseAccents } from "./vocabulary.similarity";

export type LegalDocumentSource = {
    id: string;
    document_title: string | null;
    json_content: string;
};

export type ProvisionVerificationResult = {
    verified: boolean;
    reason?: string;
    matchedDocumentId?: string;
};

type ProvisionTarget = {
    article: string;
    clause: string | null;
    point: string | null;
};

type ProvisionNode = {
    number: string;
    title: string | null;
    content: string | null;
    clauses: ProvisionNode[];
    points: ProvisionNode[];
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STRUCTURE_KEYS = ["parts", "chapters", "sections"] as const;
const PLACEHOLDER_EVIDENCE = new Set([
    "none",
    "n/a",
    "null",
    "undefined",
    "test",
    "placeholder",
    "chua co",
    "không có",
    "khong co",
]);

export function isJobOrSnapshotId(identifier: string): boolean {
    const lower = identifier.trim().toLowerCase();

    if (UUID_REGEX.test(lower)) {
        return true;
    }

    const isStorageKey = lower.startsWith("snapshots/") || lower.startsWith("uploads/") || lower.startsWith("runs/");
    const isFileName = lower.endsWith(".pdf") || lower.endsWith(".json");

    return lower.startsWith("job-") || lower.startsWith("job_") || isStorageKey || isFileName;
}

export function validateEvidenceAndProvenance(evidence: string, sourceProvisionId: string): void {
    const trimmedEvidence = typeof evidence === "string" ? evidence.trim() : "";

    if (!trimmedEvidence) {
        throw new Error("Invalid evidence: Legal evidence text is required and cannot be empty");
    }

    if (PLACEHOLDER_EVIDENCE.has(trimmedEvidence.toLowerCase())) {
        throw new Error("Invalid evidence: Placeholder or empty evidence text is not permitted");
    }

    if (trimmedEvidence.length < 5) {
        throw new Error("Invalid evidence: Legal evidence text must have meaningful length (at least 5 characters)");
    }

    const trimmedProvisionId = typeof sourceProvisionId === "string" ? sourceProvisionId.trim() : "";

    if (!trimmedProvisionId) {
        throw new Error("Invalid source_provision_id: Legal provision identifier is required and cannot be empty");
    }

    if (isJobOrSnapshotId(trimmedProvisionId)) {
        throw new Error("Invalid source_provision_id: Job ID or Snapshot ID cannot be used as stable Provision ID");
    }
}

/** Splits "doc_id:dieu_5_khoan_1" / "doc_id#..." into a document filter and the provision reference. */
export function splitQualifiedProvisionId(sourceProvisionId: string): { documentId: string | null; provisionRef: string } {
    const reference = sourceProvisionId.trim();
    const colonIndex = reference.indexOf(":");
    const separatorIndex = colonIndex !== -1 ? colonIndex : reference.indexOf("#");

    if (separatorIndex <= 0) {
        return { documentId: null, provisionRef: reference };
    }

    return {
        documentId: reference.slice(0, separatorIndex).trim(),
        provisionRef: reference.slice(separatorIndex + 1).trim(),
    };
}

/**
 * Checks that the referenced Điều/Khoản/Điểm exists in a stored legal document and that the evidence text
 * comes from it. A bare reference that exists in several documents is ambiguous and is rejected.
 */
export function verifyProvisionInLegalDocuments(
    documents: LegalDocumentSource[],
    sourceProvisionId: string,
    evidence: string,
    sourceDocumentId?: string | null,
): ProvisionVerificationResult {
    if (documents.length === 0) {
        return { verified: false, reason: "No legal documents found in repository to verify provenance" };
    }

    const qualified = splitQualifiedProvisionId(sourceProvisionId);
    const documentFilter = sourceDocumentId?.trim() || qualified.documentId;
    const candidates = documentFilter
        ? documents.filter((document) => matchesDocument(document, documentFilter))
        : documents;

    if (documentFilter && candidates.length === 0) {
        return { verified: false, reason: `Source document '${documentFilter}' not found in repository` };
    }

    const target = parseProvisionTarget(qualified.provisionRef);

    if (!target) {
        return { verified: false, reason: `Provision reference '${sourceProvisionId}' does not name an article (Điều)` };
    }

    const matches = candidates
        .map((document) => ({ document, texts: findProvisionTexts(document, target) }))
        .filter((match) => match.texts.length > 0);

    if (matches.length === 0) {
        const scope = documentFilter ? ` in source document '${documentFilter}'` : " in source legal documents";

        return { verified: false, reason: `Provision '${sourceProvisionId}' not found${scope}` };
    }

    if (!documentFilter && matches.length > 1) {
        const documentList = matches.map((match) => `'${match.document.document_title ?? match.document.id}' (${match.document.id})`).join(", ");

        return {
            verified: false,
            reason: `Ambiguous provision reference '${sourceProvisionId}': provision exists in multiple legal documents [${documentList}]. Please specify 'source_document_id' or use qualified format '<doc_id>:${sourceProvisionId}'.`,
        };
    }

    const normalizedEvidence = normalizeText(evidence);

    for (const match of matches) {
        if (match.texts.some((text) => matchesEvidence(text, normalizedEvidence))) {
            return { verified: true, matchedDocumentId: match.document.id };
        }
    }

    const scope = documentFilter ? ` in document '${documentFilter}'` : "";

    return {
        verified: false,
        reason: `Legal evidence does not match text in provision '${qualified.provisionRef}'${scope}`,
    };
}

function matchesDocument(document: LegalDocumentSource, filter: string): boolean {
    const normalizedFilter = removeVietnameseAccents(filter.toLowerCase());
    const normalizedTitle = removeVietnameseAccents((document.document_title ?? "").toLowerCase());

    return document.id.toLowerCase() === filter.toLowerCase() || normalizedTitle === normalizedFilter;
}

function parseProvisionTarget(provisionRef: string): ProvisionTarget | null {
    const reference = removeVietnameseAccents(normalizeText(provisionRef));
    const article = reference.match(/(?:dieu|art)[_\s]*(\d+[a-z]?)/i)
        ?? reference.match(/(?:^|_)d(\d+)(?:_|$)/i)
        ?? reference.match(/^(\d+)$/);

    if (!article) {
        return null;
    }

    const clause = reference.match(/(?:khoan|clause)[_\s]*(\d+)/i) ?? reference.match(/(?:^|_)k(\d+)(?:_|$)/i);
    const point = reference.match(/(?:diem|point|pt)[_\s]*([a-z0-9]+)/i) ?? reference.match(/(?:^|_)d([a-z])(?:_|$)/i);

    return {
        article: article[1],
        clause: clause?.[1] ?? null,
        point: point?.[1]?.toLowerCase() ?? null,
    };
}

/**
 * Returns the text of every node matching the target (normally one), including the article title and the
 * parents' lead-in text: the subject and vehicle of a sanction are usually named only in the article title.
 */
function findProvisionTexts(document: LegalDocumentSource, target: ProvisionTarget): string[] {
    let parsed: unknown;

    try {
        parsed = JSON.parse(document.json_content);
    } catch {
        return [];
    }

    const texts: string[] = [];

    for (const article of collectArticles(parsed)) {
        if (stripPrefix(article.number, "Điều") !== target.article) {
            continue;
        }

        if (!target.clause) {
            texts.push(nodeText(article));
            continue;
        }

        for (const clause of article.clauses) {
            if (stripPrefix(clause.number, "Khoản") !== target.clause) {
                continue;
            }

            const articleLeadIn = `${article.title ?? ""} ${article.content ?? ""}`;

            if (!target.point) {
                texts.push(`${articleLeadIn} ${nodeText(clause)}`);
                continue;
            }

            for (const point of clause.points) {
                // Point letters are compared without accents so "diem_d" can address "đ".
                const pointLetter = removeVietnameseAccents(stripPrefix(point.number, "Điểm").toLowerCase());

                if (pointLetter === target.point) {
                    texts.push(`${articleLeadIn} ${clause.content ?? ""} ${nodeText(point)}`);
                }
            }
        }
    }

    return texts;
}

function collectArticles(container: unknown): ProvisionNode[] {
    if (!isRecord(container)) {
        return [];
    }

    const articles = readNodes(container.articles);

    for (const key of STRUCTURE_KEYS) {
        const children = Array.isArray(container[key]) ? container[key] : [];

        for (const child of children) {
            articles.push(...collectArticles(child));
        }
    }

    return articles;
}

function readNodes(value: unknown): ProvisionNode[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter(isRecord).map((node) => ({
        number: typeof node.number === "string" || typeof node.number === "number" ? String(node.number) : "",
        title: typeof node.title === "string" ? node.title : null,
        content: typeof node.content === "string" ? node.content : null,
        clauses: readNodes(node.clauses),
        points: readNodes(node.points),
    }));
}

function nodeText(node: ProvisionNode): string {
    const childText = [...node.clauses, ...node.points].map(nodeText).join(" ");

    return `${node.title ?? ""} ${node.content ?? ""} ${childText}`;
}

function stripPrefix(number: string, prefix: string): string {
    return number.replace(new RegExp(`^${prefix}\\s*`, "i"), "").trim();
}

function matchesEvidence(provisionText: string, normalizedEvidence: string): boolean {
    const normalizedText = normalizeText(provisionText);

    if (normalizedText.includes(normalizedEvidence)) {
        return true;
    }

    const evidenceTokens = normalizedEvidence.split(" ").filter((token) => token.length > 2);

    if (evidenceTokens.length === 0) {
        return false;
    }

    const matchedTokens = evidenceTokens.filter((token) => normalizedText.includes(token));

    return matchedTokens.length / evidenceTokens.length >= 0.7;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
