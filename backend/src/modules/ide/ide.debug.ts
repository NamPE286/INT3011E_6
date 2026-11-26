import type { D1Database } from "@cloudflare/workers-types";
import { isRecord, requestStructuredJson } from "../llm/openai-json";
import { analyzeDraftContent } from "./ide.analyzer";
import { extractFineRanges, extractNumericThresholds, type ExtractedFineRange, type ExtractedThreshold } from "./ide.intervals";
import { parseDraftDocument, type ParsedDraft, type ParsedNode } from "./ide.parser";
import type {
    AmbiguityDecisionItem,
    DebugSimulationResult,
    DebugTraceStep,
    ExploitedDefect,
    JudgeVerdict,
    LegalDiagnostic,
    VerdictOutcome,
} from "./ide.types";

export type DebugSimulationInput = {
    content: string;
    scenario: string;
    db?: D1Database;
    ambiguityOverrides?: Record<string, boolean>;
    useAi?: boolean;
    apiKey?: string;
    model?: string;
    fetcher?: typeof fetch;
};

type ExtractedMeasurement = {
    value: number;
    unit: string;
    raw: string;
};

type ScenarioFacts = {
    measurements: ExtractedMeasurement[];
    subject: "INDIVIDUAL" | "ORGANIZATION";
    claimsException: boolean;
    claimedExceptionText: string | null;
    keywords: string[];
};

const MEASUREMENT_PATTERN = /(\d+(?:[.,]\d+)?)\s*(km\/h|mg\/100\s*ml|mg\/lít|tấn|kg|%)/giu;
const ORG_HINT = /\b(?:công ty|doanh nghiệp|tổ chức|hợp tác xã|tập đoàn)\b/iu;
const EXCEPTION_HINT = /(trường hợp đặc biệt|lý do chính đáng|trường hợp cần thiết|bất khả kháng)/iu;

const STOPWORDS = new Set([
    "người", "điều", "khiển", "phương", "tiện", "tham", "giao", "thông", "trên", "đường",
    "hành", "vi", "phạm", "thực", "hiện", "trong", "trường", "hợp", "bị", "về", "của",
    "và", "hoặc", "với", "tại", "theo", "cho", "khi", "đang", "này", "đó", "một", "các",
    "anh", "chị", "ông", "bà", "lái", "chạy", "xe", "quá",
]);

const JUDGE_AI_SYSTEM_PROMPT = `Bạn là Thẩm phán Tòa án đang xét xử một tình huống thực tế dựa TUYỆT ĐỐI trên dự thảo văn bản hiện tại, các giả định mơ hồ đã chọn và kết quả kiểm chứng Lean 4.
KHÔNG được viện dẫn bất kỳ văn bản pháp luật nào ngoài workspace.
Trả về JSON gồm:
- summary: 1-2 câu kết luận ngắn gọn của Thẩm phán.
- judicialReasoning: mảng 2-3 lập luận ngắn gọn theo hồ sơ trace đã cung cấp.`;

const JUDGE_AI_SCHEMA: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    required: ["summary", "judicialReasoning"],
    properties: {
        summary: { type: "string" },
        judicialReasoning: { type: "array", items: { type: "string" } },
    },
};

export async function runLegalDebugSimulation(input: DebugSimulationInput): Promise<DebugSimulationResult> {
    const startedAt = Date.now();
    const draft = parseDraftDocument(input.content);
    const fineRanges = extractFineRanges(draft);
    const thresholds = extractNumericThresholds(draft, fineRanges);
    const analysis = await analyzeDraftContent(input.content, { db: input.db, includeAi: false });
    const overrides = input.ambiguityOverrides ?? {};

    const facts = extractScenarioFacts(input.scenario);
    const trace: DebugTraceStep[] = [];
    const ambiguities: AmbiguityDecisionItem[] = [];
    const exploitedDefects: ExploitedDefect[] = [];
    const matchedFine: { min: number; max: number }[] = [];
    const additionalSanctions: string[] = [];

    evaluateNumericMeasurements(
        facts,
        thresholds,
        fineRanges,
        analysis.diagnostics,
        overrides,
        trace,
        ambiguities,
        exploitedDefects,
        matchedFine,
    );
    evaluateMatchedClauses(
        draft,
        facts,
        fineRanges,
        analysis.diagnostics,
        overrides,
        trace,
        ambiguities,
        exploitedDefects,
        matchedFine,
        additionalSanctions,
    );

    let verdict = synthesizeVerdict(facts, trace, ambiguities, exploitedDefects, matchedFine, additionalSanctions);
    let method: "LEAN_SYMBOLIC" | "LEAN_PLUS_AI" = "LEAN_SYMBOLIC";

    if (input.useAi && input.apiKey && input.apiKey.trim().length > 0) {
        const refined = await refineVerdictWithAi(input.scenario, trace, verdict, {
            apiKey: input.apiKey,
            model: input.model ?? "gpt-5.4",
            fetcher: input.fetcher,
        });

        if (refined) {
            verdict = {
                ...verdict,
                summary: refined.summary,
                judicialReasoning: refined.judicialReasoning,
            };
            method = "LEAN_PLUS_AI";
        }
    }

    return {
        scenario: input.scenario,
        extractedFacts: buildExtractedFactList(facts),
        trace,
        ambiguities,
        verdict,
        workspaceOnly: true,
        method,
        durationMs: Math.max(1, Date.now() - startedAt),
    };
}

