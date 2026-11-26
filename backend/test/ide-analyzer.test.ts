import { describe, expect, it } from "bun:test";
import { analyzeDraftContent } from "../src/modules/ide/ide.analyzer";
import { parseDraftDocument } from "../src/modules/ide/ide.parser";
import { BUILTIN_TEMPLATES } from "../src/modules/ide/ide.templates";
import { createTestD1Database } from "./d1-test-db";

describe("ide parser", () => {
    it("parses chapters, articles, clauses, points and glossary terms with exact line ranges", () => {
        const content = [
            "Chương I. QUY ĐỊNH CHUNG",
            "Điều 1. Giải thích từ ngữ",
            '1. “xe tự hành” là phương tiện tự động.',
            "Điều 2. Xử phạt",
            "1. Phạt tiền từ 1.000.000 đồng đến 2.000.000 đồng:",
            "a) Không chấp hành hiệu lệnh.",
        ].join("\n");

        const parsed = parseDraftDocument(content);

        expect(parsed.nodes.map((node) => `${node.level}:${node.number}`)).toEqual([
            "CHAPTER:I",
            "ARTICLE:1",
            "CLAUSE:1",
            "ARTICLE:2",
            "CLAUSE:1",
            "POINT:a",
        ]);
        expect(parsed.definedTerms.has("xe tự hành")).toBe(true);
        expect(parsed.nodes[5].refLabel).toBe("Điểm a Khoản 1 Điều 2");
        expect(parsed.nodes[5].startLine).toBe(6);
    });
});

