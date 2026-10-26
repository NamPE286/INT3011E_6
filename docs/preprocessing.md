# Preprocessing pipeline

Tài liệu kỹ thuật cho các bước tiền xử lý chạy sau khi PDF đã được LLM đọc thành legal JSON ([PDF upload API](pdf-upload-api.md)). Mỗi bước là deterministic-first: rule/regex và resolver có thể kiểm chứng chạy trước, LLM chỉ dùng ở phần khó và luôn bị kiểm tra lại bằng evidence trong snapshot.

```text
saveLegalDocument (ACCEPTED)
  └─ 1. Provisions (#8)          provisions
  └─ 2. Document graph (#5)      document_metadata, document_relation_candidates, document_relations
  └─ 3. Change graph (#11)       change_instructions, provision_relations (+ cạnh document_relations suy ra)
```

Mỗi bước được gọi trong `executeProcessingPipeline` ngay sau khi lưu văn bản. Lỗi của một bước được log và có thể chạy lại bằng endpoint tương ứng; nó không biến job đã hoàn tất thành `failed`. Văn bản `REVIEW_REQUIRED` không được phân tích, và dữ liệu phái sinh của lần đọc trước bị xóa.

> Các endpoint dưới đây chưa có xác thực Admin (TODO #4, giống `/api/jobs*`).

## 1. Provisions — Điều/Khoản/Điểm và vai trò (#8, FR-04/FR-05)

- `flattenLegalDocument` duyệt legal JSON theo thứ tự đọc, tạo id ổn định `<document_id>:dieu_6_khoan_1_diem_a` (cùng scheme với MCP), giữ parent, locator Điều/Khoản/Điểm, trang, source quote, vùng PDF và chất lượng đọc. Dòng `Căn cứ …` của phần đầu thành provision `PREAMBLE`.
- Mỗi provision lưu provenance FR-04: `source_snapshot_id`, `pdf_sha256`, `read_method` (`LLM:<model>;prompt=…;schema=…`).
- `classifyRole` gán `content_role` (`OPERATIVE_INSTRUCTION`, `QUOTED_NEW_TEXT`, `HISTORICAL_DESCRIPTION`, …) và `relevance` (`SANCTION_RULE`, `VIOLATION_RULE`, `AMENDMENT_INSTRUCTION`, `REPEAL_INSTRUCTION`, `REFERENCE`, `IRRELEVANT`, `UNCERTAIN`). Trạng thái ngoặc kép được mang qua các provision để nội dung trích dẫn của lệnh sửa đổi không bị đọc như lệnh của chính văn bản.

| Method | Path | Mô tả |
| --- | --- | --- |
| `GET` | `/api/jobs/:jobId/provisions` | Danh sách provision theo thứ tự đọc. |
| `POST` | `/api/jobs/:jobId/provisions/analyze` | Chạy lại phân tích; `409` nếu văn bản cần review. |

## 2. Document graph — lược đồ quan hệ văn bản (#5, FR-03)

1. **Metadata định danh** (`document_metadata`): số hiệu (header `Số: …`), loại, cơ quan, ngày ban hành, ngày có hiệu lực đọc từ câu "có hiệu lực (thi hành) kể từ ngày …" (không đoán khi chỉ có "kể từ ngày ký").
2. **Candidate** (`document_relation_candidates`): `extractDocumentRelationCandidates` quét tiêu đề văn bản, tiêu đề Điều và nội dung từng provision. Provision trích dẫn/lịch sử bị bỏ qua và nội dung trong ngoặc kép bị che (giữ nguyên offset). Mỗi candidate giữ provision nguồn, offset, câu trích, cue, citation thô, action, type theo taxonomy SRS §4.3, scope `FULL / PARTIAL / UNKNOWN`, method/version.
3. **Resolve** (`resolveCandidate`): khớp số hiệu chuẩn hóa với corpus.
   - không có số hiệu hoặc không có trong corpus → `UNRESOLVED` (frontier cần thu thập);
   - nhiều văn bản cùng số → `AMBIGUOUS`; trỏ về chính nó → `REJECTED`;
   - loại văn bản hoặc ngày ban hành trong citation mâu thuẫn → `CONFLICT`;
   - type `UNKNOWN` hoặc không so được loại văn bản → `CANDIDATE`;
   - số hiệu + loại văn bản khớp đúng một văn bản và action đọc từ câu chữ pháp lý → `ACCEPTED`.
4. **Cạnh** (`document_relations`): mỗi `(from, to, type, scope)` là một cạnh, evidence là toàn bộ candidate `ACCEPTED` cùng khóa (`EXPLICIT_LEGAL_TEXT`). Quan hệ ngược (incoming) suy từ cùng cạnh, không lưu cạnh trùng.

Mỗi lần build, toàn bộ candidate trong corpus được resolve lại: văn bản nhập sau sẽ nhận incoming edge từ văn bản nhập trước (graph cập nhật tăng dần).

| Method | Path | Mô tả |
| --- | --- | --- |
| `GET` | `/api/documents/:documentId/relations` | `outgoing`/`incoming` (cạnh ACCEPTED + evidence), `candidates` chưa xác minh, `coverage` (số lượng theo status, `frontier`), `disclaimer`. |
| `POST` | `/api/documents/:documentId/relations/rebuild` | Build lại graph của văn bản và resolve lại corpus; `409` nếu cần review. |

Giới hạn hiện tại: chưa tự thu thập văn bản ở frontier (FR-02 acquisition) — frontier được trả về để Admin upload; citation không có số hiệu luôn `UNRESOLVED`.

## 3. Change graph — ChangeInstruction và ProvisionRelation (#11, FR-06/FR-07)

1. **ChangeInstruction** (`change_instructions`): mỗi provision `OPERATIVE_INSTRUCTION` có relevance `AMENDMENT_INSTRUCTION`/`REPEAL_INSTRUCTION` thành một instruction. Chỉ đọc câu lệnh (nội dung trong ngoặc kép bị che):
   - operation `AMEND / SUPPLEMENT / REPLACE / REPEAL / CORRECT / SUBSTITUTE_TEXT`;
   - địa chỉ đích (`parseLocators`): danh sách, khoảng ("từ khoản 1 đến khoản 3"), "các điểm a, b và c"; Điều/Khoản thiếu được lấy từ instruction bao ngoài ("Sửa đổi một số khoản của Điều 5: a) Sửa đổi khoản 2 …"); "Bổ sung điểm e vào khoản 5 Điều 5" giữ insertion locator;
   - văn bản đích: câu lệnh → các provision bao ngoài (ví dụ tiêu đề Điều "Sửa đổi, bổ sung một số điều của Nghị định số …") → tiêu đề văn bản; "… của Nghị định này" là nội văn bản;
   - nội dung mới (`new_text_provision_ids` = các provision trích dẫn thuộc instruction), ngoại lệ ("trừ …"), ngày hiệu lực = ngày có hiệu lực của văn bản sửa đổi (null nếu chưa đọc được).
2. **Resolve**: văn bản đích dùng chung luật định danh với document graph. Mỗi địa chỉ được map sang id provision của văn bản đích; địa chỉ không có trong bản đã lưu giữ `UNRESOLVED`/`PARTIALLY_RESOLVED` kèm lý do, không nối tạm vào provision gần đúng. Văn bản đích ngoài corpus → `UNRESOLVED`, không tạo cạnh.
3. **ProvisionRelation** (`provision_relations`): cạnh first-class từ provision chứa lệnh → provision bị tác động (`AMENDS / SUPPLEMENTS / REPLACES / REPEALS / CORRECTS`), giữ locator, insertion locator, nội dung mới, evidence, ngày hiệu lực, method/version. `verification_status` = `ACCEPTED` khi văn bản đích đã xác minh, `CANDIDATE` khi mới khớp số hiệu.
4. **Bổ sung document graph**: ProvisionRelation `ACCEPTED` giữa hai văn bản được tổng hợp thành cạnh `document_relations` scope `PARTIAL` (`STRUCTURED_DERIVATION`, method `PROVISION_RELATION`) với `evidence_provision_relation_ids`; cạnh từ câu chữ và cạnh suy ra được giữ riêng.

Instruction tác động toàn văn bản (ví dụ "Nghị định số 46/2016/NĐ-CP hết hiệu lực") có `target_scope = DOCUMENT` và không lan truyền xuống từng provision.

| Method | Path | Mô tả |
| --- | --- | --- |
| `GET` | `/api/documents/:documentId/changes` | Instruction của văn bản kèm ProvisionRelation đã resolve. |
| `POST` | `/api/documents/:documentId/changes/rebuild` | Trích xuất lại instruction và resolve lại toàn corpus; `409` nếu cần review. |
| `GET` | `/api/provisions/:provisionId/relations` | `outgoing`/`incoming` của một provision, mỗi cạnh kèm instruction làm evidence. |