function extractScenarioFacts(scenario: string): ScenarioFacts {
    const measurements: ExtractedMeasurement[] = [];

    for (const match of scenario.matchAll(MEASUREMENT_PATTERN)) {
        const value = Number(match[1].replace(",", "."));
        const unit = match[2].toLowerCase().replace(/\s+/g, "");

        if (Number.isFinite(value)) {
            measurements.push({ value, unit, raw: match[0] });
        }
    }

    const subject = ORG_HINT.test(scenario) ? "ORGANIZATION" : "INDIVIDUAL";
    const exceptionMatch = EXCEPTION_HINT.exec(scenario);
    const keywords = scenario
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((word) => word.length >= 3 && !STOPWORDS.has(word));

    return {
        measurements,
        subject,
        claimsException: Boolean(exceptionMatch),
        claimedExceptionText: exceptionMatch?.[1] ?? null,
        keywords: [...new Set(keywords)],
    };
}

function evaluateNumericMeasurements(
    facts: ScenarioFacts,
    thresholds: readonly ExtractedThreshold[],
    fineRanges: readonly ExtractedFineRange[],
    diagnostics: readonly LegalDiagnostic[],
    overrides: Record<string, boolean>,
    trace: DebugTraceStep[],
    ambiguities: AmbiguityDecisionItem[],
    exploitedDefects: ExploitedDefect[],
    matchedFine: { min: number; max: number }[],
): void {
    for (const measurement of facts.measurements) {
        const sameUnit = thresholds.filter((item) => item.unit === measurement.unit);

        if (sameUnit.length === 0) {
            continue;
        }

        const hits = sameUnit.filter((item) => matchesThreshold(measurement.value, item));

        if (hits.length === 0) {
            const minBound = Math.min(...sameUnit.map((item) => item.min ?? Infinity));
            const maxBound = Math.max(...sameUnit.map((item) => item.max ?? -Infinity));

            if (measurement.value > minBound && measurement.value < maxBound) {
                const gapDiag = diagnostics.find((diag) => diag.code === "LP003");
                const targetLine = gapDiag?.range.startLine ?? sameUnit[0].line;
                const refLabel = gapDiag?.provisionRef ?? sameUnit[0].provisionRef ?? `Dòng ${targetLine}`;
                const intervalsDesc = sameUnit.map((item) => `[${item.min ?? "?"}, ${item.max ?? "∞"}]`).join(" ∧ ");

                trace.push({
                    stepNumber: trace.length + 1,
                    line: targetLine,
                    provisionRef: refLabel,
                    status: "LOOPHOLE_HIT",
                    condition: `Kiểm tra ngưỡng ${measurement.raw}`,
                    evaluation: `Giá trị ${measurement.raw} rơi vào khoảng trống giữa các khung phạt — không khớp bất kỳ điều khoản nào.`,
                    leanCheck: `${measurement.value} ∉ ${intervalsDesc} → UNCOVERED`,
                    diagnosticCode: "LP003",
                });

                pushDefect(exploitedDefects, {
                    code: "LP003",
                    category: "LOOPHOLE",
                    title: gapDiag?.title ?? `Khoảng trống định lượng tại mức ${measurement.raw}`,
                    impactInCourt: `Luật sư bào chữa chứng minh được ${measurement.raw} không thuộc khung phạt nào; Tòa buộc tuyên không đủ căn cứ xử phạt.`,
                });
            }

            continue;
        }

        if (hits.length >= 2) {
            const first = hits[0];
            const second = hits[1];

            trace.push({
                stepNumber: trace.length + 1,
                line: second.line,
                provisionRef: second.provisionRef ?? `Dòng ${second.line}`,
                status: "CONFLICT_HIT",
                condition: `Kiểm tra ngưỡng ${measurement.raw}`,
                evaluation: `Giá trị ${measurement.raw} khớp đồng thời cả "${first.excerpt}" và "${second.excerpt}".`,
                leanCheck: `${measurement.value} ∈ [${first.min}, ${first.max ?? "∞"}] ∧ ${measurement.value} ∈ [${second.min}, ${second.max ?? "∞"}] → AMBIGUOUS`,
                diagnosticCode: "LG002",
            });

            pushDefect(exploitedDefects, {
                code: "LG002",
                category: "LOGIC",
                title: `Chồng chéo ngưỡng định lượng tại mốc ${measurement.raw}`,
                impactInCourt: "Hai điều khoản có mức phạt khác nhau cùng áp dụng cho một hành vi, vi phạm nguyên tắc áp dụng có lợi cho người vi phạm.",
            });

            continue;
        }

        const hit = hits[0];
        const lineFine = findFineAtLine(fineRanges, hit);

        if (lineFine && lineFine.min > lineFine.max) {
            trace.push({
                stepNumber: trace.length + 1,
                line: hit.line,
                provisionRef: hit.provisionRef ?? `Dòng ${hit.line}`,
                status: "CONFLICT_HIT",
                condition: `Khớp ngưỡng ${hit.excerpt}, kiểm tra khung phạt`,
                evaluation: `Khung tiền phạt bị đảo ngược (${lineFine.minRaw}đ > ${lineFine.maxRaw}đ), tạo khoảng rỗng về mặt toán học.`,
                leanCheck: `${lineFine.min} ≤ ${lineFine.max} → FALSE`,
                diagnosticCode: "LG001",
            });

            pushDefect(exploitedDefects, {
                code: "LG001",
                category: "LOGIC",
                title: "Khung tiền phạt bị đảo ngược (min > max)",
                impactInCourt: "Quyết định xử phạt bị Tòa tuyên hủy do mức phạt tối thiểu lớn hơn mức tối đa.",
            });

            continue;
        }

        if (facts.subject === "ORGANIZATION" && lineFine?.subject === "INDIVIDUAL") {
            trace.push({
                stepNumber: trace.length + 1,
                line: hit.line,
                provisionRef: hit.provisionRef ?? `Dòng ${hit.line}`,
                status: "LOOPHOLE_HIT",
                condition: `Khớp ${hit.excerpt}, kiểm tra chủ thể vi phạm (Tổ chức)`,
                evaluation: "Điều khoản chỉ quy định mức phạt cho 'cá nhân', không quy định đối với tổ chức/doanh nghiệp.",
                leanCheck: "Subject = ORGANIZATION ∧ ClauseSubject = INDIVIDUAL → NOT_APPLICABLE",
                diagnosticCode: "LP006",
            });

            pushDefect(exploitedDefects, {
                code: "LP006",
                category: "LOOPHOLE",
                title: "Bỏ sót chủ thể tổ chức",
                impactInCourt: "Doanh nghiệp viện dẫn điều khoản chỉ áp dụng cho cá nhân để bác bỏ quyết định xử phạt.",
            });

            continue;
        }

        const lineAmbiguities = diagnostics.filter(
            (diag) => diag.range.startLine === hit.line && (diag.code === "AM001" || diag.code === "AM002" || diag.code === "AM003"),
        );

        let blockedByAmbiguity = false;

        for (const ambDiag of lineAmbiguities) {
            const decision = buildAmbiguityDecision(ambDiag, overrides);
            pushAmbiguity(ambiguities, decision);

            if (decision.selectedValue === null) {
                blockedByAmbiguity = true;
                trace.push({
                    stepNumber: trace.length + 1,
                    line: hit.line,
                    provisionRef: hit.provisionRef ?? `Dòng ${hit.line}`,
                    status: "AMBIGUOUS_BRANCH",
                    condition: decision.question,
                    evaluation: `Điều khoản chứa yếu tố mơ hồ "${ambDiag.excerpt}". Hãy chọn giả định để kiểm thử logic phân nhánh.`,
                    leanCheck: `Ambiguity("${ambDiag.excerpt}") = ?`,
                    diagnosticCode: ambDiag.code,
                });
            } else if (decision.selectedValue === false) {
                blockedByAmbiguity = true;
                trace.push({
                    stepNumber: trace.length + 1,
                    line: hit.line,
                    provisionRef: hit.provisionRef ?? `Dòng ${hit.line}`,
                    status: "SKIPPED",
                    condition: decision.question,
                    evaluation: `Giả định: KHÔNG thỏa mãn "${ambDiag.excerpt}" → không áp dụng khung phạt này.`,
                    leanCheck: `Assume("${ambDiag.excerpt}" = false) → SKIP`,
                    diagnosticCode: ambDiag.code,
                });
            } else {
                trace.push({
                    stepNumber: trace.length + 1,
                    line: hit.line,
                    provisionRef: hit.provisionRef ?? `Dòng ${hit.line}`,
                    status: "MATCHED",
                    condition: decision.question,
                    evaluation: `Giả định: CÓ thỏa mãn "${ambDiag.excerpt}" → tiếp tục áp dụng khung phạt.`,
                    leanCheck: `Assume("${ambDiag.excerpt}" = true) → APPLY`,
                    diagnosticCode: ambDiag.code,
                });
            }
        }

        if (blockedByAmbiguity) {
            continue;
        }

        if (hit.fineMin !== null && hit.fineMax !== null) {
            matchedFine.push({ min: hit.fineMin, max: hit.fineMax });
        }

        trace.push({
            stepNumber: trace.length + 1,
            line: hit.line,
            provisionRef: hit.provisionRef ?? `Dòng ${hit.line}`,
            status: "MATCHED",
            condition: `Khớp ngưỡng ${hit.excerpt}`,
            evaluation: `Áp dụng được khung phạt${hit.fineMin !== null && hit.fineMax !== null ? ` từ ${hit.fineMin.toLocaleString("vi-VN")}đ đến ${hit.fineMax.toLocaleString("vi-VN")}đ` : ""}.`,
            leanCheck: `${measurement.value} ∈ [${hit.min}, ${hit.max ?? "∞"}] → MATCHED`,
            diagnosticCode: null,
        });
    }
}

