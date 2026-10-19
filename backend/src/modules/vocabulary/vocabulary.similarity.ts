import type { VocabType } from "./vocabulary.types";

export function removeVietnameseAccents(str: string): string {
    return str
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/Đ/g, "D");
}

export function normalizeText(text: string): string {
    return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function levenshteinDistance(a: string, b: string): number {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }

    return matrix[b.length][a.length];
}

export function tokenDiceSimilarity(a: string, b: string): number {
    const tokensA = normalizeText(a).split(" ").filter(Boolean);
    const tokensB = normalizeText(b).split(" ").filter(Boolean);

    if (tokensA.length === 0 || tokensB.length === 0) {
        return 0;
    }

    const setB = new Set(tokensB);
    let intersection = 0;

    for (const token of tokensA) {
        if (setB.has(token)) {
            intersection++;
        }
    }

    return (2 * intersection) / (tokensA.length + tokensB.length);
}

export function calculateSimilarity(a: string, b: string): number {
    const normA = normalizeText(a);
    const normB = normalizeText(b);

    if (normA === normB) {
        return 1.0;
    }

    const unaccentA = removeVietnameseAccents(normA);
    const unaccentB = removeVietnameseAccents(normB);

    if (unaccentA === unaccentB) {
        return 0.95;
    }

    const maxLen = Math.max(normA.length, normB.length);
    const levDistance = levenshteinDistance(normA, normB);
    const levSim = maxLen === 0 ? 1 : 1 - levDistance / maxLen;

    const tokenSim = tokenDiceSimilarity(normA, normB);
    const unaccentTokenSim = tokenDiceSimilarity(unaccentA, unaccentB);

    return Math.max(levSim, tokenSim, unaccentTokenSim);
}

const TYPE_PREFIXES: Record<VocabType, string> = {
    ACTION: "ACT",
    SUBJECT: "SUB",
    VEHICLE: "VEH",
    TARGET: "TARGET",
    LOCATION: "LOC",
    CONDITION: "COND",
    EXCEPTION: "EXC",
};

export function generateCanonicalId(type: VocabType, label: string): string {
    const prefix = TYPE_PREFIXES[type] ?? "VOCAB";
    const slug = removeVietnameseAccents(label)
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 36);

    return `${prefix}_${slug || "ITEM"}`;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isJobOrSnapshotId(identifier: string): boolean {
    const trimmed = identifier.trim();

    if (UUID_REGEX.test(trimmed)) {
        return true;
    }

    const lower = trimmed.toLowerCase();

    if (
        lower.startsWith("job-") ||
        lower.startsWith("job_") ||
        lower.startsWith("snapshots/") ||
        lower.startsWith("uploads/") ||
        lower.endsWith(".pdf") ||
        lower.endsWith(".json")
    ) {
        return true;
    }

    return false;
}

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

export function validateEvidenceAndProvenance(evidence: string, sourceProvisionId: string): void {
    if (!evidence || typeof evidence !== "string") {
        throw new Error("Invalid evidence: Legal evidence text is required and cannot be empty");
    }

    const trimmedEvidence = evidence.trim();

    if (PLACEHOLDER_EVIDENCE.has(trimmedEvidence.toLowerCase())) {
        throw new Error("Invalid evidence: Placeholder or empty evidence text is not permitted");
    }

    if (trimmedEvidence.length < 5) {
        throw new Error(
            "Invalid evidence: Legal evidence text must have meaningful length (at least 5 characters)"
        );
    }

    if (!sourceProvisionId || typeof sourceProvisionId !== "string") {
        throw new Error(
            "Invalid source_provision_id: Legal provision identifier is required and cannot be empty"
        );
    }

    const trimmedProvisionId = sourceProvisionId.trim();
    if (trimmedProvisionId.length === 0) {
        throw new Error("Invalid source_provision_id: Legal provision identifier cannot be blank");
    }

    if (isJobOrSnapshotId(trimmedProvisionId)) {
        throw new Error(
            "Invalid source_provision_id: Job ID or Snapshot ID cannot be used as stable Provision ID"
        );
    }
}

export interface ProvisionVerificationResult {
    verified: boolean;
    reason?: string;
    matchedDocumentId?: string;
}

