# HANDOFF — Epic Preprocessing (#38)

Trạng thái làm việc để người/agent tiếp theo có thể tiếp tục. Cập nhật lần cuối: khi hoàn thành bộ evaluation.

## Đã xong
- PR #48 (document graph extractor) — review, sửa (taxonomy SRS, Unicode, style), merged.
- PR #49 (provisions #8) — review, sửa (provenance FR-04, hook pipeline, test), merged.
- #5 Document graph: metadata, candidate, resolver, cạnh ACCEPTED, API, hook pipeline. Xem `docs/preprocessing.md`.

- #11 Change graph: `backend/src/modules/changes/*`, ProvisionRelation tổng hợp lại vào document graph.

- #15 Violation rules: `backend/src/modules/violations/*` (deterministic + LLM vocabulary-guided, đã smoke test với OpenAI thật).

- #17 Identity: `backend/src/modules/identity/*`; tất cả bước chạy qua `runPreprocessing`.

- #18 History: `backend/src/modules/history/*` (lineage, intervals, as-of).

- #19 Semantic change: `backend/src/modules/history/change-events.ts`.

- Evaluation: `data/eval/preprocessing-dev-v1.json`, `backend/scripts/eval-preprocessing.ts` (`bun run eval`), báo cáo trong `data/eval/reports/`.

## Còn lại
7. Slide báo cáo epic

## Ghi chú môi trường
- OpenAI key chỉ để trong `backend/.dev.vars` (gitignored), không commit.
- Chạy: `cd backend && bun test && bun run typecheck`.
- Quy tắc code: `docs/ai-rules/*` (brace mọi control flow, 4 spaces, test trước).
