# Đối chiếu SRS với mã nguồn

Kiểm tra ngày 02/11/2026 trên nhánh `claude/feat/relation-graph` (SRS v0.12). Căn cứ: đọc mã, `bun test` (backend 312 test, web 80 test), `bun run eval` (dev set), bộ end-to-end trên luật giả `data/fake-law` (`backend/test/fake-law-e2e.test.ts`, LLM giả) và một lần chạy pipeline với OpenAI thật (mục cuối).

**Kết luận:** SRS **chưa được triển khai đầy đủ**. Lõi xử lý (đọc PDF → provision → graph văn bản → ChangeInstruction/ProvisionRelation → ViolationRule/Sanction → identity → lineage/as-of → change events) và các trang tra cứu chạy được end-to-end, cả với LLM thật; 7 lỗi tìm thấy đã sửa (bên dưới). Còn thiếu: xác thực Admin, acquisition/discovery tự động (FR-02), search index (FR-19), import nhiều phần/phụ lục và đánh giá held-out/QA (#29).

Ký hiệu: ✅ đạt · 🟡 một phần · ❌ chưa có.

## Functional requirements

| FR | Trạng thái | Ghi chú |
| --- | --- | --- |
| FR-01 Import PDF | 🟡 | Upload 1 file, validate, dedup theo SHA-256 (D3), R2 snapshot, queue, LLM đọc theo cụm trang, checkpoint/retry, review. Thiếu: nhiều phần/phụ lục trong một import, metadata khai báo, trạng thái READY/PARTIAL theo SRS, xác thực Admin. Route vẫn là `/api/uploads`, chưa phải `/admin/imports`. |
| FR-02 Corpus discovery | ❌ | Có frontier (số hiệu được trích dẫn nhưng chưa nhập) nhưng không acquire/reverse search tự động. |
| FR-03 Document graph | ✅ | Candidate + evidence, resolver theo số hiệu/loại, cạnh ACCEPTED tách khỏi candidate, coverage/frontier. |
| FR-04 Provision segmentation | ✅ | Điều/Khoản/Điểm, nội dung trích dẫn trong lệnh sửa đổi tách riêng. |
| FR-05 Relevance | ✅ | Deterministic theo nội dung. |
| FR-06 ChangeInstruction | ✅ | Sửa đổi/bổ sung/bãi bỏ/thay thế, locator, ngày hiệu lực. |
| FR-07 ProvisionRelation | ✅ | Cùng/khác văn bản, cập nhật khi nhập theo thứ tự ngược (đã kiểm tra e2e). |
| FR-08 / 08.1 Violation extraction | ✅ | Deterministic + LLM theo vocabulary (`get_vocab_snapshot` → `add_vocab`); D2, L3 đã sửa. |
| FR-09 Sanction | ✅ | Tiền phạt, `point_deduction_applicability`, SanctionEffect có kiểu (tước GPLX, trừ điểm, tịch thu). |
| FR-10 Identity | ✅ | Deterministic + LLM khi AMBIGUOUS; không gộp context khác nhau. |
| FR-11 History | ✅ | Lineage theo context, chuỗi rule qua ProvisionRelation. |
| FR-12 Current / as-of | ✅ | Đã kiểm tra e2e: mức phạt cũ trước ngày hiệu lực, mức mới sau; điểm bị bãi bỏ hết áp dụng. UNCERTAIN khi thiếu evidence. |
| FR-13 Semantic change | ✅ | Change events; F1 = 1,0 trên dev set (deterministic). |
| FR-14 Document search | ✅ | Không dùng LLM; xếp hạng số hiệu đã sửa (D1). |
| FR-15 Document view | 🟡 | Nội dung + Quan hệ, đánh dấu phần bị tác động. Trang có **3** tab (thêm "Hành vi vi phạm") trong khi AC 13 yêu cầu đúng 2. Đồ thị quan hệ: trang `/graph` (#61). |
| FR-16.1 Manual search | 🟡 | Khớp theo từ trên tên/alias (D4 đã sửa); chưa tìm trên toàn văn provision. |
| FR-16.2 / 16.3 AI chat + references | 🟡 | `/api/ask`: claim → evidence, hiện hành + lịch sử (L1), retrieval theo từ rồi model chọn trong danh mục (L2). Chưa có rate limit/xác thực, chưa có bộ QA held-out. |
| FR-17 Violation detail | ✅ | |
| FR-18 Violation history | ✅ | |
| FR-19 Search index | ❌ | Chưa có index FTS/projection; tìm bằng quét bảng. |
| FR-20 AI provenance | ✅ | ExtractionRun ghi model/prompt/vocabulary version; câu trả lời có `provenance`. |

## Non-functional và hệ thống

| Mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Authorization Admin (§5.7) | ❌ | `authPlugin` vẫn trả `user: null`; mọi endpoint ghi đều mở (TODO #4). |
| NFR-01/02 Traceability, explainability | ✅ | Mọi rule/cạnh có provision nguồn và evidence. |
| NFR-03 Reproducibility | 🟡 | Run provenance có; chưa có generation/publish. |
| NFR-06 Data consistency | 🟡 | Nhập trùng cùng hash đã chặn (D3); khác hash cùng legal identity chưa gộp. |
| NFR-08 Observability | 🟡 | Log JSON theo job/stage, checklist preprocessing; chưa có metric thời gian/queue. |
| §14–15 Evaluation, baselines | 🟡 | Dev set + baseline cho preprocessing; thiếu held-out, retrieval/QA và end-to-end metric (#29). |

## Acceptance criteria (§16)

Đạt: 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 19, 20, 21, 22, 23, 24 (mức rule), 30, 31, 32. Một phần: 1 (chưa xác thực Admin), 13 (3 tab), 16–18 (chạy được, chưa có bộ đánh giá), 25 (cùng hash đã đạt; khác hash cùng số hiệu chưa), 27. Chưa đạt: 2, 26, 28, 29.

## Lỗi phát hiện khi kiểm thử — đã sửa

D1–D4 tìm thấy bằng bộ e2e trên luật giả; L1–L3 tìm thấy khi chạy pipeline với OpenAI thật (`gpt-5-mini`). Mỗi lỗi có test hồi quy.

| # | Lỗi | Sửa | Test |
| --- | --- | --- | --- |
| D3 | Upload lại cùng PDF tạo văn bản trùng; số hiệu trùng làm mất **toàn bộ** quan hệ tới văn bản đó (AC 25, NFR-06). | `processing_jobs.pdf_sha256` (unique, migration 0013); upload trùng nội dung trả job cũ với `duplicate: true`, giao diện admin báo "đã nhập trước đó". Lỗi enqueue xóa cả job, không chỉ snapshot. | `upload.test.ts`, `fake-law-e2e.test.ts` |
| D1 | Tìm `01/2030` xếp văn bản *trích dẫn* số hiệu lên đầu; số hiệu viết tắt/có gạch nối không khớp chính văn bản. | `queryCitesNumber`: tách số hiệu khỏi truy vấn, khớp đầy đủ hoặc theo tiền tố. | `document-number-match.test.ts` |
| D2 | Dấu `”.` của nội dung trích dẫn lọt vào hành vi/alias. | `cleanRuleText` bỏ dấu đóng kèm dấu câu sau nó. | `rule-text.test.ts` |
| D4 | Tìm hành vi chỉ khớp chuỗi liền ("đỗ xe ngoài đô thị" không ra). | Khớp từng từ nguyên vẹn trong cùng alias, cụm liền xếp trước (FR-16.1). Vẫn chưa có index FTS (FR-19). | `fake-law-e2e.test.ts` |
| L1 | Hỏi "trước đây thế nào" → AI nói không có thông tin: evidence chỉ có rule đang áp dụng. | Evidence thêm rule đã hết hiệu lực của cùng lineage (`earlier`); trạng thái chỉ tính theo rule tại ngày hỏi; rule bị bãi bỏ không có thay thế → `UNCERTAIN`. Prompt `grounded-answer-v2`. | `ask.test.ts`, `fake-law-e2e.test.ts` |
| L2 | "Vượt đèn đỏ phạt bao nhiêu?" → `NO_ANSWER` (ví dụ demo SRS 12.4). | Khi khớp từ không ra và có model: model chỉ *chọn* trong danh mục hành vi đã lưu, id ngoài danh mục bị bỏ; `provenance.retrievalMethod`. | `ask.test.ts` |
| L3 | `add_vocab` coi "xe mô tô" ≈ "xe ô tô" → AMBIGUOUS, rule mô tô UNCERTAIN. | So theo âm tiết không dấu: thay âm tiết = khái niệm khác; thêm/bớt âm tiết vẫn là gần trùng. | `vocabulary-similarity.test.ts` |

Còn mở: PDF *khác* nhau cùng số hiệu (bản scan + bản số) vẫn làm resolver AMBIGUOUS thay vì gộp về một legal identity (phần còn lại của AC 25).
