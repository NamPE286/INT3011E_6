import type { D1Database } from "@cloudflare/workers-types";
import type { LegalDocumentRecord } from "./document.types";

export class DocumentRepository {
    constructor(
        private readonly db: D1Database,
        private readonly workspaceId?: string,
    ) {}

    public async searchCorpusDocuments(
        queryTerms: string[],
        maxFetch: number = 50,
        acceptedOnly: boolean = false
    ): Promise<LegalDocumentRecord[]> {
        // Fast SQL filtering on D1 to bound memory and execution cost
        if (queryTerms.length === 0) {
            const conditions: string[] = [];
            const params: (string | number)[] = [];

            if (acceptedOnly) {
                conditions.push("review_status = 'ACCEPTED'");
            }

            if (this.workspaceId) {
                conditions.push("workspace_id = ?");
                params.push(this.workspaceId);
            }

            params.push(maxFetch);
            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

            const result = await this.db
                .prepare(`
                    SELECT
                        id,
                        job_id,
                        document_title,
                        json_content,
                        snapshot_r2_key,
                        artifact_r2_key,
                        pdf_sha256,
                        created_at
                    FROM legal_documents
                    ${whereClause}
                    ORDER BY created_at DESC
                    LIMIT ?
                `)
                .bind(...params)
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

        let workspaceClause = "";

        if (this.workspaceId) {
            workspaceClause = "AND workspace_id = ?";
            params.push(this.workspaceId);
        }

        params.push(maxFetch);

        const sql = `
            SELECT
                id,
                job_id,
                document_title,
                json_content,
                snapshot_r2_key,
                artifact_r2_key,
                pdf_sha256,
                created_at
            FROM legal_documents
            WHERE (${likeClauses.join(" OR ")})
            ${acceptedOnly ? "AND review_status = 'ACCEPTED'" : ""}
            ${workspaceClause}
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
                    artifact_r2_key,
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
