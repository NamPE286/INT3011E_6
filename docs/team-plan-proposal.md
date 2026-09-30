# Đề xuất kế hoạch triển khai và phân công nhóm

**Dự án:** Vietnamese Traffic Violation Sanction Intelligence  
**Nhóm:** 6 thành viên  
**Mục đích tài liệu:** Đề xuất cách tổ chức nhóm, cách sử dụng AI trong quá trình phát triển và phương pháp đánh giá chất lượng hệ thống.

---

## 1. Tóm tắt đề tài

Dự án xây dựng một **lớp tri thức pháp lý có cấu trúc** cho các quy định xử phạt vi phạm giao thông đường bộ Việt Nam.

Thay vì để một mô hình AI tự tìm kiếm trên Internet và trực tiếp suy luận từ các văn bản rời rạc, hệ thống thực hiện trước các bước:

1. nhập văn bản từ CSDL quốc gia về văn bản pháp luật (VBPL);
2. crawl các văn bản có quan hệ liên quan;
3. phân tách cấu trúc Điều / Khoản / Điểm;
4. xác định quan hệ sửa đổi, bổ sung, thay thế và bãi bỏ;
5. trích xuất hành vi vi phạm và chế tài;
6. nối các quy định của cùng một hành vi qua thời gian;
7. xác định quy định hiện hành hoặc quy định tại một thời điểm cụ thể;
8. lập chỉ mục để hệ thống AI có thể retrieval từ dữ liệu đã xử lý;
9. trả lời câu hỏi kèm reference tới đúng Provision nguồn.

North-star question của hệ thống theo [SRS](./srs.md):

> Given a traffic violation, what is the currently applicable sanction, which provision establishes it, and how did that rule evolve over time?

Về mặt sử dụng với AI, hệ thống có thể được xem như một **domain knowledge / retrieval layer** nằm giữa nguồn VBPL và mô hình AI.

~~~text
CSDL VBPL
    │
    ▼
Crawl + Parse + Legal Relation Resolution
    │
    ▼
TrafficViolation / ViolationRule / Sanction / History
    │
    ▼
Search / Retrieval Layer
    │
    ├── Web application
    ├── HTTP API
    └── MCP interface cho AI
              │
              ▼
        AI answer + references
~~~

MCP là một interface để mô hình AI truy cập knowledge layer, không phải bản thân mục tiêu nghiên cứu chính của đề tài.

---

## 2. Vấn đề mà hệ thống giải quyết

Một câu hỏi tưởng như đơn giản:

> "Hành vi X hiện tại bị phạt bao nhiêu?"

không phải lúc nào cũng có thể trả lời chính xác chỉ bằng cách tìm một văn bản chứa từ khóa tương ứng.

Một quy định có thể:

- nằm ở nhiều Điều / Khoản / Điểm;
- được sửa đổi bởi văn bản khác;
- bị thay thế một phần;
- đã hết hiệu lực trong khi văn bản chứa nó vẫn còn hiệu lực một phần;
- có nhiều mức phạt khác nhau theo phương tiện hoặc context;
- có cách diễn đạt thay đổi qua từng thời kỳ.

Nếu AI chỉ thực hiện web search tại thời điểm người dùng hỏi, hệ thống có nguy cơ retrieve thiếu văn bản liên quan hoặc sử dụng một provision không còn áp dụng.

Do đó SRS áp dụng nguyên tắc:

> **retrieval-first, answer-last**

và yêu cầu các claim pháp lý quan trọng phải trace được về Provision nguồn.

Mục tiêu của dự án không phải chứng minh rằng AI luôn trả lời đúng, mà là xây dựng một pipeline có thể **giảm các nguồn sai số có thể kiểm soát được**, đồng thời đo được sai số ở từng bước.

---

## 3. Vì sao nhóm không chia đều 6 người cùng lập trình

Nhóm đề xuất phân công theo **năng lực và loại công việc**, thay vì chia đều số lượng code.

Trong dự án này, phần implementation có các đặc điểm:

