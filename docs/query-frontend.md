# API và Giao diện — Soạn Luật Studio

Tài liệu kỹ thuật cho toàn bộ API và giao diện web của **Soạn Luật Studio** (Soạn thảo văn bản quy phạm pháp luật, Soát logic luật, Phân tích phạm vi tác động, Lược đồ 2 chế độ và Tra cứu/AI có dẫn nguồn). Pipeline nạp PDF nền xem tại [preprocessing.md](preprocessing.md).

## 1. Xác thực & Cô lập Workspace

- Xác thực dùng **Better Auth** (`email + password`) qua cookie phiên HttpOnly (`credentials: "include"`).
- Mọi request tới API dữ liệu trong Workspace tự động đính kèm header `X-Workspace-Id` (đọc từ `web/src/lib/stores/workspace-storage.ts` trong `web/src/lib/api/http.ts`).
- Backend kiểm tra quyền sở hữu Workspace (`resolveWorkspaceAccess`) cho từng request: chưa đăng nhập mà yêu cầu thao tác ghi hoặc truyền `X-Workspace-Id` → `401`; truy cập Workspace của tài khoản khác → `403`.

## 2. Hợp đồng API

### Auth & Workspaces

| Method | Path | Mô tả |
| --- | --- | --- |
| `POST` | `/api/auth/sign-up/email` · `/sign-in/email` · `/sign-out` | Đăng ký, đăng nhập và đăng xuất (Better Auth). |
| `GET` | `/api/auth/get-session` | Đọc phiên đăng nhập hiện tại. |
| `GET` | `/api/workspaces` | Liệt kê Workspace của tài khoản (tự khởi tạo Workspace mẫu kèm NĐ 100/123/168, TT 73/2024 và Dự thảo 2026 nếu chưa có). |
| `POST` | `/api/workspaces` | Tạo Workspace mới (`name`, `description?`, `domain?`, `seedSample?`). |
| `PATCH` / `DELETE` | `/api/workspaces/:workspaceId` | Đổi tên/mô tả hoặc xóa toàn bộ dữ liệu Workspace. |

### Soạn thảo thủ công & Nối cạnh lược đồ (yêu cầu đăng nhập)

| Method | Path | Mô tả |
| --- | --- | --- |
| `POST` / `PATCH` / `DELETE` | `/api/manual/documents[/:documentId]` | Tạo, cập nhật metadata/ngày hiệu lực và xóa văn bản dự thảo trong Workspace. |
| `POST` / `PATCH` / `DELETE` | `/api/manual/documents/:documentId/provisions[/:provisionId]` | Chèn, sửa nội dung và xóa cascade cây Chương / Mục / Điều / Khoản / Điểm. |
| `POST` / `DELETE` | `/api/manual/graph/document-relations[/:relationId]` | Nối/xóa cạnh ảnh hưởng cấp văn bản (`AMENDS`, `REPLACES`, `REPEALS`, `GUIDES`, `LEGAL_BASIS`, `REFERENCES`...). |
| `POST` / `DELETE` | `/api/manual/graph/provision-relations[/:relationId]` | Nối/xóa cạnh ảnh hưởng cấp Điều/Khoản/Điểm. |
| `POST` / `DELETE` | `/api/manual/graph/sanction-edges[/:edgeId]` | Nối/xóa cạnh biến động khung xử phạt (tăng nặng, giảm nhẹ, trừ điểm GPLX...). |

### Soát Logic Luật & Phân tích Phạm vi Tác động

| Method | Path | Mô tả |
| --- | --- | --- |
| `GET` | `/api/documents/:documentId/audit` | Chạy 16 quy tắc tất định soát logic luật trên 5 nhóm (`STRUCTURE`, `TEMPORAL`, `REFERENCE`, `SANCTION_CONFLICT`, `DRAFTING_TECHNIQUE`). Trả `summary` (`status`, `score`, `errorCount`, `warningCount`, `infoCount`), `findings[]` (kèm `provisionId`, `evidence`, `suggestion`) và `disclaimer`. |
| `GET` | `/api/documents/:documentId/impact?max_depth=1..5` | Phân tích phạm vi tác động trực tiếp (tầng 1) và lan truyền dây chuyền đa tầng (BFS trên đồ thị phụ thuộc ngược `GUIDES`/`DETAILS`/`LEGAL_BASIS`/`REFERENCES`/`AMENDS`), trả `directImpacts`, `indirectImpacts` (kèm `impactPath`), `affectedProvisions`, `sanctionShifts`, `affectedSubjects`, `unresolvedFrontier` và `synchronizationChecklist`. |
| `GET` | `/api/workspace/audit-summary` | Tổng quan điểm nhất quán, tổng số lỗi/cảnh báo và mức rủi ro tác động của toàn bộ văn bản trong Workspace hiện tại. |

### Lược đồ, Văn bản, Khung xử phạt & Hỏi đáp AI

