## Summary

Triển khai luồng upload và xử lý tài liệu PDF pháp luật thành JSON có cấu trúc bằng Cloudflare Workers, R2, Queues, D1 và OpenAI API.

Luồng xử lý:

`Client → Upload API → R2 → D1 Processing Job → Queue → Consumer → PDF Extraction → LLM → JSON Validation → D1`

## Changes

- Triển khai API upload PDF, kiểm tra file đầu vào và lưu file vào Cloudflare R2.
- Tạo processing job trong D1 và gửi message vào Cloudflare Queue.
- Consumer nhận job và thực hiện xử lý bất đồng bộ.
- Trích xuất nội dung văn bản từ PDF có text layer.
- Gọi LLM để phân tích cấu trúc văn bản pháp luật theo Phần, Chương, Mục, Điều, Khoản và Điểm.
- Kiểm tra hierarchy, nội dung, numbering và `source_locator`.
- Lưu kết quả JSON cùng thông tin nguồn vào bảng `legal_documents`.
- Hỗ trợ theo dõi trạng thái xử lý và xử lý các trường hợp lỗi.
- Bổ sung migration và các bài kiểm thử liên quan.

## How to Use Upload PDF API

### 1. Prerequisites

- Cài đặt Bun và các dependencies của Backend.
- Cấu hình các binding `DB`, `FILE_STORAGE` và `PROCESSING_QUEUE` trong Wrangler.
- Cấu hình `OPENAI_API_KEY` và `OPENAI_MODEL` trong `.dev.vars` để chạy local.
- Áp dụng D1 migrations.

Chạy trong thư mục `backend`:

```bash
bun install
bunx wrangler d1 migrations apply DB --local
bunx wrangler dev --local --ip 127.0.0.1 --port 8790
```

Sau khi khởi động, API local chạy tại:

`http://127.0.0.1:8790`

### 2. Upload a PDF

**Endpoint:** `POST /api/uploads`

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | File | Yes | File PDF cần xử lý |

**Windows PowerShell:**

```powershell
curl.exe --noproxy "*" -i -X POST "http://127.0.0.1:8790/api/uploads" -F "file=@D:\path\to\document.pdf;type=application/pdf"
```

Thay `D:\path\to\document.pdf` bằng đường dẫn PDF thật trên máy.

**macOS/Linux:**

```bash
curl -i -X POST "http://127.0.0.1:8790/api/uploads" -F "file=@./document.pdf;type=application/pdf"
```

**Postman:**

1. Chọn method `POST`.
2. Nhập URL `http://127.0.0.1:8790/api/uploads`.
3. Chọn **Body → form-data**.
4. Thêm key `file`, chọn loại `File`.
5. Chọn file PDF và nhấn **Send**.

Không cần truyền OpenAI API key trong request upload. Token được cấu hình phía Backend.

**Expected result:**

- API trả HTTP `200 OK` khi upload thành công.
- Response chứa thông tin job, bao gồm `jobId`.
- PDF được lưu vào R2.
- Job được tạo trong D1 và gửi đến Queue để Consumer xử lý.

**Important:** HTTP 200 ở bước upload chỉ xác nhận upload và enqueue thành công, không có nghĩa JSON đã được tạo.

### 3. Check Processing Status

**Endpoint:** `GET /api/jobs/:jobId`

Ví dụ:

```powershell
curl.exe --noproxy "*" -i "http://127.0.0.1:8790/api/jobs/YOUR_JOB_ID"
```

Thay `YOUR_JOB_ID` bằng `jobId` từ response upload.

Các trạng thái xử lý:

| Status | Meaning |
|---|---|
| `queued` | Job đang chờ xử lý |
| `processing` | Consumer đang xử lý |
| `completed` | Xử lý hoàn thành |
| `needs_review` | Nội dung hoặc kết quả cần kiểm tra |
| `failed` | Xử lý gặp lỗi kỹ thuật |

Client nên sử dụng endpoint này để kiểm tra kết quả xử lý bất đồng bộ.

### 4. Verify Generated JSON

Sau khi job `completed`, JSON được lưu trong bảng D1 `legal_documents`.

**Kiểm tra kết quả trong D1 local:**

```powershell
bunx wrangler d1 execute DB --local --command "SELECT job_id, document_title, json_valid(json_content) AS valid_json FROM legal_documents ORDER BY created_at DESC LIMIT 5;"
```

**Xem JSON theo job ID:**

```powershell
bunx wrangler d1 execute DB --local --command "SELECT json_content FROM legal_documents WHERE job_id = 'YOUR_JOB_ID';"
```

Thay `YOUR_JOB_ID` bằng ID thực tế.

Hiện tại, `GET /api/jobs/:jobId` là API theo dõi trạng thái. Chưa có endpoint HTTP lấy JSON kết quả riêng được xác nhận trong phạm vi thay đổi này.

### 5. Current Limitations

- Hỗ trợ PDF có text layer; chưa triển khai OCR đầy đủ cho PDF scan.
- Giới hạn hiện tại: tối đa 12 MB và 35 trang.
- LLM xử lý theo single-request với giới hạn khoảng 650 dòng hoặc 38.000 ký tự.
- Văn bản dài cần cơ chế chia chunk để xử lý đầy đủ.
- Kết quả không khớp với nguồn sẽ được chuyển `needs_review` thay vì lưu JSON không đáng tin cậy.

## Testing

- [ ] `bun run typecheck` passed
- [ ] `bun test` passed
- [x] Upload PDF hợp lệ trả HTTP 200
- [x] Consumer nhận message từ Queue
- [x] LLM API được gọi và trả kết quả để validator kiểm tra
- [ ] Job PDF thật hoàn thành với trạng thái `completed`
- [ ] JSON được lưu thành công trong `legal_documents`
- [ ] Kết quả JSON được đối chiếu với PDF gốc
- [ ] CI checks passed

Chỉ đánh dấu thêm các checkbox khi đã xác nhận bằng kết quả thực tế.

## Known Issues / Pending Work

- Lần kiểm thử PDF thật gần nhất bị `needs_review` do lỗi phân loại heading Phần/Chương.
- Cần kiểm thử lại toàn bộ unit test sau các thay đổi.
- Chưa hỗ trợ đầy đủ OCR và chia chunk cho PDF dài.
- Cần xác minh tính chính xác của `source_locator` trên PDF thực tế.

## Review Checklist

Nhờ reviewer kiểm tra:

- API upload và file validation.
- Cloudflare R2, Queue Consumer và D1 bindings.
- Xử lý lỗi, ACK/retry và tránh xử lý trùng job.
- Prompt LLM và quy tắc phân loại hierarchy.
- Validation, source locator và việc giữ nguyên câu chữ tiếng Việt.
- D1 migrations và lưu trữ kết quả.
- Các giới hạn còn lại so với acceptance criteria của issue.

**Current status:** Chờ hoàn thiện kiểm thử end-to-end và CI trước khi đánh dấu sẵn sàng review.