function evaluateMatchedClauses(
    draft: ParsedDraft,
    facts: ScenarioFacts,
    fineRanges: readonly ExtractedFineRange[],
    diagnostics: readonly LegalDiagnostic[],
    overrides: Record<string, boolean>,
    trace: DebugTraceStep[],
    ambiguities: AmbiguityDecisionItem[],
    exploitedDefects: ExploitedDefect[],
    matchedFine: { min: number; max: number }[],
    additionalSanctions: string[],
): void {
    if (facts.keywords.length === 0) {
        return;
    }

    const scoredNodes: { node: ParsedNode; score: number }[] = [];

    for (const node of draft.nodes) {
        if (node.level !== "CLAUSE" && node.level !== "POINT") {
            continue;
        }

        if (trace.some((step) => step.line >= node.startLine && step.line <= node.endLine)) {
            continue;
        }

        const lower = node.text.toLowerCase();
        const hits = facts.keywords.filter((kw) => lower.includes(kw)).length;

        if (hits >= 2) {
            scoredNodes.push({ node, score: hits });
        }
    }

    scoredNodes.sort((left, right) => right.score - left.score);

    for (const { node } of scoredNodes.slice(0, 4)) {
        const nodeDiags = diagnostics.filter(
            (diag) => diag.range.startLine >= node.startLine && diag.range.endLine <= node.endLine,
        );

        const lp002 = nodeDiags.find((diag) => diag.code === "LP002");

        if (lp002) {
            trace.push({
                stepNumber: trace.length + 1,
                line: node.startLine,
                provisionRef: node.refLabel,
                status: "LOOPHOLE_HIT",
                condition: `Khớp hành vi tại ${node.refLabel}`,
                evaluation: "Điều khoản nêu lệnh cấm nhưng không có mức phạt tiền hay chế tài kèm theo.",
                leanCheck: `HasSanction "${node.refLabel}" = false → UNSANCTIONED`,
                diagnosticCode: "LP002",
            });

            pushDefect(exploitedDefects, {
                code: "LP002",
                category: "LOOPHOLE",
                title: lp002.title,
                impactInCourt: "Tòa tuyên không thể xử phạt vì hành vi bị cấm không có điều khoản chế tài tương ứng.",
            });

            continue;
        }

        const lp001 = nodeDiags.find((diag) => diag.code === "LP001");

        if (lp001 && facts.claimsException) {
            const decision = buildAmbiguityDecision(lp001, overrides);
            pushAmbiguity(ambiguities, decision);

            if (decision.selectedValue === false) {
                trace.push({
                    stepNumber: trace.length + 1,
                    line: node.startLine,
                    provisionRef: node.refLabel,
                    status: "MATCHED",
                    condition: decision.question,
                    evaluation: `Giả định: Tòa BÁC BỎ viện dẫn "${lp001.excerpt}" → vẫn xem xét xử phạt.`,
                    leanCheck: `Assume(AcceptException = false) → PROSECUTE`,
                    diagnosticCode: lp001.code,
                });
            } else {
                trace.push({
                    stepNumber: trace.length + 1,
                    line: node.startLine,
                    provisionRef: node.refLabel,
                    status: "LOOPHOLE_HIT",
                    condition: decision.question,
                    evaluation: `Điều khoản có ngoại lệ mở "${lp001.excerpt}" không kèm tiêu chí định lượng hoặc dẫn chiếu.`,
                    leanCheck: `ExceptionHasCriteria "${lp001.excerpt}" = false → EXEMPT_LOOPHOLE`,
                    diagnosticCode: "LP001",
                });

                pushDefect(exploitedDefects, {
                    code: "LP001",
                    category: "LOOPHOLE",
                    title: lp001.title,
                    impactInCourt: `Bị đơn viện dẫn "${facts.claimedExceptionText}" để được miễn trách nhiệm do luật không quy định điều kiện bác bỏ.`,
                });

                continue;
            }
        }

        const ambInClause = nodeDiags.find(
            (diag) => diag.code === "AM001" || diag.code === "AM002" || diag.code === "AM003",
        );

        if (ambInClause) {
            const decision = buildAmbiguityDecision(ambInClause, overrides);
            pushAmbiguity(ambiguities, decision);

            if (decision.selectedValue === null) {
                trace.push({
                    stepNumber: trace.length + 1,
                    line: node.startLine,
                    provisionRef: node.refLabel,
                    status: "AMBIGUOUS_BRANCH",
                    condition: decision.question,
                    evaluation: `Điều khoản chứa yếu tố mơ hồ "${ambInClause.excerpt}". Chọn cách diễn giải để kiểm thử.`,
                    leanCheck: `Ambiguity("${ambInClause.excerpt}") = ?`,
                    diagnosticCode: ambInClause.code,
                });

                continue;
            }

            if (decision.selectedValue === false) {
                trace.push({
                    stepNumber: trace.length + 1,
                    line: node.startLine,
                    provisionRef: node.refLabel,
                    status: "SKIPPED",
                    condition: decision.question,
                    evaluation: `Giả định: KHÔNG thỏa mãn "${ambInClause.excerpt}" → bỏ qua điều khoản này.`,
                    leanCheck: `Assume("${ambInClause.excerpt}" = false) → SKIP`,
                    diagnosticCode: ambInClause.code,
                });

                continue;
            }
        }

        const nodeFine = fineRanges.find(
            (fine) => fine.startOffset >= node.startOffset && fine.startOffset <= node.endOffset,
        );

        if (nodeFine && nodeFine.min <= nodeFine.max) {
            matchedFine.push({ min: nodeFine.min, max: nodeFine.max });
            trace.push({
                stepNumber: trace.length + 1,
                line: node.startLine,
                provisionRef: node.refLabel,
                status: "MATCHED",
                condition: `Khớp hành vi tại ${node.refLabel}`,
                evaluation: `Áp dụng khung phạt từ ${nodeFine.minRaw}đ đến ${nodeFine.maxRaw}đ.`,
                leanCheck: `${nodeFine.min} ≤ ${nodeFine.max} → MATCHED`,
                diagnosticCode: null,
            });
        }

        const termIssue = nodeDiags.find((diag) => diag.code === "AM005")
            ?? findLinkedAdditionalSanctionIssue(draft, node, diagnostics);

        if (termIssue) {
            const decision = buildAmbiguityDecision(termIssue, overrides);
            pushAmbiguity(ambiguities, decision);

            if (decision.selectedValue === true) {
                additionalSanctions.push(`${termIssue.excerpt} (theo giả định Tòa chấp nhận)`);
                trace.push({
                    stepNumber: trace.length + 1,
                    line: termIssue.range.startLine,
                    provisionRef: termIssue.provisionRef ?? node.refLabel,
                    status: "MATCHED",
                    condition: decision.question,
                    evaluation: `Giả định: Tòa CHẤP NHẬN áp dụng "${termIssue.excerpt}" dù chưa có văn bản định nghĩa trong workspace.`,
                    leanCheck: `Assume(AcceptTerm "${termIssue.excerpt}" = true) → APPLIED`,
                    diagnosticCode: termIssue.code,
                });
            } else {
                trace.push({
                    stepNumber: trace.length + 1,
                    line: termIssue.range.startLine,
                    provisionRef: termIssue.provisionRef ?? node.refLabel,
                    status: "UNENFORCEABLE_TERM",
                    condition: decision.question,
                    evaluation: termIssue.message,
                    leanCheck: `DefinedInWorkspace "${termIssue.excerpt}" = false → UNENFORCEABLE`,
                    diagnosticCode: termIssue.code,
                });

                pushDefect(exploitedDefects, {
                    code: termIssue.code,
                    category: termIssue.category,
                    title: termIssue.title,
                    impactInCourt: `Phần chế tài liên quan đến "${termIssue.excerpt}" bị đình chỉ áp dụng do thiếu văn bản định nghĩa trong workspace.`,
                });
            }
        }

        const lp004 = nodeDiags.find((diag) => diag.code === "LP004")
            ?? diagnostics.find((diag) => diag.code === "LP004" && diag.provisionRef?.includes(`Điều ${node.articleNo ?? ""}`));

        if (lp004) {
            additionalSanctions.push(`${lp004.excerpt} (thiếu định mức — không thi hành được)`);
            pushDefect(exploitedDefects, {
                code: "LP004",
                category: "LOOPHOLE",
                title: lp004.title,
                impactInCourt: "Hình phạt bổ sung thiếu thời hạn/số điểm cụ thể nên không đủ căn cứ thi hành.",
            });
        }
    }
}

