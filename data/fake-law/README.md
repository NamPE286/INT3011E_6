# Bộ luật giả định để kiểm thử

Hai nghị định **không có thật**, số hiệu cố ý đặt ở tương lai (2030, 2032) để không lẫn với văn bản thật. Dùng cho kiểm thử end-to-end và kiểm tra thủ công mà không tốn token đọc PDF thật.

| File | Nội dung |
| --- | --- |
| `nd-01-2030.json` / `.pdf` | Nghị định 01/2030/NĐ-CP (hiệu lực 01/01/2031): Điều 2 xử phạt xe ô tô (đỗ xe ngoài đô thị, đèn chiếu sáng, đèn tín hiệu + tước GPLX), Điều 3 xử phạt xe mô tô (mũ bảo hiểm 200.000–400.000 đồng). |
| `nd-02-2032.json` / `.pdf` | Nghị định 02/2032/NĐ-CP (hiệu lực 01/01/2033) sửa đổi 01/2030: sửa điểm a khoản 2 Điều 2, bãi bỏ điểm b khoản 1 Điều 2, thay khoản 1 Điều 3 (mũ bảo hiểm 400.000–600.000 đồng). |
| `generate_pdfs.py` | Sinh PDF từ JSON (`python3 data/fake-law/generate_pdfs.py`, cần `reportlab` và font DejaVu Sans). |

Mỗi JSON là nguồn duy nhất: PDF được in từ nó và `backend/test/fake-law.ts` trả chính các block đó làm kết quả "LLM đọc PDF" giả, nên test không gọi OpenAI. Upload PDF thật qua `/admin` (với `OPENAI_API_KEY`) cũng dùng được để so sánh với bản phiên âm.

Test: `cd backend && bun test test/fake-law-e2e.test.ts`. Các case `it.failing` ghi lại lỗi đã biết; khi sửa xong lỗi, test sẽ báo và cần bỏ `.failing`.
