import type {
    DocumentCandidate,
    LegalDocumentRecord,
    SearchLegalDocumentsInput,
} from "./document.types";

export function removeVietnameseAccents(str: string): string {
    return str
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/Đ/g, "D");
}

export function normalizeDocNumber(docNumber: string): string {
    return removeVietnameseAccents(docNumber)
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[-_./]+/g, "/")
        .trim();
}

export const LEGAL_DOC_TYPES = [
    "Bộ luật",
    "Luật",
    "Nghị định",
    "Thông tư",
    "Quyết định",
    "Nghị quyết",
    "Pháp lệnh",
    "Chỉ thị",
    "Thông tư liên tịch",
] as const;

export const AGENCY_PATTERNS: Array<{ pattern: RegExp; agency: string }> = [
    { pattern: /(?:NĐ|ND)[-_/]*CP\b/i, agency: "Chính phủ" },
    { pattern: /(?:QĐ|QD)[-_/]*TTg\b/i, agency: "Thủ tướng Chính phủ" },
    { pattern: /(?:QH\d*|quoc\s*hoi)\b/i, agency: "Quốc hội" },
    { pattern: /(?:UBTVQH\d*)\b/i, agency: "Ủy ban Thường vụ Quốc hội" },
    { pattern: /(?:BGTVT|giao\s*thong\s*van\s*tai)\b/i, agency: "Bộ Giao thông vận tải" },
    { pattern: /(?:BCA|cong\s*an)\b/i, agency: "Bộ Công an" },
    { pattern: /(?:BTC|tai\s*chinh)\b/i, agency: "Bộ Tài chính" },
    { pattern: /(?:BTP|tu\s*phap)\b/i, agency: "Bộ Tư pháp" },
    { pattern: /(?:BYT|y\s*te)\b/i, agency: "Bộ Y tế" },
    { pattern: /(?:BCT|cong\s*thuong)\b/i, agency: "Bộ Công Thương" },
];

export interface ExtractedMetadata {
    document_number: string | null;
    document_type: string | null;
    agency: string | null;
    issued_at: string | null;
    metadata_notes: string[];
}