function buildAmbiguityDecision(diag: LegalDiagnostic, overrides: Record<string, boolean>): AmbiguityDecisionItem {
    const selectedValue = Object.prototype.hasOwnProperty.call(overrides, diag.id) ? overrides[diag.id] : null;
    const ref = diag.provisionRef ?? `Dòng ${diag.range.startLine}`;

    if (diag.code === "AM001") {
        return {
            id: diag.id,
            code: diag.code,
            term: diag.excerpt,
            provisionRef: ref,
            line: diag.range.startLine,
            question: `Thực tế tình huống có thỏa mãn mức "${diag.excerpt}" hay không?`,
            trueLabel: `Có — Đạt "${diag.excerpt}" (Áp dụng)`,
            falseLabel: `Không — Chưa đạt "${diag.excerpt}" (Bỏ qua)`,
            selectedValue,
        };
    }

    if (diag.code === "AM003") {
        return {
            id: diag.id,
            code: diag.code,
            term: diag.excerpt,
            provisionRef: ref,
            line: diag.range.startLine,
            question: `Người có thẩm quyền có chọn áp dụng "${diag.excerpt}" hay không?`,
            trueLabel: "Có — Quyết định xử phạt",
            falseLabel: "Không — Không áp dụng",
            selectedValue,
        };
    }

    if (diag.code === "AM005") {
        return {
            id: diag.id,
            code: diag.code,
            term: diag.excerpt,
            provisionRef: ref,
            line: diag.range.startLine,
            question: `Tòa có chấp nhận thi hành "${diag.excerpt}" khi chưa có văn bản định nghĩa?`,
            trueLabel: "Có — Chấp nhận thi hành",
            falseLabel: "Không — Bác bỏ (Thiếu định nghĩa)",
            selectedValue,
        };
    }

    if (diag.code === "LP001") {
        return {
            id: diag.id,
            code: diag.code,
            term: diag.excerpt,
            provisionRef: ref,
            line: diag.range.startLine,
            question: `Tòa có chấp nhận viện dẫn "${diag.excerpt}" của bị đơn không?`,
            trueLabel: "Có — Chấp nhận miễn trừ (Trắng án)",
            falseLabel: "Không — Bác bỏ ngoại lệ (Vẫn phạt)",
            selectedValue,
        };
    }

    return {
        id: diag.id,
        code: diag.code,
        term: diag.excerpt,
        provisionRef: ref,
        line: diag.range.startLine,
        question: `Hành vi có thuộc phạm vi "${diag.excerpt}" hay không?`,
        trueLabel: "Có — Thuộc phạm vi",
        falseLabel: "Không — Ngoài phạm vi",
        selectedValue,
    };
}

