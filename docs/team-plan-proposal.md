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

- kiến trúc;
- implementation;
- integration;
- review code do AI coding agent hỗ trợ;
- automated test;
- sửa lỗi;
- CI/CD và release candidate.

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

## 3. Quy trình

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

## 4. Deliverable

- hệ thống chạy được end-to-end;
- bộ test và gold dataset;
- metric evaluation;
- bug/regression report;
- demo;
- API/MCP cho AI;
- câu trả lời AI có reference tới Provision nguồn.

## 5. Metric chính

- Provision Relation F1;
- Critical Change Recall;
- Current Rule Accuracy;
- Retrieval Recall@K / nDCG@K;
- AI Citation Precision;
- End-to-end Current Sanction Accuracy.
