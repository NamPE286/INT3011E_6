import { Database } from "bun:sqlite";
import type {
    D1Database,
    D1PreparedStatement,
    D1Response,
    D1Result,
} from "@cloudflare/workers-types";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function createTestD1Database(): D1Database {
    const sqlite = new Database(":memory:");

    const migrationFiles = [
        "0000_last_cloak.sql",
        "0001_create_processing_jobs.sql",
        "0002_create_legal_documents.sql",
        "0003_create_vocab_entries.sql",
    ];

    for (const fileName of migrationFiles) {
        const fullPath = join(__dirname, "../migrations", fileName);
        const sqlContent = readFileSync(fullPath, "utf-8");
        const statements = sqlContent.split(";");

        for (const statement of statements) {
            const trimmed = statement.trim();
            if (trimmed) {
                sqlite.run(trimmed);
            }
        }
    }

    function createPreparedStatement(query: string, params: unknown[] = []): D1PreparedStatement {
        const statement = {
            _query: query,
            _params: params,
            bind(...values: unknown[]) {
                return createPreparedStatement(query, values);
            },
            async first<T = unknown>(colName?: string): Promise<T | null> {
                const prepared = sqlite.query(query);
                const queryArgs = params as Parameters<typeof prepared.get>;
                const row = prepared.get(...queryArgs) as Record<string, unknown> | null;

                if (!row) {
                    return null;
                }

                if (colName) {
                    return (row[colName] as T) ?? null;
                }

                return row as T;
            },
            async all<T = unknown>(): Promise<D1Result<T>> {
                const prepared = sqlite.query(query);
                const queryArgs = params as Parameters<typeof prepared.all>;
                const results = prepared.all(...queryArgs) as T[];

                return {
                    results,
                    success: true,
                    meta: {
                        duration: 0,
                    },
                } as unknown as D1Result<T>;
            },
            async run(): Promise<D1Response> {
                const prepared = sqlite.query(query);
                const queryArgs = params as Parameters<typeof prepared.run>;
                const info = prepared.run(...queryArgs);

                return {
                    success: true,
                    meta: {
                        changes: info.changes,
                        last_row_id: info.lastInsertRowid,
                        duration: 0,
                    },
                } as unknown as D1Response;
            },
            async raw<T = unknown[]>(): Promise<T[]> {
                const prepared = sqlite.query(query);
                const queryArgs = params as Parameters<typeof prepared.values>;
                return prepared.values(...queryArgs) as T[];
            },
        };

        return statement as unknown as D1PreparedStatement;
    }

    const d1Database = {
        prepare(query: string): D1PreparedStatement {
            return createPreparedStatement(query);
        },
        async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
            const results: D1Result<T>[] = [];

            for (const s of statements) {
                const customStmt = s as unknown as {
                    _query: string;
                    all: () => Promise<D1Result<T>>;
                    run: () => Promise<D1Response>;
                };
                const queryText = customStmt._query?.trim().toUpperCase() ?? "";

                if (queryText.startsWith("SELECT")) {
                    results.push(await customStmt.all());
                } else {
                    const runRes = await customStmt.run();
                    results.push({
                        results: [] as T[],
                        success: true,
                        meta: runRes.meta,
                    } as unknown as D1Result<T>);
                }
            }

            return results;
        },
        async exec(query: string) {
            sqlite.run(query);
            return { count: 0, duration: 0 };
        },
    } as unknown as D1Database;

    return d1Database;
}
