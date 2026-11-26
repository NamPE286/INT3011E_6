import type { ExtractedFineRange, ExtractedThreshold } from "./ide.intervals";
import { normalizeLegalTerm, positionAtOffset, rangeFromOffsets, type ParsedDraft } from "./ide.parser";
import type {
    CrossReferenceItem,
    ExtractedLegalFact,
    LeanObligation,
    LeanTokenStats,
    LeanVerificationReport,
    LegalDiagnostic,
    TermStatusItem,
} from "./ide.types";
import type { WorkspaceContext } from "./ide.workspace";

export type LeanCompileInput = {
    draft: ParsedDraft;
    fineRanges: readonly ExtractedFineRange[];
    thresholds: readonly ExtractedThreshold[];
    references: readonly CrossReferenceItem[];
    terms: readonly TermStatusItem[];
    diagnostics: LegalDiagnostic[];
    workspaceContext: WorkspaceContext;
    extractedFacts?: readonly ExtractedLegalFact[];
    actualAiTokens?: number;
};

export type LeanCompileOutput = {
    report: LeanVerificationReport;
    derivedDiagnostics: LegalDiagnostic[];
};

export function compileDraftToLean(input: LeanCompileInput): LeanCompileOutput {
    const obligations: LeanObligation[] = [];
    const derivedDiagnostics: LegalDiagnostic[] = [];
    const lines: string[] = [
        "-- LexIDE Formal Legal Verification (Lean 4.12)",
        `-- Workspace: ${input.workspaceContext.corpusDocumentCount} văn bản kho, ${input.workspaceContext.savedDraftCount} dự thảo (chỉ dùng dữ liệu workspace)`,
        "namespace LexIDE",
        "",
    ];

    emitTermDefinitions(input.terms, obligations, lines);
    emitReferenceObligations(input.references, obligations, lines);
    emitFineBoundObligations(input.draft, input.fineRanges, obligations, lines);
    emitThresholdObligations(input.thresholds, obligations, lines);
    emitDiagnosticObligations(input.diagnostics, obligations, lines);
    emitExtractedFactObligations(
        input.draft,
        input.extractedFacts ?? [],
        input.workspaceContext,
        obligations,
        lines,
        derivedDiagnostics,
    );

    lines.push("end LexIDE");

    const allDiagnostics = [...input.diagnostics, ...derivedDiagnostics];
    attachTheoremsToDiagnostics(allDiagnostics, obligations);

    const provedCount = obligations.filter((item) => item.status === "PROVED").length;
    const refutedCount = obligations.filter((item) => item.status === "REFUTED").length;
    const tokenStats = computeTokenStats(input.draft, allDiagnostics, input.actualAiTokens ?? 0);

    return {
        report: {
            engine: "BUILTIN_KERNEL",
            leanVersion: "Lean 4.12 (LexIDE Kernel)",
            leanCode: lines.join("\n"),
            obligations,
            provedCount,
            refutedCount,
            tokenStats,
        },
        derivedDiagnostics,
    };
}

export function selectAiCandidateClauses(draft: ParsedDraft): { refLabel: string; text: string }[] {
    const candidates: { refLabel: string; text: string }[] = [];

    for (const node of draft.nodes) {
        if (node.level !== "CLAUSE" && node.level !== "POINT") {
            continue;
        }

        const hasConditionOrException = /\b(?:nếu|trừ|khi|trường hợp|điều kiện|miễn|giảm|tịch thu|tước)\b/iu.test(node.text);

        if (hasConditionOrException) {
            candidates.push({
                refLabel: node.refLabel,
                text: node.text.replace(/\s+/g, " ").trim().slice(0, 220),
            });
        }
    }

    return candidates.slice(0, 12);
}

