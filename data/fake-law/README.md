# Bộ luật giả định để kiểm thử

Hai nghị định đầu **không có thật**, số hiệu cố ý đặt ở tương lai (2030, 2032) để không lẫn với văn bản thật. Dùng cho kiểm thử end-to-end và kiểm tra thủ công mà không tốn token đọc PDF thật.

| File | Nội dung |
| --- | --- |
| `nd-01-2030.json` / `.pdf` | Nghị định 01/2030/NĐ-CP (hiệu lực 01/01/2031): Điều 2 xử phạt xe ô tô (đỗ xe ngoài đô thị, đèn chiếu sáng, đèn tín hiệu + tước GPLX), Điều 3 xử phạt xe mô tô (mũ bảo hiểm 200.000–400.000 đồng). |
| `nd-02-2032.json` / `.pdf` | Nghị định 02/2032/NĐ-CP (hiệu lực 01/01/2033) sửa đổi 01/2030: sửa điểm a khoản 2 Điều 2, bãi bỏ điểm b khoản 1 Điều 2, thay khoản 1 Điều 3 (mũ bảo hiểm 400.000–600.000 đồng). |
| `nd-46-2016.json` / `.pdf` | **Trích văn bản thật** Nghị định 46/2016/NĐ-CP (hiệu lực 01/08/2016): đèn tín hiệu ô tô (1,2–2 triệu), mũ bảo hiểm mô tô (100.000–200.000), đèn tín hiệu mô tô (300.000–400.000). |
| `nd-100-2019.json` / `.pdf` | **Trích** Nghị định 100/2019/NĐ-CP (hiệu lực 01/01/2020, thay thế 46/2016): đèn tín hiệu, nồng độ cồn ≤ 50 mg (ô tô, mô tô), mũ bảo hiểm 200.000–300.000, tước GPLX. |
| `nd-123-2021.json` / `.pdf` | **Trích** Nghị định 123/2021/NĐ-CP (hiệu lực 01/01/2022): bổ sung điểm n khoản 3 Điều 6 (mũ bảo hiểm lên 400.000–600.000) và bãi bỏ điểm i khoản 2 Điều 6 của 100/2019. |
| `nd-168-2024.json` / `.pdf` | **Trích** Nghị định 168/2024/NĐ-CP (hiệu lực 01/01/2025): đèn tín hiệu ô tô 18–20 triệu, mô tô 4–6 triệu, nồng độ cồn, mũ bảo hiểm, trừ điểm GPLX; Điều 52 bãi bỏ Điều 5, Điều 6 của 100/2019. |
| `generate_pdfs.py` | Sinh PDF từ JSON (`python3 data/fake-law/generate_pdfs.py`, cần `reportlab` và font DejaVu Sans; trên macOS đặt `FAKE_LAW_FONT="/Library/Fonts/Arial Unicode.ttf"`). |

Bốn file trích văn bản thật giữ nguyên văn từng điểm được chọn (nguồn luatvietnam.vn, đối chiếu 16/11/2026) nhưng bỏ phần lớn điều khoản, nên tham chiếu chéo tới điểm không được trích sẽ nằm ngoài corpus. Chuỗi 46/2016 → 100/2019 → 123/2021 → 168/2024 dùng cho demo lịch sử và tra cứu theo ngày mà chỉ tốn vài nghìn token đọc PDF.

Mỗi JSON là nguồn duy nhất: PDF được in từ nó và `backend/test/fake-law.ts` trả chính các block đó làm kết quả "LLM đọc PDF" giả, nên test không gọi OpenAI. Upload PDF thật qua `/admin` (với `OPENAI_API_KEY`) cũng dùng được để so sánh với bản phiên âm.

Test: `cd backend && bun test test/fake-law-e2e.test.ts`. Các case `it.failing` ghi lại lỗi đã biết; khi sửa xong lỗi, test sẽ báo và cần bỏ `.failing`.