function extractArticles(doc: any): any[] {
    const articles: any[] = [];
    if (Array.isArray(doc.articles)) articles.push(...doc.articles);
    if (Array.isArray(doc.parts)) {
        for (const p of doc.parts) {
            if (Array.isArray(p.articles)) articles.push(...p.articles);
            if (Array.isArray(p.chapters)) {
                for (const c of p.chapters) {
                    if (Array.isArray(c.articles)) articles.push(...c.articles);
                    if (Array.isArray(c.sections)) {
                        for (const s of c.sections) {
                            if (Array.isArray(s.articles)) articles.push(...s.articles);
                        }
                    }
                }
            }
        }
    }
    if (Array.isArray(doc.chapters)) {
        for (const c of doc.chapters) {
            if (Array.isArray(c.articles)) articles.push(...c.articles);
        }
    }
    return articles;
}

function hasProvisionNode(
    doc: any,
    targetArticle?: string,
    targetClause?: string,
    targetPoint?: string,
    unaccentProvId?: string
): boolean {
    const articles = extractArticles(doc);
    for (const art of articles) {
        const artNum = String(art.number ?? "").replace(/^Điều\s*/i, "").trim();
        const artMatches = targetArticle ? artNum === targetArticle : unaccentProvId?.includes(artNum);
        if (!artMatches && targetArticle) {
            continue;
        }

        if (targetClause && Array.isArray(art.clauses)) {
            for (const cl of art.clauses) {
                const clNum = String(cl.number ?? "").replace(/^Khoản\s*/i, "").trim();
                if (clNum === targetClause) {
                    if (targetPoint && Array.isArray(cl.points)) {
                        for (const pt of cl.points) {
                            const ptNum = String(pt.number ?? "")
                                .replace(/^Điểm\s*/i, "")
                                .trim()
                                .toLowerCase();
                            if (ptNum === targetPoint) {
                                return true;
                            }
                        }
                    } else if (!targetPoint) {
                        return true;
                    }
                }
            }
        } else if (!targetClause) {
            return true;
        }
    }
    return false;
}