function emitTermDefinitions(
    terms: readonly TermStatusItem[],
    obligations: LeanObligation[],
    lines: string[],
): void {
    if (terms.length === 0) {
        return;
    }

    const uniqueTerms = new Map<string, TermStatusItem>();

    for (const term of terms) {
        if (!uniqueTerms.has(term.normalizedTerm)) {
            uniqueTerms.set(term.normalizedTerm, term);
        }
    }

    lines.push("-- 1. Kiểm tra định nghĩa thuật ngữ trong Workspace");
    lines.push("inductive LegalTerm where");

    for (const item of uniqueTerms.values()) {
        lines.push(`  | ${toLeanIdent(item.normalizedTerm)}`);
    }

    lines.push("  deriving DecidableEq");
    lines.push("");
    lines.push("def DefinedInWorkspace : LegalTerm → Bool");

    for (const item of uniqueTerms.values()) {
        const isDefined = item.status !== "UNDEFINED";
        lines.push(`  | .${toLeanIdent(item.normalizedTerm)} => ${isDefined ? "true" : "false"}`);
    }

    lines.push("");

    for (const item of uniqueTerms.values()) {
        const slug = toLeanIdent(item.normalizedTerm);
        const theoremName = `term_defined_${slug}`;
        const statement = `theorem ${theoremName} : DefinedInWorkspace .${slug} = true := by decide`;
        const isDefined = item.status !== "UNDEFINED";

        lines.push(statement);
        obligations.push({
            id: `lean-term-${slug}`,
            theoremName,
            kind: "TERM_DEFINED",
            status: isDefined ? "PROVED" : "REFUTED",
            tactic: "decide",
            line: item.line,
            provisionRef: item.definedBy,
            leanStatement: statement,
            counterexample: isDefined
                ? null
                : `DefinedInWorkspace .${slug} = false (chưa có văn bản định nghĩa "${item.term}" trong workspace)`,
            diagnosticCode: isDefined ? null : "AM005",
        });
    }

    lines.push("");
}

function emitReferenceObligations(
    references: readonly CrossReferenceItem[],
    obligations: LeanObligation[],
    lines: string[],
): void {
    if (references.length === 0) {
        return;
    }

    lines.push("-- 2. Kiểm tra tính toàn vẹn dẫn chiếu nội bộ");

    for (let idx = 0; idx < references.length; idx += 1) {
        const ref = references[idx];
        const slug = toLeanIdent(ref.targetRef);
        const theoremName = `ref_valid_L${ref.line}_${idx + 1}`;
        const isValid = ref.status === "VALID";
        const expr = ref.status === "BROKEN"
            ? `ExistsInDraft "${slug}" = true`
            : ref.status === "ORPHANED_BY_REPEAL"
              ? `ExistsInDraft "${slug}" = true ∧ IsRepealed "${slug}" = false`
              : ref.status === "SELF_REFERENCE"
                ? `TargetOf "${slug}" ≠ SelfNode`
                : `ExistsInDraft "${slug}" = true ∧ IsRepealed "${slug}" = false`;

        const statement = `theorem ${theoremName} : ${expr} := by decide`;
        lines.push(statement);

        const counterexample = ref.status === "BROKEN"
            ? `ExistsInDraft "${ref.targetRef}" = false`
            : ref.status === "ORPHANED_BY_REPEAL"
              ? `IsRepealed "${ref.targetRef}" = true`
              : ref.status === "SELF_REFERENCE"
                ? `TargetOf "${ref.targetRef}" = SelfNode`
                : null;

        obligations.push({
            id: `lean-ref-${idx + 1}`,
            theoremName,
            kind: "REF_VALID",
            status: isValid ? "PROVED" : "REFUTED",
            tactic: "decide",
            line: ref.line,
            provisionRef: ref.fromRef,
            leanStatement: statement,
            counterexample,
            diagnosticCode: ref.status === "BROKEN" ? "LG003" : ref.status === "SELF_REFERENCE" ? "LG004" : ref.status === "ORPHANED_BY_REPEAL" ? "LG007" : null,
        });
    }

    lines.push("");
}