| Method | Path | Mô tả |
| --- | --- | --- |
| `GET` | `/api/graph` | Đồ thị quan hệ 2 chế độ theo Workspace: `documents`, `provisions`, `documentRelations`, `provisionRelations` và `sanctionChangeEdges` (hợp nhất cạnh `AI` và `MANUAL`). |
| `GET` | `/api/documents?q=&document_type=&agency=&limit=` | Tìm văn bản `ACCEPTED` trong Workspace theo số hiệu, tên, từ khóa (không dùng LLM). |
| `GET` | `/api/documents/:documentId` | Metadata, danh sách provision theo thứ tự đọc và `amendments` tác động vào văn bản. |
| `GET` | `/api/documents/:documentId/relations` | Cạnh `ACCEPTED`, candidate chưa xác minh, `frontier` và phạm vi dữ liệu. |
| `GET` | `/api/documents/:documentId/dependents` | Văn bản đang tác động vào văn bản này (kể cả `CANDIDATE`); `deletable` là `true` khi là node lá. |
| `DELETE` | `/api/documents/:documentId` | Xóa văn bản node lá cùng provision, quan hệ đi ra, rule, job và tệp trên R2 (`409` kèm `dependents` nếu còn văn bản khác tác động vào nó). |
| `GET` | `/api/violations`, `/api/violations/:id`, `/rules?as_of=`, `/history` | Tìm hành vi, xem khung phạt theo mốc ngày `as_of` và chuỗi lịch sử theo `RuleLineage`. |
| `POST` | `/api/ask` | Hỏi đáp AI có căn cứ (`ANSWERED`/`AMBIGUOUS`/`UNCERTAIN`/`NO_ANSWER`) kèm `claims` dẫn chiếu bắt buộc tới `evidence` và `provisionId`. |

## 3. Giao diện (`web/src/routes`)

| Route | Nội dung |
| --- | --- |
| `/` | **LexIDE (Local-First Lawmaker IDE — [chi tiết](lexide.md)):** môi trường soạn thảo văn bản quy phạm pháp luật kiểu VS Code chạy 100% cục bộ trên trình duyệt (khởi đầu với Workspace trống, chọn thư mục máy hoặc nạp bộ dự thảo mẫu 10 tệp), tự động đẩy số `Điều`/`Khoản`/`Điểm`, kiểm định Tầng 0 + Lean 4 + Neuro-Symbolic Pipeline v4.1, nút **Sửa bằng AI** cho mọi lỗi, Lược đồ quan hệ, Tab Hành vi (bấm icon chỉ báo để mở & highlight), Run & Debug, xuất DOCX/PDF và hiển thị Token Usage tại Status Bar. |
| `/drafting?document=` | **Bàn soạn thảo cấu trúc:** chọn/tạo/xóa dự thảo, sửa metadata & ngày hiệu lực inline, chèn/sửa/xóa Chương/Mục/Điều/Khoản/Điểm, chuyển đổi 4 tab **Soạn thảo · Soát logic (live) · Phạm vi tác động (live) · Xem trước**. Bấm "Sửa điều khoản" trên lỗi logic sẽ nhảy thẳng về đúng điều khoản lỗi để chỉnh sửa. |
| `/audit?document=&tab=` | **Trung tâm Soát Logic & Phạm vi Tác động:** KPI toàn Workspace, danh sách văn bản kèm điểm nhất quán `0–100`, bộ lọc lỗi theo mức độ/nhóm quy tắc, cấu hình độ sâu lan truyền `1–5` tầng và danh mục khuyến nghị đồng bộ hóa. |
| `/graph?document=` | **Lược đồ tác động 2 chế độ:** chuyển đổi Chế độ 1 (Biến động mức xử lý hành vi) và Chế độ 2 (Ảnh hưởng văn bản & điều khoản), lọc theo loại cạnh/văn bản trọng tâm và bảng nối/xóa cạnh thủ công. |
| `/workspaces` | Quản lý nhiều Workspace độc lập cho tài khoản (tạo mới, tùy chọn nạp dữ liệu lập pháp mẫu, đổi tên, xóa, chuyển đổi nhanh). |
| `/login` | Đăng nhập và đăng ký tài khoản qua Better Auth. |
| `/documents`, `/documents/[id]` | Kho văn bản hiện hành & dự thảo; trang chi tiết có hai tab **Nội dung** (mục lục, highlight điều khoản bị sửa/bãi bỏ) và **Quan hệ**, kèm nút mở nhanh sang `/audit` và `/drafting`. |
| `/violations`, `/violations/[id]?as_of=` | Tra cứu khung xử phạt hành vi và lịch sử hiệu lực theo mốc thời gian (`as-of`). |
| `/ask?q=` | Trợ lý AI rà soát chồng chéo, căn cứ và lịch sử khung phạt có chip dẫn nguồn click được tới Provision. |
| `/admin`, `/admin/review/[jobId]` | Nhập PDF văn bản hiện hành bằng AI, theo dõi job, kiểm tra validation và duyệt công bố (`ACCEPTED`) + chạy lại checklist tiền xử lý. |

Mọi phản hồi backend đều được kiểm tra ở biên (`web/src/lib/api/*`: `analysis.ts`, `graph.ts`, `documents.ts`, `violations.ts`, `ask.ts`, `review.ts`); dòng sai định dạng bị bỏ qua an toàn, không hiển thị chuỗi lỗi nội bộ thô cho người dùng.

Chạy thử local:

```bash
cd backend && bun run d1:migrate:local && bun run dev
cd web && cp .env.example .env && bun run dev
```

Kiểm tra chất lượng:

```bash
cd backend && bun test && bun run typecheck
cd web && bun test && bun run check && bun run build
```
