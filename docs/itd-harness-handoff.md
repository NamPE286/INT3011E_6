# Handoff: Inference-time Distillation (ITD) Harness for LexIDE

> **Mục tiêu tài liệu:** Cung cấp đầy đủ ngữ cảnh kiến trúc, entrypoint, dữ liệu benchmark, failure taxonomy, và quy trình thiết kế **Inference-time Distillation (ITD) Harness** để agent tiếp theo có thể tự động chưng cất năng lực suy luận của frontier LLM (teacher) thành các artifact thực thi tại inference time (symbolic rules, Lean 4 invariants, `gemini-decision-1` gates, và compact structured prompts).

---

## 1. Trạng thái hệ thống hiện tại

- **Sản phẩm:** **LexIDE** — môi trường soạn thảo & kiểm chứng văn bản quy phạm pháp luật Việt Nam theo kiến trúc **Local-First Neuro-Symbolic** (chạy 100% trên trình duyệt / Cloudflare Workers, không phụ thuộc backend cho các tính năng lõi).
- **Production URL (Cloudflare Workers):** `https://int3011e-web.nampe.workers.dev` (Worker name: `int3011e-web`, config tại `web/wrangler.jsonc`).
- **Sức khỏe kiểm thử hiện tại:**
  - `cd web && bun test`: **163 pass, 0 fail** (32 files, 544 assertions).
  - `cd web && bun run check && bun run build`: `svelte-check` **0 errors, 0 warnings**; Cloudflare Workers build thành công.
  - `cd web && bun run scripts/eval-debug-vs-llm.ts`: **16/16 (100%)** cho `LexIDE Debug (Lean Symbolic)` trong **44 ms** (3 ms/ca), **0 token**, `0` khung phạt đảo ngược.

---

## 2. Mục tiêu của Inference-time Distillation (ITD)

Thay vì fine-tune trọng số model (weight-level distillation), **ITD** chưng cất tri thức và lập luận của Teacher LLM (ví dụ `gemini-4-neon` hoặc frontier model) thành **4 kênh artifact thực thi tại inference time**:

1. **Deterministic Symbolic Rules (0 token):** Regex/AST extractors, canonical concept maps, vehicle/subject disambiguation, deontic conflict detectors, unit normalizers.
2. **Lean 4 Formal Invariants (0 token):** Các định lý/kiểm tra bất biến toán học (`min ≤ max`, interval continuity `LP003`/`LG002`, deontic consistency `PROHIBITED ∧ PERMITTED → ⊥`, workspace-only `AM005`).
3. **Decision-API Triage Gates (0 output token):** Dùng `gemini-decision-1` (`/v1beta/decisions`) cho các câu hỏi nhị phân/lựa chọn để lọc clause trước khi gọi structured extraction.
4. **Compact Structured Prompts / Mappers (low token):** Chỉ escalate lên `gemini-3.5-flash-lite` (`/v1/interactions` với strict JSON schema) khi tầng deterministic không đủ độ phủ (ví dụ paraphrase hoàn toàn mới), sau đó vẫn đưa kết quả qua bộ kiểm chứng Lean xác định.

**Nguyên tắc bất biến:**
- **Workspace-Only Grounding:** Tuyệt đối không viện dẫn luật ngoài `draft` + `workspaceFiles`.
- **Lean-Governed Verdict:** LLM chỉ trích xuất/ánh xạ (extract/map); phán quyết cuối cùng (`GUILTY_SANCTIONED`, `ACQUITTED_LOOPHOLE`, `CONFLICT_AMBIGUOUS`, `PARTIALLY_ENFORCEABLE`, `NOT_COVERED`) do tầng Lean/symbolic quyết định.

---

## 3. Bản đồ Codebase & Entrypoints

### A. Debug Luật (Tòa án AI)
- `web/src/lib/engine/debug.ts`: Entrypoint `runLocalDebugSimulation(input: DebugSimulationInput): Promise<DebugSimulationResult>`.
  - Gồm: `extractScenarioFacts`, `evaluateNumericMeasurements`, `evaluateMatchedClauses`, `evaluateClauseList`, `mapScenarioToClausesWithAi` (neuro-symbolic fallback), `refineVerdictWithAi`, `synthesizeVerdict`.
- `web/src/lib/engine/debug-matching.ts`:
  - `detectVehicleKind(text)` (`"CAR" | "MOTORBIKE" | "AUTONOMOUS" | null`)
  - `extractCanonicalConcepts(text)`
  - `scoreClauseMatch(...)`
  - `detectDeonticConflictInNodes(...)`
  - `findParentArticle(...)`
