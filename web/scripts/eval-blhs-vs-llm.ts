import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeLocalDraft } from "../src/lib/engine/analyzer";
import {
    callGeminiDecisions,
    callGeminiStructuredInteraction,
} from "../src/lib/engine/gemini-client";
import { extractFineRanges, extractNumericThresholds } from "../src/lib/engine/intervals";
import { compileDraftToLean } from "../src/lib/engine/lean-compiler";
import { extractLegalFactsForUnits } from "../src/lib/engine/llm-extract";
import {
    extractUnitsFromDraft,
    IncrementalLlmCache,
} from "../src/lib/engine/llm-incremental";
import { buildLocalWorkspaceContext, type LocalWorkspaceFile } from "../src/lib/engine/local-workspace";
import { parseDraftDocument } from "../src/lib/engine/parser";
import { analyzeAmbiguities } from "../src/lib/engine/rules-ambiguity";
import { analyzeLogic } from "../src/lib/engine/rules-logic";
import { analyzeLoopholes } from "../src/lib/engine/rules-loophole";
import type { ExtractedLegalFact, LegalDiagnostic } from "../src/lib/engine/types";
import { buildWorkspaceBehaviorHistory } from "../src/lib/engine/workspace-behaviors";
import { buildWorkspaceRelationGraph } from "../src/lib/engine/workspace-relations";

const MAX_TOKEN_BUDGET = 150_000;
const BACKOFF_MS = [3000, 6000, 10000, 15000] as const;

type PureLlmIssue = {
    article: string;
    clause: string;
    category: string;
    severity: string;
    quote: string;
    description: string;
    suggestion: string;
};

type PureLlmRelation = {
    fromDoc: string;
    toDoc: string;
    type: string;
    detail: string;
};

type PureLlmChange = {
    article: string;
    crimeName: string;
    y2015: string;
    y2017: string;
    y2025: string;
    summary: string;
};

const GROUND_TRUTH_BUGS = [
    { id: "BUG_326", article: "326", label: "Điều 326: Chồng chéo sách/báo in 50–100 vs 51–100 đơn vị" },
    { id: "BUG_359", article: "359", label: "Điều 359: Trùng mốc 05 giấy tờ giả (02–05 vs 05–10)" },
    { id: "BUG_305", article: "305", label: "Điều 305: Khoảng trống thuốc nổ 30–31 kilôgam" },
    { id: "BUG_298", article: "298", label: "Điều 298: K4 dẫn chiếu nhầm Điều 225 (bản quyền) thay vì Điều 224 + K1c 62%–121%" },
    { id: "BUG_389", article: "389", label: "Điều 389: K1g ghi trùng Điều 299 hai lần thay vì Điều 304" },
    { id: "BUG_398", article: "398", label: "Điều 398: K1 dẫn chiếu nhầm Điều 135 thay vì Điều 134" },
    { id: "BUG_303", article: "303", label: "Điều 303: K2đ ghi 200% trở lên trùng mốc 122%–200%" },
] as const;

function loadBlhsWorkspace(): LocalWorkspaceFile[] {
    const baseDir = resolve(import.meta.dir, "../../data/blhs-real/library");
    const specs: { file: string; title: string; docNum: string; docType: string }[] = [
        { file: "100-2015-qh13-blhs-2015.txt", title: "Bộ luật Hình sự 2015", docNum: "100/2015/QH13", docType: "Bộ luật" },
        { file: "12-2017-qh14-sua-doi-blhs.txt", title: "Luật sửa đổi, bổ sung một số điều của BLHS", docNum: "12/2017/QH14", docType: "Luật" },
        { file: "02-2018-nq-hdtp-an-treo.txt", title: "Nghị quyết hướng dẫn áp dụng Điều 65 BLHS về án treo", docNum: "02/2018/NQ-HĐTP", docType: "Nghị quyết" },
        { file: "86-2025-qh15-sua-doi-blhs-2025.txt", title: "Luật sửa đổi, bổ sung một số điều của BLHS 2025", docNum: "86/2025/QH15", docType: "Luật" },
    ];

    return specs.map((item) => ({
        path: `library/${item.file}`,
        name: item.file,
        title: item.title,
        documentNumber: item.docNum,
        documentType: item.docType,
        content: readFileSync(resolve(baseDir, item.file), "utf8"),
        isLibrary: true,
        updatedAt: "2026-11-25T00:00:00.000Z",
    }));
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolveTimer) => setTimeout(resolveTimer, ms));
}

