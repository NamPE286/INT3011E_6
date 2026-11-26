# Đối chiếu SRS v2.0 với mã nguồn

Cập nhật ngày 26/11/2026 trên cơ sở **SRS v2.0** (Soạn Luật Studio & LexIDE — Local-First Legislative Drafting, Neuro-Symbolic Logic Auditing & Impact Scope Analysis).

**Kết luận:** Các trụ cột cốt lõi của bài toán **Soạn thảo luật + Soát logic luật + Phân tích phạm vi tác động** đã được triển khai end-to-end (Better Auth, đa Workspace cô lập, bàn soạn thảo Chương/Mục/Điều/Khoản/Điểm, bộ máy soát logic 16 quy tắc tất định, bộ máy phân tích phạm vi tác động trực tiếp & dây chuyền đa tầng, lược đồ 2 chế độ, pipeline AI đọc PDF + 6 bước tiền xử lý và trợ lý AI dẫn nguồn). Các phần còn mở nằm ở nâng cao hệ thống: acquisition tự động từ VBPL (FR-02), bảo vệ auth cho các endpoint `/api/uploads`/`/api/jobs*`, chỉ mục FTS5 (FR-19), nhập nhiều phần/phụ lục trong một job và bộ đánh giá held-out (#29).

Ký hiệu: ✅ đạt · 🟡 một phần · ❌ chưa có.

## Functional requirements

| FR | Trạng thái | Ghi chú |
| --- | --- | --- |
| FR-01 Import PDF | 🟡 | Upload 1 file PDF, validate, dedup theo `(workspace_id, pdf_sha256)`, R2 snapshot, queue, LLM đọc theo cụm trang, checkpoint/retry, review. Thiếu: nhiều phần/phụ lục trong một job và khóa auth bắt buộc cho `/api/uploads`/`/api/jobs*`. |
| FR-02 Corpus discovery | ❌ | Có `frontier` (số hiệu được trích dẫn nhưng chưa có trong Workspace, hiển thị cả ở Document Relations và Impact Scope) nhưng chưa tự acquire/reverse search từ VBPL. |
| FR-03 Document graph | ✅ | Candidate + evidence, resolver theo số hiệu/loại, cạnh `ACCEPTED` tách khỏi candidate, cô lập theo `workspace_id`. |
| FR-04 Provision segmentation | ✅ | Điều/Khoản/Điểm, nội dung trích dẫn trong lệnh sửa đổi tách riêng. |
| FR-05 Relevance | ✅ | Deterministic theo nội dung. |
| FR-06 ChangeInstruction | ✅ | Sửa đổi/bổ sung/bãi bỏ/thay thế, locator, ngày hiệu lực. |
| FR-07 ProvisionRelation | ✅ | Cùng/khác văn bản, hỗ trợ cả nguồn AI và nối thủ công (`sourceMode`), cập nhật tăng dần. |
| FR-08 / 08.1 Violation extraction | ✅ | Deterministic + LLM theo vocabulary (`get_vocab_snapshot` → `add_vocab`). |
| FR-09 Sanction | ✅ | Tiền phạt, `point_deduction_applicability`, `SanctionEffect` có kiểu (tước GPLX, trừ điểm, tịch thu). |
| FR-10 Identity | ✅ | Deterministic + LLM khi `AMBIGUOUS`; không gộp context khác nhau. |
| FR-11 History | ✅ | Lineage theo context, chuỗi rule qua `ProvisionRelation`. |
| FR-12 Current / as-of | ✅ | Trả mức phạt theo mốc ngày; `UNCERTAIN` khi thiếu evidence. |
| FR-13 Semantic change | ✅ | `change_events`; F1 = 1,0 trên dev set (deterministic). |
| FR-14 Document search | ✅ | Không dùng LLM; cô lập theo `workspace_id`. |
| FR-15 Document view | ✅ | Hai tab **Nội dung** + **Quan hệ**, mục lục Điều, highlight phần bị sửa/bãi bỏ, kèm nút mở nhanh sang `/audit` và `/drafting`. |
| FR-16.1 Manual search | 🟡 | Khớp theo từ trên tên/alias; chưa có FTS trên toàn văn provision. |
| FR-16.2 / 16.3 AI chat + references | 🟡 | `/api/ask`: claim → evidence, hiện hành + lịch sử, dẫn nguồn tới Provision. Chưa có rate limit và bộ QA held-out (#29). |
| FR-17 Violation detail | ✅ | Hiển thị mức phạt hiện hành và theo mốc thời gian. |
| FR-18 Violation history | ✅ | Hiển thị timeline lineage và biến động chế tài. |
| FR-19 Search index | ❌ | Chưa có index FTS5; tìm bằng truy vấn SQL/lọc trong bộ nhớ. |
| FR-20 AI provenance | ✅ | `ExtractionRun` ghi model/prompt/vocabulary version; câu trả lời có `provenance`. |
| FR-21 Auth & Multi-Workspace | ✅ | Better Auth (`email + password`), cookie phiên, CRUD Workspace độc lập, kiểm tra quyền sở hữu server-side (`401`/`403`), tự seed Workspace mẫu kèm NĐ 100/123/168, TT 73/2024 và Dự thảo 2026. |
| FR-22 Structured Drafting Studio | ✅ | `/drafting` + `/api/manual/*`: tạo/sửa/xóa văn bản & metadata/ngày hiệu lực, chèn/sửa/xóa cây Chương/Mục/Điều/Khoản/Điểm, xem trước bản thể thức và làm mới soát logic/tác động live. |
| FR-23 Soát logic luật | ✅ | `backend/src/modules/analysis/logic-audit.ts`, `GET /api/documents/:id/audit`, `GET /api/workspace/audit-summary`, `LogicAuditPanel.svelte`, tích hợp trong `/drafting` (nhảy thẳng về điều khoản lỗi) và `/audit`. Đủ 16 quy tắc tất định thuộc 5 nhóm. |
| FR-24 Phân tích phạm vi tác động | ✅ | `backend/src/modules/analysis/impact-scope.ts`, `GET /api/documents/:id/impact?max_depth=1..5`, `ImpactScopePanel.svelte`, tích hợp trong `/drafting` và `/audit`: tác động trực tiếp tầng 1, lan truyền dây chuyền đa tầng (BFS), điều khoản bị tác động, biến động chế tài, nhóm đối tượng, `unresolvedFrontier` và danh mục khuyến nghị đồng bộ hóa. |
| FR-25 Lược đồ tác động 2 chế độ | ✅ | `/graph` + `GET /api/graph`: Chế độ 1 (Biến động mức xử lý) & Chế độ 2 (Ảnh hưởng văn bản/điều khoản), hợp nhất cạnh AI + thủ công và hỗ trợ nối/xóa cạnh thủ công. |
| FR-26 LexIDE Local-First IDE | ✅ | `/` (`web/src/routes/+page.svelte`): khởi đầu Workspace trống, chọn thư mục máy hoặc nạp bộ dự thảo mẫu 10 tệp (`sample-workspace.ts`), chạy 100% cục bộ trên trình duyệt. |
| FR-27 Neuro-Symbolic & Lean 4 | ✅ | `analyzer.ts`, `lean-compiler.ts`, `llm-neurosymbolic.ts`: Tầng 0 tất định (0 token) + Lean 4 + Gemini Decisions/Interactions API có Anti-Hallucination Gate. |
| FR-28 Tự động đẩy số & Sửa bằng AI | ✅ | `ide-numbering.ts` + `ide-intellisense.ts` + `LawEditor.svelte` tự động đẩy số `Điều`/`Khoản`/`Điểm`; `llm-fix.ts` cung cấp nút **Sửa bằng AI** trên mọi lỗi ở Problems, Inspector và Hover Tooltip. |
| FR-29 Lược đồ, Hành vi & Token Bar | ✅ | Icon chỉ báo hành vi gọn (`✦` / `⚖ N`) bấm để mở & highlight trong `BehaviorsPanel.svelte`; `IdeStatusBar.svelte` hiển thị Token Usage phiên làm việc. |
| FR-30 Run & Debug & Xuất DOCX/PDF | ✅ | `debug.ts` (Tòa án giả lập `F5`) và `export.ts` (DOCX/PDF Times New Roman chuẩn Nghị định 30/2020/NĐ-CP) chạy cục bộ. |

## Non-functional và hệ thống

| Mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Auth & Workspace Isolation (§5.7) | 🟡 | Better Auth + kiểm tra chủ sở hữu Workspace hoạt động đầy đủ cho `/api/workspaces/*`, `/api/manual/*`, `/api/documents/*`, `/api/graph`, `/api/workspace/audit-summary`. Các route admin upload/job (`/api/uploads`, `/api/jobs*`) vẫn cần khóa phân quyền Admin ở vòng sau. |
| NFR-01/02 Traceability, explainability | ✅ | Mọi lỗi logic, chuỗi tác động dây chuyền, rule và cạnh đều dẫn nguồn về Provision/Document cụ thể. |
| NFR-03 Reproducibility | ✅ | Bộ máy soát logic & phạm vi tác động là pure function tất định 100%; AI extraction lưu provenance run. |
| NFR-06 Data consistency | 🟡 | Dedup PDF theo `(workspace_id, pdf_sha256)`; kiểm tra chu trình & sửa văn bản đã bãi bỏ trong Logic Audit. Khác hash cùng số hiệu chưa tự gộp. |
| NFR-08 Observability | 🟡 | Log JSON theo job/stage, checklist preprocessing, tổng quan lỗi/rủi ro toàn Workspace. |
| §14–15 Evaluation, baselines | 🟡 | Dev set + baseline cho preprocessing và `/api/ask`; thiếu bộ held-out QA và benchmark soát logic trên dự thảo thật (#29). |

## Acceptance criteria (§16)

- **Đạt:** 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 19, 20, 21, 22, 23, 24, 30, 31, 32, **33, 34, 35, 36, 37, 38**.
- **Một phần:** 1 (chưa khóa auth riêng cho `/api/uploads`), 16–18 (chạy được, chưa có held-out QA), 25 (cùng hash đã đạt theo Workspace; khác hash cùng số hiệu chưa), 27.
- **Chưa đạt:** 2 (acquisition tự động VBPL), 26, 28, 29 (held-out evaluation).

## Kiểm thử tự động hiện tại

- **Backend:** `cd backend && bun test && bun run typecheck` → **324 pass, 0 fail** (36 file, gồm `test/analysis.test.ts` kiểm thử 16 quy tắc soát logic, lan truyền tác động đa tầng và API theo Workspace; `test/auth-workspace-manual.test.ts` kiểm thử Better Auth, cô lập Workspace và soạn thảo thủ công).
- **Frontend:** `cd web && bun test && bun run check && bun run build` → **92 pass, 0 fail** (14 file, gồm `src/lib/api/analysis.test.ts`), `svelte-check` 0 errors / 0 warnings, production build Cloudflare Workers thành công.