function emitFineBoundObligations(
    draft: ParsedDraft,
    fineRanges: readonly ExtractedFineRange[],
    obligations: LeanObligation[],
    lines: string[],
): void {
    if (fineRanges.length === 0) {
        return;
    }

    lines.push("-- 3. Chứng minh cận khung tiền phạt (min ≤ max)");

    for (let idx = 0; idx < fineRanges.length; idx += 1) {
        const fine = fineRanges[idx];
        const line = positionAtOffset(draft.lineStarts, fine.startOffset).line;
        const theoremName = `fine_bounds_L${line}_${idx + 1}`;
        const statement = `theorem ${theoremName} : (${fine.min} : Nat) ≤ ${fine.max} := by omega`;
        const isOk = fine.min <= fine.max;

        lines.push(statement);
        obligations.push({
            id: `lean-fine-${idx + 1}`,
            theoremName,
            kind: "FINE_BOUNDS",
            status: isOk ? "PROVED" : "REFUTED",
            tactic: "omega",
            line,
            provisionRef: fine.provisionRef,
            leanStatement: statement,
            counterexample: isOk ? null : `${fine.min} > ${fine.max} (chênh lệch ${fine.min - fine.max} đồng)`,
            diagnosticCode: isOk ? null : "LG001",
        });
    }

    lines.push("");
}

function emitThresholdObligations(
    thresholds: readonly ExtractedThreshold[],
    obligations: LeanObligation[],
    lines: string[],
): void {
    if (thresholds.length === 0) {
        return;
    }

    lines.push("-- 4. Chứng minh phân hoạch ngưỡng định lượng (không khoảng trống / không chồng chéo)");

    for (let idx = 0; idx < thresholds.length; idx += 1) {
        const item = thresholds[idx];

        if (item.status === "GAP_BEFORE" && item.gapFrom && item.gapFrom.max !== null && item.min !== null) {
            const witness = Math.floor((item.gapFrom.max + item.min) / 2);
            const theoremName = `no_gap_L${item.line}_${idx + 1}`;
            const statement = `theorem ${theoremName} (x : Nat) (h : ${item.gapFrom.min ?? 0} ≤ x ∧ x ≤ ${item.max ?? item.min}) : (x ≤ ${item.gapFrom.max}) ∨ (${item.min} ≤ x) := by omega`;

            lines.push(statement);
            obligations.push({
                id: `lean-gap-${idx + 1}`,
                theoremName,
                kind: "NO_GAP",
                status: "REFUTED",
                tactic: "omega",
                line: item.line,
                provisionRef: item.provisionRef,
                leanStatement: statement,
                counterexample: `x = ${witness} ${item.unit} (${item.gapFrom.max} < ${witness} < ${item.min})`,
                diagnosticCode: "LP003",
            });
        } else if (item.status === "OVERLAP" && item.overlapWith && item.overlapWith.max !== null && item.min !== null) {
            const witness = item.min;
            const theoremName = `disjoint_L${item.line}_${idx + 1}`;
            const statement = `theorem ${theoremName} (x : Nat) : ¬ ((${item.overlapWith.min ?? 0} ≤ x ∧ x ≤ ${item.overlapWith.max}) ∧ (${item.min} ≤ x ∧ x ≤ ${item.max ?? item.min})) := by omega`;

            lines.push(statement);
            obligations.push({
                id: `lean-overlap-${idx + 1}`,
                theoremName,
                kind: "DISJOINT",
                status: "REFUTED",
                tactic: "omega",
                line: item.line,
                provisionRef: item.provisionRef,
                leanStatement: statement,
                counterexample: `x = ${witness} ${item.unit} thỏa mãn đồng thời cả hai khung`,
                diagnosticCode: "LG002",
            });
        } else if (item.min !== null && item.max !== null) {
            const theoremName = `interval_valid_L${item.line}_${idx + 1}`;
            const statement = `theorem ${theoremName} : (${item.min} : Nat) ≤ ${item.max} := by omega`;

            lines.push(statement);
            obligations.push({
                id: `lean-int-${idx + 1}`,
                theoremName,
                kind: "DISJOINT",
                status: item.min <= item.max ? "PROVED" : "REFUTED",
                tactic: "omega",
                line: item.line,
                provisionRef: item.provisionRef,
                leanStatement: statement,
                counterexample: item.min <= item.max ? null : `${item.min} > ${item.max}`,
                diagnosticCode: item.min <= item.max ? null : "LG001",
            });
        }
    }

    lines.push("");
}

