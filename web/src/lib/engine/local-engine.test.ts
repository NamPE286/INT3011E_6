import { describe, expect, it } from "bun:test";
import { computeCompletions } from "../ide-intellisense";
import { extractHeaderTitle, inferLocalFileMeta, normalizeRenamePath, setHeaderTitle } from "../local-fs";
import { analyzeLocalDraft } from "./analyzer";
import { runLocalDebugSimulation } from "./debug";
import { buildVietnameseLegalDocx, buildVietnameseLegalHtml } from "./export";
import { IncrementalLlmCache } from "./llm-incremental";
import { buildLocalWorkspaceContext, type LocalWorkspaceFile } from "./local-workspace";
import { unzipArchive } from "./zip";
import { buildSampleLibraryZip, extractLawsFromZipArchive } from "./zip-library";

describe("local-first LexIDE engine (zero backend)", () => {
    it("analyzes empty workspace locally with 0 LLM tokens and resolves terms after local zip library import", async () => {
        const draft = [
            "Điều 1. Xử phạt vi phạm",
            "1. Phạt tiền từ 6.000.000 đồng đến 4.000.000 đồng và trừ 02 điểm giấy phép lái xe.",
        ].join("\n");

        const emptyAnalysis = await analyzeLocalDraft(draft, []);

        expect(emptyAnalysis.workspaceScope.corpusDocumentCount).toBe(0);
        expect(emptyAnalysis.lean?.tokenStats.actualAiTokens).toBe(0);
        expect(emptyAnalysis.diagnostics.some((d) => d.code === "LG001")).toBe(true);
        expect(emptyAnalysis.terms.some((t) => t.normalizedTerm === "điểm giấy phép lái xe" && t.status === "UNDEFINED")).toBe(true);

        const { laws } = await extractLawsFromZipArchive(buildSampleLibraryZip());

        expect(laws.length).toBe(2);

        const libFiles: LocalWorkspaceFile[] = laws.map((law, idx) => ({
            path: `library/law-${idx}.txt`,
            name: `law-${idx}.txt`,
            title: law.title,
            documentNumber: law.documentNumber,
            documentType: law.documentType,
            content: law.content,
            isLibrary: true,
            updatedAt: "2026-01-01T00:00:00.000Z",
        }));

        const populatedAnalysis = await analyzeLocalDraft(draft, libFiles);

        expect(populatedAnalysis.workspaceScope.corpusDocumentCount).toBe(2);
        expect(
            populatedAnalysis.terms.some(
                (t) => t.normalizedTerm === "điểm giấy phép lái xe" && t.status === "DEFINED_IN_WORKSPACE",
            ),
        ).toBe(true);

        const wsCtx = buildLocalWorkspaceContext(libFiles);
        const completions = computeCompletions({
            content: "Căn cứ ",
            cursorOffset: 7,
            outline: populatedAnalysis.outline,
            workspaceContext: wsCtx,
        });

        expect(completions?.items.some((item) => item.insertText.includes("36/2024/QH15"))).toBe(true);
    });

    it("calls user-provided LLM endpoint strictly for fact extraction and proves deontic conflict in Lean 4", async () => {
        const draft = [
            "Điều 1. Quy tắc",
            "1. Cấm hành vi đi vào đường cấm.",
            "2. Cho phép hành vi đi vào đường cấm.",
        ].join("\n");

        let apiKeyHeader = "";
        let schemaName = "";

        const fakeFetch = (async (_url: string, init?: RequestInit) => {
            const headers = init?.headers as Record<string, string>;
            apiKeyHeader = headers["x-goog-api-key"] ?? "";
            const body = JSON.parse(String(init?.body ?? "{}")) as { response_format?: { mime_type?: string } };
            schemaName = body.response_format?.mime_type === "application/json" ? "legislative_extract_facts_v1" : "";

            return new Response(
                JSON.stringify({
                    output_text: JSON.stringify({
                        facts: [
                            {
                                quote: "Cấm hành vi đi vào đường cấm",
                                subject: "INDIVIDUAL",
                                modality: "PROHIBITED",
                                actionKey: "di_vao_duong_cam",
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
                                quote: "Cho phép hành vi đi vào đường cấm",
                                subject: "INDIVIDUAL",
                                modality: "PERMITTED",
                                actionKey: "di_vao_duong_cam",
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
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            );
        }) as unknown as typeof fetch;

        const result = await analyzeLocalDraft(draft, [], {
            includeAi: true,
            useDecisionApi: false,
            apiKey: "sk-user-local-token",
            apiBaseUrl: "https://generativelanguage.googleapis.com",
            model: "gemini-3.5-flash-lite",
            fetcher: fakeFetch,
        });

        expect(apiKeyHeader).toBe("sk-user-local-token");
        expect(schemaName).toBe("legislative_extract_facts_v1");
        expect(result.aiStatus.used).toBe(true);
        expect(result.lean?.obligations.some((ob) => ob.kind === "DEONTIC_CONSISTENT" && ob.status === "REFUTED")).toBe(true);
    });

    it("runs debug simulation and exports DOCX/HTML locally with Times New Roman", async () => {
        const draft = [
            "Điều 1. Tốc độ",
            "1. Phạt tiền từ 4.000.000 đồng đến 6.000.000 đồng đối với cá nhân điều khiển xe quá tốc độ từ 20 km/h đến 35 km/h trong trường hợp nghiêm trọng.",
        ].join("\n");

        const debugRes = await runLocalDebugSimulation({
            content: draft,
            scenario: "Anh A chạy quá tốc độ 25 km/h.",
        });

        expect(debugRes.ambiguities.length).toBeGreaterThan(0);

        const docx = buildVietnameseLegalDocx({
            title: "Nghị định mẫu",
            documentNumber: "15/2026/NĐ-CP",
            content: draft,
        });
        const entries = await unzipArchive(docx);
        const styles = new TextDecoder().decode(entries.find((e) => e.path === "word/styles.xml")?.bytes);

        expect(styles).toContain("Times New Roman");

        const html = buildVietnameseLegalHtml({
            title: "Nghị định mẫu",
            documentNumber: "15/2026/NĐ-CP",
            content: draft,
        });

        expect(html).toContain("Times New Roman");
        expect(html).toContain("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM");
    });

    it("enforces mandatory line-1 law title header, infers metadata, and validates file rename paths", async () => {
        const missingHeader = "Điều 1. Phạm vi điều chỉnh\n1. Quy định chung.";
        const diagResult = await analyzeLocalDraft(missingHeader, []);

        expect(diagResult.diagnostics.some((d) => d.code === "LG006")).toBe(true);
        expect(extractHeaderTitle(missingHeader)).toBeNull();

        const fixed = setHeaderTitle(missingHeader, "Luật An toàn giao thông");

        expect(extractHeaderTitle(fixed)).toBe("Luật An toàn giao thông");
        expect(inferLocalFileMeta("random-name.txt", fixed).title).toBe("Luật An toàn giao thông");

        const fixedResult = await analyzeLocalDraft(fixed, []);

        expect(fixedResult.diagnostics.some((d) => d.code === "LG006")).toBe(false);

        expect(normalizeRenamePath("library/old-law.txt", "luat-moi")).toBe("library/luat-moi.txt");
        expect(normalizeRenamePath("draft.txt", "../bad")).toBeNull();
    });

    it("detects empty article, missing sanction, missing effective clause, and missing header on 'Điều 1. Lỗi vượt đèn đỏ'", async () => {
        const minimal = await analyzeLocalDraft("Điều 1. Lỗi vượt đèn đỏ", []);
        const codes = new Set(minimal.diagnostics.map((d) => d.code));

        expect(codes.has("LG006")).toBe(true);
        expect(codes.has("LP007")).toBe(true);
        expect(codes.has("LP002")).toBe(true);
        expect(codes.has("LP005")).toBe(true);
        expect((minimal.lean?.refutedCount ?? 0) >= 3).toBe(true);
        expect(minimal.lean?.tokenStats.actualAiTokens).toBe(0);
    });

    it("sends only changed or newly added clauses to LLM via IncrementalLlmCache and uses 0 tokens on unchanged reruns", async () => {
        const cache = new IncrementalLlmCache();
        const sentBodies: string[] = [];

        const fakeFetch = (async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as { input?: string };
            const input = body.input ?? "";
            sentBodies.push(input);

            const facts = [];

            if (input.includes("vượt đèn đỏ")) {
                facts.push({
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
                    referencedTerms: [],
                });
            }

            if (input.includes("lấn làn khẩn cấp")) {
                facts.push({
                    quote: "Cấm hành vi lấn làn khẩn cấp",
                    subject: "INDIVIDUAL",
                    modality: "PROHIBITED",
                    actionKey: "lan_lan_khan_cap",
                    fineMin: null,
                    fineMax: null,
                    thresholdUnit: null,
                    thresholdMin: null,
                    thresholdMax: null,
                    hasSanction: false,
                    hasOpenException: false,
                    hasExceptionCriteria: false,
                    referencedTerms: [],
                });
            }

            return new Response(JSON.stringify({ output_text: JSON.stringify({ facts }) }), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }) as unknown as typeof fetch;

        const draft1 = "Luật Giao thông\n\nĐiều 1. Quy định\n1. Cấm hành vi vượt đèn đỏ.";
        const r1 = await analyzeLocalDraft(draft1, [], {
            includeAi: true,
            useDecisionApi: false,
            apiKey: "sk-test",
            model: "gemini-3.5-flash-lite",
            incrementalCache: cache,
            fetcher: fakeFetch,
        });

        expect(sentBodies.length).toBe(1);
        expect(r1.lean?.tokenStats.aiEscalatedClauses).toBe(1);

        const draft2 = `${draft1}\n2. Cấm hành vi lấn làn khẩn cấp.`;
        const r2 = await analyzeLocalDraft(draft2, [], {
            includeAi: true,
            useDecisionApi: false,
            apiKey: "sk-test",
            model: "gemini-3.5-flash-lite",
            incrementalCache: cache,
            fetcher: fakeFetch,
        });

        expect(sentBodies.length).toBe(2);
        expect(sentBodies[1]).not.toContain("vượt đèn đỏ");
        expect(sentBodies[1]).toContain("lấn làn khẩn cấp");
        expect(r2.lean?.tokenStats.aiEscalatedClauses).toBe(1);
        expect(r2.lean?.obligations.filter((o) => o.theoremName.startsWith("extracted_sanction_")).length).toBe(2);

        const r3 = await analyzeLocalDraft(draft2, [], {
            includeAi: true,
            useDecisionApi: false,
            apiKey: "sk-test",
            model: "gemini-3.5-flash-lite",
            incrementalCache: cache,
            fetcher: fakeFetch,
        });

        expect(sentBodies.length).toBe(2);
        expect(r3.lean?.tokenStats.actualAiTokens).toBe(0);
        expect(r3.lean?.obligations.filter((o) => o.theoremName.startsWith("extracted_sanction_")).length).toBe(2);
    });
});
