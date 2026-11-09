# Bộ đánh giá

| File | Nội dung |
| --- | --- |
| `preprocessing-dev-v1.json` | Dev set cho epic Preprocessing (#38): 4 văn bản (trích, rút gọn theo câu chữ Nghị định 100/2019, 123/2021, 168/2024, Thông tư 65/2020) và nhãn gold cho từng bước. |
| `ask-fake-law-v1.json` | 12 câu hỏi đáp AI trên luật giả `data/fake-law` (đúng hành vi, mức phạt theo ngày, quy định bị bãi bỏ, ngoại lệ, ngoài corpus, ngoài chủ đề). |
| `reports/*.json` | Kết quả chạy `bun run eval` (deterministic), `bun run eval -- --llm` (thêm bước LLM) và `bun run eval:ask`. |

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

## Hỏi đáp AI (`eval:ask`)

Chấm `/api/ask` của một backend đang chạy, sau khi đã nhập hai PDF trong `data/fake-law` qua `/admin`:

```bash
cd backend
bun run eval:ask -- --repeat 3 --out ../data/eval/reports/ask-fake-law-v1.<model>.json
```

| Metric | Cách tính |
| --- | --- |
| `statusAccuracy` | `status` (ANSWERED / UNCERTAIN / NO_ANSWER …) nằm trong `accept_status`. |
| `retrievalHitRate` | Có evidence thuộc đúng hành vi (`expect_violation`). |
| `fineCorrectRate` | Mọi mức tiền trong `expect_amounts` xuất hiện trong câu trả lời. |
| `expectedTermRate` | Câu trả lời có các cụm bắt buộc (`expect_terms`, ví dụ "bãi bỏ", "tước"). |
| `claimCitationValidity` | Tỷ lệ nhận định có ít nhất một nguồn và mọi nguồn đều tồn tại. |
| `groundedAmountRate` | Tỷ lệ số tiền trong nhận định trùng mức phạt của chính evidence nhận định đó dẫn (phát hiện bịa số). |
| `stableStatusRate` | Câu hỏi cho cùng một `status` ở mọi lần lặp. |

Câu trả lời sai được liệt kê trong `failures` của report. Bộ này nhỏ và trên luật giả: dùng để so sánh giữa các lần sửa prompt/model, không phải để kết luận độ chính xác trên luật thật.
