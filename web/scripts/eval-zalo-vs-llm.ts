import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeLocalDraft } from "../src/lib/engine/analyzer";
import { callGeminiStructuredInteraction } from "../src/lib/engine/gemini-client";
import { IncrementalLlmCache } from "../src/lib/engine/llm-incremental";
import type { LocalWorkspaceFile } from "../src/lib/engine/local-workspace";
import { buildWorkspaceRelationGraph } from "../src/lib/engine/workspace-relations";

const MAX_TOKEN_BUDGET = 150_000;

type PureLlmIssue = {
    article: string;
    clause: string;
    category: string;
    description: string;
};

function loadZaloSubset(): LocalWorkspaceFile[] {
    const baseDir = resolve(import.meta.dir, "../../data/zalo-legal-subset");
    const manifest = JSON.parse(readFileSync(resolve(baseDir, "manifest.json"), "utf8")) as Array<{
        law_id: string;
        file: string;
        header: string;
        articles: number;
        chars: number;
    }>;

    return manifest.map((m) => ({
        path: `library/${m.file}`,
        name: m.file,
        title: m.header,
        documentNumber: m.law_id.toUpperCase(),
        documentType: m.header.startsWith("THÔNG TƯ") ? "Thông tư" : m.header.startsWith("NGHỊ ĐỊNH") ? "Nghị định" : "Luật",
        content: readFileSync(resolve(baseDir, m.file), "utf8"),
        isLibrary: true,
        updatedAt: "2026-11-26T00:00:00.000Z",
    }));
}

function buildAdversarialZalo452020(baseContent: string): string {
    return `${baseContent}

Điều 901. Xử phạt hành vi vi phạm định lượng và thẩm quyền
1. Phạt tiền từ 15.000.000 đồng đến 10.000.000 đồng đối với hành vi kê khai sai hồ sơ.
2. Thuốc thử nghiệm có tỷ lệ sai lệch từ 20% đến 50% thì bị xử phạt cảnh cáo.
3. Thuốc thử nghiệm có tỷ lệ sai lệch từ 50% đến 80% thì bị phạt tiền từ 5.000.000 đồng đến 8.000.000 đồng.
4. Vật tư tiêu hao từ 10 kilôgam đến 20 kilôgam thì bị thu hồi.
5. Vật tư tiêu hao từ trên 22 kilôgam đến 50 kilôgam thì bị phạt tiền từ 10.000.000 đồng đến 20.000.000 đồng.
6. Hành vi vi phạm nghiêm trọng hơn khoản 1 Điều này nhưng mức phạt tiền từ 2.000.000 đồng đến 5.000.000 đồng.

Điều 902. Dẫn chiếu và ngoại lệ mở
1. Áp dụng xử phạt theo quy định tại khoản 99 Điều 14 Nghị định này.
2. Việc xử lý thực hiện theo quy định tại Điều 902 của Nghị định này.
3. Bãi bỏ Điều 903.
4. Tiếp tục thực hiện dẫn chiếu theo Điều 903 Nghị định này.
5. Áp dụng mức phạt theo Điều 1 (Nghị định số 90/2020/NĐ-CP về đánh giá xếp loại cán bộ, công chức).
6. Nếu không thuộc trường hợp quy định tại Điều 2 của Nghị định này, thì xử lý trừ trường hợp đặc biệt.

Điều 903. Điều khoản bị bãi bỏ
1. Quy định tạm thời về kiểm tra.
`;
}

const PLANTED_ZALO_BUGS = [
    { id: "Z01", code: "LG001", kw: ["901", "15.000.000", "10.000.000", "đảo ngược"] },
    { id: "Z02", code: "LG002", kw: ["901", "50%", "chồng chéo"] },
    { id: "Z03", code: "LP003", kw: ["901", "20", "22", "kilôgam", "khoảng trống"] },
    { id: "Z04", code: "LG003", kw: ["902", "khoản 99", "điều 14"] },
    { id: "Z05", code: "LG004", kw: ["902", "chính nó", "vòng lặp"] },
    { id: "Z06", code: "LG007", kw: ["902", "903", "bãi bỏ"] },
    { id: "Z07", code: "LG008", kw: ["902", "điều 1", "cán bộ"] },
    { id: "Z08", code: "LG016", kw: ["901", "nghiêm trọng hơn", "khoản 6", "khoản 1"] },
    { id: "Z09", code: "LG015", kw: ["902", "điều 2", "không thuộc"] },
    { id: "Z10", code: "LP001", kw: ["902", "trường hợp đặc biệt", "ngoại lệ"] },
] as const;