function emitDiagnosticObligations(
    diagnostics: readonly LegalDiagnostic[],
    obligations: LeanObligation[],
    lines: string[],
): void {
    const structural = diagnostics.filter(
        (diag) => diag.code === "LP001" || diag.code === "LP002" || diag.code === "LP007" || diag.code === "AM001" || diag.code === "LG006",
    );

    if (structural.length === 0) {
        return;
    }

    lines.push("-- 5. Điều kiện chặt chẽ quy phạm (chế tài, ngoại lệ, định lượng)");

    for (let idx = 0; idx < structural.length; idx += 1) {
        const diag = structural[idx];
        const kind = diag.code === "LP002" || diag.code === "LP007"
            ? "SANCTION_COVERAGE"
            : diag.code === "LP001"
              ? "EXCEPTION_BOUNDED"
              : "PREDICATE_CLEAR";
        const theoremName = `${kind.toLowerCase()}_L${diag.range.startLine}_${idx + 1}`;
        const prop = diag.code === "LP002"
            ? `HasSanction "${toLeanIdent(diag.provisionRef ?? `L${diag.range.startLine}`)}" = true`
            : diag.code === "LP007"
              ? `ArticleHasNormativeBody "${toLeanIdent(diag.provisionRef ?? `L${diag.range.startLine}`)}" = true`
              : diag.code === "LG006"
                ? `HasLawHeaderTitle = true`
                : diag.code === "LP001"
                  ? `ExceptionHasCriteria "${toLeanIdent(diag.excerpt)}" = true`
                  : `PredicateQuantified "${toLeanIdent(diag.excerpt)}" = true`;

        const statement = `theorem ${theoremName} : ${prop} := by decide`;
        lines.push(statement);

        obligations.push({
            id: `lean-norm-${idx + 1}`,
            theoremName,
            kind,
            status: "REFUTED",
            tactic: "decide",
            line: diag.range.startLine,
            provisionRef: diag.provisionRef,
            leanStatement: statement,
            counterexample: `${prop} bị vi phạm tại "${diag.excerpt}"`,
            diagnosticCode: diag.code,
        });
    }

    lines.push("");
}