function findLinkedAdditionalSanctionIssue(
    draft: ParsedDraft,
    node: ParsedNode,
    diagnostics: readonly LegalDiagnostic[],
): LegalDiagnostic | null {
    if (!node.articleNo) {
        return null;
    }

    const articleDiags = diagnostics.filter(
        (diag) => diag.code === "AM005" && diag.provisionRef?.endsWith(`Điều ${node.articleNo}`),
    );

    if (articleDiags.length === 0) {
        return null;
    }

    const target = articleDiags[0];
    const lineStart = Math.max(0, target.range.startOffset - 120);
    const slice = draft.content.slice(lineStart, target.range.endOffset);

    if (node.clauseNo && slice.includes(`khoản ${node.clauseNo}`)) {
        return target;
    }

    return null;
}

function synthesizeVerdict(
    facts: ScenarioFacts,
    trace: readonly DebugTraceStep[],
    ambiguities: readonly AmbiguityDecisionItem[],
    exploitedDefects: readonly ExploitedDefect[],
    matchedFine: readonly { min: number; max: number }[],
    additionalSanctions: readonly string[],
): JudgeVerdict {
    const hasLoophole = trace.some((step) => step.status === "LOOPHOLE_HIT");
    const hasConflict = trace.some((step) => step.status === "CONFLICT_HIT");
    const hasUnenforceable = trace.some((step) => step.status === "UNENFORCEABLE_TERM");
    const hasUnresolvedAmbiguity = trace.some((step) => step.status === "AMBIGUOUS_BRANCH");
    const hasMatched = trace.some((step) => step.status === "MATCHED");
    const applicableFine = matchedFine.length > 0 ? matchedFine[0] : null;

    let outcome: VerdictOutcome = "NOT_COVERED";
    let outcomeLabel = "CHƯA CÓ QUY PHẠM ĐIỀU CHỈNH";
    let summary = "Dự thảo hiện tại chưa có điều khoản nào điều chỉnh trực tiếp tình huống được mô tả.";
    let lawmakerAction = "Bổ sung quy phạm điều chỉnh hành vi này nếu thuộc phạm vi điều chỉnh của văn bản.";

    if (hasUnresolvedAmbiguity && !hasMatched) {
        outcome = "CONFLICT_AMBIGUOUS";
        outcomeLabel = "CẦN CHỌN GIẢ ĐỊNH MƠ HỒ ĐỂ KẾT LUẬN";
        summary = `Tình huống phụ thuộc vào ${ambiguities.filter((item) => item.selectedValue === null).length} điểm mơ hồ chưa định lượng. Hãy tinh chỉnh cách hiểu bên dưới để kiểm thử phán quyết.`;
        lawmakerAction = "Định lượng hóa các khái niệm mơ hồ để tránh việc Tòa án phải diễn giải tùy nghi.";
    } else if (hasConflict && !hasMatched) {
        outcome = "CONFLICT_AMBIGUOUS";
        outcomeLabel = "XUNG ĐỘT QUY PHẠM — TÒA HỦY / ÁP DỤNG MỨC NHẸ NHẤT";
        summary = "Hành vi rơi vào vùng chồng chéo hoặc khung phạt lỗi logic trong dự thảo, không thể ấn định chế tài thống nhất.";
        lawmakerAction = "Sửa ngay các lỗi logic (LG001/LG002) để phân tách ranh giới định lượng và sắp xếp cận min ≤ max.";
    } else if (hasLoophole && !hasMatched) {
        outcome = "ACQUITTED_LOOPHOLE";
        outcomeLabel = "KHÔNG THỂ XỬ PHẠT — LỌT KẼ HỞ PHÁP LÝ";
        summary = "Đương sự thoát chế tài vì tình huống khai thác đúng kẽ hở trong dự thảo (khoảng trống ngưỡng, lệnh cấm không chế tài hoặc ngoại lệ mở).";
        lawmakerAction = "Vá các kẽ hở đã bị khai thác trong trace (khép kín ngưỡng, thêm chế tài hoặc giới hạn ngoại lệ).";
    } else if (hasMatched && (hasUnenforceable || hasLoophole || hasConflict || hasUnresolvedAmbiguity)) {
        outcome = "PARTIALLY_ENFORCEABLE";
        outcomeLabel = "XỬ PHẠT MỘT PHẦN — VƯỚNG CHẾ TÀI BỔ SUNG / THUẬT NGỮ";
        summary = `Có căn cứ phạt tiền (${applicableFine ? `${applicableFine.min.toLocaleString("vi-VN")}–${applicableFine.max.toLocaleString("vi-VN")}đ` : "theo khung"}), nhưng phần chế tài bổ sung hoặc thuật ngữ liên quan không thể thi hành tại Tòa.`;
        lawmakerAction = "Bổ sung văn bản định nghĩa thuật ngữ vào Thư viện workspace và ghi rõ thời hạn/định mức hình phạt bổ sung.";
    } else if (hasMatched) {
        outcome = "GUILTY_SANCTIONED";
        outcomeLabel = "ĐỦ CĂN CỨ TUYÊN PHẠT";
        summary = `Hội đồng xét xử có đủ căn cứ pháp lý và chứng minh Lean 4 hợp lệ để áp dụng mức phạt${applicableFine ? ` từ ${applicableFine.min.toLocaleString("vi-VN")}đ đến ${applicableFine.max.toLocaleString("vi-VN")}đ` : ""}.`;
        lawmakerAction = "Quy phạm áp dụng cho tình huống này đã chặt chẽ; tiếp tục kiểm thử các tình huống biên khác.";
    }

    const judicialReasoning = buildJudicialReasoning(facts, trace, exploitedDefects, outcome);

    return {
        outcome,
        outcomeLabel,
        summary,
        applicableFine,
        additionalSanctions: [...additionalSanctions],
        exploitedDefects: [...exploitedDefects],
        judicialReasoning,
        lawmakerAction,
    };
}

