import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { callGeminiStructuredInteraction, DEFAULT_GEMINI_MODEL } from "../../src/lib/engine/gemini-client";
import { runItdLiveJudge, runItdLoopholeDetector } from "../../src/lib/engine/itd-harness";
import { buildJudgeBlindDataset } from "./judge-blind-dataset";
import { buildJudgeDevDataset } from "./judge-dev-dataset";
import { buildLoopholeGoldenDataset } from "./loophole-dataset";
import { printSplitReport } from "./runner";
import {
    evaluateSplit,
    type EvaluatedJudgePair,
    type EvaluatedLoopholePair,
} from "./scoring";
import type { DatasetSplit, JudgeEvalCase, LoopholeEvalCase } from "./types";

const PURE_LOOPHOLE_SYSTEM = `Bạn là chuyên gia thẩm định văn bản quy phạm pháp luật và hợp đồng Việt Nam.
Phát hiện các kẽ hở nghiêm trọng (KHÔNG báo lỗi giả trên văn bản sạch!).
Mã lỗi chuẩn: LG001 (khung phạt tiền/tù đảo ngược), LP003 (khoảng trống ngưỡng), LG002 (chồng chéo ngưỡng), DEONTIC_CONFLICT (vừa cấm vừa cho phép), LG003 (dẫn chiếu gãy), LG004 (tự dẫn chiếu), LG007 (dẫn chiếu điều đã bãi bỏ), LP001 (ngoại lệ mở không dẫn chiếu), LP002 (cấm không chế tài), LP006 (chỉ phạt cá nhân bỏ sót tổ chức), LG016 (nghịch lý mức phạt), AM005 (thuật ngữ chuyên ngành chưa định nghĩa trong draft/workspace).
CHỈ căn cứ DRAFT + WORKSPACE. Mọi verbatimQuote PHẢI là trích dẫn nguyên văn trong DRAFT.
Trả về JSON đúng schema.`;

const PURE_LOOPHOLE_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    required: ["caseId", "hasLoophole", "workspaceOnly", "findings"],
    properties: {
        caseId: { type: "string" },
        hasLoophole: { type: "boolean" },
        workspaceOnly: { type: "boolean" },
        findings: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: ["code", "category", "provisionRef", "verbatimQuote", "exploitScenario"],
                properties: {
                    code: { type: "string" },
                    category: { type: "string", enum: ["LOOPHOLE", "AMBIGUITY", "LOGIC"] },
                    provisionRef: { type: "string" },
                    verbatimQuote: { type: "string" },
                    exploitScenario: { type: "string" },
                },
            },
        },
    },
};

const PURE_JUDGE_SYSTEM = `Bạn là Thẩm phán Live Judge xét xử tình huống CHỈ dựa trên DRAFT và WORKSPACE.
Quy tắc:
- outcome thuộc 1 trong 5 nhãn: GUILTY_SANCTIONED, PARTIALLY_ENFORCEABLE, ACQUITTED_LOOPHOLE, CONFLICT_AMBIGUOUS, NOT_COVERED.
- abstained = true khi và chỉ khi outcome === "CONFLICT_AMBIGUOUS".
- applicableFine tính theo đơn vị đồng Việt Nam (VNĐ, ví dụ 4000000 cho 4 triệu đồng), cộng dồn nếu đa vi phạm, nhân 2 cho tổ chức nếu có điều khoản quy đổi. Nếu không phạt tiền thì null.
- nonMonetarySanctions liệt kê phạt tù, tù chung thân, tịch thu tang vật... nếu có.
- citations bắt buộc trích dẫn nguyên văn (verbatimQuote) và địa chỉ điều khoản (provisionRef) có trong DRAFT hoặc WORKSPACE.
Trả về JSON đúng schema.`;

const PURE_JUDGE_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    required: [
        "caseId",
        "outcome",
        "abstained",
        "applicableFine",
        "nonMonetarySanctions",
        "detectedDefectCodes",
        "citations",
        "reasoning",
        "workspaceOnly",
    ],
    properties: {
        caseId: { type: "string" },
        outcome: {
            type: "string",
            enum: [
                "GUILTY_SANCTIONED",
                "ACQUITTED_LOOPHOLE",
                "CONFLICT_AMBIGUOUS",
                "PARTIALLY_ENFORCEABLE",
                "NOT_COVERED",
            ],
        },
        abstained: { type: "boolean" },
        applicableFine: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["min", "max"],
            properties: {
                min: { type: "number" },
                max: { type: "number" },
            },
        },
        nonMonetarySanctions: { type: "array", items: { type: "string" } },
        detectedDefectCodes: { type: "array", items: { type: "string" } },
        citations: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: ["provisionRef", "verbatimQuote"],
                properties: {
                    provisionRef: { type: "string" },
                    verbatimQuote: { type: "string" },
                },
            },
        },
        reasoning: { type: "string" },
        workspaceOnly: { type: "boolean" },
    },
};

