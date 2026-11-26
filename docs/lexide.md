# LexIDE — Môi trường soạn thảo & kiểm định pháp luật (Lawmaker IDE)

**LexIDE** là môi trường soạn thảo văn bản quy phạm pháp luật theo phong cách **Visual Studio Code** (Dark Modern & Light Modern), tích hợp kiến trúc **Neuro-Symbolic Pipeline v4.1** giúp nhà làm luật phát hiện sớm **kẽ hở pháp lý (Loophole)**, **ngôn từ mơ hồ (Ambiguity)**, **lỗ hổng logic & dẫn chiếu (Logic)**, chứng minh toán học liên-điều bằng **Lean 4**, theo dõi **Lược đồ quan hệ** và **Hành vi / Lịch sử thay đổi**, đồng thời mô phỏng **Tòa án giả lập (Run & Debug)**.

> **Nguyên tắc Local-First & Workspace-Only:** Không yêu cầu đăng nhập. Người dùng chọn trực tiếp **thư mục trên máy** (`showDirectoryPicker` / `webkitdirectory`) để đọc, chỉnh sửa và lưu tệp luật; toàn bộ engine kiểm định tĩnh Tầng 0, **Lean 4 (0 token)**, **Lược đồ quan hệ**, **Hành vi**, **Run & Debug**, **Diff Viewer**, giải nén `.zip` và xuất **DOCX/PDF chuẩn Nghị định 30/2020/NĐ-CP (Times New Roman)** chạy 100% cục bộ trên trình duyệt (`web/src/lib/engine/`). Chỉ Tầng 1 (`gemini-decision-1`) và Tầng 2 (`gemini-3.5-flash-lite` / Gemini Interactions API) gọi trực tiếp bằng **Gemini API Key** do người dùng tự cung cấp qua Onboarding / Cài đặt.

---

## 1. Bố cục giao diện VS Code

| Thành phần | Vị trí | Chức năng chính |
| --- | --- | --- |
| **Activity Bar** | Thanh dọc bên trái (`48px`) | **7 chế độ**: **Explorer**, **Find and Replace**, **Source Control**, **Run and Debug**, **Library**, **Lược đồ quan hệ (`relations`)**, **Hành vi & Lịch sử (`behaviors`)**, cùng nút chuyển Dark Modern / Light Modern. |
| **Primary Sidebar** | Cột trái | Hiển thị nội dung tương ứng theo Activity Bar: cây dự thảo & Outline (kèm nút **Nạp bộ dự thảo mẫu** 10 tệp từ trạng thái Workspace trống ban đầu); Tìm & thay thế; Diff & Commit phiên bản; Tòa án giả lập; Thư viện luật nền; Lược đồ quan hệ văn bản; Danh sách hành vi & lịch sử sửa đổi (tự động mở, bung và highlight khi bấm vào icon chỉ báo hành vi trong editor). |
| **Law Editor** | Vùng trung tâm | Editor tab + Breadcrumb (kèm **Live AI Analyzer Indicator** + nút Hủy `AbortController`); tô màu cú pháp `Chương/Điều/Căn cứ`; gạch chân lượn sóng theo 3 nhóm lỗi; **chỉ báo hành vi** dạng icon gọn (`✦` cho hành vi mới, `⚖ N` cho hành vi có lịch sử) — bấm trực tiếp để mở & highlight trong tab Hành vi; **Hover Tooltip** khi rê chuột qua vùng lỗi hoặc **thuật ngữ đã định nghĩa** (kèm nút **Sửa bằng AI**); **IntelliSense** (`Ctrl+Space`, `Tab`) và **tự động đẩy số** `Điều`, `Khoản`, `Điểm` (`a, b, c, d, đ...`) phía sau khi chèn hoặc gõ tiền tố. |
| **Bottom Panel** | Bảng dưới | Chuyển đổi giữa **Vấn đề** (lọc Loophole / Mơ hồ / Logic + **Sửa nhanh** + nút **Sửa bằng AI** cho toàn bộ các lỗi) và **Lean 4 Compiler** (mệnh đề chứng minh `PROVED`/`REFUTED`, phản ví dụ, thống kê tiết kiệm token, mã `.lean`). |
| **Inspector** | Cột phải | Điểm chất lượng (0–100), phân tích kịch bản lách luật, nút **Sửa bằng AI** cho mọi lỗi, **Thuật ngữ & Văn bản định nghĩa**, **Ma trận ngưỡng định lượng**, và **Bản đồ dẫn chiếu nội bộ**. |
| **Status Bar** | Thanh xanh `#007acc` dưới cùng | Hiển thị phạm vi `Workspace`, trạng thái chạy **AI Analyzer** live, trạng thái biên dịch `Lean 4`, số lỗi theo nhóm, **Token Usage phiên làm việc** (`Tokens: tổng (in / out) · Tiết kiệm %`), vị trí con trỏ `Ln, Col`, và phím tắt. |