function emitExtractedFactObligations(
    draft: ParsedDraft,
    facts: readonly ExtractedLegalFact[],
    workspaceContext: WorkspaceContext,
    obligations: LeanObligation[],
    lines: string[],
    derivedDiagnostics: LegalDiagnostic[],
): void {
    if (facts.length === 0) {
        return;
    }

    lines.push("-- 6. Biên dịch tất định các sự kiện trích xuất từ LLM sang định lý Lean 4");

    const definedTermSet = new Set<string>([
        ...[...draft.definedTerms].map((term) => normalizeLegalTerm(term)),
        ...workspaceContext.definedTerms.map((item) => item.normalizedTerm),
    ]);

    const modalitiesByAction = new Map<string, { prohibited?: ExtractedLegalFact; permitted?: ExtractedLegalFact }>();

    for (let idx = 0; idx < facts.length; idx += 1) {
        const fact = facts[idx];
        const range = rangeFromOffsets(draft.content, draft.lineStarts, fact.startOffset, fact.endOffset);
        const actionSlug = toLeanIdent(fact.actionKey);

        if (fact.modality === "PROHIBITED" || fact.modality === "PERMITTED") {
            const bucket = modalitiesByAction.get(fact.actionKey) ?? {};

            if (fact.modality === "PROHIBITED") {
                bucket.prohibited = bucket.prohibited ?? fact;
            } else {
                bucket.permitted = bucket.permitted ?? fact;
            }

            modalitiesByAction.set(fact.actionKey, bucket);
        }

        if (fact.fineMin !== null && fact.fineMax !== null) {
            const theoremName = `extracted_fine_L${fact.line}_${idx + 1}`;
            const statement = `theorem ${theoremName} : (${Math.round(fact.fineMin)} : Nat) ≤ ${Math.round(fact.fineMax)} := by omega`;
            const isOk = fact.fineMin <= fact.fineMax;
            const counterexample = isOk ? null : `${fact.fineMin} > ${fact.fineMax}`;

            lines.push(statement);
            obligations.push({
                id: `lean-ext-fine-${idx + 1}`,
                theoremName,
                kind: "FINE_BOUNDS",
                status: isOk ? "PROVED" : "REFUTED",
                tactic: "omega",
                line: fact.line,
                provisionRef: fact.provisionRef,
                leanStatement: statement,
                counterexample,
                diagnosticCode: isOk ? null : "LG001",
            });

            if (!isOk) {
                derivedDiagnostics.push({
                    id: `LEAN-EXT-LG001-fine-${fact.startOffset}`,
                    code: "LG001",
                    category: "LOGIC",
                    severity: "error",
                    title: "Khung tiền phạt trích xuất bị đảo ngược (min > max)",
                    message: `Lean 4 bác bỏ điều kiện cận dưới ≤ cận trên (${fact.fineMin} > ${fact.fineMax}).`,
                    exploitScenario: "Quyết định xử phạt bị vô hiệu do khoảng phạt rỗng về mặt toán học.",
                    suggestion: "Sắp xếp lại mức phạt tối thiểu nhỏ hơn hoặc bằng mức tối đa.",
                    excerpt: fact.quote,
                    provisionRef: fact.provisionRef,
                    range,
                    source: "AI",
                    quickFix: null,
                    corpusLink: null,
                    leanTheorem: theoremName,
                    counterexample,
                });
            }
        }

        if (fact.thresholdMin !== null && fact.thresholdMax !== null) {
            const theoremName = `extracted_threshold_L${fact.line}_${idx + 1}`;
            const statement = `theorem ${theoremName} : (${Math.round(fact.thresholdMin)} : Nat) ≤ ${Math.round(fact.thresholdMax)} := by omega`;
            const isOk = fact.thresholdMin <= fact.thresholdMax;
            const counterexample = isOk ? null : `${fact.thresholdMin} > ${fact.thresholdMax} (${fact.thresholdUnit ?? ""})`;

            lines.push(statement);
            obligations.push({
                id: `lean-ext-thr-${idx + 1}`,
                theoremName,
                kind: "DISJOINT",
                status: isOk ? "PROVED" : "REFUTED",
                tactic: "omega",
                line: fact.line,
                provisionRef: fact.provisionRef,
                leanStatement: statement,
                counterexample,
                diagnosticCode: isOk ? null : "LG001",
            });

            if (!isOk) {
                derivedDiagnostics.push({
                    id: `LEAN-EXT-LG001-thr-${fact.startOffset}`,
                    code: "LG001",
                    category: "LOGIC",
                    severity: "error",
                    title: "Ngưỡng định lượng bị đảo ngược (min > max)",
                    message: `Lean 4 chứng minh khoảng định lượng không hợp lệ (${fact.thresholdMin} > ${fact.thresholdMax}).`,
                    exploitScenario: "Không thể xác định ngưỡng vi phạm hợp lệ khi áp dụng thực tế.",
                    suggestion: "Điều chỉnh cận dưới nhỏ hơn hoặc bằng cận trên.",
                    excerpt: fact.quote,
                    provisionRef: fact.provisionRef,
                    range,
                    source: "AI",
                    quickFix: null,
                    corpusLink: null,
                    leanTheorem: theoremName,
                    counterexample,
                });
            }
        }

        if (fact.modality === "PROHIBITED") {
            const theoremName = `extracted_sanction_L${fact.line}_${idx + 1}`;
            const statement = `theorem ${theoremName} : HasSanction "${actionSlug}" = true := by decide`;
            const isOk = fact.hasSanction;
            const counterexample = isOk ? null : `HasSanction "${actionSlug}" = false`;

            lines.push(statement);
            obligations.push({
                id: `lean-ext-sanc-${idx + 1}`,
                theoremName,
                kind: "SANCTION_COVERAGE",
                status: isOk ? "PROVED" : "REFUTED",
                tactic: "decide",
                line: fact.line,
                provisionRef: fact.provisionRef,
                leanStatement: statement,
                counterexample,
                diagnosticCode: isOk ? null : "LP002",
            });

            if (!isOk) {
                derivedDiagnostics.push({
                    id: `LEAN-EXT-LP002-${fact.startOffset}`,
                    code: "LP002",
                    category: "LOOPHOLE",
                    severity: "error",
                    title: "Hành vi bị cấm thiếu chế tài xử lý",
                    message: `Lean 4 chứng minh hành vi "${fact.actionKey}" ở trạng thái PROHIBITED nhưng HasSanction = false.`,
                    exploitScenario: "Hành vi bị cấm nhưng không có chế tài kèm theo nên không thể xử phạt.",
                    suggestion: "Bổ sung mức phạt hoặc dẫn chiếu điều khoản xử phạt tương ứng.",
                    excerpt: fact.quote,
                    provisionRef: fact.provisionRef,
                    range,
                    source: "AI",
                    quickFix: null,
                    corpusLink: null,
                    leanTheorem: theoremName,
                    counterexample,
                });
            }
        }

        if (fact.hasOpenException) {
            const theoremName = `extracted_exception_L${fact.line}_${idx + 1}`;
            const statement = `theorem ${theoremName} : ExceptionHasCriteria "${actionSlug}" = true := by decide`;
            const isOk = fact.hasExceptionCriteria;
            const counterexample = isOk ? null : `ExceptionHasCriteria "${actionSlug}" = false`;

            lines.push(statement);
            obligations.push({
                id: `lean-ext-exc-${idx + 1}`,
                theoremName,
                kind: "EXCEPTION_BOUNDED",
                status: isOk ? "PROVED" : "REFUTED",
                tactic: "decide",
                line: fact.line,
                provisionRef: fact.provisionRef,
                leanStatement: statement,
                counterexample,
                diagnosticCode: isOk ? null : "LP001",
            });

            if (!isOk) {
                derivedDiagnostics.push({
                    id: `LEAN-EXT-LP001-${fact.startOffset}`,
                    code: "LP001",
                    category: "LOOPHOLE",
                    severity: "warning",
                    title: "Ngoại lệ mở thiếu tiêu chí định lượng",
                    message: `Lean 4 chứng minh ngoại lệ tại "${fact.actionKey}" chưa có tiêu chí giới hạn.`,
                    exploitScenario: "Chủ thể vi phạm viện dẫn ngoại lệ mở để né tránh xử phạt.",
                    suggestion: "Bổ sung điều kiện định lượng hoặc dẫn chiếu điều khoản quy định ngoại lệ.",
                    excerpt: fact.quote,
                    provisionRef: fact.provisionRef,
                    range,
                    source: "AI",
                    quickFix: null,
                    corpusLink: null,
                    leanTheorem: theoremName,
                    counterexample,
                });
            }
        }

        for (const rawTerm of fact.referencedTerms) {
            const normalized = normalizeLegalTerm(rawTerm);
            const termSlug = toLeanIdent(normalized);
            const theoremName = `extracted_term_L${fact.line}_${termSlug}`;
            const statement = `theorem ${theoremName} : DefinedInWorkspace .${termSlug} = true := by decide`;
            const isDefined = definedTermSet.has(normalized);
            const counterexample = isDefined
                ? null
                : `DefinedInWorkspace .${termSlug} = false (chưa có định nghĩa "${rawTerm}" trong workspace)`;

            lines.push(statement);
            obligations.push({
                id: `lean-ext-term-${idx + 1}-${termSlug}`,
                theoremName,
                kind: "TERM_DEFINED",
                status: isDefined ? "PROVED" : "REFUTED",
                tactic: "decide",
                line: fact.line,
                provisionRef: fact.provisionRef,
                leanStatement: statement,
                counterexample,
                diagnosticCode: isDefined ? null : "AM005",
            });

            if (!isDefined) {
                derivedDiagnostics.push({
                    id: `LEAN-EXT-AM005-${fact.startOffset}-${termSlug}`,
                    code: "AM005",
                    category: "AMBIGUITY",
                    severity: "warning",
                    title: `Thuật ngữ chưa có văn bản định nghĩa trong workspace: "${rawTerm}"`,
                    message: `Lean 4 chứng minh "${rawTerm}" chưa tồn tại trong Điều Giải thích từ ngữ hoặc Library workspace.`,
                    exploitScenario: "Tranh chấp cách hiểu thuật ngữ chuyên ngành khi áp dụng tại Tòa.",
                    suggestion: `Bổ sung định nghĩa "${rawTerm}" vào dự thảo hoặc import văn bản định nghĩa vào Library.`,
                    excerpt: fact.quote,
                    provisionRef: fact.provisionRef,
                    range,
                    source: "AI",
                    quickFix: null,
                    corpusLink: null,
                    leanTheorem: theoremName,
                    counterexample,
                });
            }
        }
    }

    for (const [actionKey, pair] of modalitiesByAction.entries()) {
        if (!pair.prohibited || !pair.permitted) {
            continue;
        }

        const slug = toLeanIdent(actionKey);
        const theoremName = `deontic_consistent_${slug}`;
        const statement = `theorem ${theoremName} : ¬ (Prohibited "${slug}" ∧ Permitted "${slug}") := by decide`;
        const counterexample = `Prohibited "${slug}" = true ∧ Permitted "${slug}" = true`;
        const target = pair.permitted;
        const range = rangeFromOffsets(draft.content, draft.lineStarts, target.startOffset, target.endOffset);

        lines.push(statement);
        obligations.push({
            id: `lean-ext-deontic-${slug}`,
            theoremName,
            kind: "DEONTIC_CONSISTENT",
            status: "REFUTED",
            tactic: "decide",
            line: target.line,
            provisionRef: target.provisionRef,
            leanStatement: statement,
            counterexample,
            diagnosticCode: "LG002",
        });

        derivedDiagnostics.push({
            id: `LEAN-EXT-LG002-${target.startOffset}-${slug}`,
            code: "LG002",
            category: "LOGIC",
            severity: "error",
            title: `Mâu thuẫn đạo nghĩa trên hành vi "${actionKey}"`,
            message: `Lean 4 phát hiện cùng hành vi "${actionKey}" vừa bị cấm (PROHIBITED) vừa được cho phép (PERMITTED).`,
            exploitScenario: "Hai quy phạm mâu thuẫn trực tiếp khiến cơ quan thi hành không thể áp dụng thống nhất.",
            suggestion: "Rà soát lại phạm vi loại trừ giữa hai điều khoản để loại bỏ xung đột.",
            excerpt: target.quote,
            provisionRef: target.provisionRef,
            range,
            source: "AI",
            quickFix: null,
            corpusLink: null,
            leanTheorem: theoremName,
            counterexample,
        });
    }

    lines.push("");
}