function buildJudicialReasoning(
    facts: ScenarioFacts,
    trace: readonly DebugTraceStep[],
    exploitedDefects: readonly ExploitedDefect[],
    outcome: VerdictOutcome,
): string[] {
    const reasons: string[] = [];

    reasons.push(
        `Chủ thể được xác định: ${facts.subject === "ORGANIZATION" ? "Tổ chức/Doanh nghiệp" : "Cá nhân"}${facts.measurements.length > 0 ? ` · Thông số đo: ${facts.measurements.map((item) => item.raw).join(", ")}` : ""}.`,
    );

    for (const step of trace.slice(0, 4)) {
        reasons.push(`[${step.provisionRef}] ${step.evaluation}`);
    }

    if (exploitedDefects.length > 0) {
        reasons.push(
            `Lỗ hổng bị khai thác tại Tòa (${exploitedDefects.map((item) => item.code).join(", ")}): ${exploitedDefects[0].impactInCourt}`,
        );
    } else if (outcome === "NOT_COVERED") {
        reasons.push("Không tìm thấy điều khoản nào trong dự thảo khớp với hành vi của tình huống.");
    }

    return reasons;
}

async function refineVerdictWithAi(
    scenario: string,
    trace: readonly DebugTraceStep[],
    verdict: JudgeVerdict,
    options: { apiKey: string; model: string; fetcher?: typeof fetch },
): Promise<{ summary: string; judicialReasoning: string[] } | null> {
    try {
        const traceText = trace.map((step) => `- [${step.provisionRef}] (${step.status}) ${step.evaluation} | Lean: ${step.leanCheck}`).join("\n");
        const raw = await requestStructuredJson({
            apiKey: options.apiKey,
            model: options.model,
            schemaName: "judge_verdict_v1",
            schema: JUDGE_AI_SCHEMA,
            systemPrompt: JUDGE_AI_SYSTEM_PROMPT,
            userText: `Tình huống: ${scenario}\nKết quả máy Lean: ${verdict.outcomeLabel}\nTrace:\n${traceText || "(Không khớp điều khoản nào)"}`,
            maxOutputTokens: 600,
            fetcher: options.fetcher,
        });

        if (!isRecord(raw) || typeof raw.summary !== "string" || !Array.isArray(raw.judicialReasoning)) {
            return null;
        }

        const reasoning = raw.judicialReasoning.filter((item): item is string => typeof item === "string" && item.trim().length > 0);

        if (reasoning.length === 0) {
            return null;
        }

        return {
            summary: raw.summary.trim(),
            judicialReasoning: reasoning,
        };
    } catch {
        return null;
    }
}

