import { Database } from "bun:sqlite";
import type {
    D1Database,
    D1PreparedStatement,
    D1Response,
    D1Result,
} from "@cloudflare/workers-types";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type TestD1Options = {
    seedSampleDocument?: boolean;
};

export function createTestD1Database(options: TestD1Options = {}): D1Database {
    const sqlite = new Database(":memory:");
    const migrationsDir = join(__dirname, "../migrations");
    const migrationFiles = readdirSync(migrationsDir).filter((fileName) => fileName.endsWith(".sql")).sort();

    for (const fileName of migrationFiles) {
        const sqlContent = readFileSync(join(migrationsDir, fileName), "utf-8");
        const statements = sqlContent.split(";");

        for (const statement of statements) {
            const trimmed = statement.trim();
            if (trimmed) {
                sqlite.run(trimmed);
            }
        }
    }

    if (options.seedSampleDocument !== false) {
        seedSampleLegalDocument(sqlite);
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

    let transactionLock = Promise.resolve();

    const d1Database = {
        prepare(query: string): D1PreparedStatement {
            return createPreparedStatement(query);
        },
        async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
            let releaseLock: () => void = () => {};
            const prevLock = transactionLock;
            transactionLock = new Promise<void>((resolve) => {
                releaseLock = resolve;
            });
            await prevLock;

            sqlite.run("BEGIN TRANSACTION");
            try {
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

                sqlite.run("COMMIT");
                return results;
            } catch (error) {
                sqlite.run("ROLLBACK");
                throw error;
            } finally {
                releaseLock();
            }
        },
        async exec(query: string) {
            sqlite.run(query);
            return { count: 0, duration: 0 };
        },
    } as unknown as D1Database;

    return d1Database;
}

function seedSampleLegalDocument(sqlite: Database): void {
    // Seed realistic sample legal document for provenance verification
    const sampleLegalDoc = {
        document_title: "Nghị định 100/2019/NĐ-CP",
        articles: [
            {
                number: "3",
                title: "Giải thích từ ngữ",
                content: "Điều 3. Giải thích từ ngữ",
                clauses: [
                    {
                        number: "1",
                        title: null,
                        content: "Phương tiện giao thông cơ giới đường bộ gồm xe ô tô và các loại xe tương tự.",
                        points: [],
                    },
                    {
                        number: "2",
                        title: null,
                        content: "Xe mô tô hai bánh, ba bánh và các loại xe tương tự.",
                        points: [],
                    },
                    {
                        number: "3",
                        title: null,
                        content: "Xe gắn máy có vận tốc thiết kế không quá 50km/h.",
                        points: [],
                    },
                    {
                        number: "19",
                        title: null,
                        content: "Phương tiện giao thông thô sơ đường bộ bao gồm xe xích lô.",
                        points: [],
                    },
                ],
            },
            {
                number: "5",
                title: "Xử phạt người điều khiển xe ô tô",
                content: "Điều 5. Xử phạt người điều khiển xe ô tô",
                clauses: [
                    {
                        number: "1",
                        title: null,
                        content: "Người điều khiển xe ô tô vi phạm: Đâm va vào dải phân cách trên đường bộ.",
                        points: [],
                    },
                    {
                        number: "2",
                        title: null,
                        content: "Phạt tiền từ 400.000 đồng đến 600.000 đồng đối với hành vi:",
                        points: [
                            {
                                number: "d",
                                title: null,
                                content: "Người điều khiển xe dừng xe không đúng nơi quy định.",
                            },
                        ],
                    },
                    {
                        number: "3",
                        title: null,
                        content: "Điều khiển xe chạy quá tốc độ quy định.",
                        points: [],
                    },
                    {
                        number: "4",
                        title: null,
                        content: "Phạt tiền từ 1.000.000 đồng đến 2.000.000 đồng đối với hành vi:",
                        points: [
                            {
                                number: "b",
                                title: null,
                                content: "Không chấp hành hiệu lệnh của người điều khiển giao thông.",
                            },
                        ],
                    },
                    {
                        number: "5",
                        title: null,
                        content: "Phạt tiền từ 3.000.000 đồng đến 5.000.000 đồng đối với hành vi:",
                        points: [
                            {
                                number: "a",
                                title: null,
                                content: "Người điều khiển phương tiện không chấp hành hiệu lệnh của đèn tín hiệu giao thông.",
                            },
                        ],
                    },
                ],
            },
            {
                number: "6",
                title: "Xử phạt người điều khiển xe mô tô",
                content: "Điều 6. Xử phạt người điều khiển xe mô tô",
                clauses: [
                    {
                        number: "1",
                        title: null,
                        content: "Người lái xe chạy xe quá tốc độ.",
                        points: [],
                    },
                ],
            },
            {
                number: "15",
                title: "Chuyển hướng xe",
                content: "Điều 15. Chuyển hướng xe",
                clauses: [
                    {
                        number: "1",
                        title: null,
                        content: "Khi chuyển hướng xe, người điều khiển phải giảm tốc độ.",
                        points: [],
                    },
                    {
                        number: "2",
                        title: null,
                        content: "Người lái xe rẽ xe không bật đèn tín hiệu.",
                        points: [],
                    },
                ],
            },
            {
                number: "16",
                title: "Lùi xe",
                content: "Điều 16. Đi lùi xe trên đường một chiều.",
                clauses: [],
            },
            {
                number: "26",
                title: "Giao thông trên đường cao tốc",
                content: "Điều 26. Giao thông trên đường cao tốc",
                clauses: [
                    {
                        number: "1",
                        title: null,
                        content: "Đường cao tốc là đường dành cho xe cơ giới chạy tốc độ cao.",
                        points: [],
                    },
                ],
            },
        ],
    };

    sqlite.run(`
        INSERT INTO legal_documents (
            id, job_id, document_title, json_content, snapshot_r2_key, artifact_r2_key, pdf_sha256, created_at
        ) VALUES (
            'doc-seed-nd100',
            'job-seed-nd100',
            'Nghị định 100/2019/NĐ-CP',
            ?,
            'snapshots/nd100.pdf',
            'snapshots/nd100.extracted.json',
            'dummy-sha256',
            datetime('now')
        )
    `, [JSON.stringify(sampleLegalDoc)]);
}