async function withRetry<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
    try {
        return await fn();
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const isTransient = msg.includes("(503)") || msg.includes("(429)") || msg.includes("timed out") || msg.includes("fetch");

        if (isTransient && attempt < BACKOFF_MS.length) {
            const waitMs = BACKOFF_MS[attempt];
            console.log(`  [retry ${attempt + 1}/${BACKOFF_MS.length}] transient error, waiting ${waitMs}ms...`);
            await sleep(waitMs);

            return withRetry(fn, attempt + 1);
        }

        throw err;
    }
}

function compactDiag(d: LegalDiagnostic): {
    code: string;
    severity: string;
    provisionRef: string | null;
    line: number;
    title: string;
    excerpt: string;
    source: string;
} {
    return {
        code: d.code,
        severity: d.severity,
        provisionRef: d.provisionRef,
        line: d.range.startLine,
        title: d.title,
        excerpt: d.excerpt.slice(0, 120),
        source: d.source,
    };
}

function diagCountsByCode(diags: readonly { code: string }[]): Record<string, number> {
    const counts: Record<string, number> = {};

    for (const d of diags) {
        counts[d.code] = (counts[d.code] ?? 0) + 1;
    }

    return counts;
}

function matchPureLlmIssuesToGroundTruth(issues: readonly PureLlmIssue[]): string[] {
    const matched = new Set<string>();

    for (const bug of GROUND_TRUTH_BUGS) {
        const hit = issues.some((issue) => {
            const blob = `${issue.article} ${issue.clause} ${issue.quote} ${issue.description}`.toLowerCase();

            return blob.includes(`điều ${bug.article}`) || blob.includes(bug.article);
        });

        if (hit) {
            matched.add(bug.id);
        }
    }

    return [...matched];
}