- kiến trúc và domain model liên kết chặt chẽ;
- nhiều module phụ thuộc cùng một canonical model;
- thay đổi schema hoặc semantics ở một bước có thể ảnh hưởng toàn pipeline;
- sử dụng AI coding agent giúp tăng đáng kể tốc độ tạo implementation, test boilerplate và refactor;
- nhiều người cùng sửa core pipeline có thể làm tăng chi phí coordination, merge conflict và inconsistency.

Vì vậy nhóm đề xuất để **một thành viên có năng lực kỹ thuật cao nhất chịu trách nhiệm implementation và integration chính**, đồng thời sử dụng AI coding agent như công cụ hỗ trợ.

Tuy nhiên, AI-generated code không được xem là kết quả đúng mặc định. Người phụ trách kỹ thuật vẫn phải chịu trách nhiệm về:

- kiến trúc;
- lựa chọn domain model;
- kiểm tra code do AI sinh;
- integration;
- test tự động;
- security và data consistency;
- traceability;
- reproducibility;
- quyết định merge.

Phần nhân lực còn lại được chuyển sang **testing và evaluation độc lập**.

Điều này đặc biệt phù hợp với đề tài vì SRS dành một phần lớn yêu cầu cho:

- ground truth;
- accuracy;
- relation correctness;
- current-rule correctness;
- retrieval quality;
- citation correctness;
- error analysis.

Nói cách khác, bottleneck của dự án không chỉ là "viết đủ code", mà còn là **chứng minh hệ thống đang xử lý đúng dữ liệu pháp lý**.

---

## 4. Mô hình nhân sự đề xuất

### 4.1. Cấu trúc

~~~text
                    Lead / Developer
                          │
          implementation + integration
                          │
          ┌───────────────┼───────────────┐
          │               │               │
       feature         build          candidate
       output          artifact         release
          │               │               │
          ▼               ▼               ▼
   5 Tester / Evaluator theo domain độc lập
          │
          ▼
 test cases + gold data + metrics + bug reports
          │
          ▼
        Quality Gate
          │
    fail ─┴─ pass
      │        │
      ▼        ▼
    Fix       Done
~~~

### 4.2. Vai trò 1 — Lead / Developer

Trách nhiệm chính:

- quản lý scope theo SRS;
- thiết kế kiến trúc tổng thể;
- duy trì domain model;
- phân rã feature thành technical subtasks;
- implement backend, frontend và integration;
- sử dụng AI coding agent để tăng năng suất implementation;
- tự kiểm tra output do AI sinh;
- viết và duy trì automated tests cần thiết;
- xử lý bug do evaluator phát hiện;
- đảm bảo CI và Definition of Done;
- duy trì consistency giữa các module;
- chuẩn bị candidate build cho nhóm evaluation.

Lead không được tự coi feature là đạt chỉ vì implementation chạy thành công. Feature chỉ hoàn thành sau khi qua quality gate của evaluator theo [Tester Workflow](./workflow/tester.md).

---

## 5. Phân công 5 Tester / Evaluator

Năm thành viên không test chung một cách ngẫu nhiên. Mỗi người có **domain ownership** riêng và phải tạo artifact có thể kiểm tra được.

### Evaluator 1 — Source, Crawl & Provision Structure

Phạm vi:

- import từ VBPL;
- recursive crawl;
- DocumentRelation;
- Điều / Khoản / Điểm;
- source snapshot;
- traceability từ Provision về nguồn.

Liên quan chủ yếu:

- FR-01 đến FR-05;
- NFR-01;
- NFR-03;
- NFR-05;
- NFR-06.

Deliverable:

- corpus mẫu;
- crawl test cases;
- expected document graph;
- expected provision hierarchy;
- duplicate/cycle/error cases;
- bug reports;
- metric cho provision classification.

---

### Evaluator 2 — Legal Change Graph

Phạm vi:

- ChangeInstruction;
- ProvisionRelation;
- sửa đổi;
- bổ sung;
- thay thế;
- bãi bỏ;
- relation evidence.

Liên quan chủ yếu:

- FR-06;
- FR-07;
- NFR-01;
- NFR-02;
- NFR-04.

Deliverable:

- gold set cho amendment/repeal instructions;
- expected provision edges;
- ambiguous target cases;
- conflict cases;
- Provision Relation Precision / Recall / F1;
- error analysis cho relation resolution.

---

### Evaluator 3 — Violation & Sanction Extraction

Phạm vi:

- hành vi vi phạm;
- structured behavior fields;
- mức phạt;
- chế tài bổ sung;
- context theo phương tiện/chủ thể/điều kiện.

Liên quan chủ yếu:

- FR-08;
- FR-09;
- FR-10.

Deliverable:

- gold ViolationRule records;
- gold sanction records;
- alias/canonical behavior cases;
- ambiguous identity cases;
- field-level Precision / Recall / F1;
- sanction exact-match evaluation.

---

### Evaluator 4 — History, Current Rule & Semantic Change

Phạm vi:

- RuleLineage;
- lịch sử hành vi;
- current rule;
- as-of query;
- semantic change.

Liên quan chủ yếu:

- FR-11;
- FR-12;
- FR-13;
- NFR-06.

Deliverable:

- expected lineage;
- current-rule gold cases;
- historical/as-of cases;
- semantic change labels;
- Current Rule Accuracy;
- History Reconstruction Accuracy;
- Critical Change Recall.

---

### Evaluator 5 — Search, AI Answer & End-to-End QA

Phạm vi:

- document search;
- violation search;
- AI retrieval;
- grounded answer;
- citation;
- end-to-end scenario;
- regression trước demo/release.

Liên quan chủ yếu:

- FR-14 đến FR-20;
- NFR-07;
- NFR-08.

Deliverable:

- query/relevance dataset;
- manual search evaluation;
- AI retrieval evaluation;
- grounded QA set;
- citation support checks;
- end-to-end regression;
- demo acceptance checklist.

Metric chính:

- Recall@K;
- MRR / nDCG@K;
- AI Answer Correctness;
- Citation Coverage;
- Citation Precision;
- End-to-end Current Sanction Accuracy;
- As-of Rule Accuracy.

---

## 6. Nguyên tắc độc lập giữa Development và Evaluation

Một lý do quan trọng để tách 1 Developer và 5 Evaluator là giảm nguy cơ **người xây hệ thống tự tạo cả đáp án chuẩn để chấm chính hệ thống của mình**.

Đề xuất:

1. Lead cung cấp yêu cầu, schema đầu ra và tài liệu domain cần thiết.
2. Evaluator tự xây test cases / expected output từ SRS và nguồn VBPL.
3. Gold dataset dùng cho held-out evaluation không được dùng trực tiếp để hard-code implementation.
4. Không random split từng provision nếu các provision thuộc cùng một amendment lineage.
5. Development set và held-out set phải tách theo document lineage / amendment chain như quy định trong SRS.
6. Evaluator ghi failure trước khi trao đổi cách implementation đang hoạt động nếu có thể.
7. Khi bug được fix, evaluator thực hiện regression thay vì chỉ retest đúng một case.

Cách tổ chức này giúp evaluation có ý nghĩa hơn so với việc chia 6 người cùng implement rồi tự kiểm tra module của chính mình.

---

## 7. Quy trình làm việc

Repo hiện đã định nghĩa workflow:

~~~text
To do
  ↓
In progress
  ↓
Wait to review
  ↓
Reviewing
  ↓
Wait to test
  ↓
Testing
  ↓
Done
~~~

Đề xuất áp dụng như sau.

### Bước 1 — Feature definition

Parent issue chỉ mô tả **domain capability**.

Ví dụ:

- Admin nhập văn bản pháp luật;
- Trích xuất hành vi và chế tài;
- Xác định rule hiện hành;
- Tìm kiếm bằng AI có dẫn nguồn.

Lead phân rã parent issue thành technical subtasks khi implementation bắt đầu.

### Bước 2 — Implementation

Lead/Developer:

- implement;
- sử dụng AI coding agent khi phù hợp;
- chạy automated test;
- review code sinh bởi AI;
- tạo PR;
- cung cấp cách chạy và candidate build.

### Bước 3 — Evaluation preparation

Evaluator phụ trách domain chuẩn bị:

- test cases;
- ground truth;
- edge cases;
- acceptance checklist;
- metric cần chạy.