---

## 2. Bộ quy tắc kiểm định tĩnh & chuẩn dẫn chiếu pháp lý Việt Nam

### Kẽ hở pháp lý (`LOOPHOLE` — gạch chân vàng)
- `LP001`: Ngoại lệ mở không có căn cứ (`trừ trường hợp đặc biệt`, `trừ lý do chính đáng`...) không gắn `theo quy định tại Điều ...`.
- `LP002`: Hành vi bị `nghiêm cấm` / `cấm` hoặc điều khoản vi phạm nhưng thiếu chế tài (hỗ trợ cả chế tài hành chính và hình sự: `phạt tù`, `tù chung thân`, `tử hình`, `cải tạo không giam giữ`...).
- `LP003`: Khoảng trống định lượng giữa các khung (đa lĩnh vực: `km/h`, `mg/100ml`, `kilôgam`, `gam`, `đơn vị`, `giấy tờ giả`, `ảnh`, `GB`, `MB`, `m2`, `m3`, `%`...) — bao gồm cả khoảng trống **liên-điều** được chứng minh bởi Lean 4.
- `LP004`: Hình phạt bổ sung thiếu thời hạn hoặc định mức.
- `LP005`: Thiếu điều khoản `Hiệu lực thi hành` hoặc thiếu điều khoản chuyển tiếp khi sửa đổi/bãi bỏ.
- `LP006`: Chỉ quy định mức phạt cho `cá nhân`, bỏ sót `tổ chức` (tự động bỏ qua khi có điều khoản quy đổi `tổ chức bằng 02 lần cá nhân` hoặc `cá nhân bằng 1/2 / 50% tổ chức`).
- `LP007`: Điều khoản rỗng — mới có tiêu đề, chưa có nội dung quy phạm.

### Mơ hồ ngôn từ (`AMBIGUITY` — gạch chân xanh dương)
- `AM001`: Từ ngữ định tính không có thước đo (`hợp lý`, `kịp thời`, `nghiêm trọng`, `phù hợp`, `đáng kể`...). Tự động bỏ qua thuật ngữ đã được định nghĩa (như `tội phạm đặc biệt nghiêm trọng` tại Điều 9 BLHS) và `"phù hợp với quy định..."`.
- `AM002`: Liệt kê mở không giới hạn phạm vi (`và các trường hợp khác`, `v.v.`).
- `AM003`: Chế tài tùy nghi (`có thể bị phạt`, `có thể bị tước`...) — bỏ qua hình phạt bổ sung hợp lệ trong luật hình sự (`người phạm tội còn có thể bị...`).
- `AM004`: Tham chiếu ngược mơ hồ (`hành vi nêu trên`, `quy định nêu trên`...).
- `AM005`: Kiểm tra định nghĩa thuật ngữ bắt buộc trong `Điều Giải thích từ ngữ` / `Phân loại tội phạm` hoặc trong văn bản thuộc workspace, đồng thời phục vụ **Hover dẫn chiếu định nghĩa**.

