# HANDOFF — Epic Preprocessing (#38)

Trạng thái để người/agent tiếp theo tiếp tục. Cập nhật lần cuối: 26/10/2026, khi epic hoàn thành.

## Đã xong

| Hạng mục | PR | Mã nguồn |
| --- | --- | --- |
| Review + sửa PR document graph extractor | #48 | `backend/src/modules/documents/document-graph.extractor.ts` |
| Review + sửa PR provisions (#8) | #49 | `backend/src/modules/provisions/*` |
| #5 Document graph (metadata, candidate, resolver, cạnh, API) | #50 | `backend/src/modules/documents/document-graph.*` |
| #11 ChangeInstruction + ProvisionRelation | #51 | `backend/src/modules/changes/*` |
| #15 ViolationRule + Sanction (+ LLM theo vocabulary) | #52 | `backend/src/modules/violations/*` |
| #17 Identity + alias | #53 | `backend/src/modules/identity/*` |
| #18 Lineage, khoảng hiệu lực, as-of | #54 | `backend/src/modules/history/*` |
| #19 Change events | #55 | `backend/src/modules/history/change-events.ts` |
| Bộ đánh giá + 2 lỗi nó tìm ra | #56 | `data/eval/*`, `backend/scripts/eval-preprocessing.ts` |

Các bước chạy qua `runPreprocessing` (`backend/src/modules/processing/preprocessing.ts`). Tài liệu: `docs/preprocessing.md`. Slide báo cáo epic: artifact "Báo cáo Epic Preprocessing" (claude.ai, private — chủ sở hữu cần Share trước khi gửi nhóm).

## Còn mở / gợi ý tiếp theo

- #29: held-out annotation trên PDF đầy đủ (100/2019, 123/2021, 168/2024); dev-v1 chỉ là regression set.
- Acquisition tự động cho frontier (FR-02) và coverage trong ImportJob.
- Xác thực Admin cho các endpoint rebuild/extract/resolve (TODO #4).
- `add_vocab` similarity ký tự coi "xe mô tô" ≈ "xe ô tô" là AMBIGUOUS.
- Chế độ LLM: danh sách phương tiện không ổn định → `VEHICLE_SCOPE_CHANGED` sai (micro F1 change types 0,94).

## Ghi chú môi trường

- OpenAI key chỉ để trong `backend/.dev.vars` (gitignored), không commit.
- Kiểm tra: `cd backend && bun test && bun run typecheck`; đánh giá: `bun run eval` (thêm `-- --llm` với `OPENAI_API_KEY`).
- Quy tắc code: `docs/ai-rules/*`.

## Epic Truy vấn (#39) — giao diện và API

Đã làm (nhánh `claude/feat/query-frontend`, chưa push): tìm/xem văn bản (#23), tra cứu hành vi + as-of + lịch sử (#24), hỏi đáp AI có dẫn nguồn (#26). Xem [docs/query-frontend.md](docs/query-frontend.md).

Còn thiếu so với tiêu chí nghiệm thu:

- Metric retrieval tái lập và bộ QA held-out (retrieval, correctness, citation) — thuộc #29.
- Tìm hành vi chỉ theo alias; chưa có full-text trên nội dung provision.
- Frontend chưa có test component/e2e (chỉ test phần logic thuần); đã kiểm tra thủ công bằng trình duyệt trên dữ liệu fixture.
- `/api/ask` và các endpoint admin chưa có xác thực/rate limit.
- Nhãn tên văn bản ở tab Quan hệ chỉ tra được trong 50 văn bản mới nhất; ngoài đó hiển thị id.