- `web/src/lib/engine/debug.test.ts`: Unit tests cho toàn bộ hành vi Debug.

### B. Analyzer, Parser, Intervals & Static Rules
- `web/src/lib/engine/analyzer.ts`: `analyzeLocalDraft(content, workspaceFiles, options)` — pipeline phân tích toàn văn bản.
- `web/src/lib/engine/parser.ts`: `parseDraftDocument`, `findNodeAtOffset`, `positionAtOffset`, `rangeFromOffsets`.
- `web/src/lib/engine/intervals.ts`: `extractFineRanges`, `extractNumericThresholds`, `UNIT_PATTERN`, `parseDecimal`, `normalizeUnit`.
- `web/src/lib/engine/rules-loophole.ts`: `analyzeLoopholes`, `ORG_CONVERSION_CLAUSE` (`LP001`–`LP007`).
- `web/src/lib/engine/rules-ambiguity.ts`: `analyzeAmbiguities` (`AM001`–`AM005`).
- `web/src/lib/engine/rules-logic.ts`: `analyzeLogic` (`LG001`–`LG017`).
- `web/src/lib/engine/lean-compiler.ts`: `compileDraftToLean` — sinh mã Lean 4 và kiểm chứng obligations.

### C. LLM & Incremental Cache
- `web/src/lib/engine/gemini-client.ts`:
  - `DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite"`
  - `GEMINI_DECISION_MODEL = "gemini-decision-1"`
  - `callGeminiStructuredInteraction(...)` (`/v1/interactions`)
  - `callGeminiDecisions(...)` (`/v1beta/decisions`)
- `web/src/lib/engine/llm-extract.ts`: Trích xuất fact có cấu trúc + Decision API triage.
- `web/src/lib/engine/llm-neurosymbolic.ts`: Pipeline Neuro-Symbolic v4 (`runNeuroSymbolicAudit`).
- `web/src/lib/engine/llm-incremental.ts`: `IncrementalLlmCache` (cache theo clause hash, 0 token khi không đổi).
- `web/src/lib/engine/llm-fix.ts`: Sinh bản sửa lỗi bằng AI (`generateAiFixForDiagnostic`).
- `web/src/lib/engine/types.ts`: Toàn bộ type contracts (`DebugSimulationResult`, `AnalysisResult`, `LegalDiagnostic`, `VerdictOutcome`, v.v.).

---

## 4. Benchmark & Baselines hiện có

Các script eval nằm trong `web/scripts/`:
- `web/scripts/eval-debug-vs-llm.ts` → xuất `data/eval/reports/debug-court-benchmark.json`
- `web/scripts/eval-neurosymbolic-v4.ts` → xuất `data/eval/reports/neurosymbolic-v4-benchmark.json`
- `web/scripts/eval-blhs-vs-llm.ts` → xuất `data/eval/reports/blhs-pipeline-vs-llm.json`
- `web/scripts/eval-zalo-vs-llm.ts` → xuất `data/eval/reports/zalo-pipeline-v3-vs-llm.json`
- `web/scripts/eval-lexide-cases.ts`

### Baseline Debug Luật (16 ca: 11 Core Traffic + 5 Extension/Hard)
| Contender | Outcome | Core | Extension | Defect Recall | Fine Accuracy | Inverted Fines | Latency | Tokens |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **LexIDE Debug (Trước ITD)** | 9/16 (56%) | 9/11 | 0/5 | 7/11 (64%) | 2/5 (40%) | 0 | 45 ms | 0 |
| **LexIDE Debug (Sau sửa 7 lỗi)** | **16/16 (100%)** | **11/11** | **5/5** | **11/11 (100%)** | **5/5 (100%)** | **0** | **44 ms** | **0** |
| **Live Pure `gemini-3.5-flash-lite` (API)** | 10/16 (63%) | 5/11 | 5/5 | 8/11 (73%) | 5/5 (100%) | 1 | 45.4 s | 17,502 |
| **Pure Flash-Lite (Blind)** | 11/16 (69%) | 7/11 | 4/5 | 7/11 (64%) | 5/5 (100%) | 2 | 10.0 s | 0 |
| **Pure Gemini 4 Neon (Blind)** | 16/16 (100%) | 11/11 | 5/5 | 11/11 (100%) | 5/5 (100%) | 0 | 163.0 s | 0 |

---

## 5. Kiến trúc ITD Harness đề xuất

Khi xây dựng harness tự động (ví dụ `web/scripts/itd-harness.ts` hoặc `scripts/itd/`):

