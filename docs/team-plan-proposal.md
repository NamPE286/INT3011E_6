# Đề xuất kế hoạch triển khai và phân công nhóm

**Dự án:** Vietnamese Traffic Violation Sanction Intelligence  
**Nhóm:** 6 thành viên

## 1. Mục tiêu

Xây dựng lớp dữ liệu/tri thức trung gian cho AI khi truy vấn về hành vi vi phạm giao thông và mức xử phạt.

Hệ thống xử lý trước:

- văn bản và quan hệ giữa các văn bản;
- Điều / Khoản / Điểm;
- hành vi vi phạm;
- mức xử phạt;
- lịch sử sửa đổi;
- quy định hiện hành và theo thời điểm;
- nguồn dẫn chứng.

Dữ liệu được cung cấp qua Web/API/MCP để AI retrieval trước khi trả lời.

## 2. Phân công

### 1 Lead / Developer

Phụ trách:

- thiết kế nghiệp vụ
- thiết kế kiến trúc
- thiết kế UXUI
- Crawl data
- triển khai code
- CI/CD.

### 5 Tester / Evaluator

**Evaluator 1 — Crawl & Provision**

- import VBPL;
- document graph;
- Điều / Khoản / Điểm;
- traceability.

**Evaluator 2 — Legal Relation**

- sửa đổi;
- bổ sung;
- thay thế;
- bãi bỏ;
- ProvisionRelation.

**Evaluator 3 — Violation & Sanction**

- hành vi vi phạm;
- mức phạt;
- context;
- identity/alias.

**Evaluator 4 — History & Current Rule**

- RuleLineage;
- lịch sử;
- current rule;
- as-of query;
- semantic change.

**Evaluator 5 — Search & AI**

- manual search;
- AI retrieval;
- grounded answer;
- citation;
- end-to-end testing.

## 3. Kế hoạch theo tuần

| Iteration | Thời gian | Issue / mục tiêu chính | Evaluator chính |
|---|---|---|---|
| I1 | 28/09–04/10 | [#4](https://github.com/NamPE286/INT3011E_6/issues/4) — Admin nhập văn bản VBPL, nền tảng import | E1 |
| I2 | 05/10–11/10 | Hoàn thiện [#4](https://github.com/NamPE286/INT3011E_6/issues/4); [#5](https://github.com/NamPE286/INT3011E_6/issues/5) — crawl văn bản liên quan và DocumentRelation | E1 |
| I3 | 12/10–18/10 | [#8](https://github.com/NamPE286/INT3011E_6/issues/8) — phân tách Điều/Khoản/Điểm và phân loại provision | E1 |
| I4 | 19/10–25/10 | [#11](https://github.com/NamPE286/INT3011E_6/issues/11) — ChangeInstruction và ProvisionRelation | E2 |
| I5 | 26/10–01/11 | [#15](https://github.com/NamPE286/INT3011E_6/issues/15) — trích xuất hành vi và chế tài | E3 |
| I6 | 02/11–08/11 | [#17](https://github.com/NamPE286/INT3011E_6/issues/17), [#18](https://github.com/NamPE286/INT3011E_6/issues/18), [#19](https://github.com/NamPE286/INT3011E_6/issues/19) — identity, lineage, current/as-of rule, semantic change | E3, E4 |
| I7 | 09/11–15/11 | [#23](https://github.com/NamPE286/INT3011E_6/issues/23), [#24](https://github.com/NamPE286/INT3011E_6/issues/24) — search/retrieval cho văn bản và hành vi | E5 |
| I8 | 16/11–22/11 | Hoàn thiện [#23](https://github.com/NamPE286/INT3011E_6/issues/23), [#24](https://github.com/NamPE286/INT3011E_6/issues/24) — document view, violation detail, timeline/history | E4, E5 |
| I9 | 23/11–29/11 | [#26](https://github.com/NamPE286/INT3011E_6/issues/26) — AI retrieval, grounded answer, citation, MCP/API | E5 |
| I10 | 30/11–06/12 | [#29](https://github.com/NamPE286/INT3011E_6/issues/29) — held-out evaluation, regression, metric, demo cuối | E1–E5 |

Trong mỗi iteration:

- Lead/Developer implement và tích hợp các issue của tuần.
- Evaluator chuẩn bị test case/gold data song song.
- Cuối iteration chạy test, evaluation và regression trước khi đóng issue.

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

- hệ thống chạy được end-to-end;
- bộ test và gold dataset;
- metric evaluation;
- bug/regression report;
- demo;
- API/MCP cho AI;
- câu trả lời AI có reference tới Provision nguồn.

## 6. Metric chính

- Provision Relation F1;
- Critical Change Recall;
- Current Rule Accuracy;
- Retrieval Recall@K / nDCG@K;
- AI Citation Precision;
- End-to-end Current Sanction Accuracy.
