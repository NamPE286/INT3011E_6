# Đề xuất kế hoạch triển khai và phân công nhóm

**Dự án:** Soạn Luật Studio — Ứng dụng Soạn thảo Luật kèm Soát Logic Luật & Phân tích Phạm vi Tác động  
**Corpus mẫu MVP:** Xử phạt vi phạm hành chính giao thông đường bộ Việt Nam  
**Nhóm:** 6 thành viên

## 1. Mục tiêu

Xây dựng nền tảng **soạn thảo văn bản quy phạm pháp luật** kết hợp tri thức pháp luật có cấu trúc từ văn bản hiện hành để:

- cho phép nhà soạn luật tạo Workspace độc lập và soạn dự thảo chuẩn cấu trúc Chương / Mục / Điều / Khoản / Điểm;
- tự động **soát logic luật** (kết cấu/đánh số, thứ tự hiệu lực, sửa văn bản đã bãi bỏ, chu trình mâu thuẫn, dẫn chiếu nội/ngoại văn bản bị treo, khung chế tài bất hợp lý và xung đột quy phạm ngầm);
- tự động **phân tích phạm vi tác động** trực tiếp (tầng 1) và lan truyền dây chuyền đa tầng (tầng 2–5 tới thông tư hướng dẫn/văn bản viện dẫn), tổng hợp biến động khung phạt, đối tượng chịu tác động, frontier chưa có trong kho và danh mục cần sửa đổi đồng bộ;
- cung cấp **lược đồ tác động 2 chế độ**, lịch sử hiệu lực `as-of` và trợ lý AI rà soát có dẫn chiếu nguồn.

## 2. Phân công

### 1 Lead / Developer

Phụ trách:

- thiết kế nghiệp vụ (SRS v1.0) & kiến trúc;
- thiết kế UX/UI bàn soạn thảo, trung tâm soát logic & tác động, lược đồ 2 chế độ;
- triển khai backend (Better Auth, Workspaces, Manual Drafting, Legal Logic Audit, Impact Scope, Dual-Mode Graph, AI PDF Pipeline & MCP) và frontend;
- CI/CD và deploy Cloudflare Workers.

### 5 Tester / Evaluator

**Evaluator 1 — Auth, Workspace & Drafting Studio**

- Better Auth, cô lập dữ liệu đa Workspace (`401`/`403`);
- soạn thảo Chương/Mục/Điều/Khoản/Điểm, sửa metadata/ngày hiệu lực, xem trước thể thức;
- import PDF văn bản hiện hành và traceability.

**Evaluator 2 — Legal Logic Audit (Soát logic luật)**

- kiểm thử 16 quy tắc soát logic thuộc 5 nhóm (kết cấu, thời gian/hiệu lực, dẫn chiếu, chế tài/xung đột ngầm, kỹ thuật lập pháp);
- kiểm tra độ chính xác phát hiện lỗi (không báo giả, nhảy đúng điều khoản lỗi).

**Evaluator 3 — Impact Scope & Dual-Mode Graph (Phạm vi tác động & Lược đồ)**

- đánh giá tác động trực tiếp tầng 1 và lan truyền dây chuyền đa tầng (Thông tư hướng dẫn, văn bản căn cứ);
- kiểm thử `unresolvedFrontier`, danh mục khuyến nghị đồng bộ hóa và lược đồ 2 chế độ (AI + thủ công).

**Evaluator 4 — Violation, Sanction & History As-of**

- trích xuất hành vi, khung phạt, trạng thái trừ điểm GPLX (`APPLIES/NOT_APPLICABLE/UNKNOWN`);
- `RuleLineage`, truy vấn `as-of` và semantic change.

**Evaluator 5 — Search, Grounded AI & End-to-End**

- tìm kiếm văn bản/hành vi, trợ lý AI có trích dẫn nguồn, kiểm chứng chống hallucination;
- kiểm thử end-to-end toàn quy trình soạn dự thảo → soát logic → đánh giá tác động → tra cứu.

## 3. Kế hoạch theo tuần

| Iteration | Thời gian | Mục tiêu chính | Evaluator chính |
| --- | --- | --- | --- |
| I1 | 28/09–04/10 | Nền tảng import PDF & lưu trữ D1/R2/Queues ([#4](https://github.com/NamPE286/INT3011E_6/issues/4)) | E1 |
| I2 | 05/10–11/10 | Đồ thị quan hệ văn bản & `DocumentRelation` ([#5](https://github.com/NamPE286/INT3011E_6/issues/5)) | E1, E3 |
| I3 | 12/10–18/10 | Phân tách Điều/Khoản/Điểm và phân loại provision ([#8](https://github.com/NamPE286/INT3011E_6/issues/8)) | E1 |
| I4 | 19/10–25/10 | `ChangeInstruction` và `ProvisionRelation` ([#11](https://github.com/NamPE286/INT3011E_6/issues/11)) | E2, E3 |
| I5 | 26/10–01/11 | Trích xuất hành vi, chế tài & Vocabulary MCP ([#15](https://github.com/NamPE286/INT3011E_6/issues/15)) | E4 |
| I6 | 02/11–08/11 | Identity, `RuleLineage`, `as-of` & semantic change ([#17](https://github.com/NamPE286/INT3011E_6/issues/17), [#18](https://github.com/NamPE286/INT3011E_6/issues/18), [#19](https://github.com/NamPE286/INT3011E_6/issues/19)) | E4 |
| I7 | 09/11–15/11 | Tra cứu văn bản, hành vi & hỏi đáp AI dẫn nguồn ([#23](https://github.com/NamPE286/INT3011E_6/issues/23), [#24](https://github.com/NamPE286/INT3011E_6/issues/24), [#26](https://github.com/NamPE286/INT3011E_6/issues/26)) | E5 |
| I8 | 16/11–22/11 | Better Auth, đa Workspace, Bàn soạn thảo cấu trúc & Lược đồ 2 chế độ | E1, E3 |
| I9 | 23/11–29/11 | Bộ máy **Soát logic luật** (16 quy tắc), **Phân tích phạm vi tác động** (trực tiếp + dây chuyền) & Trung tâm `/audit` | E2, E3 |
| I10 | 30/11–06/12 | Held-out evaluation, kiểm thử hồi quy, tối ưu UX & demo cuối ([#29](https://github.com/NamPE286/INT3011E_6/issues/29)) | E1–E5 |

## 4. Quy trình

```text
SRS / Issue
    ↓
Lead implement
    ↓
Review + CI
    ↓
Tester / Evaluator
    ↓
Fail → Fix → Retest
    ↓
Pass → Done
```

## 5. Deliverable

- ứng dụng Soạn Luật Studio chạy end-to-end (soạn thảo + soát logic + phạm vi tác động + lược đồ 2 chế độ + AI PDF/QA);
- bộ test tự động (backend + frontend) và gold dataset đánh giá;
- báo cáo metric & bug/regression;
- demo kịch bản lập pháp hoàn chỉnh;
- API/MCP nội bộ và câu trả lời AI có dẫn chiếu nguồn.

## 6. Metric chính

- Logic Audit Precision / Recall trên bộ kịch bản lỗi lập pháp (kết cấu, thời gian, dẫn chiếu, chế tài);
- Impact Scope Recall (trực tiếp tầng 1 và lan truyền dây chuyền đa tầng);
- Document & Provision Relation F1;
- Critical Change Recall & Current Rule Accuracy;
- AI Citation Precision & End-to-end Current Sanction Accuracy.