async function callPureLlm(apiKey: string, input: string, maxOutputTokens = 4096): Promise<{
    model: string | null;
    issues: PureLlmIssue[];
    usage: { inputTokens: number; outputTokens: number; totalTokens: number };
    durationMs: number;
    error: string | null;
}> {
    const schema: Record<string, unknown> = {
        type: "object",
        additionalProperties: false,
        required: ["issues"],
        properties: {
            issues: {
                type: "array",
                items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["article", "clause", "category", "description"],
                    properties: {
                        article: { type: "string" },
                        clause: { type: "string" },
                        category: { type: "string" },
                        description: { type: "string" },
                    },
                },
            },
        },
    };
    const prompt = "Bạn là chuyên gia kỹ thuật lập pháp Việt Nam. Rà soát văn bản quy phạm pháp luật dưới đây và liệt kê TẤT CẢ các lỗi thực sự nghiêm trọng về: (1) khung phạt đảo ngược/không tăng tiến, (2) chồng chéo/khoảng trống định lượng, (3) dẫn chiếu gãy/vòng lặp/bãi bỏ/sai tên/sai ngữ nghĩa, (4) ngoại lệ mở. Chỉ báo lỗi có căn cứ.";
    const models = ["gemini-3.7-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-2.5-flash"];

    for (const model of models) {
        const start = Date.now();

        try {
            const res = await callGeminiStructuredInteraction({
                apiKey,
                model,
                systemInstruction: prompt,
                input,
                schema,
                maxOutputTokens,
            });
            const issues = ((res.data as { issues?: PureLlmIssue[] }).issues ?? []);

            return { model, issues, usage: res.usage, durationMs: Date.now() - start, error: null };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);

            if (!msg.includes("(503)") && !msg.includes("(429)") && !msg.includes("timed out")) {
                return { model, issues: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, durationMs: Date.now() - start, error: msg };
            }
        }
    }

    return { model: null, issues: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, durationMs: 0, error: "All Free Tier models returned 503/429" };
}