Công việc evaluation có thể bắt đầu song song với implementation dựa trên SRS, không cần chờ code hoàn thành.

### Bước 4 — Testing

Sau khi candidate pass review/check:

- evaluator chạy acceptance test;
- chạy held-out evaluation;
- ghi metric;
- tạo bug sub-issue nếu fail;
- feature quay lại development nếu không đạt quality gate.

### Bước 5 — Regression

Trước khi đóng iteration:

- evaluator domain retest;
- Evaluator 5 chạy end-to-end regression;
- kết quả metric được lưu để so sánh với iteration trước.

---

## 8. Sử dụng AI coding agent

Nhóm chủ động sử dụng AI trong quá trình development vì đây là công cụ tăng năng suất phù hợp với tính chất dự án.

AI coding agent có thể hỗ trợ:

- sinh boilerplate;
- implement module theo specification;
- refactor;
- sinh migration;
- viết test skeleton;
- rà soát code;
- tìm lỗi;
- viết tài liệu kỹ thuật.

Nhưng AI coding agent **không phải thành viên chịu trách nhiệm**.

Mọi output từ AI phải nằm dưới trách nhiệm của Lead/Developer.

Đặc biệt, AI không được tự quyết định:

- ý nghĩa pháp lý của dữ liệu;
- ground truth;
- tiêu chí pass/fail evaluation;
- liệu một citation có thực sự support claim hay không;
- liệu kết quả cuối có đủ điều kiện release hay không.

Những nội dung trên thuộc trách nhiệm của evaluator và acceptance process.

---

## 9. Quality gate

Một capability chỉ được coi là hoàn thành khi đáp ứng đồng thời:

### Engineering gate

- implementation hoàn thành;
- build/typecheck/test pass;
- không còn lỗi blocker;
- dữ liệu có traceability theo SRS;
- kết quả có thể reproduce.

### Domain gate

- acceptance criteria pass;
- edge cases chính đã được kiểm tra;
- không vi phạm deterministic evidence priority;
- ambiguous case không bị ép thành kết quả chắc chắn.

### Evaluation gate

- metric liên quan được chạy trên dataset đã định nghĩa;
- kết quả được ghi lại;
- regression so với baseline/iteration trước được kiểm tra;
- error analysis được cập nhật nếu có failure đáng kể.

Đối với AI answer, ngoài correctness còn bắt buộc kiểm tra:

- retrieval;
- citation coverage;
- citation precision;
- unsupported claim.

---

## 10. Các chỉ số đánh giá chính

SRS định nghĩa nhiều metric; nhóm đề xuất lấy ba metric nghiên cứu chính làm trục:

1. **Provision Relation F1**  
   Đo khả năng nối đúng Điều / Khoản / Điểm có quan hệ sửa đổi.

2. **Critical Change Recall**  
   Đo khả năng không bỏ sót các thay đổi pháp lý quan trọng.

3. **Current Rule Accuracy**  
   Đo khả năng xác định đúng rule đang áp dụng.

Đối với lớp AI/MCP, bổ sung:

4. **AI Retrieval Recall@K / nDCG@K**  
   AI có retrieve được evidence cần thiết hay không.

5. **AI Citation Precision**  
   Reference có thực sự hỗ trợ claim được sinh ra hay không.

6. **End-to-end Current Sanction Accuracy**  
   Từ câu hỏi hành vi đến mức phạt cuối cùng có đúng hay không.

Cách đo này giúp phân biệt:

~~~text
AI trả lời sai vì retrieve thiếu
≠
AI retrieve đúng nhưng synthesis sai
≠
knowledge layer đã resolve sai rule
≠
crawler/parser làm thiếu dữ liệu
~~~

Đây là một trong các mục tiêu quan trọng của kiến trúc dự án.

---

## 11. Phân bổ effort dự kiến

Phân công không đặt mục tiêu mỗi thành viên phải tạo số dòng code tương đương nhau.

Thay vào đó, mỗi thành viên phải tạo **đầu ra kiểm chứng được**.

