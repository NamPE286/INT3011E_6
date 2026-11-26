import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
    BLIND_TEACHER_JUDGE_META,
    BLIND_TEACHER_JUDGE_RAW,
    BLIND_TEACHER_LOOPHOLE_META,
    BLIND_TEACHER_LOOPHOLE_RAW,
} from "./blind-teacher-baseline-data";
import {
    DEV_STUDENT_JUDGE_META,
    DEV_STUDENT_JUDGE_RAW,
    DEV_STUDENT_LOOPHOLE_META,
    DEV_STUDENT_LOOPHOLE_RAW,
    DEV_TEACHER_JUDGE_META,
    DEV_TEACHER_JUDGE_RAW,
    DEV_TEACHER_LOOPHOLE_META,
    DEV_TEACHER_LOOPHOLE_RAW,
} from "./dev-llm-baselines-data";
import { printSplitReport, runHarnessOnSplit, scoreCapturedLlmBaseline } from "./runner";
import { evaluateParetoAcceptanceGate } from "./scoring";
import type { SplitEvalReport } from "./types";

function readJsonIfExists<T>(filePath: string): T | null {
    if (!existsSync(filePath)) {
        return null;
    }

    return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

async function main(): Promise<void> {
    const reportsDir = resolve(import.meta.dir, "../../../data/eval/reports");
    mkdirSync(reportsDir, { recursive: true });

    const devTeacher = scoreCapturedLlmBaseline({
        armName: "Teacher Baseline: Gemini 4 Neon (xhigh) Raw",
        harnessVersion: "teacher-raw",
        split: "dev",
        loopholeRaw: DEV_TEACHER_LOOPHOLE_RAW,
        loopholeMeta: DEV_TEACHER_LOOPHOLE_META,
        judgeRaw: DEV_TEACHER_JUDGE_RAW,
        judgeMeta: DEV_TEACHER_JUDGE_META,
    });
    const devStudentCaptured = scoreCapturedLlmBaseline({
        armName: "Student Baseline: Gemini 3.5 Flash-Lite Raw (Captured Batch)",
        harnessVersion: "student-raw-captured",
        split: "dev",
        loopholeRaw: DEV_STUDENT_LOOPHOLE_RAW,
        loopholeMeta: DEV_STUDENT_LOOPHOLE_META,
        judgeRaw: DEV_STUDENT_JUDGE_RAW,
        judgeMeta: DEV_STUDENT_JUDGE_META,
    });
    const blindTeacher = scoreCapturedLlmBaseline({
        armName: "Teacher Baseline: Gemini 4 Neon (xhigh) Raw",
        harnessVersion: "teacher-raw",
        split: "blind_test",
        loopholeRaw: BLIND_TEACHER_LOOPHOLE_RAW,
        loopholeMeta: BLIND_TEACHER_LOOPHOLE_META,
        judgeRaw: BLIND_TEACHER_JUDGE_RAW,
        judgeMeta: BLIND_TEACHER_JUDGE_META,
    });

    const devV0 = readJsonIfExists<SplitEvalReport>(resolve(reportsDir, "itd-v0-dev.json"));
    const blindV0 = readJsonIfExists<SplitEvalReport>(resolve(reportsDir, "itd-v0-blind_test.json"));
    const devV1 = readJsonIfExists<SplitEvalReport>(resolve(reportsDir, "itd-v1-dev.json"));
    const devV2 = readJsonIfExists<SplitEvalReport>(resolve(reportsDir, "itd-v2-dev.json"));
    const blindV2 = readJsonIfExists<SplitEvalReport>(resolve(reportsDir, "itd-v2-blind_test.json"));

    const devV3Det = await runHarnessOnSplit({
        version: "v3",
        armName: "Gemini 3.5 Flash-Lite + ITD Harness v3 (Tier 0+1 Deterministic)",
        split: "dev",
        useAi: false,
    });
    const blindV3Det = await runHarnessOnSplit({
        version: "v3",
        armName: "Gemini 3.5 Flash-Lite + ITD Harness v3 (Tier 0+1 Deterministic)",
        split: "blind_test",
        useAi: false,
    });

    const liveDev = readJsonIfExists<{
        livePureFlashLite?: SplitEvalReport;
        liveHarnessV3?: SplitEvalReport;
        pureApiStats?: { retries: number; errorCount: number };
    }>(resolve(reportsDir, "itd-live-api-dev.json"));
    const liveBlind = readJsonIfExists<{
        livePureFlashLite?: SplitEvalReport;
        liveHarnessV3?: SplitEvalReport;
        pureApiStats?: { retries: number; errorCount: number };
    }>(resolve(reportsDir, "itd-live-api-blind_test.json"));

    const paretoDeterministic = evaluateParetoAcceptanceGate({
        candidateBlind: blindV3Det,
        previousBestBlind: blindV0,
        teacherBlind: blindTeacher,
    });

    const paretoLiveApi = liveBlind?.liveHarnessV3
        ? evaluateParetoAcceptanceGate({
            candidateBlind: liveBlind.liveHarnessV3,
            previousBestBlind: blindV0,
            teacherBlind: blindTeacher,
        })
        : null;

    const debugRegression = readJsonIfExists<{
        summary?: Record<string, unknown>;
    }>(resolve(reportsDir, "debug-court-benchmark.json"));

    printSplitReport(blindTeacher);
    printSplitReport(blindV3Det);

    if (liveBlind?.liveHarnessV3) {
        printSplitReport(liveBlind.liveHarnessV3);
    }

    console.log("\n=== PARETO ACCEPTANCE GATE (SEALED BLIND TEST) ===");
    console.log("Deterministic v3:", JSON.stringify(paretoDeterministic));

    if (paretoLiveApi) {
        console.log("Live API v3 (Flash-Lite + Decision API):", JSON.stringify(paretoLiveApi));
    }

    const unified = {
        generatedAt: new Date().toISOString(),
        datasetSpec: {
            splitRatio: "60% Dev / 40% Blind Test (disjoint legal domains, anti-leakage sealed logs)",
            devCases: { loophole: 24, positiveLoophole: 15, negativeLoophole: 9, liveJudge: 42, total: 66 },
            blindTestCases: { loophole: 16, positiveLoophole: 10, negativeLoophole: 6, liveJudge: 28, total: 44 },
            regressionAnchor16: debugRegression?.summary ?? null,
        },
        dev: {
            teacherRaw: devTeacher,
            studentRawCaptured: devStudentCaptured,
            studentRawLiveApi: liveDev?.livePureFlashLite ?? null,
            studentRawLiveApiStats: liveDev?.pureApiStats ?? null,
            baselineV0: devV0,
            harnessV1: devV1,
            harnessV2: devV2,
            harnessV3Deterministic: devV3Det,
            harnessV3LiveApi: liveDev?.liveHarnessV3 ?? null,
        },
        blindTest: {
            teacherRaw: blindTeacher,
            studentRawLiveApi: liveBlind?.livePureFlashLite ?? null,
            studentRawLiveApiStats: liveBlind?.pureApiStats ?? null,
            baselineV0: blindV0,
            harnessV2: blindV2,
            harnessV3Deterministic: blindV3Det,
            harnessV3LiveApi: liveBlind?.liveHarnessV3 ?? null,
        },
        paretoAcceptanceGate: {
            deterministicV3: paretoDeterministic,
            liveApiV3: paretoLiveApi,
        },
    };

    const outPath = resolve(reportsDir, "itd-harness-benchmark.json");
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(unified, null, 2), "utf8");
    console.log(`\nSaved unified benchmark artifact to ${outPath}`);
}

await main();
