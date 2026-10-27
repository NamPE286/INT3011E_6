# PDF → Legal JSON pipeline

Tài liệu mô tả luồng hiện có trong code cho issue [#33](https://github.com/NamPE286/INT3011E_6/issues/33): Admin upload PDF văn bản pháp luật (kể cả bản scan), hệ thống dùng LLM đọc PDF và tạo JSON phân cấp theo contract v1 của issue.

```text
POST /api/uploads ─► R2 uploads/{jobId}/{file}.pdf (snapshot bất biến) ─► D1 processing_jobs ─► Queue {jobId}
Queue consumer ─► chia PDF thành cụm trang ─► LLM đọc từng cụm (checkpoint R2) ─► ghép + kiểm tra deterministic ─► D1 legal_documents
```

## Thiết kế

| Bước | File | Ghi chú |
| --- | --- | --- |
| Validate upload | `processing/pdf-document.ts`, `upload/upload.service.ts` | Kiểm tra `%PDF-`, parse được bằng `pdf-lib`, không mã hóa, 1–300 trang, ≤ 50 MB. File lỗi bị từ chối ngay ở HTTP 400. |
| Chia trang | `pdf-document.ts` | Copy nguyên trang PDF vào file con (`PDF_CHUNK_PAGES`, mặc định 3 trang); không render/OCR. |
| Đọc bằng LLM | `processing/legal-llm.service.ts` | OpenAI Responses API, input là file PDF, output JSON theo schema strict. LLM chỉ chép **nguyên văn** từng block theo thứ tự đọc và ký hiệu đầu dòng (`marker`: "Điều 6.", "Chương II", "a)"). |
| Phân loại cấp | `legal-llm.service.ts` (`classifyMarker`) | Cấp Phần/Chương/Mục/Điều/Khoản/Điểm được backend suy ra từ `marker` bằng regex, không tin nhãn của model. |
| Ghép cây + kiểm tra | `processing/legal-assembler.ts` | Ghép block qua ranh giới cụm trang, gắn `source_locator` (trang, quote, quality), tách nội dung trích dẫn của lệnh sửa đổi (xem dưới), kiểm tra số thứ tự (Điều liên tục, Khoản 1..n, Điểm a, b, c, d, đ, e...), độ phủ trang, chất lượng đọc, tiêu đề, phần ký/kết thúc. |
| Lưu | `processing/legal-persistence.ts` | `legal_documents` lưu JSON, `review_status`, `validation_issues`, model, prompt/schema version, số trang. |

### Văn bản sửa đổi: nội dung trích dẫn

Văn bản sửa đổi chép nguyên Điều/Khoản/Điểm mới trong ngoặc kép ("Sửa đổi, bổ sung Điều 20 như sau: “Điều 20. … 1. … a) …”"). Các đơn vị này **không** thuộc cây Điều/Khoản/Điểm của chính văn bản: assembler đưa chúng vào trường `quoted` của node chứa lệnh, giữ cấu trúc riêng (`kind`, `number`, `title`, `content`, `source_locator`, `children`) và không kiểm tra số thứ tự của chúng.

- Mở trích dẫn: ngay sau câu dẫn có động từ sửa đổi ở đầu câu hoặc ở dạng bị động ("Sửa đổi, bổ sung … như sau:", "… được sửa đổi như sau:"), hoặc một tiêu đề bắt đầu bằng “. LLM thường bỏ dấu “ mở nhưng giữ dấu ” đóng, nên câu dẫn là tín hiệu chính. "… các hình thức xử phạt bổ sung như sau:" không phải câu dẫn.
- Lệnh con ("Sửa đổi một số điểm của khoản 6 Điều 28 như sau: a) Sửa đổi điểm i …") không phải nội dung trích dẫn.
- Đóng trích dẫn ở khối kết thúc bằng ”; nếu thiếu dấu đóng thì đóng trước lệnh kế tiếp cùng cấp của node chứa lệnh, ghi `QUOTE_NOT_CLOSED` (WARNING).

Assembler còn chuẩn hóa chữ Cyrillic trông giống chữ Latin trong ký hiệu ("р)" → "p)") và hạ `PAGE_UNREADABLE` thành `PAGE_BLANK` (WARNING) cho trang mà chính PDF không có chữ hay ảnh (`findBlankPages`).

### Checkpoint, retry, idempotency

- Mỗi cụm trang lưu tại `runs/{jobId}/{sha256[0:16]}-{model}-{prompt}-{schema}/chunks/{start}-{end}.json`. Khi queue retry, các cụm đã có sẽ không gọi LLM lại.
- Lỗi tạm thời (HTTP 408/429/5xx, mạng) → job `failed` tạm thời, message được `retry()` (tối đa 3 lần, sau đó vào DLQ).
- Output LLM sai schema được thử lại 1 lần. Nếu vẫn sai, các trang của cụm đó bị đánh dấu `UNREADABLE` (không lặp vô hạn, không bịa nội dung).
- Lỗi vĩnh viễn (PDF hỏng, thiếu `OPENAI_API_KEY`, không tìm thấy cấu trúc) → `needs_review`, message được `ack()`.
- Message trùng cho job đã `completed`/`needs_review` được bỏ qua.
- Duyệt: `POST /api/jobs/:jobId/review` với `{ "decision": "accept" }` chuyển document `REVIEW_REQUIRED` sang `ACCEPTED`, job sang `completed` rồi chạy preprocessing; `409` nếu document không chờ review, `404` nếu không có document.

### Mức độ issue

| Severity | Ý nghĩa | Ví dụ |
| --- | --- | --- |
| `ERROR` | Không publish âm thầm: job `needs_review`, document `REVIEW_REQUIRED` (vẫn lưu để kiểm tra) | `NUMBERING_GAP`, `ORPHAN_NODE`, `PAGE_UNREADABLE`, `PAGE_NOT_REPORTED`, `CHUNK_FAILED`, `TITLE_MISSING`, `CLOSING_MISSING` |
| `WARNING` | Sửa lỗi đọc deterministic, có ghi lại | `MARKER_REPAIRED` ("1." → "l)", "d)" lặp → "đ)"), `MARKER_DROPPED` (marker bịa trên đoạn nối tiếp chữ thường), `QUOTE_NOT_CLOSED`, `PAGE_BLANK` |

`CLOSING_MISSING` thường nghĩa là PDF chỉ là **một phần** của văn bản (ví dụ `100.signed_01.pdf` dừng giữa Điều 30).

## Chạy local

```bash
cd backend
cp .dev.vars.example .dev.vars   # điền OPENAI_API_KEY
bun install
bun run d1:migrate:local
bun run dev                      # http://localhost:8787
```

| Biến | Bắt buộc | Mặc định | Ý nghĩa |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | Có | | Key gọi OpenAI. Chỉ đặt trong `.dev.vars`/secret, không commit. |
| `OPENAI_MODEL` | Không | `gpt-5.4` | Model đọc PDF. `gpt-5.4-mini` nhanh hơn nhưng nhầm marker nhiều hơn trên bản scan. |
| `PDF_CHUNK_PAGES` | Không | `3` | Số trang mỗi lần gọi LLM (1–20). |

## API

### Upload

```bash
curl -X POST http://localhost:8787/api/uploads -F "file=@./nd100.pdf;type=application/pdf"
# {"jobId":"...","status":"queued"}
```

### Theo dõi job

```bash
curl http://localhost:8787/api/jobs/JOB_ID      # một job
curl http://localhost:8787/api/jobs             # 100 job gần nhất
```

`status`: `queued` → `processing` (`step`: `preparing` → `extracting` → `analyzing` → `finalizing`) → `completed` | `needs_review`; `failed` là lỗi tạm thời đang chờ queue retry.

### Lấy JSON kết quả

```bash
curl http://localhost:8787/api/jobs/JOB_ID/document
```

```json
{
    "jobId": "...",
    "reviewStatus": "ACCEPTED | REVIEW_REQUIRED",
    "issues": [{ "severity": "ERROR", "code": "CLOSING_MISSING", "message": "...", "page": 76 }],
    "extraction": { "model": "gpt-5.4", "promptVersion": "pdf-blocks-v3", "schemaVersion": "legal-json-v1", "pageCount": 76, "pdfSha256": "...", "createdAt": "..." },
    "document": { "document_title": "...", "content": "...", "source": {}, "parts": [], "chapters": [], "sections": [], "articles": [] }
}
```

## Kết quả kiểm thử thực tế (Nghị định 100/2019/NĐ-CP, phần 1)

File scan 76 trang (`100.signed_01.pdf`, không có text layer), model `gpt-5.4`, 3 trang/cụm:

- Thời gian xử lý khoảng 3 phút (26 lần gọi LLM, chạy song song 4).
- Cấu trúc: 2 Chương, 6 Mục (đủ tên), Điều 1–30, 185 Khoản, 723 Điểm; tiêu đề, số hiệu, ngày ban hành và căn cứ nằm ở `content` gốc.
- Validation: 1 `ERROR` `CLOSING_MISSING` (đúng, vì file chỉ là phần 1), 1 `WARNING` sửa "d)" → "đ)" ở trang 76.
- Đối chiếu thủ công: trang 2–4 và trang 44 khớp từng chữ. Trang 76 có 2 lỗi chép trong danh sách tham chiếu ("điểm d" thay vì "điểm g"; lặp "điểm c"). Hệ thống chưa phát hiện được loại lỗi này. Cần bộ gold fixture và metric `legal_text_fidelity` theo mục A6 của #33 trước khi coi kết quả là chính xác.

## Giới hạn đã biết

- Chưa có pass kiểm chứng thứ hai cho lỗi chép trong câu (chỉ kiểm tra cấu trúc và số thứ tự).
- `regions`/bbox luôn rỗng, `source_quote` được dựng từ bản chép của LLM.
- Mỗi lần upload tạo một bản ghi mới; chưa dedup theo `pdf_sha256` (tiêu chí MVP 25).
- Chưa ghép nhiều file PDF thành một văn bản (`part_index` luôn bằng 1).
- Endpoint admin chưa có xác thực (#4).
