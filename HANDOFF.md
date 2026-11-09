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

## Kiểm thử end-to-end và đồ thị quan hệ (#61)

Nhánh `claude/feat/relation-graph` (chưa push):

- Đối chiếu SRS: [docs/srs-coverage.md](docs/srs-coverage.md), kèm 4 lỗi phát hiện (D1–D4); lỗi nặng nhất là upload trùng PDF làm mất toàn bộ quan hệ (D3).
- Luật giả `data/fake-law` (2 nghị định, có PDF) và `backend/test/fake-law-e2e.test.ts`: chạy upload → queue → preprocessing → truy vấn không cần OpenAI. Lỗi đã biết là các test `it.failing`.
- `GET /api/graph` và trang `/graph` có bộ lọc; xem [docs/query-frontend.md](docs/query-frontend.md).

## Deploy web, đo đạc và failed case (09/11/2026)

Nhánh `claude/gifted-gauss-9l0xfj`:

- `npx wrangler deploy` trong `web/` báo "Missing entry-point" vì đã xóa workflow Pages. Đã thêm `web/wrangler.jsonc` (Worker + assets, tự build) và đọc `PUBLIC_BACKEND_URL` lúc chạy. Trên Cloudflare: Root directory `web`, đặt biến `PUBLIC_BACKEND_URL` trong Worker › Settings › Variables. Chỉ kiểm chứng bằng `--dry-run` và `wrangler dev`, chưa deploy lên tài khoản thật.
- `bun run eval:ask` + `data/eval/ask-fake-law-v1.json`: chấm `/api/ask` (12 câu × 3 lần). Report gpt-5.4 và dev-set tiền xử lý gpt-5.4 trong `data/eval/reports`.
- Failed case 1: hỏi về quy định đã bị bãi bỏ (đèn chiếu sáng, 01/06/2033) → `UNCERTAIN` đúng nhưng 0/3 lần nói "bãi bỏ", có lần lộ "REPEALED", ngày ISO. Evidence thiếu văn bản bãi bỏ; prompt `grounded-answer-v2` không yêu cầu nói rõ.
- Failed case 2: Worker không gọi được OpenAI → queue thử 3 lần rồi vào DLQ, nhưng job vẫn `failed` với lỗi thô và trước đây hiện "Lỗi, đang thử lại". Đã đổi nhãn thành "Lỗi"; còn thiếu trạng thái retrying/ghi lỗi cuối và nút thử lại.
- Sửa 7 lỗi UI/UX ở trang quản trị, header mobile và trạng thái rỗng trang hành vi.