const HEADER_LENGTH = 1500;
// Matches the "Số: 100/2019/NĐ-CP" header line; inside serialized JSON a line break appears as the two characters "\n".
const HEADER_NUMBER_REGEX = /(?:^|[\s"]|\\n)Số(?:\s*hiệu)?\s*:\s*(\d+[\w.-]*\/[\p{L}\d/_.-]+)/u;

export function extractMetadataFromDocument(
    title: string,
    jsonContent: string
): ExtractedMetadata {
    const notes: string[] = [];
    // The serialized document starts with its title and root content (national motto, "Số: ...", place/date).
    const header = jsonContent.slice(0, HEADER_LENGTH);

    // 1. Extract Document Number
    let docNumber: string | null = HEADER_NUMBER_REGEX.exec(header)?.[1]?.trim() ?? null;
    const numRegexes = [
        /\b(\d+[\w.-]*\/\d{4}\/[a-zA-Z0-9_Đđ-]+)\b/i,
        /\b(\d+\/\d{4}\/[a-zA-Z0-9_Đđ-]+)\b/i,
        /\b(\d+\/[a-zA-Z0-9_Đđ-]+)\b/i,
        /\bLuật\s+(?:số\s+)?(\d+\/\d{4}\/QH\d+)\b/i,
    ];

    for (const r of numRegexes) {
        const m = title.match(r);
        if (m && !docNumber) {
            docNumber = m[1].trim();
            break;
        }
    }

    if (!docNumber) {
        notes.push("Số hiệu văn bản không hiển thị rõ trong tiêu đề");
    }

    // 2. Extract Document Type
    let docType: string | null = null;
    for (const type of LEGAL_DOC_TYPES) {
        if (new RegExp(`\\b${type}\\b`, "i").test(title)) {
            docType = type;
            break;
        }
    }

    if (!docType) {
        notes.push("Loại văn bản không nhận diện được từ tiêu đề");
    }

    // 3. Extract Issuing Agency
    let agency: string | null = null;
    for (const item of AGENCY_PATTERNS) {
        if (item.pattern.test(title)) {
            agency = item.agency;
            break;
        }
    }

    if (!agency && jsonContent) {
        for (const item of AGENCY_PATTERNS) {
            if (item.pattern.test(jsonContent.slice(0, 500))) {
                agency = item.agency;
                break;
            }
        }
    }

    if (!agency) {
        notes.push("Cơ quan ban hành chưa được xác thực trong tiêu đề hoặc metadata nguồn");
    }

    // 4. Extract Issuance Date
    let issuedAt: string | null = null;
    const dateRegex = /(?:ngày|ngay)\s+(\d{1,2})\s+(?:tháng|thang)\s+(\d{1,2})\s+(?:năm|nam)\s+(\d{4})/i;
    const dateMatch = title.match(dateRegex) || jsonContent.slice(0, 800).match(dateRegex);

    if (dateMatch) {
        const day = dateMatch[1].padStart(2, "0");
        const month = dateMatch[2].padStart(2, "0");
        const year = dateMatch[3];
        issuedAt = `${year}-${month}-${day}`;
    } else if (docNumber) {
        const yearMatch = docNumber.match(/\/(\d{4})\//);
        if (yearMatch) {
            notes.push(`Ngày ban hành chính xác chưa có trong văn bản nguồn (chỉ xác định năm ${yearMatch[1]} từ số hiệu)`);
        }
    }

    if (!issuedAt && !notes.some((n) => n.includes("năm"))) {
        notes.push("Ngày ban hành chưa có trong metadata nguồn");
    }

    return {
        document_number: docNumber,
        document_type: docType,
        agency,
        issued_at: issuedAt,
        metadata_notes: notes,
    };
}

function documentTypeNamedInQuery(normalizedQuery: string): string | null {
    const typesLongestFirst = [...LEGAL_DOC_TYPES].sort((first, second) => second.length - first.length);

    for (const type of typesLongestFirst) {
        if (normalizedQuery.startsWith(`${removeVietnameseAccents(type.toLowerCase())} `)) {
            return type;
        }
    }

    return null;
}

export function matchAndScoreDocument(
    doc: LegalDocumentRecord,
    input: SearchLegalDocumentsInput
): DocumentCandidate | null {
    const title = doc.document_title ?? "";
    const extracted = extractMetadataFromDocument(title, doc.json_content);
    const matchReasons: string[] = [];
    let score = 0;

    const normQuery = removeVietnameseAccents(input.query.trim().toLowerCase());
    const normTitle = removeVietnameseAccents(title.toLowerCase());
    const queryType = documentTypeNamedInQuery(normQuery);

    // "Luật Giao thông đường bộ 2008" must not resolve to a Nghị định that merely cites that law.
    if (queryType && extracted.document_type && queryType !== extracted.document_type) {
        return null;
    }

    // 1. Check Document Number filter
    if (input.document_number) {
        const normFilterNum = normalizeDocNumber(input.document_number);
        if (!extracted.document_number) {
            return null; // Required filter not present
        }
        const normExtractedNum = normalizeDocNumber(extracted.document_number);
        if (normExtractedNum !== normFilterNum && !normExtractedNum.includes(normFilterNum)) {
            return null;
        }
        score += 0.50;
        matchReasons.push(`Khớp số hiệu yêu cầu: '${input.document_number}'`);
    } else if (extracted.document_number) {
        // Query mentions document number
        const normExtractedNum = normalizeDocNumber(extracted.document_number);
        if (normQuery.includes(normExtractedNum) || normTitle.includes(normQuery)) {
            score += 0.40;
            matchReasons.push(`Khớp số hiệu trong truy vấn: '${extracted.document_number}'`);
        }
    }

    // 2. Check Document Type filter
    if (input.document_type) {
        const normFilterType = removeVietnameseAccents(input.document_type.trim().toLowerCase());
        const normExtractedType = removeVietnameseAccents(extracted.document_type?.toLowerCase() ?? "");
        if (normExtractedType !== normFilterType && !normTitle.includes(normFilterType)) {
            return null;
        }
        score += 0.15;
        matchReasons.push(`Khớp loại văn bản: '${input.document_type}'`);
    }

    // 3. Check Agency filter
    if (input.agency) {
        const normFilterAgency = removeVietnameseAccents(input.agency.trim().toLowerCase());
        const normExtractedAgency = removeVietnameseAccents(extracted.agency?.toLowerCase() ?? "");
        if (
            normExtractedAgency !== normFilterAgency &&
            !normTitle.includes(normFilterAgency) &&
            !normExtractedAgency.includes(normFilterAgency)
        ) {
            return null;
        }
        score += 0.15;
        matchReasons.push(`Khớp cơ quan ban hành: '${input.agency}'`);
    }

    // 4. Check Date range filters (issued_from / issued_to)
    if (input.issued_from) {
        if (!extracted.issued_at || extracted.issued_at < input.issued_from) {
            return null;
        }
        matchReasons.push(`Sau mốc ngày: ${input.issued_from}`);
    }
    if (input.issued_to) {
        if (!extracted.issued_at || extracted.issued_at > input.issued_to) {
            return null;
        }
        matchReasons.push(`Trước mốc ngày: ${input.issued_to}`);
    }

    // 5. Query matching against Title and Content
    let hasTextMatch = false;

    if (normTitle.includes(normQuery)) {
        hasTextMatch = true;
        score += 0.35;
        matchReasons.push(`Khớp trực tiếp tiêu đề văn bản: '${title}'`);
    } else {
        // Word token matching on title
        const queryTokens = normQuery.split(/\s+/).filter((w) => w.length > 2);
        if (queryTokens.length > 0) {
            const matchedTokens = queryTokens.filter((t) => normTitle.includes(t));
            const tokenRatio = matchedTokens.length / queryTokens.length;
            if (tokenRatio >= 0.5) {
                hasTextMatch = true;
                score += 0.25 * tokenRatio;
                matchReasons.push(`Khớp ${Math.round(tokenRatio * 100)}% từ khóa tiêu đề`);
            }
        }
    }

    // Search in json_content (provision nodes, articles, clause text)
    if (!hasTextMatch && doc.json_content) {
        const normContent = removeVietnameseAccents(doc.json_content.toLowerCase());
        if (normContent.includes(normQuery)) {
            hasTextMatch = true;
            score += 0.20;
            matchReasons.push("Khớp từ khóa trong nội dung điều khoản văn bản");
        } else {
            const queryTokens = normQuery.split(/\s+/).filter((w) => w.length > 2);
            if (queryTokens.length > 0) {
                const contentMatches = queryTokens.filter((t) => normContent.includes(t));
                if (contentMatches.length / queryTokens.length >= 0.7) {
                    hasTextMatch = true;
                    score += 0.15;
                    matchReasons.push("Khớp phần lớn từ khóa trong nội dung văn bản");
                }
            }
        }
    }

    // If no text match and no specific document_number filter was satisfied
    if (!hasTextMatch && matchReasons.length === 0) {
        return null;
    }

    const finalScore = Math.min(1.0, Math.round(score * 100) / 100);

    return {
        candidate_id: doc.id,
        identity_type: "CORPUS_DOCUMENT",
        canonical_document_id: null, // Strictly null: job/snapshot/corpus ID is NOT canonical Document ID
        document_number: extracted.document_number,
        title: doc.document_title,
        document_type: extracted.document_type,
        agency: extracted.agency,
        issued_at: extracted.issued_at,
        source_provenance: {
            document_id: doc.id,
            job_id: doc.job_id,
            pdf_sha256: doc.pdf_sha256,
            created_at: doc.created_at,
        },
        availability: {
            has_json_content: Boolean(doc.json_content && doc.json_content.length > 10),
            has_pdf_snapshot: Boolean(doc.snapshot_r2_key),
            snapshot_r2_key: doc.snapshot_r2_key || null,
            artifact_r2_key: doc.artifact_r2_key || null,
        },
        match_score: finalScore,
        match_reasons: matchReasons.length > 0 ? matchReasons : ["Khớp điều kiện tìm kiếm"],
        metadata_notes: extracted.metadata_notes.length > 0 ? extracted.metadata_notes.join("; ") : undefined,
    };
}