| Vai trò | Đầu ra chính |
|---|---|
| Lead / Developer | architecture, implementation, integration, automated tests, candidate builds |
| Evaluator 1 | source/crawl/provision datasets và evaluation |
| Evaluator 2 | legal relation gold data và relation evaluation |
| Evaluator 3 | violation/sanction gold data và extraction evaluation |
| Evaluator 4 | lineage/current/as-of/change evaluation |
| Evaluator 5 | retrieval/AI/citation/E2E evaluation |

Tiến độ được đánh giá bằng issue, artifact và kết quả evaluation, không chỉ bằng commit count.

---

## 12. Rủi ro và cách giảm thiểu

### Rủi ro 1 — Lead trở thành single point of failure

Biện pháp:

- SRS và issue phải mô tả đầy đủ behavior;
- code phải có automated test;
- kiến trúc và setup được ghi trong repository;
- evaluator phải hiểu input/output của domain mình phụ trách;
- mọi thay đổi đi qua PR và CI;
- implementation không phụ thuộc knowledge chỉ tồn tại trong chat cá nhân.

### Rủi ro 2 — Tester chỉ kiểm tra UI/happy path

Biện pháp:

- mỗi tester có domain ownership;
- bắt buộc có gold dataset/expected result;
- có metric định lượng;
- có edge case và regression;
- evaluator chịu trách nhiệm giải thích failure.

### Rủi ro 3 — AI coding agent tạo code sai nhưng chạy được

Biện pháp:

- Lead review output;
- automated tests;
- held-out evaluation độc lập;
- deterministic legal evidence được ưu tiên trước semantic inference;
- không coi demo thành công là bằng chứng correctness.

### Rủi ro 4 — Evaluation bị leakage

Biện pháp:

- split theo document lineage / amendment chain;
- giữ held-out cases tách khỏi implementation;
- không hard-code expected output từ test set.

---

## 13. Kết quả mong đợi cuối kỳ

Nhóm không chỉ đặt mục tiêu có một website demo.

Kết quả cuối kỳ gồm:

1. pipeline ingest dữ liệu VBPL;
2. document/provision relation graph;
3. structured violation and sanction knowledge base;
4. history và current/as-of rule resolution;
5. manual search;
6. AI retrieval và grounded answer;
7. MCP/API interface để AI bên ngoài có thể sử dụng knowledge layer;
8. evaluation datasets;
9. baseline;
10. quantitative metrics;
11. error analysis;
12. end-to-end demo có reference về nguồn pháp lý.

Demo mục tiêu:

~~~text
User / AI:
"Vượt đèn đỏ hiện tại bị phạt bao nhiêu
và quy định này đã thay đổi như thế nào?"

        ↓

Knowledge / Retrieval Layer

        ↓

Current ViolationRule
+ Sanction
+ RuleLineage
+ History
+ Source Provisions

        ↓

Answer
+ claim-level legal references
~~~

---

## 14. Đề xuất cần giảng viên xác nhận

Nhóm đề xuất giảng viên xác nhận mô hình tổ chức sau:

> **01 Lead/Developer chịu trách nhiệm implementation và integration chính, có sử dụng AI coding agent; 05 thành viên còn lại tập trung vào testing và evaluation theo các domain độc lập.**

Lý do lựa chọn mô hình này:

- tận dụng chênh lệch năng lực kỹ thuật trong nhóm;
- giảm coordination overhead trong core implementation;
- tận dụng AI để tăng productivity;
- dành nhiều nhân lực hơn cho evaluation, vốn là phần quan trọng của đề tài Legal AI;
- tạo separation giữa người xây hệ thống và người xác minh kết quả;
- phù hợp với các yêu cầu traceability, reproducibility, uncertainty và quantitative evaluation đã nêu trong SRS.

Nhóm vẫn chịu trách nhiệm đầy đủ về sản phẩm và kết quả học thuật; AI được xem là **công cụ phát triển**, không phải chủ thể chịu trách nhiệm thay nhóm.

---

## Tài liệu liên quan

- [Software Requirements Specification](./srs.md)
- [Developer Workflow Guide](./workflow/dev.md)
- [Tester Workflow Guide](./workflow/tester.md)
- [README dự án](../README.md)