async function main(): Promise<void> {
    const apiKey = process.env.GEMINI_API_KEY?.trim() ?? "";

    if (!apiKey) {
        console.error("Missing GEMINI_API_KEY env var.");
        process.exit(1);
    }

    const files = loadBlhsWorkspace();
    const blhs2015 = files[0];
    const law2017 = files[1];
    const nq2018 = files[2];
    const law2025 = files[3];

    let totalTokensUsed = 0;

    // 0. Probe Decision API
    console.log("[0/5] Probing Gemini Decisions API...");
    let decisionApiHealthy = false;
    let decisionProbeTokens = 0;

    try {
        const dec = await withRetry(() => callGeminiDecisions({
            apiKey,
            input: "[U0] Điều 305. Thuốc nổ từ 10 kg đến 30 kg.",
            questions: {
                u0: {
                    type: "noul",
                    instructions: "Is [U0] a sanction or threshold rule?",
                },
            },
        }));
        decisionApiHealthy = true;
        decisionProbeTokens = dec.usage.totalTokens;
        totalTokensUsed += decisionProbeTokens;
    } catch (err: unknown) {
        console.log("  Decision API probe failed:", err instanceof Error ? err.message : String(err));
    }

    await sleep(1200);

    // =========================================================================
    // ARM 1A: Tier 0 Deterministic (0 tokens)
    // =========================================================================
    console.log("[1/5] Running Arm 1A: Tier 0 Deterministic (0 tokens)...");
    const t0Start = Date.now();
    const tier0Blhs = await analyzeLocalDraft(blhs2015.content, files, {
        currentPath: blhs2015.path,
        includeAi: false,
    });
    const tier02017 = await analyzeLocalDraft(law2017.content, files, {
        currentPath: law2017.path,
        includeAi: false,
    });
    const tier02025 = await analyzeLocalDraft(law2025.content, files, {
        currentPath: law2025.path,
        includeAi: false,
    });
    const relationGraph = buildWorkspaceRelationGraph(files, law2025.path, law2025.content);
    const behaviorHistory = buildWorkspaceBehaviorHistory(files, relationGraph, new Map(), law2025.path, law2025.content);
    const tier0Ms = Date.now() - t0Start;

    // =========================================================================
    // ARM 1B: Current Pipeline (Tier 0 + Decision API + Extract on gemini-3.5-flash-lite)
    // =========================================================================
    const pipelineModel = "gemini-3.5-flash-lite";
    console.log(`[2/5] Running Arm 1B: Current Pipeline (${pipelineModel})...`);
    const cache = new IncrementalLlmCache();
    const t1Start = Date.now();
    const defaultPipelineRun = await analyzeLocalDraft(blhs2015.content, files, {
        currentPath: blhs2015.path,
        includeAi: true,
        useDecisionApi: true,
        apiKey,
        model: pipelineModel,
        incrementalCache: cache,
    });
    const defaultPipelineMs = Date.now() - t1Start;
    totalTokensUsed += defaultPipelineRun.lean.tokenStats.actualAiTokens;

    await sleep(1200);

    // Drain remaining units in batches of 12
    const parsed2015 = parseDraftDocument(blhs2015.content);
    const allUnits = extractUnitsFromDraft(parsed2015);
    let fullDrainTokens = defaultPipelineRun.lean.tokenStats.actualAiTokens;
    let fullDrainFiltered = defaultPipelineRun.lean.tokenStats.tokenBreakdown?.filteredByDecision ?? 0;
    let fullDrainEscalated = defaultPipelineRun.lean.tokenStats.tokenBreakdown?.escalatedToExtract ?? 0;
    const allExtractedFacts: ExtractedLegalFact[] = [];
    const drainErrors: string[] = [];
    const tDrainStart = Date.now();

    for (let offset = 12; offset < allUnits.length; offset += 12) {
        if (totalTokensUsed > 100_000) {
            drainErrors.push(`Stopped at offset ${offset}: token budget guard`);
            break;
        }

        const batch = allUnits.slice(offset, offset + 12);

        try {
            const res = await withRetry(() => extractLegalFactsForUnits(parsed2015, batch, {
                apiKey,
                model: pipelineModel,
                useDecisionApi: true,
            }));
            fullDrainTokens += res.actualAiTokens;
            totalTokensUsed += res.actualAiTokens;
            fullDrainFiltered += res.tokenBreakdown.filteredByDecision;
            fullDrainEscalated += res.tokenBreakdown.escalatedToExtract;
            allExtractedFacts.push(...res.facts);

            if (res.error) {
                drainErrors.push(`offset ${offset}: ${res.error}`);
            }
        } catch (err: unknown) {
            drainErrors.push(`offset ${offset}: ${err instanceof Error ? err.message : String(err)}`);
            break;
        }

        await sleep(1200);
    }

    const fullDrainMs = defaultPipelineMs + (Date.now() - tDrainStart);

    // Compile drained facts with Lean 4 to capture derivedDiagnostics
    const fineRanges = extractFineRanges(parsed2015);
    const thresholds = extractNumericThresholds(parsed2015, fineRanges);
    const wsContext = buildLocalWorkspaceContext(files, blhs2015.path);
    const compiledDrain = compileDraftToLean({
        draft: parsed2015,
        fineRanges,
        thresholds,
        references: analyzeLogic(parsed2015, fineRanges, thresholds).references,
        terms: analyzeAmbiguities(parsed2015, wsContext.definedTerms).terms,
        diagnostics: [
            ...analyzeLoopholes(parsed2015, fineRanges, thresholds),
            ...analyzeAmbiguities(parsed2015, wsContext.definedTerms).diagnostics,
            ...analyzeLogic(parsed2015, fineRanges, thresholds).diagnostics,
        ],
        workspaceContext: wsContext,
        extractedFacts: allExtractedFacts,
        actualAiTokens: fullDrainTokens,
    });

    // =========================================================================
    // ARM 1C: Incremental 1-clause edit (fix Điều 305)
    // =========================================================================
    console.log("[3/5] Running Arm 1C: Incremental 1-clause edit...");
    const edited2015 = blhs2015.content.replace(
        "Thuốc nổ các loại từ trên 31 kilôgam đến 100 kilôgam",
        "Thuốc nổ các loại từ trên 30 kilôgam đến 100 kilôgam",
    );
    const tIncStart = Date.now();
    const incRun = await analyzeLocalDraft(edited2015, files, {
        currentPath: blhs2015.path,
        includeAi: true,
        useDecisionApi: true,
        apiKey,
        model: pipelineModel,
        incrementalCache: cache,
    });
    const incMs = Date.now() - tIncStart;
    totalTokensUsed += incRun.lean.tokenStats.actualAiTokens;

    await sleep(1200);

    // =========================================================================
    // ARM 2: Pure LLM Baseline (2A: gemini-3.5-flash-lite, 2B: gemini-3.6-flash)
    // =========================================================================
    const pureLlmIssueSchema: Record<string, unknown> = {
        type: "object",
        additionalProperties: false,
        required: ["issues"],
        properties: {
            issues: {
                type: "array",
                items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["article", "clause", "category", "severity", "quote", "description", "suggestion"],
                    properties: {
                        article: { type: "string" },
                        clause: { type: "string" },
                        category: { type: "string" },
                        severity: { type: "string" },
                        quote: { type: "string" },
                        description: { type: "string" },
                        suggestion: { type: "string" },
                    },
                },
            },
        },
    };

    const pureLlmTaskAPrompt = `Bạn là chuyên gia thẩm định kỹ thuật lập pháp Việt Nam.
Hãy rà soát toàn bộ trích đoạn Bộ luật Hình sự 100/2015/QH13 dưới đây và liệt kê TẤT CẢ các lỗi thực sự nghiêm trọng về:
1. Chồng chéo hoặc khoảng trống định lượng (số lượng, khối lượng, tỷ lệ %, mức phạt).
2. Dẫn chiếu sai điều luật (dẫn chiếu nhầm sang tội danh khác hoặc trùng lặp điều luật).
3. Lỗ hổng liệt kê mở hoặc mâu thuẫn nội tại.
Chỉ báo lỗi có căn cứ rõ ràng, trích nguyên văn quote ngắn gọn.`;

    const runPureLlmTaskA = async (modelName: string, maxOutputTokens: number): Promise<{
        model: string;
        issues: PureLlmIssue[];
        matchedGroundTruth: string[];
        usage: { inputTokens: number; outputTokens: number; totalTokens: number };
        durationMs: number;
        error: string | null;
    }> => {
        const start = Date.now();

        try {
            const res = await withRetry(() => callGeminiStructuredInteraction({
                apiKey,
                model: modelName,
                systemInstruction: pureLlmTaskAPrompt,
                input: blhs2015.content,
                schema: pureLlmIssueSchema,
                maxOutputTokens,
            }));
            const durationMs = Date.now() - start;
            const raw = res.data as { issues?: PureLlmIssue[] };
            const issues = Array.isArray(raw.issues) ? raw.issues : [];
            totalTokensUsed += res.usage.totalTokens;

            return {
                model: modelName,
                issues,
                matchedGroundTruth: matchPureLlmIssuesToGroundTruth(issues),
                usage: res.usage,
                durationMs,
                error: null,
            };
        } catch (err: unknown) {
            return {
                model: modelName,
                issues: [],
                matchedGroundTruth: [],
                usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
                durationMs: Date.now() - start,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    };

    console.log("[4/5] Running Arm 2A: Pure LLM (gemini-3.5-flash-lite, Run 1 & 2)...");
    const pureLiteRun1 = await runPureLlmTaskA("gemini-3.5-flash-lite", 3000);
    await sleep(1200);
    const pureLiteRun2 = await runPureLlmTaskA("gemini-3.5-flash-lite", 3000);
    await sleep(1200);

    console.log("[5/5] Running Arm 2B: Pure LLM (gemini-3.6-flash, Task A + B + C)...");
    const pure36TaskA = await runPureLlmTaskA("gemini-3.6-flash", 8192);
    await sleep(1200);

    // Task B: Pure LLM Relation Graph
    const compactDocsForRelations = files.map((f) => {
        const lines = f.content.split("\n");
        const head = lines.slice(0, 22).join("\n");
        const tail = lines.slice(-15).join("\n");

        return `=== ${f.documentNumber} (${f.title}) ===\n${head}\n...\n${tail}`;
    }).join("\n\n");

    const pureRelationSchema: Record<string, unknown> = {
        type: "object",
        additionalProperties: false,
        required: ["relations"],
        properties: {
            relations: {
                type: "array",
                items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["fromDoc", "toDoc", "type", "detail"],
                    properties: {
                        fromDoc: { type: "string" },
                        toDoc: { type: "string" },
                        type: { type: "string" },
                        detail: { type: "string" },
                    },
                },
            },
        },
    };

    const tRelStart = Date.now();
    let pureRelUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let pureRelations: PureLlmRelation[] = [];
    let pureRelError: string | null = null;

    try {
        const pureRelRes = await withRetry(() => callGeminiStructuredInteraction({
            apiKey,
            model: "gemini-3.6-flash",
            systemInstruction: "Trích xuất lược đồ quan hệ giữa các văn bản (BASED_ON, AMENDS, SUPPLEMENTS, REPLACES, REPEALS, IMPLEMENTS).",
            input: compactDocsForRelations,
            schema: pureRelationSchema,
            maxOutputTokens: 8192,
        }));
        pureRelUsage = pureRelRes.usage;
        totalTokensUsed += pureRelRes.usage.totalTokens;
        pureRelations = ((pureRelRes.data as { relations?: PureLlmRelation[] }).relations ?? []);
    } catch (err: unknown) {
        pureRelError = err instanceof Error ? err.message : String(err);
    }

    const pureRelMs = Date.now() - tRelStart;

    await sleep(1200);

    // Task C: Pure LLM 3-Gen Penalty Change History
    const pureHistorySchema: Record<string, unknown> = {
        type: "object",
        additionalProperties: false,
        required: ["changes"],
        properties: {
            changes: {
                type: "array",
                items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["article", "crimeName", "y2015", "y2017", "y2025", "summary"],
                    properties: {
                        article: { type: "string" },
                        crimeName: { type: "string" },
                        y2015: { type: "string" },
                        y2017: { type: "string" },
                        y2025: { type: "string" },
                        summary: { type: "string" },
                    },
                },
            },
        },
    };

    const tHistStart = Date.now();
    let pureHistUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let pureChanges: PureLlmChange[] = [];
    let pureHistError: string | null = null;

    try {
        const pureHistRes = await withRetry(() => callGeminiStructuredInteraction({
            apiKey,
            model: "gemini-3.6-flash",
            systemInstruction: "Tổng hợp lịch sử thay đổi hình phạt/chế tài qua 3 đời luật: 100/2015/QH13 -> 12/2017/QH14 -> 86/2025/QH15.",
            input: `=== 100/2015/QH13 ===\n${blhs2015.content}\n\n=== 12/2017/QH14 ===\n${law2017.content}\n\n=== 86/2025/QH15 ===\n${law2025.content}`,
            schema: pureHistorySchema,
            maxOutputTokens: 8192,
        }));
        pureHistUsage = pureHistRes.usage;
        totalTokensUsed += pureHistRes.usage.totalTokens;
        pureChanges = ((pureHistRes.data as { changes?: PureLlmChange[] }).changes ?? []);
    } catch (err: unknown) {
        pureHistError = err instanceof Error ? err.message : String(err);
    }

    const pureHistMs = Date.now() - tHistStart;

    if (totalTokensUsed > MAX_TOKEN_BUDGET) {
        throw new Error(`Exceeded MAX_TOKEN_BUDGET (${totalTokensUsed} > ${MAX_TOKEN_BUDGET})`);
    }

    // Scale projection for 500-page full BLHS
    const refInputTokens = pure36TaskA.usage.inputTokens > 0
        ? pure36TaskA.usage.inputTokens
        : pureLiteRun1.usage.inputTokens;
    const charsPerToken = blhs2015.content.length / Math.max(1, refInputTokens);
    const full500PagesChars = Math.round(500 * (nq2018.content.length / 20));
    const full500PagesInputTokens = Math.round(full500PagesChars / charsPerToken);

    const report = {
        ranAt: new Date().toISOString(),
        decisionProbe: { decisionApiHealthy, decisionProbeTokens },
        corpus: {
            filesCount: files.length,
            totalPdfPages: 500,
            totalExcerptChars: files.reduce((acc, f) => acc + f.content.length, 0),
            blhs2015Chars: blhs2015.content.length,
            blhs2015Units: allUnits.length,
        },
        arm1PipelineAsIs: {
            model: pipelineModel,
            tier0: {
                tokens: 0,
                durationMs: tier0Ms,
                blhs2015DiagnosticsCount: tier0Blhs.diagnostics.length,
                blhs2015CountsByCode: diagCountsByCode(tier0Blhs.diagnostics),
                blhs2015DiagnosticsSample: tier0Blhs.diagnostics.map(compactDiag),
                law2017CountsByCode: diagCountsByCode(tier02017.diagnostics),
                law2025CountsByCode: diagCountsByCode(tier02025.diagnostics),
                relationGraph: {
                    totalDocuments: relationGraph.summary.totalDocuments,
                    totalEdges: relationGraph.summary.totalEdges,
                    violationCount: relationGraph.summary.violationCount,
                    edges: relationGraph.edges.map((e) => `${e.fromId} -[${e.type}]-> ${e.toId}`),
                },
                behaviorHistory: {
                    totalBehaviors: behaviorHistory.totalBehaviors,
                    withHistoryCount: behaviorHistory.withHistoryCount,
                },
            },
            defaultSingleCall: {
                durationMs: defaultPipelineMs,
                actualAiTokens: defaultPipelineRun.lean.tokenStats.actualAiTokens,
                tokenBreakdown: defaultPipelineRun.lean.tokenStats.tokenBreakdown ?? null,
                aiStatus: defaultPipelineRun.aiStatus,
                totalDiagnostics: defaultPipelineRun.diagnostics.length,
            },
            fullDocumentDrain: {
                durationMs: fullDrainMs,
                totalUnits: allUnits.length,
                filteredByDecision: fullDrainFiltered,
                escalatedToExtract: fullDrainEscalated,
                extractedFactsCount: allExtractedFacts.length,
                derivedDiagnosticsFromLlm: compiledDrain.derivedDiagnostics.map(compactDiag),
                totalTokens: fullDrainTokens,
                drainErrors,
            },
            incremental1ClauseEdit: {
                durationMs: incMs,
                actualAiTokens: incRun.lean.tokenStats.actualAiTokens,
                tokenBreakdown: incRun.lean.tokenStats.tokenBreakdown ?? null,
            },
        },
        arm2PureLlm: {
            sameModelLite: {
                run1: pureLiteRun1,
                run2: pureLiteRun2,
            },
            strongerModel36Flash: {
                taskABugDetection: pure36TaskA,
                taskBRelationGraph: {
                    durationMs: pureRelMs,
                    usage: pureRelUsage,
                    relationsCount: pureRelations.length,
                    relations: pureRelations,
                    error: pureRelError,
                },
                taskCBehaviorHistory: {
                    durationMs: pureHistMs,
                    usage: pureHistUsage,
                    changesCount: pureChanges.length,
                    changes: pureChanges,
                    error: pureHistError,
                },
            },
        },
        scaleProjection500Pages: {
            measuredCharsPerPage: Number((nq2018.content.length / 20).toFixed(1)),
            measuredCharsPerToken: Number(charsPerToken.toFixed(2)),
            estimated500PagesChars: full500PagesChars,
            estimated500PagesInputTokens: full500PagesInputTokens,
            pureLlm10EditsTokens: full500PagesInputTokens * 10,
            pipelineTier0Tokens: 0,
        },
        totalTokensUsedThisBenchmark: totalTokensUsed,
        budgetCap: 500_000,
    };

    const outDir = resolve(import.meta.dir, "../../data/eval/reports");
    mkdirSync(outDir, { recursive: true });
    const outPath = resolve(outDir, "blhs-pipeline-vs-llm.json");
    writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
    console.log("DONE! Saved report to:", outPath);
    console.log("Total tokens used:", totalTokensUsed);
    console.log("Tier 0 BLHS 2015 counts:", JSON.stringify(diagCountsByCode(tier0Blhs.diagnostics)));
    console.log("Pure 3.5-lite Run1:", pureLiteRun1.matchedGroundTruth, "err:", pureLiteRun1.error);
    console.log("Pure 3.6-flash TaskA:", pure36TaskA.matchedGroundTruth, "issues:", pure36TaskA.issues.length, "tokens:", pure36TaskA.usage.totalTokens);
}

void main();
