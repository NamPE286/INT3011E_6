# Bộ trích luật thật để demo và kiểm thử thủ công

Bốn file là **trích văn bản thật**, chỉ giữ nguyên văn các điểm được chọn (nguồn luatvietnam.vn, đối chiếu 16–17/11/2026). Mục đích là demo và kiểm tra thủ công bằng PDF ngắn, tốn ít token đọc PDF. Thư mục này không chứa văn bản bịa. Hai nghị định bịa (01/2030, 02/2032) dùng cho test tự động nằm ở [`backend/test/fixtures/synthetic-law`](../../backend/test/fixtures/synthetic-law).

| File | Nội dung |
| --- | --- |
| `nd-46-2016.json` / `.pdf` | Nghị định 46/2016/NĐ-CP (hiệu lực 01/08/2016). Điều 5: đèn tín hiệu ô tô. Điều 6 (mô tô): mũ bảo hiểm, đèn tín hiệu, quá tốc độ 05–10 và 10–20 km/h, chở 02 người, dùng điện thoại, đi ngược chiều, lạng lách đánh võng, tước GPLX. Điều 80 thay thế 171/2013. |
| `nd-100-2019.json` / `.pdf` | Nghị định 100/2019/NĐ-CP (hiệu lực 01/01/2020, thay thế 46/2016). Điều 5 (ô tô): đèn tín hiệu, nồng độ cồn ≤ 50 mg, tước GPLX. Điều 6 (mô tô): cùng các hành vi như 46/2016 cộng nồng độ cồn và đèn trong hầm. |
| `nd-123-2021.json` / `.pdf` | Nghị định 123/2021/NĐ-CP (hiệu lực 01/01/2022) sửa 100/2019: bổ sung điểm n, o khoản 3 Điều 6 (mũ bảo hiểm lên 400.000–600.000 đồng), sửa đổi khoản 5 Điều 6 (đi ngược chiều), bãi bỏ điểm i, k khoản 2 và điểm đ khoản 4 Điều 6. |
| `nd-168-2024.json` / `.pdf` | Nghị định 168/2024/NĐ-CP (hiệu lực 01/01/2025). Điều 6 (ô tô): đèn tín hiệu, nồng độ cồn, trừ điểm. Điều 7 (mô tô): các hành vi trên với mức mới, tước GPLX và trừ điểm. Điều 52 bãi bỏ Điều 5–11 của 100/2019. |
| `generate_pdfs.py` | Sinh PDF từ JSON (`python3 data/fake-law/generate_pdfs.py [thư mục ...]`, cần `reportlab` và font DejaVu Sans; trên macOS đặt `FAKE_LAW_FONT="/Library/Fonts/Arial Unicode.ttf"`). |

Chín hành vi xe mô tô có mặt qua cả chuỗi 46/2016 → 100/2019 → 123/2021 → 168/2024:

| Hành vi | 46/2016 | 100/2019 | 168/2024 |
| --- | --- | --- | --- |
| Không đội mũ bảo hiểm | 100.000–200.000 | 200.000–300.000 (từ 2022: 400.000–600.000 theo 123/2021) | 400.000–600.000 |
| Không chấp hành đèn tín hiệu | 300.000–400.000 | 600.000–1.000.000 | 4.000.000–6.000.000 |
| Nồng độ cồn ≤ 50 mg/100 ml máu | — | 2.000.000–3.000.000 | 2.000.000–3.000.000 |
| Quá tốc độ 05 đến dưới 10 km/h | 100.000–200.000 | 200.000–300.000 | 400.000–600.000 |
| Quá tốc độ 10–20 km/h | 500.000–1.000.000 | 600.000–1.000.000 | 800.000–1.000.000 |
| Chở theo 02 người | 100.000–200.000 | 200.000–300.000 | 400.000–600.000 |
| Dùng ô, điện thoại khi lái | 100.000–200.000 | 600.000–1.000.000 | 800.000–1.000.000 |
| Đi ngược chiều đường một chiều | 300.000–400.000 | 1.000.000–2.000.000 | 4.000.000–6.000.000 |
| Lạng lách, đánh võng | 5.000.000–7.000.000 | 6.000.000–8.000.000 | 8.000.000–10.000.000 |

Mức phạt trong bảng chỉ để đối chiếu nhanh; căn cứ là câu chữ trong từng JSON. Vì bản trích bỏ phần lớn điều khoản, tham chiếu chéo tới điểm không được trích nằm ngoài corpus, và khi đọc PDF hệ thống báo đánh số nhảy cóc rồi chờ duyệt ở `/admin`.

Mỗi JSON là nguồn duy nhất: PDF được in từ nó. Upload PDF qua `/admin` (với `OPENAI_API_KEY`) để chạy toàn bộ pipeline.
