import { findNodeAtOffset, parseDraftDocument, rangeFromOffsets, type ParsedDraft } from "./parser";
import type { LegalDiagnostic } from "./types";

export type LocalWorkspaceFile = {
    path: string;
    name: string;
    title: string;
    documentNumber: string | null;
    documentType: string | null;
    content: string;
    isLibrary: boolean;
    updatedAt: string;
};

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
    sourceProvisionRef?: string | null;
    sourceLine?: number | null;
    sourceDocumentNumber?: string | null;
    sourceDocumentReplacedBy?: string | null;
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

const EXTERNAL_CITE = /(?:(điểm)\s+([a-zđ])\s+)?(?:(khoản)\s+(\d+)\s+)?Điều\s+(\d+[a-zđ]?)\s+(?:của\s+)?(?:Nghị định|Luật|Bộ luật|Thông tư|Nghị quyết|Pháp lệnh|Quyết định)\s+(?:số\s+)?(\d{1,4}\/\d{4}\/[A-ZĐ0-9\-]+)/giu;

function formatLegalBasisInsertText(docType: string, docNumber: string | null, title: string): string {
    const cleanTitle = title.trim();

    if (!docNumber) {
        return `Căn cứ ${cleanTitle};`;
    }

    if (/^(?:Luật|Bộ luật|Hiến pháp|Pháp lệnh)$/iu.test(docType)) {
        const hasTypePrefix = new RegExp(`^${docType}\\b`, "iu").test(cleanTitle);

        return hasTypePrefix
            ? `Căn cứ ${cleanTitle} số ${docNumber};`
            : `Căn cứ ${docType} ${cleanTitle} số ${docNumber};`;
    }

    return `Căn cứ ${docType} số ${docNumber} (${cleanTitle});`;
}

/**
 * Builds the WorkspaceContext strictly from files in the user's selected local folder.
 */
export function buildLocalWorkspaceContext(
    files: readonly LocalWorkspaceFile[],
    excludePath?: string,
): WorkspaceContext {
    const bases: WorkspaceBasisItem[] = [];
    const articlePatterns: WorkspacePatternItem[] = [];
    const clausePatterns: WorkspacePatternItem[] = [];
    const pointPatterns: WorkspacePatternItem[] = [];
    const provisions: WorkspaceProvisionRef[] = [];
    const definedTerms: WorkspaceDefinedTerm[] = [];

    const seenBases = new Set<string>();
    const seenTerms = new Set<string>();

    let corpusDocumentCount = 0;
    let savedDraftCount = 0;

    for (const file of files) {
        if (excludePath && file.path === excludePath) {
            continue;
        }

        const sourceKind: WorkspaceSourceKind = file.isLibrary ? "CORPUS" : "DRAFT";

        if (file.isLibrary) {
            corpusDocumentCount += 1;
        } else {
            savedDraftCount += 1;
        }

        const docLabel = file.documentNumber
            ? `${file.title} (${file.documentNumber})`
            : file.title;
        const sourceLabel = file.documentNumber ?? file.title;
        const docType = file.documentType ?? "Văn bản";

        if (!seenBases.has(docLabel.toLowerCase())) {
            seenBases.add(docLabel.toLowerCase());
            bases.push({
                id: `basis-${file.path}`,
                label: `${file.isLibrary ? "CC" : "DT"} ${docLabel}`.slice(0, 90),
                documentNumber: file.documentNumber,
                documentType: file.documentType,
                sourceKind,
                sourceLabel: `${file.isLibrary ? "Thư viện" : "Thư mục"}: ${sourceLabel}`,
                insertText: formatLegalBasisInsertText(docType, file.documentNumber, file.title),
                documentation: `Trích từ tệp "${file.path}" trong thư mục làm việc.`,
            });
        }

        const parsed = parseDraftDocument(file.content);

        for (const node of parsed.nodes) {
            if (provisions.length < 150) {
                provisions.push({
                    id: `${file.path}:${node.id}`,
                    documentId: file.path,
                    documentLabel: sourceLabel,
                    provisionId: node.id,
                    refLabel: node.refLabel,
                    title: node.title,
                    excerpt: node.text.slice(0, 160),
                    sourceKind,
                });
            }

            if (node.level === "ARTICLE" && node.title && articlePatterns.length < 12) {
                articlePatterns.push({
                    id: `art-${file.path}-${node.number}`,
                    label: node.title,
                    detail: sourceLabel,
                    insertBody: "1. ",
                    sourceKind,
                    sourceLabel,
                    documentation: node.text.slice(0, 160),
                });
            } else if (node.level === "CLAUSE" && clausePatterns.length < 12) {
                clausePatterns.push({
                    id: `cls-${file.path}-${node.id}`,
                    label: node.text.replace(/^\d+\.\s*/, "").slice(0, 56),
                    detail: sourceLabel,
                    insertBody: node.text.replace(/^\d+\.\s*/, "").slice(0, 140),
                    sourceKind,
                    sourceLabel,
                    documentation: node.text.slice(0, 160),
                });
            } else if (node.level === "POINT" && pointPatterns.length < 12) {
                pointPatterns.push({
                    id: `pt-${file.path}-${node.id}`,
                    label: node.text.replace(/^[a-zđ]\)\s*/iu, "").slice(0, 56),
                    detail: sourceLabel,
                    insertBody: node.text.replace(/^[a-zđ]\)\s*/iu, "").slice(0, 140),
                    sourceKind,
                    sourceLabel,
                    documentation: node.text.slice(0, 160),
                });
            }
        }

        for (const [normalizedTerm, entry] of parsed.definedTermEntries.entries()) {
            if (seenTerms.has(normalizedTerm)) {
                continue;
            }

            seenTerms.add(normalizedTerm);
            definedTerms.push({
                term: entry.term,
                normalizedTerm,
                definition: entry.definition,
                sourceDocumentId: file.path,
                sourceProvisionId: null,
                sourceProvisionRef: entry.provisionRef,
                sourceLine: entry.line,
                sourceDocumentNumber: file.documentNumber,
                sourceDocumentReplacedBy: null,
                sourceLabel: `${sourceLabel} (Thư mục local)`,
                sourceKind,
            });
        }
    }

    return {
        corpusDocumentCount,
        savedDraftCount,
        bases,
        articlePatterns,
        clausePatterns,
        pointPatterns,
        provisions,
        definedTerms,
    };
}