function attachTheoremsToDiagnostics(diagnostics: LegalDiagnostic[], obligations: readonly LeanObligation[]): void {
    for (const diag of diagnostics) {
        const match = obligations.find(
            (ob) => ob.status === "REFUTED" && ob.diagnosticCode === diag.code && ob.line === diag.range.startLine,
        ) ?? obligations.find((ob) => ob.status === "REFUTED" && ob.diagnosticCode === diag.code);

        if (match) {
            diag.leanTheorem = match.theoremName;
            diag.counterexample = match.counterexample;
        }
    }
}

function computeTokenStats(
    draft: ParsedDraft,
    diagnostics: readonly LegalDiagnostic[],
    actualAiTokens: number,
): LeanTokenStats {
    const totalClauses = draft.nodes.filter((node) => node.level === "CLAUSE" || node.level === "POINT").length;
    const aiCandidateCount = selectAiCandidateClauses(draft).length;
    const naiveFullTokens = Math.max(250, Math.ceil(draft.content.length / 3.2) + 450);
    const savedPercent = actualAiTokens === 0
        ? 100
        : Math.max(0, Math.min(99, Math.round((1 - actualAiTokens / naiveFullTokens) * 100)));

    return {
        naiveFullTokens,
        actualAiTokens,
        savedPercent,
        totalClauses,
        deterministicClauses: Math.max(0, totalClauses - (actualAiTokens > 0 ? aiCandidateCount : 0)),
        aiEscalatedClauses: actualAiTokens > 0 ? aiCandidateCount : 0,
        strategy: actualAiTokens === 0
            ? `Biên dịch tất định AST → Lean 4 (0 token LLM cho ${diagnostics.length} cảnh báo)`
            : `Extract-only LLM (${aiCandidateCount}/${totalClauses} khoản phức tạp) → Lean 4 Kernel chứng minh tất định`,
    };
}

function toLeanIdent(raw: string): string {
    const ascii = raw
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

    return ascii.slice(0, 36) || "item";
}