1. **Phân tách dữ liệu nghiêm ngặt (Train / Dev / Held-Out Test):**
   - Không được tune rule chỉ để qua 16 ca trong `eval-debug-vs-llm.ts`.
   - Sinh hoặc tuyển chọn tập **Held-Out Test** độc lập (đa lĩnh vực: hình sự, lao động, thuế, đất đai, đấu thầu, dân sự, giao thông) để đo generalization thực sự.
2. **Teacher Trace Generation:**
   - Cho Teacher (frontier model) giải từng ca và xuất trace có cấu trúc: `{ matchedProvisionRefs, extractedFacts, legalReasoningSteps, expectedOutcome, expectedFine, expectedDefects }`.
3. **Failure Taxonomy & Routing sang 4 kênh ITD:**
   - *Thiếu đơn vị / pattern định lượng* → Kênh 1 (Symbolic: `intervals.ts`).
   - *Thiếu đồng nghĩa / phân tách chủ thể-phương tiện* → Kênh 1 (Symbolic: `debug-matching.ts`).
   - *Mâu thuẫn logic / đạo nghĩa / bất biến toán học* → Kênh 2 (Lean Invariants).
   - *Cần phân loại ngữ nghĩa nhị phân* → Kênh 3 (`gemini-decision-1`).
   - *Paraphrase tự do ngoài từ điển* → Kênh 4 (`gemini-3.5-flash-lite` compact mapper).
4. **Multi-Metric Pareto Acceptance Gate (bắt buộc trước khi nhận bản distill mới):**
   - Held-out Outcome Accuracy tăng hoặc không giảm.
   - `invalidInvertedFinesEmitted === 0`.
   - `workspaceOnly === true`.
   - Token trung bình & latency nằm trong ngưỡng cho phép.
   - Toàn bộ `cd web && bun test && bun run check && bun run build` **pass 100%**.

---

## 6. Các Blind Spots ưu tiên cao để Distill tiếp

1. **Tình huống đa vi phạm (Multi-violation):** Một tình huống thực hiện đồng thời 2–3 hành vi (ví dụ: vượt đèn đỏ + không mũ bảo hiểm + nồng độ cồn) → tổng hợp khung phạt / cộng dồn / nguyên tắc xử phạt.
2. **Chế tài phi tiền tệ & hình sự:** `phạt tù` (năm/tháng), `tù chung thân`, `tử hình`, `tịch thu tang vật`, `cải tạo không giam giữ` trong Debug simulation (hiện `applicableFine` chỉ có `{ min, max }` tiền).
3. **Liên kết sửa đổi / bãi bỏ xuyên văn bản trong Debug:** Khi `workspaceFiles` có văn bản mới sửa đổi/bãi bỏ một điều của `draft` (hoặc ngược lại).
4. **Đa lĩnh vực ngoài giao thông:** Thuế, Lao động, Đất đai, Đấu thầu, Xây dựng, Môi trường, Dân sự.
5. **Ngoại lệ lồng nhau & phủ định kép:** `"trừ trường hợp..."`, `"không áp dụng đối với..."`, hiệu lực theo thời gian (`ngày vi phạm` vs `ngày có hiệu lực`).
6. **Telemetry token usage trong `DebugSimulationResult`:** Bổ sung optional `tokenUsage?: GeminiUsage` vào `DebugSimulationResult` để harness đo chính xác chi phí token của chế độ `LEAN_PLUS_AI`.

---

## 7. Môi trường, Quy ước & Lưu ý quan trọng

- **Package manager & runtime:** Luôn dùng **Bun** (`bun test`, `bun run check`, `bun run build`, `bun run scripts/...`). Không dùng `npm`/`yarn`/`pnpm`.
- **AI Rules bắt buộc:** Đọc toàn bộ `docs/ai-rules/` trước khi sửa code (`4 spaces`, luôn dùng `{}` cho `if/for/while`, strict TypeScript không `any`, dòng trống trước `return`/`break`, Red → Green → Refactor).
- **Git:** Nếu đang ở nhánh `main`, **KHÔNG** commit hoặc push.
- **Bảo mật:** **KHÔNG** hardcode `GEMINI_API_KEY` vào bất kỳ file nào; luôn đọc từ `process.env.GEMINI_API_KEY`.
- **Gemini API Free Tier quirk:** Model `gemini-4-neon` trả về `429` (`limit: 0 input tokens per minute`) trên Free Tier key; `gemini-3.5-flash-lite` và `gemini-decision-1` hoạt động bình thường trên Free Tier.
