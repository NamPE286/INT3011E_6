import type { D1Database } from "@cloudflare/workers-types";
import { extractDefinedTermsFromText, normalizeLegalTerm, parseDraftDocument } from "./ide.parser";

export type WorkspaceSourceKind = "CORPUS" | "DRAFT";

export type WorkspaceBasisItem = {
    id: string;
    label: string;
    documentNumber: string | null;
    documentType: string | null;
    sourceKind: WorkspaceSourceKind;
    sourceLabel: string;
    insertText: string;
    documentation: string;
};

export type WorkspacePatternItem = {
    id: string;
    label: string;
    detail: string;
    insertBody: string;
    sourceKind: WorkspaceSourceKind;
    sourceLabel: string;
    documentation: string;
};

export type WorkspaceProvisionRef = {
    id: string;
    documentId: string;
    documentLabel: string;
    provisionId: string;
    refLabel: string;
    title: string | null;
    excerpt: string;
    sourceKind: WorkspaceSourceKind;
};

export type WorkspaceDefinedTerm = {
    term: string;
    normalizedTerm: string;
    definition: string;
    sourceDocumentId: string | null;
    sourceProvisionId: string | null;
    sourceLabel: string;
    sourceKind: WorkspaceSourceKind;
};

export type WorkspaceContext = {
    corpusDocumentCount: number;
    savedDraftCount: number;
    bases: WorkspaceBasisItem[];
    articlePatterns: WorkspacePatternItem[];
    clausePatterns: WorkspacePatternItem[];
    pointPatterns: WorkspacePatternItem[];
    provisions: WorkspaceProvisionRef[];
    definedTerms: WorkspaceDefinedTerm[];
};

type CorpusDocRow = {
    id: string;
    document_title: string | null;
    document_number: string | null;
    document_type: string | null;
    issued_at: string | null;
};

type CorpusProvisionRow = {
    id: string;
    document_id: string;
    level: string;
    number: string;
    title: string | null;
    text: string | null;
    article_no: string | null;
    paragraph_no: string | null;
    point_no: string | null;
    content_role: string;
};

type VocabRow = {
    canonical_label: string;
    aliases: string;
    definition: string | null;
    source_provision_id: string | null;
    source_document_id: string | null;
};

type SavedDraftRow = {
    id: string;
    title: string;
    document_number: string | null;
    document_type: string | null;
    content: string;
};

