# HANDOFF — Epic Preprocessing (#38)

Trạng thái làm việc để người/agent tiếp theo có thể tiếp tục. Cập nhật lần cuối: khi hoàn thành #5.

## Đã xong
- PR #48 (document graph extractor) — review, sửa (taxonomy SRS, Unicode, style), merged.
- PR #49 (provisions #8) — review, sửa (provenance FR-04, hook pipeline, test), merged.
- #5 Document graph: metadata, candidate, resolver, cạnh ACCEPTED, API, hook pipeline. Xem `docs/preprocessing.md`.

## Còn lại (theo thứ tự phụ thuộc)
1. #11 ChangeInstruction + ProvisionRelation (FR-06/07)
2. #15 ViolationRule + Sanction extraction (FR-08/09)
3. #17 Violation identity + alias (FR-10)
4. #18 Lineage, current rule, as-of (FR-11/12)
5. #19 Semantic change (FR-13)
6. Slide báo cáo epic

## Ghi chú môi trường
- OpenAI key chỉ để trong `backend/.dev.vars` (gitignored), không commit.
- Chạy: `cd backend && bun test && bun run typecheck`.
- Quy tắc code: `docs/ai-rules/*` (brace mọi control flow, 4 spaces, test trước).