export function verifyProvisionInLegalDocuments(
    documents: Array<{ id: string; document_title?: string; json_content: string }>,
    sourceProvisionId: string,
    evidence: string,
    sourceDocumentId?: string | null
): ProvisionVerificationResult {
    if (documents.length === 0) {
        return {
            verified: false,
            reason: "No legal documents found in repository to verify provenance",
        };
    }

    let docFilter = sourceDocumentId?.trim() || null;
    let provisionRef = sourceProvisionId.trim();

    // Support qualified format: "doc_id:provision_id" or "doc_id#provision_id"
    const sepIndex =
        provisionRef.indexOf(":") !== -1
            ? provisionRef.indexOf(":")
            : provisionRef.indexOf("#");

    if (sepIndex > 0 && !docFilter) {
        docFilter = provisionRef.slice(0, sepIndex).trim();
        provisionRef = provisionRef.slice(sepIndex + 1).trim();
    }

    const candidateDocs = docFilter
        ? documents.filter(
              (d) =>
                  d.id.toLowerCase() === docFilter!.toLowerCase() ||
                  (d.document_title &&
                      d.document_title.toLowerCase() === docFilter!.toLowerCase()) ||
                  (d.document_title &&
                      removeVietnameseAccents(d.document_title.toLowerCase()) ===
                          removeVietnameseAccents(docFilter!.toLowerCase()))
          )
        : documents;

    if (docFilter && candidateDocs.length === 0) {
        return {
            verified: false,
            reason: `Source document '${docFilter}' not found in repository`,
        };
    }

    const normProvId = normalizeText(provisionRef);
    const unaccentProvId = removeVietnameseAccents(normProvId);
    const normEvidence = normalizeText(evidence);

    const artMatch =
        unaccentProvId.match(/(?:dieu|art)[_\s]*(\d+)/i) ||
        unaccentProvId.match(/(?:^|_)d(\d+)(?:_|$)/i) ||
        unaccentProvId.match(/^(\d+)$/);
    const clauseMatch =
        unaccentProvId.match(/(?:khoan|clause)[_\s]*(\d+)/i) ||
        unaccentProvId.match(/(?:^|_)k(\d+)(?:_|$)/i);
    const pointMatch =
        unaccentProvId.match(/(?:diem|point|pt)[_\s]*([a-z0-9]+)/i) ||
        unaccentProvId.match(/(?:^|_)d([a-z])(?:_|$)/i);

    const targetArticle = artMatch?.[1];
    const targetClause = clauseMatch?.[1];
    const targetPoint = pointMatch?.[1]?.toLowerCase();

    // Check if bare provision ID is ambiguous across multiple documents
    if (!docFilter && candidateDocs.length > 1) {
        const docsWithTargetProvision: Array<{ id: string; title: string }> = [];

        for (const docRecord of candidateDocs) {
            let doc: any;
            try {
                doc = JSON.parse(docRecord.json_content);
            } catch {
                continue;
            }

            if (hasProvisionNode(doc, targetArticle, targetClause, targetPoint, unaccentProvId)) {
                docsWithTargetProvision.push({
                    id: docRecord.id,
                    title: docRecord.document_title || docRecord.id,
                });
            }
        }

        if (docsWithTargetProvision.length > 1) {
            const docList = docsWithTargetProvision
                .map((d) => `'${d.title}' (${d.id})`)
                .join(", ");
            return {
                verified: false,
                reason: `Ambiguous provision reference '${sourceProvisionId}': provision exists in multiple legal documents [${docList}]. Bare provision ID cannot be resolved arbitrarily. Please specify 'source_document_id' or use qualified format '<doc_id>:${sourceProvisionId}'.`,
            };
        }
    }

    let provisionFound = false;

    for (const docRecord of candidateDocs) {
        let doc: any;
        try {
            doc = JSON.parse(docRecord.json_content);
        } catch {
            continue;
        }

        const articles = extractArticles(doc);

        for (const art of articles) {
            const artNum = String(art.number ?? "").replace(/^Điều\s*/i, "").trim();
            const artMatches = targetArticle ? artNum === targetArticle : unaccentProvId.includes(artNum);

            if (!artMatches && targetArticle) {
                continue;
            }

            if (targetClause && Array.isArray(art.clauses)) {
                for (const cl of art.clauses) {
                    const clNum = String(cl.number ?? "").replace(/^Khoản\s*/i, "").trim();
                    if (clNum === targetClause) {
                        if (targetPoint && Array.isArray(cl.points)) {
                            for (const pt of cl.points) {
                                const ptNum = String(pt.number ?? "").replace(/^Điểm\s*/i, "").trim().toLowerCase();
                                if (ptNum === targetPoint) {
                                    provisionFound = true;
                                    const ptText = `${art.content ?? ""} ${cl.content ?? ""} ${pt.title ?? ""} ${pt.content ?? ""}`;
                                    if (matchesEvidence(ptText, normEvidence)) {
                                        return { verified: true, matchedDocumentId: docRecord.id };
                                    }
                                }
                            }
                        } else {
                            provisionFound = true;
                            const ptsText = Array.isArray(cl.points)
                                ? cl.points.map((p: any) => `${p.title ?? ""} ${p.content ?? ""}`).join(" ")
                                : "";
                            const clText = `${art.content ?? ""} ${cl.title ?? ""} ${cl.content ?? ""} ${ptsText}`;
                            if (matchesEvidence(clText, normEvidence)) {
                                return { verified: true, matchedDocumentId: docRecord.id };
                            }
                        }
                    }
                }
            } else if (!targetClause) {
                provisionFound = true;
                const clsText = Array.isArray(art.clauses)
                    ? art.clauses
                          .map((c: any) => {
                              const pts = Array.isArray(c.points)
                                  ? c.points.map((p: any) => `${p.title ?? ""} ${p.content ?? ""}`).join(" ")
                                  : "";
                              return `${c.title ?? ""} ${c.content ?? ""} ${pts}`;
                          })
                          .join(" ")
                    : "";
                const artText = `${art.title ?? ""} ${art.content ?? ""} ${clsText}`;
                if (matchesEvidence(artText, normEvidence)) {
                    return { verified: true, matchedDocumentId: docRecord.id };
                }
            }
        }
    }

    if (!provisionFound) {
        return {
            verified: false,
            reason: docFilter
                ? `Provision '${sourceProvisionId}' not found in source document '${docFilter}'`
                : `Provision '${sourceProvisionId}' not found in source legal documents`,
        };
    }

    return {
        verified: false,
        reason: docFilter
            ? `Legal evidence does not match text in provision '${sourceProvisionId}' in document '${docFilter}'`
            : `Legal evidence does not match text in provision '${sourceProvisionId}'`,
    };
}

function matchesEvidence(provisionText: string, normEvidence: string): boolean {
    const normText = normalizeText(provisionText);
    if (normText.includes(normEvidence)) {
        return true;
    }

    const evTokens = normEvidence.split(" ").filter((w) => w.length > 2);
    if (evTokens.length === 0) return false;
    const matches = evTokens.filter((t) => normText.includes(t));
    return matches.length / evTokens.length >= 0.7;
}