/**
 * Checks external citations against the local folder's files without calling any backend server.
 */
export function analyzeAgainstLocalWorkspace(
    draft: ParsedDraft,
    files: readonly LocalWorkspaceFile[],
    currentPath?: string,
): LegalDiagnostic[] {
    const diagnostics: LegalDiagnostic[] = [];
    const otherFiles = files.filter((item) => !currentPath || item.path !== currentPath);

    for (const match of draft.content.matchAll(EXTERNAL_CITE)) {
        const startOffset = match.index;
        const endOffset = startOffset + match[0].length;
        const pointNo = match[2]?.toLowerCase() ?? null;
        const clauseNo = match[4] ?? null;
        const articleNo = match[5]?.toLowerCase() ?? null;
        const docNumber = match[6];

        if (!articleNo || !docNumber) {
            continue;
        }

        const matchedFile = otherFiles.find(
            (file) =>
                (file.documentNumber ?? "").toLowerCase() === docNumber.toLowerCase() ||
                file.title.toLowerCase().includes(docNumber.toLowerCase()) ||
                file.path.toLowerCase().includes(docNumber.toLowerCase().replace(/\//g, "-")),
        );

        const node = findNodeAtOffset(draft.nodes, startOffset);

        if (!matchedFile) {
            diagnostics.push({
                id: `WS001-cite-${startOffset}`,
                code: "WS001",
                category: "LOGIC",
                severity: "info",
                title: `Văn bản dẫn chiếu chưa có trong thư mục (${docNumber})`,
                message: `Dự thảo dẫn chiếu tới "${match[0]}", nhưng văn bản "${docNumber}" chưa có trong thư mục làm việc nên chưa thể đối chiếu điều khoản gốc.`,
                exploitScenario: "Hệ thống chỉ thẩm định dựa trên các tệp có trong thư mục local; thiếu văn bản gốc có thể bỏ sót xung đột.",
                suggestion: `Import hoặc thêm tệp văn bản ${docNumber} vào thư mục Library để đối chiếu chính xác.`,
                excerpt: match[0],
                provisionRef: node?.refLabel ?? null,
                range: rangeFromOffsets(draft.content, draft.lineStarts, startOffset, endOffset),
                source: "CORPUS",
                quickFix: null,
                corpusLink: null,
            });

            continue;
        }

        const parsedTarget = parseDraftDocument(matchedFile.content);
        const foundNode = parsedTarget.nodes.find((item) => {
            if (pointNo && clauseNo) {
                return (
                    item.level === "POINT" &&
                    item.articleNo?.toLowerCase() === articleNo &&
                    item.clauseNo === clauseNo &&
                    item.pointNo?.toLowerCase() === pointNo
                );
            }

            if (clauseNo) {
                return (
                    item.level === "CLAUSE" &&
                    item.articleNo?.toLowerCase() === articleNo &&
                    item.clauseNo === clauseNo
                );
            }

            return item.level === "ARTICLE" && item.articleNo?.toLowerCase() === articleNo;
        });

        if (!foundNode) {
            diagnostics.push({
                id: `LG008-cite-${startOffset}`,
                code: "LG008",
                category: "LOGIC",
                severity: "error",
                title: `Dẫn chiếu văn bản trong thư mục không khớp (${docNumber})`,
                message: `Dự thảo dẫn chiếu tới "${match[0]}", nhưng trong tệp "${matchedFile.path}" không tìm thấy điều/khoản/điểm tương ứng.`,
                exploitScenario: "Dẫn chiếu sai điều khoản gốc làm căn cứ áp dụng bị vô hiệu.",
                suggestion: `Kiểm tra lại số hiệu Điều/Khoản/Điểm trong "${matchedFile.path}".`,
                excerpt: match[0],
                provisionRef: node?.refLabel ?? null,
                range: rangeFromOffsets(draft.content, draft.lineStarts, startOffset, endOffset),
                source: "CORPUS",
                quickFix: null,
                corpusLink: null,
            });
        }
    }

    return diagnostics;
}
