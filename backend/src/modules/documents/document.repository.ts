import type { D1Database } from "@cloudflare/workers-types";
import type { LegalDocumentRecord } from "./document.types";

export class DocumentRepository {
    constructor(private readonly db: D1Database) {}

    public async searchCorpusDocuments(
        queryTerms: string[],
        maxFetch: number = 50
    ): Promise<LegalDocumentRecord[]> {
        // Fast SQL filtering on D1 to bound memory and execution cost
        if (queryTerms.length === 0) {
            const result = await this.db
                .prepare(`
                    SELECT
                        id,
                        job_id,
                        document_title,
                        json_content,
                        snapshot_r2_key,
                        extracted_text_r2_key,
                        pdf_sha256,
                        created_at
                    FROM legal_documents
                    ORDER BY created_at DESC
                    LIMIT ?
                `)
                .bind(maxFetch)
                .all<LegalDocumentRecord>();

            return result.results;
        }

        // Expand terms: e.g. "100/2019/nd-cp" -> also search "100/2019" to handle Vietnamese accent differences in SQL LIKE
        const expandedTerms = new Set<string>();
        for (const t of queryTerms) {
            const trimmed = t.trim();
            if (trimmed.length > 0) {
                expandedTerms.add(trimmed);
                const numYear = trimmed.match(/\b\d+\/\d{4}\b/);
                if (numYear) {
                    expandedTerms.add(numYear[0]);
                }
            }
        }

        const likeClauses: string[] = [];
        const params: (string | number)[] = [];

        for (const term of Array.from(expandedTerms).slice(0, 6)) {
            likeClauses.push("(document_title LIKE ? OR json_content LIKE ? OR id = ? OR pdf_sha256 = ?)");
            params.push(`%${term}%`, `%${term}%`, term, term);
        }

        params.push(maxFetch);

        const sql = `
            SELECT
                id,
                job_id,
                document_title,
                json_content,
                snapshot_r2_key,
                extracted_text_r2_key,
                pdf_sha256,
                created_at
            FROM legal_documents
            WHERE ${likeClauses.join(" OR ")}
            ORDER BY created_at DESC
            LIMIT ?
        `;

        const result = await this.db.prepare(sql).bind(...params).all<LegalDocumentRecord>();
        return result.results;
    }

    public async getDocumentById(id: string): Promise<LegalDocumentRecord | null> {
        const row = await this.db
            .prepare(`
                SELECT
                    id,
                    job_id,
                    document_title,
                    json_content,
                    snapshot_r2_key,
                    extracted_text_r2_key,
                    pdf_sha256,
                    created_at
                FROM legal_documents
                WHERE id = ?
            `)
            .bind(id)
            .first<LegalDocumentRecord>();

        return row ?? null;
    }
}