async function sleep(ms: number): Promise<void> {
    await new Promise((resolveTimer) => setTimeout(resolveTimer, ms));
}

async function callWithRateLimitRetry<T>(
    label: string,
    fn: () => Promise<T>,
    stats: { retries: number; errors: string[] },
): Promise<T | null> {
    const backoffMs = [10000, 20000, 35000, 50000];

    for (let attempt = 0; attempt <= backoffMs.length; attempt += 1) {
        try {
            return await fn();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            const isRateLimit = /\(429\)|\(503\)|quota|rate[_\s-]?limit|resource[_\s-]?exhausted/i.test(msg);

            if (isRateLimit && attempt < backoffMs.length) {
                stats.retries += 1;
                await sleep(backoffMs[attempt]);
                continue;
            }

            stats.errors.push(`${label}: ${msg.slice(0, 140)}`);

            return null;
        }
    }

    return null;
}

async function runWithConcurrency<T, R>(
    items: readonly T[],
    concurrency: number,
    delayBetweenMs: number,
    worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;

    async function next(): Promise<void> {
        while (cursor < items.length) {
            const idx = cursor;
            cursor += 1;
            results[idx] = await worker(items[idx], idx);

            if (delayBetweenMs > 0 && cursor < items.length) {
                await sleep(delayBetweenMs);
            }
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => next());
    await Promise.all(workers);

    return results;
}

async function runPureFlashLiteLoophole(
    spec: LoopholeEvalCase,
    apiKey: string,
    model: string,
    stats: { retries: number; errors: string[] },
): Promise<EvaluatedLoopholePair> {
    const wsText = spec.workspaceFiles.length > 0
        ? spec.workspaceFiles.map((f) => `[${f.title}]\n${f.content}`).join("\n\n")
        : "(Trống)";
    let durationMs = 1;
    const res = await callWithRateLimitRetry(spec.caseId, async () => {
        const t0 = Date.now();
        const out = await callGeminiStructuredInteraction({
            apiKey,
            model,
            systemInstruction: PURE_LOOPHOLE_SYSTEM,
            input: `CASE_ID: ${spec.caseId}\nWORKSPACE:\n${wsText}\n\nDRAFT:\n${spec.draftContent}`,
            schema: PURE_LOOPHOLE_SCHEMA,
            maxOutputTokens: 1200,
        });
        durationMs = Math.max(1, Date.now() - t0);

        return out;
    }, stats);

    if (res) {
        return {
            spec,
            rawOutput: res.data,
            usage: {
                inputTokens: res.usage.inputTokens,
                outputTokens: res.usage.outputTokens,
                decisionInputTokens: 0,
                llmCalls: 1,
                durationMs,
                modelUsed: model,
            },
        };
    }

    return {
        spec,
        rawOutput: null,
        usage: {
            inputTokens: 0,
            outputTokens: 0,
            decisionInputTokens: 0,
            llmCalls: 1,
            durationMs,
            modelUsed: model,
        },
    };
}

async function runPureFlashLiteJudge(
    spec: JudgeEvalCase,
    apiKey: string,
    model: string,
    stats: { retries: number; errors: string[] },
): Promise<EvaluatedJudgePair> {
    const wsText = spec.workspaceFiles.length > 0
        ? spec.workspaceFiles.map((f) => `[${f.title}]\n${f.content}`).join("\n\n")
        : "(Trống)";
    let durationMs = 1;
    const res = await callWithRateLimitRetry(spec.caseId, async () => {
        const t0 = Date.now();
        const out = await callGeminiStructuredInteraction({
            apiKey,
            model,
            systemInstruction: PURE_JUDGE_SYSTEM,
            input: `CASE_ID: ${spec.caseId}\nWORKSPACE:\n${wsText}\n\nDRAFT:\n${spec.draftContent}\n\nSCENARIO:\n${spec.scenario}`,
            schema: PURE_JUDGE_SCHEMA,
            maxOutputTokens: 900,
        });
        durationMs = Math.max(1, Date.now() - t0);

        return out;
    }, stats);

    if (res) {
        return {
            spec,
            rawOutput: res.data,
            usage: {
                inputTokens: res.usage.inputTokens,
                outputTokens: res.usage.outputTokens,
                decisionInputTokens: 0,
                llmCalls: 1,
                durationMs,
                modelUsed: model,
            },
        };
    }

    return {
        spec,
        rawOutput: null,
        usage: {
            inputTokens: 0,
            outputTokens: 0,
            decisionInputTokens: 0,
            llmCalls: 1,
            durationMs,
            modelUsed: model,
        },
    };
}

async function main(): Promise<void> {
    const apiKey = process.env.GEMINI_API_KEY?.trim() ?? "";

    if (!apiKey) {
        console.error("Missing GEMINI_API_KEY env var.");
        process.exit(1);
    }

    const splitArg = (process.argv.find((a) => a.startsWith("--split="))?.split("=")[1] ?? "dev") as DatasetSplit;
    const modeArg = process.argv.find((a) => a.startsWith("--mode="))?.split("=")[1] ?? "both";
    const model = DEFAULT_GEMINI_MODEL;

    const loopholeAll = buildLoopholeGoldenDataset().filter((c) => c.split === splitArg);
    const judgeAll = splitArg === "dev" ? buildJudgeDevDataset() : buildJudgeBlindDataset();

    const outPath = resolve(import.meta.dir, `../../../data/eval/reports/itd-live-api-${splitArg}.json`);
    const existing = existsSync(outPath)
        ? (JSON.parse(readFileSync(outPath, "utf8")) as Record<string, unknown>)
        : {};
    const saved: Record<string, unknown> = { ...existing, ranAt: new Date().toISOString(), split: splitArg, model };

    if (modeArg === "pure" || modeArg === "both") {
        console.log(`Running LIVE Pure ${model} API on split=${splitArg} (${loopholeAll.length} loophole + ${judgeAll.length} judge)...`);
        const pureStats = { retries: 0, errors: [] as string[] };
        const pureLh = await runWithConcurrency(loopholeAll, 1, 3200, (spec) => runPureFlashLiteLoophole(spec, apiKey, model, pureStats));
        const pureJg = await runWithConcurrency(judgeAll, 1, 3200, (spec) => runPureFlashLiteJudge(spec, apiKey, model, pureStats));
        const pureReport = evaluateSplit({
            armName: `Live Pure ${model} (API Raw)`,
            harnessVersion: "live-student-raw",
            split: splitArg,
            loopholePairs: pureLh,
            judgePairs: pureJg,
        });
        printSplitReport(pureReport);
        console.log(`Pure API stats: retries=${pureStats.retries}, errors=${pureStats.errors.length}`);

        if (splitArg === "dev" && pureStats.errors.length > 0) {
            console.log(`Pure API error sample: ${pureStats.errors.slice(0, 5).join(" | ")}`);
        }

        saved.livePureFlashLite = pureReport;
        saved.pureApiStats = { retries: pureStats.retries, errorCount: pureStats.errors.length };
    }

    if (modeArg === "harness" || modeArg === "both") {
        console.log(`Running LIVE ${model} + ITD Harness v4 (API) on split=${splitArg}...`);
        const hLh = await runWithConcurrency(loopholeAll, 2, 300, async (spec) => {
            const res = await runItdLoopholeDetector({
                caseId: spec.caseId,
                draftContent: spec.draftContent,
                workspaceFiles: spec.workspaceFiles,
                currentPath: spec.currentPath,
                useAi: true,
                useDecisionApi: true,
                apiKey,
                model,
            });

            return { spec, rawOutput: res.output, usage: res.usage };
        });
        const hJg = await runWithConcurrency(judgeAll, 2, 100, async (spec) => {
            const res = await runItdLiveJudge({
                caseId: spec.caseId,
                draftContent: spec.draftContent,
                scenario: spec.scenario,
                workspaceFiles: spec.workspaceFiles,
                currentPath: spec.currentPath,
                useAi: true,
                apiKey,
                model,
            });

            return { spec, rawOutput: res.output, usage: res.usage };
        });
        const harnessReport = evaluateSplit({
            armName: `Live ${model} + ITD Harness v4 (API)`,
            harnessVersion: "v4-live-api",
            split: splitArg,
            loopholePairs: hLh,
            judgePairs: hJg,
        });
        printSplitReport(harnessReport);
        saved.liveHarnessV4 = harnessReport;
    }

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(saved, null, 2), "utf8");
    console.log(`Saved live API eval report to ${outPath}`);
}

await main();