async function main(): Promise<void> {
    const apiKey = process.env.GEMINI_API_KEY?.trim() ?? "";

    if (!apiKey) {
        console.error("Missing GEMINI_API_KEY env var.");
        process.exit(1);
    }

    let totalTokensUsed = 0;
    const zaloFiles = loadZaloSubset();
    const blhs2015Content = readFileSync(resolve(import.meta.dir, "../../data/blhs-real/library/100-2015-qh13-blhs-2015.txt"), "utf8");

    // Suite 1: BLHS 2015 (8 real defects) with Pipeline v3
    console.log("[1/4] Suite 1: BLHS 2015 Pipeline v3 (Tier 0 + Tier 1.5 Decision API)...");
    const blhsCache = new IncrementalLlmCache();
    const s1Start = Date.now();
    const blhsRes = await analyzeLocalDraft(blhs2015Content, [], {
        includeAi: true,
        useDecisionApi: true,
        apiKey,
        incrementalCache: blhsCache,
    });
    const s1Ms = Date.now() - s1Start;
    totalTokensUsed += blhsRes.lean.tokenStats.actualAiTokens;

    // Suite 2: Clean untouched Zalo 90/2020/NĐ-CP (Pipeline v3 vs Pure LLM)
    console.log("[2/4] Suite 2: Clean Zalo 90/2020/NĐ-CP (Pipeline v3 vs Pure LLM)...");
    const cleanDecree = zaloFiles.find((f) => f.name.includes("90-2020")) ?? zaloFiles[0];
    const s2PipeStart = Date.now();
    const s2Pipe = await analyzeLocalDraft(cleanDecree.content, zaloFiles, {
        currentPath: cleanDecree.path,
        includeAi: false,
    });
    const s2PipeMs = Date.now() - s2PipeStart;
    const s2Pure = await callPureLlm(apiKey, cleanDecree.content, 4096);
    totalTokensUsed += s2Pure.usage.totalTokens;

    // Suite 3: Adversarial Zalo 45/2020/NĐ-CP (10 planted bugs, Cold + Warm 1-edit vs Pure LLM)
    console.log("[3/4] Suite 3: Adversarial Zalo 45/2020/NĐ-CP (10 planted bugs)...");
    const base452020 = zaloFiles.find((f) => f.name.includes("45-2020")) ?? zaloFiles[0];
    const advContent = buildAdversarialZalo452020(base452020.content);
    const advCache = new IncrementalLlmCache();
    const s3ColdStart = Date.now();
    const s3Cold = await analyzeLocalDraft(advContent, zaloFiles, {
        currentPath: base452020.path,
        includeAi: true,
        useDecisionApi: true,
        apiKey,
        incrementalCache: advCache,
    });
    const s3ColdMs = Date.now() - s3ColdStart;
    totalTokensUsed += s3Cold.lean.tokenStats.actualAiTokens;

    const s3WarmStart = Date.now();
    const s3Warm = await analyzeLocalDraft(advContent, zaloFiles, {
        currentPath: base452020.path,
        includeAi: true,
        useDecisionApi: true,
        apiKey,
        incrementalCache: advCache,
    });
    const s3WarmMs = Date.now() - s3WarmStart;
    totalTokensUsed += s3Warm.lean.tokenStats.actualAiTokens;

    const s3Pure = await callPureLlm(apiKey, advContent, 4096);
    totalTokensUsed += s3Pure.usage.totalTokens;

    const pipeMatched = PLANTED_ZALO_BUGS.filter((b) => s3Cold.diagnostics.some((d) => d.code === b.code && (d.provisionRef?.includes("901") || d.provisionRef?.includes("902")))).map((b) => b.id);
    const pureMatched = PLANTED_ZALO_BUGS.filter((b) => s3Pure.issues.some((it) => {
        const blob = `${it.article} ${it.clause} ${it.description}`.toLowerCase();

        return b.kw.some((k) => blob.includes(k));
    })).map((b) => b.id);

    // Suite 4: Multi-doc throughput across all 6 Zalo laws
    console.log("[4/4] Suite 4: 6-document Zalo workspace throughput (0 tokens)...");
    const s4Start = Date.now();
    let totalZaloErrors = 0;

    for (const f of zaloFiles) {
        const r = await analyzeLocalDraft(f.content, zaloFiles, { currentPath: f.path, includeAi: false });
        totalZaloErrors += r.diagnostics.filter((d) => d.severity === "error").length;
    }

    const graph = buildWorkspaceRelationGraph(zaloFiles);
    const s4Ms = Date.now() - s4Start;

    if (totalTokensUsed > MAX_TOKEN_BUDGET) {
        throw new Error(`Token budget exceeded: ${totalTokensUsed}`);
    }

    const report = {
        ranAt: new Date().toISOString(),
        totalTokensUsed,
        budgetCap: 500_000,
        suite1Blhs2015: {
            durationMs: s1Ms,
            actualAiTokens: blhsRes.lean.tokenStats.actualAiTokens,
            lg016Detected: blhsRes.diagnostics.filter((d) => d.code === "LG016").map((d) => d.provisionRef),
            lg015Detected: blhsRes.diagnostics.filter((d) => d.code === "LG015").map((d) => `${d.provisionRef}: ${d.title}`),
            lg008Detected: blhsRes.diagnostics.filter((d) => d.code === "LG008").map((d) => d.provisionRef),
        },
        suite2CleanZalo902020: {
            chars: cleanDecree.content.length,
            pipelineV3: {
                durationMs: s2PipeMs,
                tokens: 0,
                errors: s2Pipe.diagnostics.filter((d) => d.severity === "error").length,
                warnings: s2Pipe.diagnostics.filter((d) => d.severity === "warning").length,
            },
            pureLlm: s2Pure,
        },
        suite3AdversarialZalo452020: {
            chars: advContent.length,
            pipelineV3Cold: {
                durationMs: s3ColdMs,
                tokens: s3Cold.lean.tokenStats.actualAiTokens,
                matchedCount: pipeMatched.length,
                matchedIds: pipeMatched,
            },
            pipelineV3Warm: {
                durationMs: s3WarmMs,
                tokens: s3Warm.lean.tokenStats.actualAiTokens,
            },
            pureLlm: {
                model: s3Pure.model,
                durationMs: s3Pure.durationMs,
                usage: s3Pure.usage,
                matchedCount: pureMatched.length,
                matchedIds: pureMatched,
                issuesCount: s3Pure.issues.length,
                error: s3Pure.error,
                issuesSample: s3Pure.issues.slice(0, 12),
            },
        },
        suite4Workspace6Docs: {
            files: zaloFiles.length,
            totalChars: zaloFiles.reduce((acc, f) => acc + f.content.length, 0),
            durationMs: s4Ms,
            tokens: 0,
            totalErrorsAcross6CleanLaws: totalZaloErrors,
            relationEdges: graph.summary.totalEdges,
        },
    };

    const outDir = resolve(import.meta.dir, "../../data/eval/reports");
    mkdirSync(outDir, { recursive: true });
    const outPath = resolve(outDir, "zalo-pipeline-v3-vs-llm.json");
    writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
    console.log("DONE! Saved:", outPath);
    console.log("Suite 1 BLHS LG015:", report.suite1Blhs2015.lg015Detected, "LG016:", report.suite1Blhs2015.lg016Detected);
    console.log("Suite 2 Clean 90/2020 -> Pipe errors:", report.suite2CleanZalo902020.pipelineV3.errors, "| Pure LLM issues:", report.suite2CleanZalo902020.pureLlm.issues.length, "model:", report.suite2CleanZalo902020.pureLlm.model);
    console.log("Suite 3 Adv 45/2020 -> Pipe:", `${pipeMatched.length}/10 (${s3ColdMs}ms, ${s3Cold.lean.tokenStats.actualAiTokens} tok)`, "| Pure LLM:", `${pureMatched.length}/10 (${s3Pure.durationMs}ms, ${s3Pure.usage.totalTokens} tok, model=${s3Pure.model})`);
    console.log("Suite 4 6-doc throughput:", `${s4Ms}ms, 0 tokens, errors=${totalZaloErrors}`);
}

void main();
