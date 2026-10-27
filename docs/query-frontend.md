# Truy vấn: API và giao diện

Tài liệu cho epic Truy vấn (#39): tìm văn bản (#23), tra cứu hành vi/mức phạt/lịch sử (#24) và hỏi đáp AI có dẫn nguồn (#26). Dữ liệu lấy từ pipeline ở [preprocessing.md](preprocessing.md).

## API mới

| Method | Path | Mô tả |
| --- | --- | --- |
| `GET` | `/api/documents?q=&document_type=&agency=&limit=` | Tìm văn bản đã `ACCEPTED` theo số hiệu, tên, từ khóa; không dùng LLM. `q` rỗng liệt kê văn bản mới nhất. `limit` tối đa 50, vượt quá trả `400`. |
| `GET` | `/api/documents/:documentId` | Metadata, provision theo thứ tự đọc và `amendments`: ProvisionRelation tác động vào văn bản (kèm `verificationStatus` `ACCEPTED`/`CANDIDATE`). `404` nếu không có hoặc còn `REVIEW_REQUIRED`. |
| `POST` | `/api/ask` | Body `{ question, as_of? }`. Trả `status` (`ANSWERED`/`AMBIGUOUS`/`UNCERTAIN`/`NO_ANSWER`), `claims` mỗi claim dẫn `evidenceIds`, `evidence` (rule, mức phạt, hiệu lực, provision nguồn), `clarification`, `scope`, `provenance`. |

`GET /api/violations/:id/rules` có thêm `reasonCodes` cho từng rule để client tự dịch lý do `UNCERTAIN`.

Các endpoint đọc khác đã có: `/api/violations`, `/api/violations/:id`, `/rules?as_of=`, `/history`, `/api/documents/:id/relations`.

## Hỏi đáp AI (`backend/src/modules/ask`)

1. **Retrieval** (`ask.retrieval.ts`): khớp từ của câu hỏi với tên và alias của `TrafficViolation`; chỉ giữ khớp mạnh, nên câu hỏi không liên quan không lấy được gì. Nếu câu hỏi nêu phương tiện mà một số lineage có, các lineage khác bị loại.
2. **Evidence**: rule áp dụng (`CURRENT`) hoặc chưa chắc (`UNCERTAIN`) tại `as_of` theo `getRulesAsOf`. Không có rule nào → `NO_ANSWER`, không có claim.
3. **Trạng thái và claim** (`ask.answer.ts`) được lập bằng quy tắc, không phụ thuộc model: nhiều rule cùng hiệu lực → `AMBIGUOUS` kèm câu hỏi làm rõ; chỉ có rule `UNCERTAIN` → `UNCERTAIN`.
4. **LLM** (khi có `OPENAI_API_KEY`) chỉ diễn đạt lại claim. Claim bị loại nếu không dẫn evidence hợp lệ hoặc chứa số không có trong evidence đã dẫn. Nếu model lỗi, không còn claim hợp lệ hoặc không phủ hết evidence, trả câu trả lời lập từ rule và ghi `provenance.fallbackReason`.

Giới hạn: retrieval chỉ khớp theo từ trong tên/alias đã lưu, nên cách nói khác hẳn ("vượt đèn đỏ") chỉ tìm được khi đã có alias đó; endpoint chưa có xác thực hay rate limit; chưa có bộ QA held-out (#29).

## Giao diện (`web`)

| Route | Nội dung |
| --- | --- |
| `/` | Điểm vào. |
| `/documents` | Tìm văn bản (form `GET`, trạng thái nằm trên URL). |
| `/documents/[id]` | Tab **Nội dung** (cây Điều/Khoản/Điểm, nhãn phần bị sửa đổi/bãi bỏ kèm căn cứ) và **Quan hệ** (cạnh `ACCEPTED` tách riêng khỏi dẫn chiếu chưa xác minh, frontier, phạm vi dữ liệu). |
| `/violations` | Tìm hành vi theo alias. |
| `/violations/[id]?as_of=` | Quy định áp dụng tại ngày chọn (mỗi lineage/ngữ cảnh hiển thị riêng, rule `UNCERTAIN` có lý do) và lịch sử thay đổi theo lineage. |
| `/ask` | Hỏi đáp AI; mỗi claim có chip nguồn dẫn tới provision. |
| `/admin` | Trang nhập PDF trước đây ở `/` (vẫn chưa có xác thực, TODO #4). Job `needs_review` có nút **Xem xét**. |
| `/admin/review/[jobId]` | Xem lỗi/cảnh báo validation và danh sách Điều đã đọc của văn bản `REVIEW_REQUIRED`; nút **Duyệt và công bố** gọi `POST /api/jobs/:jobId/review`. |

Mọi liên kết nguồn có dạng `/documents/<documentId>#<provisionId>`. Phản hồi backend được kiểm tra ở biên (`web/src/lib/api/*`): dòng sai định dạng bị bỏ, status/loại không biết không được hiển thị như kết quả. Văn bản giải thích hiển thị cho người dùng do frontend sở hữu (tiếng Việt); không hiển thị chuỗi tiếng Anh từ backend.

Chạy thử: `cd backend && bun run dev` (cần D1 local đã migrate và dữ liệu), `cd web && cp .env.example .env && bun run dev`. Kiểm tra: `cd web && bun test && bun run check`.
