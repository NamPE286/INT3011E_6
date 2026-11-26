# Handoff Kỹ thuật: ITD Harness v4 & Khắc phục 19 Test Backend (OpenAI → Gemini Migration)

**Ngày bàn giao:** 2026-11-26  
**Nhánh Git:** `main` (chưa commit / chưa push — giữ đúng quy tắc `docs/ai-rules/workflow.md`)  
**Tài liệu liên quan:**
- Báo cáo ITD Harness v3 & Benchmark đầy đủ: [docs/itd-harness-report.md](file:///Users/nambh/Desktop/uni/INT3011E_6/docs/itd-harness-report.md)
- Dữ liệu benchmark hợp nhất: [data/eval/reports/itd-harness-benchmark.json](file:///Users/nambh/Desktop/uni/INT3011E_6/data/eval/reports/itd-harness-benchmark.json)
- Đặc tả handoff ban đầu: [docs/itd-harness-handoff.md](file:///Users/nambh/Desktop/uni/INT3011E_6/docs/itd-harness-handoff.md)

---

## 1. Trạng thái Triển khai (Production Deployments Hiện tại)

Cả Frontend và Backend đều đã được deploy lên Cloudflare Workers (`Nambuihung654@gmail.com's Account`):

| Thành phần | Worker Name | URL Live | Version ID | Trạng thái Kiểm định |
| :--- | :--- | :--- | :--- | :--- |
| **Frontend (LexIDE + ITD v3)** | `int3011e-web` | https://int3011e-web.nampe.workers.dev | `a6f67e40-a28c-41fc-a83c-1d59a853b9d7` | `bun test`: **177/177 pass**, `bun run check`: **0 errors**, `bun run build`: **PASS**, HTTP `200` |
| **Backend (Elysia + D1/R2/Queue)** | `int3011e-backend` | https://int3011e-backend.nampe.workers.dev | `aa375467-4675-4909-8492-42bf1a3d72e9` | `tsc --noEmit`: **0 errors**, D1 remote migrations: **Up to date**, `bun test`: **320 pass / 19 fail** *(cần sửa ở mục 2)* |

---

## 2. Nhiệm vụ Ưu tiên 1 — Sửa 19 Test Backend đang Fail (Root Cause đã định vị chính xác)

### 2.1 Nguyên nhân gốc rễ
Trước phiên ITD, một đợt di trú trong `backend/` đã chuyển lớp gọi LLM ở [openai-json.ts](file:///Users/nambh/Desktop/uni/INT3011E_6/backend/src/modules/llm/openai-json.ts) và [models.ts](file:///Users/nambh/Desktop/uni/INT3011E_6/backend/src/modules/llm/models.ts) từ **OpenAI Responses API** sang **Gemini Interactions API (`v1/interactions`)** + **Decisions API (`v1beta/decisions`)**:
- Request mới gửi header `x-goog-api-key`, `system_instruction`, `input` (string hoặc array), `response_format`, và danh sách model cho phép trong `SELECTABLE_MODELS` là `["gemini-3.5-flash-lite", "gemini-4-hydrogen", "gemini-3.1-flash-lite"]`.
- `readOutputText()` trong [openai-json.ts](file:///Users/nambh/Desktop/uni/INT3011E_6/backend/src/modules/llm/openai-json.ts) hiện đọc response theo cấu trúc Gemini `{ steps: [{ type: "model_output", content: [{ type: "text", text }] }] }` (hoặc `output_text`), **không còn đọc** cấu trúc OpenAI `{ output: [{ type: "message", content: [{ type: "output_text", text }] }] }`.

Trong khi đó, 5 tệp test + 3 route/service backend chưa được cập nhật đồng bộ:

### 2.2 Danh sách tệp cần sửa
1. **Test Mocks trả sai format OpenAI thay vì Gemini Interactions (gây ra 18/19 lỗi):**
   - [backend/test/fake-law.ts](file:///Users/nambh/Desktop/uni/INT3011E_6/backend/test/fake-law.ts) (dòng ~88, ~97): Mock response vẫn trả `{ output: [{ type: "message", content: [{ type: "output_text", text }] }] }` và đọc request theo định dạng OpenAI; kiểm tra cả cách parse request body (`body.input` dạng string vs array) và biến env `GEMINI_API_KEY` / `OPENAI_API_KEY` (gây fail 13 test trong [fake-law-e2e.test.ts](file:///Users/nambh/Desktop/uni/INT3011E_6/backend/test/fake-law-e2e.test.ts) và 1 test trong [graph.test.ts](file:///Users/nambh/Desktop/uni/INT3011E_6/backend/test/graph.test.ts)).
   - [backend/test/violation-rules.test.ts](file:///Users/nambh/Desktop/uni/INT3011E_6/backend/test/violation-rules.test.ts) (dòng ~45): Mock response trả format OpenAI `output_text` và đọc `body.input` theo kiểu mảng OpenAI thay vì string Gemini (`requestStructuredJson` gửi `input: request.userText`).
   - [backend/test/ask.test.ts](file:///Users/nambh/Desktop/uni/INT3011E_6/backend/test/ask.test.ts) (dòng ~44, ~194, ~340–353):
     - Dòng 44 & 194: Mock response vẫn dùng format OpenAI `output_text`.
     - Dòng 346 & 353: Gửi `model: "gpt-6-luna"` không còn nằm trong `SELECTABLE_MODELS` → HTTP `400` thay vì `200` (cần đổi sang `"gemini-4-hydrogen"` hoặc model hợp lệ trong `SELECTABLE_MODELS`, đồng thời giữ nguyên test reject model không hợp lệ ở [models.test.ts](file:///Users/nambh/Desktop/uni/INT3011E_6/backend/test/models.test.ts)).
   - [backend/test/identity.test.ts](file:///Users/nambh/Desktop/uni/INT3011E_6/backend/test/identity.test.ts) (dòng ~141): Mock response trả format OpenAI `output_text`.
   - Kiểm tra [backend/test/openai-fake.ts](file:///Users/nambh/Desktop/uni/INT3011E_6/backend/test/openai-fake.ts) (đã được cập nhật một phần sang Gemini) để dùng chung helper `geminiInteractionResponse(...)` / `readInteractionUserText(...)` cho sạch sẽ và tránh lặp code!
2. **Route & Service đọc `GEMINI_API_KEY` / `GEMINI_MODEL` nhất quán với fallback `OPENAI_API_KEY`:**
   - [backend/src/modules/ask/ask.route.ts](file:///Users/nambh/Desktop/uni/INT3011E_6/backend/src/modules/ask/ask.route.ts) (dòng ~35, ~43): Đang đọc `env.OPENAI_MODEL` và `env.OPENAI_API_KEY`; cần ưu tiên `env.GEMINI_API_KEY ?? env.OPENAI_API_KEY` và `env.GEMINI_MODEL ?? env.OPENAI_MODEL` (cùng kiểm tra `env.d.ts` / [backend/src/types/env.ts](file:///Users/nambh/Desktop/uni/INT3011E_6/backend/src/types/env.ts)).
   - [backend/src/modules/identity/identity.route.ts](file:///Users/nambh/Desktop/uni/INT3011E_6/backend/src/modules/identity/identity.route.ts) (dòng ~101) & [backend/src/modules/violations/violation.route.ts](file:///Users/nambh/Desktop/uni/INT3011E_6/backend/src/modules/violations/violation.route.ts) (dòng ~47): Đồng bộ cách lấy `apiKey` & `model` tương tự [legal-llm.service.ts](file:///Users/nambh/Desktop/uni/INT3011E_6/backend/src/modules/processing/legal-llm.service.ts).
   - Kiểm tra `backend/test/processing.test.ts` (hiện đang pass, đảm bảo không làm vỡ bất kỳ test nào khi đồng bộ `GEMINI_API_KEY`).

### 2.3 Tiêu chí hoàn thành Mục 2
- `cd backend && bun test` đạt **339/339 pass (0 fail)**.
- `cd backend && bun run typecheck` đạt **0 errors**.
- Sau khi toàn bộ test xanh, chạy `cd backend && bunx wrangler deploy --dry-run` và deploy lại `int3011e-backend` (nếu người dùng yêu cầu deploy).

---

## 3. Nhiệm vụ Ưu tiên 2 — Cải tiến ITD Harness lên `v4` (`web/`)

### 3.1 Điểm chuẩn `v3` đã đóng băng (KHÔNG được thụt lùi)
- **Dev Set (66 ca):** `Soft Score = 99.17/100` | Loophole F1 `100.0%` (`9/9` sạch) | VerdictAcc `100.0%` | DefectRec `91.7%` (`11/12`) | Consistency `4/4` | Abstention `100.0%` | P95 `11 ms` (API) / `2 ms` (Det)
- **Sealed Blind Test (44 ca — TUYỆT ĐỐI KHÔNG đọc log lỗi Blind Test!):** `Soft Score = 96.79/100` (`96.79%` of Teacher `100.00`) | Loophole F1 `100.0%` (`6/6` sạch) | VerdictAcc `89.3%` (`25/28`) | OutcomeAcc `92.9%` (`26/28`) | FineAcc `88.2%` (`15/17`) | NonMonAcc `100.0%` | DefectRec `100.0%` | Consistency `3/3` | Abstention `100.0%` | P95 `23 ms` (API) | Cost `\$0.0000087/req` (**3,023.8×** rẻ hơn Teacher)
- **16-Case Regression Anchor:** `16/16 (100%)`, `invalidInvertedFinesEmitted === 0`.

### 3.2 Các hạng mục cải tiến cụ thể cho `v4`
1. **Fix `JG-DEV-MV04` Defect Recall (`91.7% → 100.0%`, đưa Dev Soft Score lên `100.00/100`):**
   - Trong [web/src/lib/engine/debug.ts](file:///Users/nambh/Desktop/uni/INT3011E_6/web/src/lib/engine/debug.ts), khi tình huống đa vi phạm có 1 hành vi hợp lệ + 1 hành vi rơi vào lệnh cấm không chế tài (`LP002`), đảm bảo `verdict.exploitedDefects` ghi nhận cả `LP002` thay vì chỉ dừng lại ở `AM005` của điều khoản phạt đầu tiên.
2. **Nâng Live Judge tổng quát hóa trên lĩnh vực mới bằng Kênh 3 `gemini-decision-1` (`missed_secondary_violation` & `paraphrase_escalation`):**
   - Hiện tại [debug.ts](file:///Users/nambh/Desktop/uni/INT3011E_6/web/src/lib/engine/debug.ts) chỉ kích hoạt Kênh 3 (`gemini-decision-1`) + Kênh 4 (`gemini-3.5-flash-lite` mapper) khi Tier 0+1 khớp **0 điều khoản** (`NOT_COVERED`).
   - Trên hợp đồng/lĩnh vực chưa từng thấy, khi kịch bản chứa liên từ đa hành vi (`"vừa ... vừa ..."`, `"đồng thời"`, `"cùng lúc"`, `"và"`) nhưng Tier 0+1 chỉ bắt được 1 điều khoản, hoặc khi số liệu/chủ thể tổ chức/bên bán/nhà thầu bị diễn đạt khác, thêm 1 câu hỏi `noul` đơn qua `gemini-decision-1` (0 output token, ~330 ms, **nhớ KHÔNG truyền tham số `criteria` trên `type: "noul"` vì `v1beta/decisions` trả HTTP 400!**) để phát hiện bỏ sót điều khoản phụ và chỉ gọi Kênh 4 khi xác suất cao (`noul >= 0.72 && confidence >= 0.75`).
   - Đảm bảo P95 Live Judge vẫn thấp hơn rất nhiều so với Hard Gate `<= 2,500 ms` và chi phí vẫn rẻ hơn Teacher `>= 10×`.
3. **Tích hợp `runItdLoopholeDetector` / `runItdLiveJudge` vào luồng giao diện LexIDE (`web/`):**
   - Kiểm tra [web/src/lib/api/ide.ts](file:///Users/nambh/Desktop/uni/INT3011E_6/web/src/lib/api/ide.ts) và các component IDE (`web/src/lib/components/ide/`) để hiển thị rõ `nonMonetarySanctions` (phạt tù, tịch thu...), `citations` nguyên văn có kiểm chứng regex, `abstained` badge khi `CONFLICT_AMBIGUOUS`, và `tokenUsage` / `llmCalls` trên Status Bar.
   - Bổ sung unit tests trong [web/src/lib/engine/itd-distilled.test.ts](file:///Users/nambh/Desktop/uni/INT3011E_6/web/src/lib/engine/itd-distilled.test.ts) cho mọi hành vi mới.
4. **Quy tắc Chống Gian lận & Pareto Acceptance Gate (BẮT BUỘC):**
   - **TUYỆT ĐỐI KHÔNG đọc log lỗi trên Blind Test Set** (`web/scripts/itd/judge-blind-dataset.ts` / `loophole-dataset.ts` phần `blind_test`). Chỉ phân tích log lỗi trên Dev Set và kiểm tra điểm tổng hợp trên Blind Test sau khi hoàn tất code `v4`.
   - Mọi bản `v4` chỉ được chấp nhận khi qua **Pareto Acceptance Gate**: `blindTest.softScore >= 96.79` (không thụt lùi so với `v3`), `hardGates.passed === true`, `invalidInvertedFinesEmitted === 0`, `workspaceOnly === true`, `eval-debug-vs-llm.ts` giữ `16/16`, `cd web && bun test && bun run check && bun run build` PASS 100%, và `0` API key bị hardcode.

---

## 4. Prompt Sẵn dùng cho Agent Tiếp theo (Copy-Paste trực tiếp)

```markdown
Đọc kỹ toàn bộ `docs/ai-rules/*`, `docs/itd-v4-and-backend-handoff.md`, và `docs/itd-harness-report.md` trước khi sửa bất kỳ dòng code nào.

Nhiệm vụ gồm 2 phần thực hiện tuần tự với kiểm định chặt chẽ (dùng Bun, không hardcode API key, không commit/push trên nhánh `main`):

### Phần 1: Sửa dứt điểm 19 test Backend đang fail (OpenAI → Gemini migration)
1. Kiểm tra `backend/src/modules/llm/openai-json.ts`, `backend/src/modules/llm/models.ts`, `backend/test/openai-fake.ts` và 5 file test đang fail (`backend/test/fake-law.ts`, `backend/test/violation-rules.test.ts`, `backend/test/ask.test.ts`, `backend/test/identity.test.ts`, `backend/test/graph.test.ts`).
2. Đồng bộ hóa test mocks từ format OpenAI Responses (`output[].content[].output_text`, `gpt-6-luna`) sang format Gemini Interactions (`steps[].content[].text` / `output_text`, `SELECTABLE_MODELS` như `gemini-4-hydrogen`), tái sử dụng helper dùng chung trong `backend/test/openai-fake.ts` nếu hợp lý.
3. Đồng bộ `backend/src/modules/ask/ask.route.ts`, `backend/src/modules/identity/identity.route.ts`, và `backend/src/modules/violations/violation.route.ts` để đọc `env.GEMINI_API_KEY ?? env.OPENAI_API_KEY` và `env.GEMINI_MODEL ?? env.OPENAI_MODEL` nhất quán với `legal-llm.service.ts` (không phá vỡ tương thích ngược của các test truyền `OPENAI_API_KEY`).
4. Yêu cầu bắt buộc Phần 1: `cd backend && bun test` đạt **100% pass (0 fail)** và `cd backend && bun run typecheck` **0 errors**.

### Phần 2: Cải tiến ITD Harness lên `v4` (`web/`) & Tích hợp UI LexIDE
1. Sửa `JG-DEV-MV04` trong `web/src/lib/engine/debug.ts` để ghi nhận đầy đủ mã lỗi `LP002` song song `AM005` trong kịch bản đa vi phạm (`PARTIALLY_ENFORCEABLE`), đưa Dev `DefectRecall` lên `100%` (`Dev Soft Score = 100.00`).
2. Nâng cấp Kênh 3 (`gemini-decision-1` — lưu ý KHÔNG truyền trường `criteria` trong `type: "noul"` vì API `v1beta/decisions` trả HTTP 400) + Kênh 4 (`gemini-3.5-flash-lite`) trong `web/src/lib/engine/debug.ts` & `itd-harness.ts` để hỗ trợ phát hiện bỏ sót điều khoản phụ trong tình huống đa hành vi và đồng nghĩa mới ngoài tập từ điển tĩnh, giữ nguyên `Live Judge P95 <= 2,500 ms` và `0%` hallucinated citations.
3. Tích hợp hiển thị các trường mới của ITD v3/v4 (`nonMonetarySanctions`, `citations` nguyên văn, cờ `abstained`, `tokenUsage`) một cách gọn gàng vào giao diện LexIDE Debug (`web/src/lib/components/ide/`).
4. Viết unit tests bổ sung trong `web/src/lib/engine/itd-distilled.test.ts`.
5. **Chống gian lận bắt buộc:** TUYỆT ĐỐI KHÔNG đọc log lỗi hay nội dung ca lỗi trên Blind Test Set. Chỉ tinh chỉnh dựa trên Dev Set, sau đó chạy kiểm chứng tổng hợp qua:
   - `cd web && bun run scripts/itd/compile-final-benchmark.ts`
   - `cd web && bun run scripts/eval-debug-vs-llm.ts`
   - `cd web && bun test && bun run check && bun run build`
   Chứng minh `v4` đạt **Pareto Acceptance Gate** (`blindTest.softScore >= 96.79`, 100% Hard Gates, 16/16 regression anchor, 0 API key cứng).

### Phần 3: Kiểm định & Deploy (sau khi toàn bộ test cả backend lẫn web đều xanh 100%)
- Chạy `wrangler deploy --dry-run` cho cả `backend` và `web`, sau đó deploy bản đã kiểm định lên `int3011e-backend` và `int3011e-web`, smoke test `/health`, `/api/dummy`, và trang web chính, rồi cập nhật báo cáo kết quả cuối cùng trong `docs/itd-harness-report.md`.
```