### Lỗ hổng logic, dẫn chiếu & căn cứ (`LOGIC` — gạch chân đỏ)
- `LG001`: Khung tiền phạt hoặc ngưỡng định lượng bị đảo ngược (`min > max`).
- `LG002`: Chồng chéo ngưỡng định lượng (`OVERLAP`) trong cùng điều hoặc **liên-điều**.
- `LG003`: Dẫn chiếu nội bộ (`Điểm/Khoản/Điều`) không tồn tại trong dự thảo (bỏ qua khối trích dẫn sửa đổi trong ngoặc kép `“...”`).
- `LG004`: Dẫn chiếu vòng lặp vào chính nó (bao gồm cả từ Khoản/Điểm trỏ ngược lên chính Điều cha).
- `LG005`: Trùng hoặc nhảy cóc số thứ tự `Điều`, `Khoản`, `Điểm` (`a, b, c, d, đ, e...`).
- `LG006`: Thiếu dòng tiêu đề tên luật ở dòng đầu tiên (Header).
- `LG007`: Dẫn chiếu tới điều khoản đã có lệnh `Bãi bỏ` trong cùng dự thảo.
- `LG008`: Dẫn chiếu sai số `Điều` so với tên tội danh/mô tả trong ngoặc đơn (kèm QuickFix 1-click) hoặc dẫn chiếu trùng lặp trong cùng điều khoản.
- `LG009`–`LG014`: Audit **Căn cứ ban hành** và thẩm quyền theo **Nghị định 34/2016/NĐ-CP**, **Nghị định 154/2020/NĐ-CP**, **Nghị định 30/2020/NĐ-CP** (chỉ quét `Căn cứ` ở phần mở đầu; đúng thứ bậc Hiến pháp → Bộ luật/Luật → Pháp lệnh → Nghị quyết → Nghị định → Quyết định → Thông tư; không căn cứ văn bản hết hiệu lực; không vượt thẩm quyền sửa đổi).
- `LG015`: Kiểm định dẫn chiếu sai ngữ nghĩa bằng **Gemini Decisions API (`gemini-decision-1`, 0 output token)** kèm ngữ cảnh Điều liền kề (`Neighbor`) và anh em (`Sibling`).
- `LG016`: Nghịch lý tăng tiến khung hình phạt (khoản nặng hơn nhưng khung phạt tiền/tù tối đa lại thấp hơn, chứng minh Lean 4 `omega`).
- `LG017`: Điều khoản con bị bỏ sót dẫn chiếu (Orphaned Sub-Provision Graph Detector, 0 token).
- `WS001`: Văn bản dẫn chiếu ngoài chưa có trong Workspace làm việc.

---

## 3. Kiến trúc Neuro-Symbolic Pipeline v4.1 (Ưu tiên Accuracy Realtime & Tối ưu Token)

1. **Tầng 0 — AST / Graph / Lean 4 tất định (0 token, ~28–90 ms):**
   - Biên dịch cấu trúc văn bản (`parser.ts`), ngưỡng định lượng (`intervals.ts`), dẫn chiếu & căn cứ (`rules-logic.ts`, `workspace-relations.ts`) sang mã Lean 4 (`namespace LexIDE ... end LexIDE`) với `omega` và `decide`.
2. **Tầng 1 — Gemini Decisions API (`gemini-decision-1`, 0 output token):**
   - Sàng lọc rủi ro theo nhóm Điều (`triageArticleGroupsWithDecisionApi`) và audit dẫn chiếu ngữ nghĩa (`LG015`).
