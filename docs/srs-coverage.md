# Đối chiếu SRS với mã nguồn

Kiểm tra ngày 02/11/2026 trên nhánh `claude/feat/relation-graph` (SRS v0.12). Căn cứ: đọc mã, `bun test` (backend 294 test, web 79 test), `bun run eval` (dev set) và bộ end-to-end trên luật giả `data/fake-law` (`backend/test/fake-law-e2e.test.ts`). Không gọi LLM thật: các bước LLM (đọc PDF, semantic IR, identity, diễn đạt câu trả lời AI) chỉ được kiểm tra qua fake.

**Kết luận:** SRS **chưa được triển khai đầy đủ**. Lõi xử lý (đọc PDF → provision → graph văn bản → ChangeInstruction/ProvisionRelation → ViolationRule/Sanction → identity → lineage/as-of → change events) và các trang tra cứu đã chạy được end-to-end; thiếu xác thực Admin, acquisition/discovery tự động, dedup theo hash, full-text search, đánh giá held-out và một số lỗi đã phát hiện bên dưới.

Ký hiệu: ✅ đạt · 🟡 một phần · ❌ chưa có.

## Functional requirements

| FR | Trạng thái | Ghi chú |
| --- | --- | --- |
| FR-01 Import PDF | 🟡 | Upload 1 file, validate, R2 snapshot, queue, LLM đọc theo cụm trang, checkpoint/retry, review. Thiếu: nhiều phần/phụ lục trong một import, metadata khai báo, trạng thái READY/PARTIAL theo SRS, **dedup theo hash** (lỗi D3), xác thực Admin. Route vẫn là `/api/uploads`, chưa phải `/admin/imports`. |
| FR-02 Corpus discovery | ❌ | Có frontier (số hiệu được trích dẫn nhưng chưa nhập) nhưng không acquire/reverse search tự động. |
| FR-03 Document graph | ✅ | Candidate + evidence, resolver theo số hiệu/loại, cạnh ACCEPTED tách khỏi candidate, coverage/frontier. |
| FR-04 Provision segmentation | ✅ | Điều/Khoản/Điểm, nội dung trích dẫn trong lệnh sửa đổi tách riêng. |
| FR-05 Relevance | ✅ | Deterministic theo nội dung. |
| FR-06 ChangeInstruction | ✅ | Sửa đổi/bổ sung/bãi bỏ/thay thế, locator, ngày hiệu lực. |
| FR-07 ProvisionRelation | ✅ | Cùng/khác văn bản, cập nhật khi nhập theo thứ tự ngược (đã kiểm tra e2e). |
| FR-08 / 08.1 Violation extraction | 🟡 | Deterministic + LLM theo vocabulary (MCP `get_vocab_snapshot` → `add_vocab`). Lỗi D2: dấu `”.` của văn bản sửa đổi lọt vào hành vi/alias. |
| FR-09 Sanction | ✅ | Tiền phạt, `point_deduction_applicability`, SanctionEffect có kiểu (tước GPLX, trừ điểm, tịch thu). |
| FR-10 Identity | ✅ | Deterministic + LLM khi AMBIGUOUS; không gộp context khác nhau. |
| FR-11 History | ✅ | Lineage theo context, chuỗi rule qua ProvisionRelation. |
| FR-12 Current / as-of | ✅ | Đã kiểm tra e2e: mức phạt cũ trước ngày hiệu lực, mức mới sau; điểm bị bãi bỏ hết áp dụng. UNCERTAIN khi thiếu evidence. |
| FR-13 Semantic change | ✅ | Change events; F1 = 1,0 trên dev set (deterministic). |
| FR-14 Document search | 🟡 | Có, không dùng LLM. Lỗi D1: xếp hạng số hiệu sai. |
| FR-15 Document view | 🟡 | Nội dung + Quan hệ, đánh dấu phần bị tác động. Trang có **3** tab (thêm "Hành vi vi phạm") trong khi AC 13 yêu cầu đúng 2. Đồ thị quan hệ: trang `/graph` (#61). |
| FR-16.1 Manual search | 🟡 | Chỉ khớp chuỗi liền trong tên/alias, chưa full-text (lỗi D4). |
| FR-16.2 / 16.3 AI chat + references | 🟡 | `/api/ask` có claim → evidence, AMBIGUOUS/UNCERTAIN/NO_ANSWER; retrieval chỉ theo từ trong alias; chưa có rate limit/xác thực; chưa có bộ QA held-out. |
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
| NFR-06 Data consistency | ❌ | Lỗi D3 phá vỡ invariant khi nhập trùng. |
| NFR-08 Observability | 🟡 | Log JSON theo job/stage, checklist preprocessing; chưa có metric thời gian/queue. |
| §14–15 Evaluation, baselines | 🟡 | Dev set + baseline cho preprocessing; thiếu held-out, retrieval/QA và end-to-end metric (#29). |

## Acceptance criteria (§16)

Đạt: 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 19, 20, 21, 22, 23, 24 (mức rule), 30, 31, 32. Một phần: 1 (chưa xác thực Admin), 12 (D1), 13 (3 tab), 15 (D4), 16–18 (chưa có đánh giá), 27. Chưa đạt: 2, 25 (D3), 26, 28, 29.

## Lỗi phát hiện khi kiểm thử

Mỗi lỗi có một test `it.failing` trong `backend/test/fake-law-e2e.test.ts`; khi sửa xong, test sẽ báo và cần bỏ `.failing`.

| # | Mức | Lỗi | Tái hiện |
| --- | --- | --- | --- |
| D3 | Cao | Upload lại cùng PDF tạo văn bản trùng; số hiệu trùng làm resolver không chọn được đích nên **toàn bộ** ProvisionRelation/DocumentRelation tới văn bản đó mất, rule bị nhân đôi. Vi phạm AC 25, NFR-06. | Nhập 01/2030, 02/2032, rồi nhập lại 01/2030: `legal_documents` 3, `provision_relations` 3 → 0. |
| D1 | Trung bình | Tìm `01/2030` xếp 02/2032 lên đầu với lý do "Khớp số hiệu '02/2032/NĐ-CP'": `document.matcher.ts` cộng điểm số hiệu khi truy vấn xuất hiện ở bất kỳ đâu trong tiêu đề, còn số hiệu đầy đủ của chính văn bản không khớp truy vấn rút gọn. | `GET /api/documents?q=01/2030`. |
| D2 | Thấp | Hành vi lấy từ nội dung trích dẫn của văn bản sửa đổi giữ dấu đóng `”.` (alias, `behaviorText`, nhãn action). | Alias "…đang làm nhiệm vụ.”". |
| D4 | Trung bình | Tìm hành vi chỉ khớp chuỗi liền: "đỗ xe ngoài đô thị" (ví dụ north-star của SRS) không ra kết quả dù hành vi "Dừng xe, đỗ xe trên phần đường xe chạy ở đoạn đường ngoài đô thị…" đã được trích xuất. | `GET /api/violations?q=đỗ xe ngoài đô thị`. |