describe("ide analyzer & lean 4 engine", () => {
    it("detects loopholes, ambiguities, logic defects and compiles to Lean 4 with 0 tokens", async () => {
        const result = await analyzeDraftContent(BUILTIN_TEMPLATES[0].content);
        const codes = new Set(result.diagnostics.map((item) => item.code));

        expect(codes.has("LP001")).toBe(true);
        expect(codes.has("LP002")).toBe(true);
        expect(codes.has("LP003")).toBe(true);
        expect(codes.has("LP004")).toBe(true);
        expect(codes.has("AM001")).toBe(true);
        expect(codes.has("AM002")).toBe(true);
        expect(codes.has("AM003")).toBe(true);
        expect(codes.has("AM005")).toBe(true);
        expect(codes.has("LG001")).toBe(true);
        expect(codes.has("LG002")).toBe(true);
        expect(codes.has("LG003")).toBe(true);
        expect(codes.has("LG005")).toBe(true);
        expect(codes.has("LG007")).toBe(true);
        expect(result.workspaceScope.strictlyWorkspaceOnly).toBe(true);
        expect(result.lean.leanCode.includes("namespace LexIDE")).toBe(true);
        expect(result.lean.obligations.length).toBeGreaterThan(0);
        expect(result.lean.refutedCount).toBeGreaterThan(0);
        expect(result.lean.tokenStats.actualAiTokens).toBe(0);
        expect(result.lean.tokenStats.savedPercent).toBe(100);
        expect(result.terms.some((term) => term.normalizedTerm === "điểm giấy phép lái xe" && term.status === "UNDEFINED")).toBe(true);
    });

    it("resolves AM005 for điểm GPLX once a defining document is in workspace D1", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });
        const draft = [
            "Điều 1. Xử phạt",
            "1. Người vi phạm bị trừ điểm giấy phép lái xe 02 điểm.",
            "Điều 2. Hiệu lực thi hành",
            "1. Có hiệu lực từ 01/01/2027.",
        ].join("\n");

        const withoutWorkspaceDef = await analyzeDraftContent(draft, { db });

        expect(withoutWorkspaceDef.diagnostics.some((item) => item.code === "AM005")).toBe(true);
        expect(withoutWorkspaceDef.lean.obligations.some((ob) => ob.kind === "TERM_DEFINED" && ob.status === "REFUTED")).toBe(true);

        await db
            .prepare(
                `INSERT INTO legal_documents (id, job_id, document_title, json_content, snapshot_r2_key, artifact_r2_key, pdf_sha256, review_status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'ACCEPTED', ?)`,
            )
            .bind("doc-law-36", "job-36", "Luật 36/2024", "{}", "s", "a", "hash", "2026-01-01T00:00:00.000Z")
            .run();
        await db
            .prepare(
                `INSERT INTO vocab_entries (id, canonical_id, type, canonical_label, aliases, definition, source_document_id, created_at, updated_at, vocabulary_version)
                 VALUES (?, ?, 'TERM', ?, ?, ?, ?, ?, ?, 1)`,
            )
            .bind(
                "v-gplx",
                "TERM_DIEM_GPLX",
                "điểm giấy phép lái xe",
                JSON.stringify(["điểm GPLX"]),
                "Mỗi giấy phép lái xe có 12 điểm trong 01 năm.",
                "doc-law-36",
                "2026-01-01T00:00:00.000Z",
                "2026-01-01T00:00:00.000Z",
            )
            .run();

        const withWorkspaceDef = await analyzeDraftContent(draft, { db });

        expect(withWorkspaceDef.diagnostics.some((item) => item.code === "AM005")).toBe(false);
        expect(withWorkspaceDef.terms.some((term) => term.status === "DEFINED_IN_WORKSPACE")).toBe(true);
        expect(withWorkspaceDef.lean.obligations.some((ob) => ob.kind === "TERM_DEFINED" && ob.status === "PROVED")).toBe(true);
    });

    it("clears LG001 inverted fine when applying its quickFix", async () => {
        const sample = [
            "Điều 1. Xử phạt",
            "1. Phạt tiền từ 6.000.000 đồng đến 4.000.000 đồng đối với hành vi vi phạm.",
            "Điều 2. Hiệu lực thi hành",
            "1. Nghị định này có hiệu lực từ ngày 01/01/2027.",
        ].join("\n");

        const initial = await analyzeDraftContent(sample);
        const lg001 = initial.diagnostics.find((item) => item.code === "LG001");

        expect(lg001).toBeDefined();
        expect(lg001?.quickFix).not.toBeNull();

        if (!lg001?.quickFix) {
            return;
        }

        const fixedContent =
            sample.slice(0, lg001.quickFix.startOffset) +
            lg001.quickFix.replacement +
            sample.slice(lg001.quickFix.endOffset);
        const reanalyzed = await analyzeDraftContent(fixedContent);

        expect(reanalyzed.diagnostics.some((item) => item.code === "LG001")).toBe(false);
    });

    it("detects external citation mismatch against corpus in D1 (LG008) and flags missing docs (WS001)", async () => {
        const db = createTestD1Database();
        await db
            .prepare("INSERT INTO document_metadata (document_id, document_number, document_type, agency, issued_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
            .bind("doc-seed-nd100", "100/2019/NĐ-CP", "Nghị định", "Chính phủ", "2019-12-30", "2026-01-01T00:00:00.000Z")
            .run();
        await db
            .prepare(
                `INSERT INTO provisions (
                    id, document_id, parent_id, ordinal, level, number, title, text,
                    article_no, paragraph_no, point_no, content_role, relevance, role_method, role_version, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
                "doc-seed-nd100:dieu_5_khoan_5_diem_a",
                "doc-seed-nd100",
                null,
                1,
                "POINT",
                "a",
                null,
                "Không chấp hành hiệu lệnh của đèn tín hiệu giao thông",
                "5",
                "5",
                "a",
                "ORDINARY_TEXT",
                "VIOLATION_RULE",
                "RULE",
                "v1",
                "2026-01-01T00:00:00.000Z",
            )
            .run();

        const draft = [
            "Điều 1. Sửa đổi",
            "1. Sửa đổi điểm z khoản 9 Điều 5 của Nghị định 100/2019/NĐ-CP.",
            "2. Viện dẫn Điều 1 của Nghị định 99/2099/NĐ-CP.",
        ].join("\n");

        const result = await analyzeDraftContent(draft, { db });

        expect(result.diagnostics.some((item) => item.code === "LG008")).toBe(true);
        expect(result.diagnostics.some((item) => item.code === "WS001")).toBe(true);
    });

    it("uses LLM strictly for structured fact extraction and proves/refutes deterministically in Lean 4", async () => {
        const sample = [
            "Điều 1. Quy định chung",
            "1. Cấm hành vi vượt đèn đỏ tại nút giao thông thông minh.",
            "2. Cho phép hành vi vượt đèn đỏ trong trường hợp khẩn cấp và phải tuân thủ quy tắc an toàn.",
        ].join("\n");
        let capturedSchemaName = "";
        const fakeFetch = (async (_url: string, init?: RequestInit) => {
            const parsedBody = JSON.parse(String(init?.body ?? "{}")) as { text?: { format?: { name?: string } } };
            capturedSchemaName = parsedBody.text?.format?.name ?? "";

            return new Response(
                JSON.stringify({
                    status: "completed",
                    steps: [
                        {
                            type: "model_output",
                            content: [
                                {
                                    type: "text",
                                    text: JSON.stringify({
                                        facts: [
                                            {
                                                quote: "Cấm hành vi vượt đèn đỏ",
                                                subject: "INDIVIDUAL",
                                                modality: "PROHIBITED",
                                                actionKey: "vuot_den_do",
                                                fineMin: null,
                                                fineMax: null,
                                                thresholdUnit: null,
                                                thresholdMin: null,
                                                thresholdMax: null,
                                                hasSanction: false,
                                                hasOpenException: false,
                                                hasExceptionCriteria: false,
                                                referencedTerms: ["quy tắc an toàn"],
                                            },
                                            {
                                                quote: "Cho phép hành vi vượt đèn đỏ",
                                                subject: "INDIVIDUAL",
                                                modality: "PERMITTED",
                                                actionKey: "vuot_den_do",
                                                fineMin: null,
                                                fineMax: null,
                                                thresholdUnit: null,
                                                thresholdMin: null,
                                                thresholdMax: null,
                                                hasSanction: false,
                                                hasOpenException: false,
                                                hasExceptionCriteria: false,
                                                referencedTerms: [],
                                            },
                                            {
                                                quote: "cụm từ hoàn toàn không tồn tại",
                                                subject: "INDIVIDUAL",
                                                modality: "PROHIBITED",
                                                actionKey: "khong_ton_tai",
                                                fineMin: null,
                                                fineMax: null,
                                                thresholdUnit: null,
                                                thresholdMin: null,
                                                thresholdMax: null,
                                                hasSanction: false,
                                                hasOpenException: false,
                                                hasExceptionCriteria: false,
                                                referencedTerms: [],
                                            },
                                        ],
                                    }),
                                },
                            ],
                        },
                    ],
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            );
        }) as unknown as typeof fetch;

        const result = await analyzeDraftContent(sample, {
            includeAi: true,
            apiKey: "test-key",
            model: "gemini-3.5-flash-lite",
            fetcher: fakeFetch,
        });

        expect(result.aiStatus.used).toBe(true);
        const aiItems = result.diagnostics.filter((item) => item.source === "AI");

        expect(aiItems.some((item) => item.excerpt === "cụm từ hoàn toàn không tồn tại")).toBe(false);
        expect(
            result.lean.obligations.some(
                (ob) => ob.theoremName.startsWith("extracted_sanction_") && ob.status === "REFUTED",
            ),
        ).toBe(true);
        expect(aiItems.some((item) => item.code === "AM005" && item.leanTheorem?.startsWith("extracted_term_"))).toBe(true);
        expect(aiItems.some((item) => item.code === "LG002" && item.leanTheorem === "deontic_consistent_vuot_den_do")).toBe(true);
        expect(result.lean.obligations.some((ob) => ob.kind === "DEONTIC_CONSISTENT" && ob.status === "REFUTED")).toBe(true);
        expect(result.lean.tokenStats.actualAiTokens).toBeGreaterThan(0);
    });
});
