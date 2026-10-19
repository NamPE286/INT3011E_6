import { matchAndScoreDocument } from "./document.matcher";
import type { DocumentRepository } from "./document.repository";
import type {
    DocumentCandidate,
    SearchLegalDocumentsInput,
    SearchLegalDocumentsResponse,
} from "./document.types";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DISCLAIMER_TEXT =
    "Kết quả tìm kiếm rỗng không chứng minh văn bản không tồn tại trong hệ thống pháp luật Việt Nam. Danh sách trả về chỉ bao gồm các candidate được phát hiện trong kho corpus nội bộ; việc phân giải canonical identity và quan hệ pháp lý phải do backend resolver chuyên biệt thực hiện.";

export class DocumentService {
    constructor(private readonly repository: DocumentRepository) {}

    public async searchLegalDocuments(
        input: SearchLegalDocumentsInput
    ): Promise<SearchLegalDocumentsResponse> {
        const startTime = Date.now();

        // 1. Validate inputs
        if (!input || typeof input.query !== "string" || input.query.trim().length === 0) {
            throw new Error("Invalid query: Search query string is required and cannot be empty");
        }

        const trimmedQuery = input.query.trim();

        let limit = 10;
        if (input.limit !== undefined && input.limit !== null) {
            if (typeof input.limit !== "number" || !Number.isInteger(input.limit) || input.limit < 1) {
                throw new Error("Invalid limit: limit must be a positive integer between 1 and 50");
            }
            if (input.limit > 50) {
                throw new Error("Invalid limit: limit cannot exceed maximum of 50");
            }
            limit = input.limit;
        }

        if (input.issued_from && !DATE_REGEX.test(input.issued_from.trim())) {
            throw new Error("Invalid issued_from: Date format must be YYYY-MM-DD");
        }

        if (input.issued_to && !DATE_REGEX.test(input.issued_to.trim())) {
            throw new Error("Invalid issued_to: Date format must be YYYY-MM-DD");
        }

        // 2. Extract terms for bounded D1 SQL fetch
        const terms: string[] = [];
        if (input.document_number) {
            terms.push(input.document_number.trim());
        }

        // Extract tokens from query
        const queryWords = trimmedQuery
            .split(/[\s,;]+/)
            .filter((w) => w.length > 2 && !/^(theo|quy|định|tại|căn|cứ|của|về|và|các|ngày)$/i.test(w));

        terms.push(...queryWords.slice(0, 4));

        // Fetch candidates with bounded SQL query
        const records = await this.repository.searchCorpusDocuments(terms, Math.min(100, limit * 4));

        if (records.length === 0) {
            const emptyResponse: SearchLegalDocumentsResponse = {
                status: "EMPTY",
                query: trimmedQuery,
                total_candidates: 0,
                candidates: [],
                disclaimer: DISCLAIMER_TEXT,
                execution_ms: Date.now() - startTime,
            };
            this.logSearch(input, emptyResponse);
            return emptyResponse;
        }

        // 3. Match, score, and filter candidates in memory
        const scoredCandidates: DocumentCandidate[] = [];

        for (const record of records) {
            const candidate = matchAndScoreDocument(record, {
                ...input,
                query: trimmedQuery,
            });

            if (candidate) {
                scoredCandidates.push(candidate);
            }
        }

        if (scoredCandidates.length === 0) {
            const emptyResponse: SearchLegalDocumentsResponse = {
                status: "EMPTY",
                query: trimmedQuery,
                total_candidates: 0,
                candidates: [],
                disclaimer: DISCLAIMER_TEXT,
                execution_ms: Date.now() - startTime,
            };
            this.logSearch(input, emptyResponse);
            return emptyResponse;
        }

        // Sort descending by match score
        scoredCandidates.sort((a, b) => b.match_score - a.match_score);

        // Determine status: AMBIGUOUS if multiple candidates exist with close scores
        let status: "OK" | "AMBIGUOUS" = "OK";
        if (scoredCandidates.length > 1) {
            const topScore = scoredCandidates[0].match_score;
            const secondScore = scoredCandidates[1].match_score;
            if (topScore - secondScore < 0.15 || topScore < 0.6) {
                status = "AMBIGUOUS";
            }
        }

        const finalCandidates = scoredCandidates.slice(0, limit);

        const response: SearchLegalDocumentsResponse = {
            status,
            query: trimmedQuery,
            total_candidates: scoredCandidates.length,
            candidates: finalCandidates,
            disclaimer: DISCLAIMER_TEXT,
            execution_ms: Date.now() - startTime,
        };

        this.logSearch(input, response);
        return response;
    }

    private logSearch(input: SearchLegalDocumentsInput, response: SearchLegalDocumentsResponse): void {
        console.log(
            JSON.stringify({
                level: "info",
                module: "documents",
                action: "search_legal_documents",
                query: input.query,
                document_number: input.document_number,
                document_type: input.document_type,
                agency: input.agency,
                status: response.status,
                total_candidates: response.total_candidates,
                returned_candidates: response.candidates.length,
                execution_ms: response.execution_ms,
            })
        );
    }
}