function matchesThreshold(value: number, item: ExtractedThreshold): boolean {
    if (item.min === null) {
        return false;
    }

    const lowerOk = item.minInclusive ? value >= item.min : value > item.min;

    if (!lowerOk) {
        return false;
    }

    if (item.max === null) {
        return true;
    }

    return item.maxInclusive ? value <= item.max : value < item.max;
}

function findFineAtLine(fineRanges: readonly ExtractedFineRange[], threshold: ExtractedThreshold): ExtractedFineRange | null {
    return fineRanges.find((fine) => fine.startOffset <= threshold.startOffset && threshold.startOffset - fine.startOffset < 260) ?? null;
}

function pushDefect(list: ExploitedDefect[], item: ExploitedDefect): void {
    if (!list.some((existing) => existing.code === item.code)) {
        list.push(item);
    }
}

function pushAmbiguity(list: AmbiguityDecisionItem[], item: AmbiguityDecisionItem): void {
    if (!list.some((existing) => existing.id === item.id)) {
        list.push(item);
    }
}

function buildExtractedFactList(facts: ScenarioFacts): { label: string; value: string }[] {
    const items: { label: string; value: string }[] = [
        { label: "Chủ thể", value: facts.subject === "ORGANIZATION" ? "Tổ chức / Doanh nghiệp" : "Cá nhân" },
    ];

    if (facts.measurements.length > 0) {
        items.push({ label: "Định lượng", value: facts.measurements.map((item) => item.raw).join(", ") });
    }

    if (facts.claimsException && facts.claimedExceptionText) {
        items.push({ label: "Viện dẫn ngoại lệ", value: facts.claimedExceptionText });
    }

    return items;
}
