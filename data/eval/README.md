# Bộ đánh giá tiền xử lý

| File | Nội dung |
| --- | --- |
| `preprocessing-dev-v1.json` | Dev set cho epic Preprocessing (#38): 4 văn bản (trích, rút gọn theo câu chữ Nghị định 100/2019, 123/2021, 168/2024, Thông tư 65/2020) và nhãn gold cho từng bước. |
| `reports/*.json` | Kết quả chạy `bun run eval` (deterministic) và `bun run eval -- --llm` (thêm bước LLM). |

**Giới hạn.** Đây là dev/regression set: văn bản được rút gọn và một số câu được điều chỉnh để mỗi bước có ít nhất một case; nhãn gold viết tay từ câu chữ pháp lý, không lấy từ output hệ thống. Không phải held-out benchmark và không dùng để kết luận độ chính xác trên corpus thật — held-out annotation trên PDF đầy đủ theo dõi tại #29. Thứ tự nhập cố ý đặt văn bản sửa đổi trước văn bản gốc để kiểm tra cập nhật tăng dần.

## Nhãn gold

- `document_relations`: cạnh ACCEPTED `(from, to, type)`; `frontier`: số hiệu được trích dẫn nhưng ngoài corpus.
- `provision_relations`: `(provision tác động, provision bị tác động, type)`.
- `provision_relevance`: nhãn FR-05 cho các provision tiêu biểu.
- `rules`: rule `(provision nguồn, địa chỉ điều chỉnh)` với mức phạt, thời hạn tước GPLX, số điểm trừ.
- `identity_clusters`: các rule cùng một hành vi.
- `as_of`: rule áp dụng tại ngày (theo violation của rule neo, mọi lineage).
- `changes`: chuyển tiếp và change types FR-13.

## Chạy

```bash
cd backend
bun run eval                                   # deterministic
OPENAI_API_KEY=... bun run eval -- --llm       # thêm bước LLM (semantic signature, identity resolver)
bun run eval -- --dataset <file> --out <report.json>
```

Mỗi metric đi kèm baseline đơn giản: graph chỉ từ phần căn cứ (header-only), identity bằng so khớp nguyên văn, as-of bằng "rule mới nhất của cùng violation".
