# Preprocessing pipeline

Tài liệu kỹ thuật cho các bước tiền xử lý chạy sau khi PDF đã được LLM đọc thành legal JSON ([PDF upload API](pdf-upload-api.md)). Mỗi bước là deterministic-first: rule/regex và resolver có thể kiểm chứng chạy trước, LLM chỉ dùng ở phần khó và luôn bị kiểm tra lại bằng evidence trong snapshot.

```text
saveLegalDocument (ACCEPTED)
  └─ 1. Provisions (#8)          provisions
  └─ 2. Document graph (#5)      document_metadata, document_relation_candidates, document_relations
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