export async function loadWorkspaceContext(
    db: D1Database | undefined,
    options: { excludeDraftId?: string } = {},
): Promise<WorkspaceContext> {
    const empty: WorkspaceContext = {
        corpusDocumentCount: 0,
        savedDraftCount: 0,
        bases: [],
        articlePatterns: [],
        clausePatterns: [],
        pointPatterns: [],
        provisions: [],
        definedTerms: [],
    };

    if (!db) {
        return empty;
    }

    try {
        const docsRes = await db
            .prepare(
                `SELECT d.id, d.document_title, m.document_number, m.document_type, m.issued_at
                 FROM legal_documents d
                 LEFT JOIN document_metadata m ON m.document_id = d.id
                 WHERE d.review_status = 'ACCEPTED'
                 ORDER BY m.issued_at DESC, d.created_at DESC
                 LIMIT 50`,
            )
            .all<CorpusDocRow>();

        const draftsRes = await db
            .prepare(
                `SELECT id, title, document_number, document_type, content
                 FROM draft_documents
                 ORDER BY updated_at DESC
                 LIMIT 50`,
            )
            .all<SavedDraftRow>();

        const docsById = new Map<string, CorpusDocRow>();

        for (const doc of docsRes.results) {
            docsById.set(doc.id, doc);
        }

        const bases: WorkspaceBasisItem[] = [];
        const articlePatterns: WorkspacePatternItem[] = [];
        const clausePatterns: WorkspacePatternItem[] = [];
        const pointPatterns: WorkspacePatternItem[] = [];
        const provisions: WorkspaceProvisionRef[] = [];
        const definedTerms: WorkspaceDefinedTerm[] = [];

        const seenBases = new Set<string>();
        const seenArticles = new Set<string>();
        const seenClauses = new Set<string>();
        const seenPoints = new Set<string>();
        const seenTerms = new Set<string>();

        for (const doc of docsRes.results) {
            const label = doc.document_number ?? doc.document_title ?? doc.id;
            const typePrefix = doc.document_type ? `${doc.document_type} ` : "";
            const titleSuffix = doc.document_title && doc.document_number ? ` (${doc.document_title})` : "";
            const insertText = `Căn cứ ${typePrefix}${doc.document_number ? `số ${doc.document_number}` : label}${titleSuffix};`;

            if (!seenBases.has(insertText.toLowerCase())) {
                seenBases.add(insertText.toLowerCase());
                bases.push({
                    id: `ws-basis-doc-${doc.id}`,
                    label: `${typePrefix}${label}`.trim(),
                    documentNumber: doc.document_number,
                    documentType: doc.document_type,
                    sourceKind: "CORPUS",
                    sourceLabel: `Kho: ${label}`,
                    insertText,
                    documentation: doc.document_title ?? `Văn bản đã duyệt trong workspace (${label}).`,
                });
            }
        }

        const provRes = await db
            .prepare(
                `SELECT p.id, p.document_id, p.level, p.number, p.title, p.text,
                        p.article_no, p.paragraph_no, p.point_no, p.content_role
                 FROM provisions p
                 JOIN legal_documents d ON d.id = p.document_id
                 WHERE d.review_status = 'ACCEPTED'
                 ORDER BY p.document_id, p.ordinal ASC
                 LIMIT 400`,
            )
            .all<CorpusProvisionRow>();

        const glossaryArticleIds = new Set<string>();

        for (const row of provRes.results) {
            const doc = docsById.get(row.document_id);
            const docLabel = doc?.document_number ?? doc?.document_title ?? row.document_id;
            const refLabel = buildProvisionRefLabel(row);

            if (row.level === "ARTICLE" && row.title && /giải thích từ ngữ/iu.test(row.title) && row.article_no) {
                glossaryArticleIds.add(`${row.document_id}::${row.article_no}`);
            }

            if (row.content_role === "PREAMBLE_BASIS" || (row.text && /^\s*Căn\s+cứ\s+/iu.test(row.text))) {
                const rawLine = (row.text ?? "").trim();

                if (rawLine.length > 10 && !seenBases.has(rawLine.toLowerCase())) {
                    seenBases.add(rawLine.toLowerCase());
                    bases.push({
                        id: `ws-basis-prov-${row.id}`,
                        label: rawLine.slice(0, 90),
                        documentNumber: doc?.document_number ?? null,
                        documentType: doc?.document_type ?? null,
                        sourceKind: "CORPUS",
                        sourceLabel: `Kho: ${docLabel}`,
                        insertText: rawLine.endsWith(";") ? rawLine : `${rawLine};`,
                        documentation: `Trích từ ${docLabel}`,
                    });
                }
            }

            if (row.level === "ARTICLE" && row.title) {
                const key = row.title.toLowerCase();

                if (!seenArticles.has(key)) {
                    seenArticles.add(key);
                    articlePatterns.push({
                        id: `ws-art-${row.id}`,
                        label: row.title,
                        detail: `Kho: ${docLabel}`,
                        insertBody: row.text?.trim() || "1. ...",
                        sourceKind: "CORPUS",
                        sourceLabel: docLabel,
                        documentation: `Mẫu Điều từ ${docLabel} (${refLabel}).`,
                    });
                }
            }

            if (row.level === "CLAUSE" && row.text) {
                const trimmed = row.text.trim();
                const key = trimmed.slice(0, 60).toLowerCase();

                if (trimmed.length >= 12 && !seenClauses.has(key) && clausePatterns.length < 15) {
                    seenClauses.add(key);
                    clausePatterns.push({
                        id: `ws-cl-${row.id}`,
                        label: trimmed.slice(0, 72) + (trimmed.length > 72 ? "…" : ""),
                        detail: `Kho: ${docLabel}`,
                        insertBody: trimmed,
                        sourceKind: "CORPUS",
                        sourceLabel: docLabel,
                        documentation: `Trích từ ${refLabel} (${docLabel}).`,
                    });
                }
            }

            if (row.level === "POINT" && row.text) {
                const trimmed = row.text.trim();
                const key = trimmed.slice(0, 60).toLowerCase();

                if (trimmed.length >= 10 && !seenPoints.has(key) && pointPatterns.length < 15) {
                    seenPoints.add(key);
                    pointPatterns.push({
                        id: `ws-pt-${row.id}`,
                        label: trimmed.slice(0, 72) + (trimmed.length > 72 ? "…" : ""),
                        detail: `Kho: ${docLabel}`,
                        insertBody: trimmed,
                        sourceKind: "CORPUS",
                        sourceLabel: docLabel,
                        documentation: `Trích từ ${refLabel} (${docLabel}).`,
                    });
                }
            }

            if (refLabel && provisions.length < 80) {
                provisions.push({
                    id: `ws-ref-${row.id}`,
                    documentId: row.document_id,
                    documentLabel: docLabel,
                    provisionId: row.id,
                    refLabel,
                    title: row.title,
                    excerpt: (row.text ?? row.title ?? "").slice(0, 120),
                    sourceKind: "CORPUS",
                });
            }

            if (row.article_no && glossaryArticleIds.has(`${row.document_id}::${row.article_no}`) && row.text) {
                const extracted = extractDefinedTermsFromText(`1. ${row.text}`);

                for (const [norm, defText] of extracted.entries()) {
                    if (!seenTerms.has(norm)) {
                        seenTerms.add(norm);
                        definedTerms.push({
                            term: norm,
                            normalizedTerm: norm,
                            definition: defText,
                            sourceDocumentId: row.document_id,
                            sourceProvisionId: row.id,
                            sourceLabel: `${docLabel} (${refLabel})`,
                            sourceKind: "CORPUS",
                        });
                    }
                }
            }
        }

        const vocabRes = await db
            .prepare(
                `SELECT canonical_label, aliases, definition, source_provision_id, source_document_id
                 FROM vocab_entries
                 WHERE definition IS NOT NULL AND TRIM(definition) != ''
                 LIMIT 200`,
            )
            .all<VocabRow>();

        for (const vocab of vocabRes.results) {
            const doc = vocab.source_document_id ? docsById.get(vocab.source_document_id) : null;
            const docLabel = doc?.document_number ?? doc?.document_title ?? vocab.source_document_id ?? "Từ điển workspace";
            const candidates = [vocab.canonical_label, ...parseJsonStringArray(vocab.aliases)];

            for (const candidate of candidates) {
                const norm = normalizeLegalTerm(candidate);

                if (norm.length >= 2 && !seenTerms.has(norm)) {
                    seenTerms.add(norm);
                    definedTerms.push({
                        term: candidate,
                        normalizedTerm: norm,
                        definition: vocab.definition ?? "",
                        sourceDocumentId: vocab.source_document_id,
                        sourceProvisionId: vocab.source_provision_id,
                        sourceLabel: docLabel,
                        sourceKind: "CORPUS",
                    });
                }
            }
        }

        for (const draftRow of draftsRes.results) {
            if (options.excludeDraftId && draftRow.id === options.excludeDraftId) {
                continue;
            }

            const draftLabel = draftRow.document_number ?? draftRow.title;
            const parsed = parseDraftDocument(draftRow.content);

            if (draftRow.document_number) {
                const insertText = `Căn cứ ${draftRow.document_type ? `${draftRow.document_type} ` : ""}số ${draftRow.document_number};`;

                if (!seenBases.has(insertText.toLowerCase())) {
                    seenBases.add(insertText.toLowerCase());
                    bases.push({
                        id: `ws-basis-draft-${draftRow.id}`,
                        label: `${draftRow.title} (${draftRow.document_number})`,
                        documentNumber: draftRow.document_number,
                        documentType: draftRow.document_type,
                        sourceKind: "DRAFT",
                        sourceLabel: `Dự thảo: ${draftLabel}`,
                        insertText,
                        documentation: `Văn bản dự thảo trong workspace (${draftRow.title}).`,
                    });
                }
            }

            for (const line of draftRow.content.split("\n")) {
                const trimmed = line.trim();

                if (/^Căn\s+cứ\s+/iu.test(trimmed) && trimmed.length > 10 && !seenBases.has(trimmed.toLowerCase())) {
                    seenBases.add(trimmed.toLowerCase());
                    bases.push({
                        id: `ws-basis-dline-${draftRow.id}-${seenBases.size}`,
                        label: trimmed.slice(0, 90),
                        documentNumber: null,
                        documentType: null,
                        sourceKind: "DRAFT",
                        sourceLabel: `Dự thảo: ${draftLabel}`,
                        insertText: trimmed.endsWith(";") ? trimmed : `${trimmed};`,
                        documentation: `Dòng căn cứ từ dự thảo "${draftRow.title}".`,
                    });
                }
            }

            for (const node of parsed.nodes) {
                if (node.level === "ARTICLE" && node.title) {
                    const key = node.title.toLowerCase();

                    if (!seenArticles.has(key)) {
                        seenArticles.add(key);
                        const slice = draftRow.content.slice(node.startOffset, node.endOffset);
                        const bodyLines = slice.split("\n").slice(1).join("\n").trim();

                        articlePatterns.push({
                            id: `ws-draft-art-${draftRow.id}-${node.id}`,
                            label: node.title,
                            detail: `Dự thảo: ${draftLabel}`,
                            insertBody: bodyLines || "1. ...",
                            sourceKind: "DRAFT",
                            sourceLabel: draftLabel,
                            documentation: `Mẫu Điều từ dự thảo "${draftRow.title}".`,
                        });
                    }
                } else if (node.level === "CLAUSE" && node.text && clausePatterns.length < 20) {
                    const trimmed = node.text.trim();
                    const key = trimmed.slice(0, 60).toLowerCase();

                    if (trimmed.length >= 12 && !seenClauses.has(key)) {
                        seenClauses.add(key);
                        clausePatterns.push({
                            id: `ws-draft-cl-${draftRow.id}-${node.id}`,
                            label: trimmed.slice(0, 72) + (trimmed.length > 72 ? "…" : ""),
                            detail: `Dự thảo: ${draftLabel}`,
                            insertBody: trimmed,
                            sourceKind: "DRAFT",
                            sourceLabel: draftLabel,
                            documentation: `Trích từ ${node.refLabel} (${draftRow.title}).`,
                        });
                    }
                } else if (node.level === "POINT" && node.text && pointPatterns.length < 20) {
                    const trimmed = node.text.trim();
                    const key = trimmed.slice(0, 60).toLowerCase();

                    if (trimmed.length >= 10 && !seenPoints.has(key)) {
                        seenPoints.add(key);
                        pointPatterns.push({
                            id: `ws-draft-pt-${draftRow.id}-${node.id}`,
                            label: trimmed.slice(0, 72) + (trimmed.length > 72 ? "…" : ""),
                            detail: `Dự thảo: ${draftLabel}`,
                            insertBody: trimmed,
                            sourceKind: "DRAFT",
                            sourceLabel: draftLabel,
                            documentation: `Trích từ ${node.refLabel} (${draftRow.title}).`,
                        });
                    }
                }
            }

            for (const [norm, defText] of parsed.definedTermDetails.entries()) {
                if (!seenTerms.has(norm)) {
                    seenTerms.add(norm);
                    definedTerms.push({
                        term: norm,
                        normalizedTerm: norm,
                        definition: defText,
                        sourceDocumentId: null,
                        sourceProvisionId: null,
                        sourceLabel: `Dự thảo: ${draftLabel}`,
                        sourceKind: "DRAFT",
                    });
                }
            }
        }

        return {
            corpusDocumentCount: docsRes.results.length,
            savedDraftCount: draftsRes.results.length,
            bases,
            articlePatterns,
            clausePatterns,
            pointPatterns,
            provisions,
            definedTerms,
        };
    } catch {
        return empty;
    }
}

function buildProvisionRefLabel(row: CorpusProvisionRow): string {
    if (row.level === "POINT" && row.point_no && row.paragraph_no && row.article_no) {
        return `Điểm ${row.point_no} Khoản ${row.paragraph_no} Điều ${row.article_no}`;
    }

    if (row.level === "CLAUSE" && row.paragraph_no && row.article_no) {
        return `Khoản ${row.paragraph_no} Điều ${row.article_no}`;
    }

    if (row.level === "ARTICLE" && row.article_no) {
        return `Điều ${row.article_no}`;
    }

    return `${row.level} ${row.number}`;
}

function parseJsonStringArray(raw: string): string[] {
    try {
        const parsed: unknown = JSON.parse(raw);

        if (Array.isArray(parsed)) {
            return parsed.filter((item): item is string => typeof item === "string");
        }
    } catch {
        return [];
    }

    return [];
}