3. **Tầng 2 — Neuro-Symbolic Extractor + Anti-Hallucination Gate → Lean 4 (`llm-neurosymbolic.ts`):**
   - Gọi Gemini Interactions API (`POST /v1/interactions`) trích xuất mọi khoảng phân loại (`ExtractedPartitionRule`, không hardcode đơn vị) và lỗi nội tại (`ExtractedSemanticDefect`).
   - **Anti-Hallucination Gate:** Mọi kết quả đều phải neo nguyên văn (`findVerbatimSpan`) trong văn bản nguồn và chặn suy đoán luật ngoài không có trong workspace.
   - **Lean 4 Cross-Article Verifier:** Chứng minh toán học các khoảng trống / chồng chéo **xuyên nhiều Điều** và sinh phản ví dụ cụ thể.
4. **Realtime Accuracy-First (`+page.svelte`):**
   - Khi gõ (debounce `900 ms`, có `AbortController`), hệ thống chạy `deepNeuroSymbolic: true` kết hợp `IncrementalLlmCache.neuroSymbolicCache` (hash theo nhóm Điều + tự động re-anchor số dòng khi thêm/xóa phía trên), chỉ gửi lại đúng nhóm Điều vừa sửa.

---

## 4. Lược đồ quan hệ & Tab Hành vi / Lịch sử thay đổi

- **Lược đồ quan hệ (`workspace-relations.ts` + `RelationGraphPanel.svelte`):**
  - Theo dõi vòng đời văn bản (`ACTIVE`, `AMENDED`, `PARTIALLY_REPEALED`, `REPLACED`, `REPEALED`, `DRAFT`) và các cạnh (`BASED_ON`, `REPLACES`, `AMENDS`, `SUPPLEMENTS`, `AMENDS_SUPPLEMENTS`, `REPEALS`, `IMPLEMENTS`, `REFERENCES`).
- **Hành vi & Lịch sử thay đổi (`workspace-behaviors.ts` + `BehaviorsPanel.svelte`):**
  - Tổng hợp hành vi theo chủ thể và lịch sử biến động chế tài qua các đời luật (ví dụ: Luật Giao thông `100/2019 → 123/2021 → 168/2024`; Bộ luật Hình sự `100/2015 → 12/2017 → 86/2025` gồm tăng phạt tiền, bỏ tử hình, bãi bỏ điều luật) dựa trên nhận diện cấu trúc tổng quát.

---

## 5. Kết quả kiểm chứng thực nghiệm trên luật thật

- **Luật Giao thông đường bộ (`data/traffic-law-real/`):** Tầng 0 phát hiện chính xác văn bản bị thay thế (`23/2008/QH12`), sai thứ tự `Căn cứ` (`LG010`), theo dõi lịch sử vượt đèn đỏ qua 3 đời Nghị định.
- **Bộ luật Hình sự thật 500 trang (`data/blhs-real/library/` — `100/2015/QH13`, `12/2017/QH14`, `02/2018/NQ-HĐTP`, `86/2025/QH15`):** Phát hiện **`8 / 8` lỗi thật lịch sử** của BLHS 2015 (Điều 326, 359, 305, 303, 389, 235 K3, 298→225, 398→135), theo dõi lịch sử 3 đời luật.
- **Tập đa lĩnh vực `NghiemAbe/Legal-Corpus-Zalo` (`data/zalo-legal-subset/`, 6 văn bản, 208 Điều, 388,137 ký tự):** Tầng 0 quét toàn bộ 6 văn bản trong `618 ms` (0 token); trên `90/2020/NĐ-CP`, Pipeline v4.1 phát hiện và chứng minh bằng Lean 4 các dead zone liên-điều `(20%, 50%]`, `(50%, 70%)`, `[0%, 70%)` với **0 hallucination** trên Free Tier.

## Tài liệu liên quan

- [Slide Báo cáo Đồ án INT3011E_6 (18 Slides)](project-defense-slides.md)
- [Walkthrough End-to-End từ Empty Workspace (12 Slides)](walkthrough-slides.md)
