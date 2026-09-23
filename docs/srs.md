# SRS — Vietnamese Traffic Violation Sanction Intelligence

**Version:** 0.4  
**Domain:** Xử phạt vi phạm giao thông đường bộ Việt Nam  
**Project type:** Legal AI / Engineering + R&D  
**Base project:** Legal Document Change Detection

---

## 1. Mục tiêu hệ thống

Hệ thống xây dựng cơ sở tri thức về **hành vi vi phạm giao thông và mức xử phạt tương ứng** từ các văn bản trên CSDL quốc gia về văn bản pháp luật (VBPL).

Điểm nhấn của hệ thống là **track hành vi qua nhiều văn bản và nhiều điều khoản khác nhau**.

Với một hành vi như:

~~~text
Đỗ xe trên phần đường xe chạy ngoài đô thị
~~~

hệ thống phải xác định được:

- quy định xử phạt hiện hành;
- mức phạt hiện hành;
- Điều / Khoản / Điểm đang là căn cứ;
- các điều khoản trước đó từng quy định cùng hành vi;
- điều khoản nào sửa đổi, bổ sung, thay thế hoặc bãi bỏ điều khoản nào;
- mức phạt và phạm vi hành vi đã thay đổi ra sao theo thời gian;
- văn bản nguồn cho từng thay đổi.

North-star question:

> Given a traffic violation, what is the currently applicable sanction, which provision establishes it, and how did that rule evolve over time?

---

## 2. Phạm vi

### 2.1. In scope

MVP chỉ tập trung vào **quy định xử phạt vi phạm hành chính đối với hành vi giao thông đường bộ**.

Các rule hình sự, dân sự hoặc trách nhiệm bồi thường không thuộc scope MVP.

Hệ thống xử lý các dữ liệu cần thiết để xác định:

- hành vi vi phạm;
- chủ thể / loại phương tiện;
- địa điểm, điều kiện và ngoại lệ;
- mức phạt tiền;
- trừ điểm giấy phép lái xe nếu có;
- hình thức xử phạt bổ sung liên quan trực tiếp;
- biện pháp khắc phục hậu quả liên quan trực tiếp;
- hiệu lực của rule;
- rule áp dụng tại một thời điểm cụ thể (as-of date);
- lịch sử sửa đổi, bổ sung, thay thế, bãi bỏ của rule;
- quan hệ giữa các Điều / Khoản / Điểm;
- quan hệ giữa các văn bản cần thiết để reconstruct lịch sử rule.

Nguồn dữ liệu MVP:

~~~text
https://vbpl.vn/
~~~

Admin chỉ được import bằng URL văn bản từ CSDL VBPL.

### 2.2. Crawl scope

Khi import một văn bản, hệ thống phải crawl recursive các văn bản liên quan được VBPL cung cấp nhằm xây dựng document graph đầy đủ.

Crawler phải:

- deduplicate theo source identifier / ItemID;
- chống cycle bằng visited set;
- lưu relationship giữa các văn bản;
- snapshot dữ liệu nguồn cần thiết;
- có retry cho request thất bại;
- có safety limit để tránh lỗi crawler tạo traversal vô hạn.

Semantic processing tập trung vào những provision có khả năng:

- định nghĩa hành vi vi phạm;
- quy định chế tài;
- sửa đổi / bổ sung rule;
- thay thế rule;
- bãi bỏ rule.

### 2.3. Out of scope

MVP không nhằm:

- bao phủ toàn bộ pháp luật giao thông;
- tư vấn pháp lý cho một vụ việc cụ thể;
- tự kết luận một cá nhân có vi phạm hay không;
- phân tích quy hoạch, hạ tầng hoặc tiêu chuẩn kỹ thuật không liên quan tới xử phạt hành vi;
- phân tích tổ chức bộ máy và trách nhiệm cơ quan nếu không tác động tới sanction rule;
- hỗ trợ upload PDF / DOCX / file tùy ý;
- thay thế CSDL VBPL chính thức;
- train foundation model riêng;
- yêu cầu human review cho mỗi extraction.

---

## 3. Actors

### 3.1. User

User có thể:

- search văn bản;
- xem nội dung văn bản;
- xem quan hệ của văn bản với các VBPL khác;
- thấy provision xử phạt nào còn hiệu lực hoặc đã bị tác động;
- search hành vi thủ công bằng full-text search;
- hỏi bằng AI chat để hệ thống tự tìm các hành vi / rule liên quan và trả lời kèm reference;
- xem mức phạt hiện hành;
- xem các provision hiện hành áp dụng cho hành vi;
- xem lịch sử provision và mức phạt của hành vi.

### 3.2. Admin

Admin có thể:

- import một URL từ vbpl.vn;
- xem trạng thái crawl / process;
- xem import ở trạng thái READY / PARTIAL / FAILED;
- retry import thất bại;
- trigger reprocess khi cần.

Admin và Reviewer được gộp thành một role.

MVP không có manual review queue bắt buộc.

### 3.3. System

System tự động:

- crawl document graph;
- parse Điều / Khoản / Điểm;
- classify provision relevance;
- extract amendment instructions;
- resolve provision-to-provision relations;
- extract traffic violations;
- extract sanctions;
- resolve identity của hành vi;
- detect semantic changes;
- reconstruct history;
- determine current rule;
- index cho full-text / semantic search;
- retrieve evidence cho AI chat;
- sinh câu trả lời có reference tới source provision.

---

## 4. Domain Definitions

### 4.1. Document

Một văn bản trên CSDL VBPL.

Ví dụ:

~~~text
Nghị định 36/CP
Nghị định 75/1998/NĐ-CP
Nghị định 36/2001/NĐ-CP
~~~

Một văn bản sửa đổi hoặc thay thế được model thành một Document riêng, không phải version của cùng một Document.

### 4.2. Provision

Đơn vị pháp lý có thể tham chiếu:

~~~text
Điều
Khoản
Điểm
~~~

Ví dụ:

~~~text
Điểm a Khoản 2 Điều 6
~~~

Provision là node chính trong provision change graph.

### 4.3. Document Relation

Quan hệ giữa hai văn bản, lấy chủ yếu từ VBPL.

Ví dụ:

~~~text
AMENDS
SUPPLEMENTS
PARTIALLY_REPLACES
FULLY_REPLACES
CORRECTS
REFERENCES
LEGAL_BASIS
GUIDES
DETAILS
SUSPENDS
~~~

Document Relation dùng để discover corpus và hỗ trợ resolve thay đổi, nhưng không thay thế Provision Relation.

### 4.4. Provision Relation

Quan hệ có hướng giữa hai Điều / Khoản / Điểm.

Các relation quan trọng:

~~~text
AMENDS
SUPPLEMENTS
REPLACES
REPEALS
REFERENCES
SPLITS_INTO
MERGES_INTO
~~~

Ví dụ:

~~~text
Nghị định A — Điểm a Khoản 2 Điều 6
        ↓ AMENDED_BY
Nghị định B — Khoản 3 Điều 1
~~~

Hệ thống phải lưu evidence chỉ ra vì sao hai provision được nối.

### 4.5. Traffic Violation

Canonical identity của một hành vi vi phạm giao thông.

Một TrafficViolation không đồng nhất với một Provision.

Một hành vi có thể được quy định bởi nhiều provision qua thời gian.

Ví dụ:

~~~text
ACTION:
    Đỗ xe

VEHICLE:
    Ô tô

LOCATION:
    Phần đường xe chạy

CONDITIONS:
    Ngoài đô thị
~~~

### 4.6. Violation Rule

Một rule cụ thể gắn TrafficViolation với một Provision trong một context pháp lý nhất định.

~~~text
TrafficViolation
      ↓
ViolationRule
      ↓
Provision
      ↓
Sanction
~~~

### 4.6.1. Rule Lineage

TrafficViolation là identity của **hành vi**, nhưng một hành vi có thể có nhiều rule song song theo vehicle / subject / context.

Vì vậy history không được tạo bằng cách nối tất cả ViolationRule của cùng một TrafficViolation vào một timeline duy nhất.

System phải duy trì **RuleLineage** để biểu diễn một chuỗi rule mà trong đó rule sau thực sự sửa đổi, thay thế hoặc kế thừa rule trước.

Ví dụ:

~~~text
TrafficViolation: Vượt đèn đỏ

├── RuleLineage: Ô tô
│   ├── Rule A
│   └── Rule B [CURRENT]
│
└── RuleLineage: Xe máy
    ├── Rule C
    └── Rule D [CURRENT]
~~~

Semantic diff chỉ được thực hiện giữa các rule thuộc cùng lineage hoặc có ProvisionRelation / legal evidence chứng minh quan hệ kế thừa.

### 4.6.2. Behavior Signature

Mỗi TrafficViolation phải có một semantic signature ổn định dùng cho resolution và deduplication.

Signature không chứa sanction hoặc effective date.

Tối thiểu có thể gồm:

~~~text
action
polarity
target
location
core conditions
~~~

Subject / vehicle / context có thể thuộc ViolationRule nếu chúng tạo ra các rule áp dụng song song thay vì một hành vi hoàn toàn khác.

### 4.6.3. Evidence Level

Mọi relation / mapping quan trọng phải ghi nhận evidence level:

~~~text
SOURCE_METADATA
EXPLICIT_LEGAL_TEXT
STRUCTURED_DERIVATION
SEMANTIC_INFERENCE
~~~

Evidence cấp thấp hơn không được override evidence pháp lý explicit.

### 4.7. Sanction

Chế tài áp dụng cho ViolationRule.

Tối thiểu hỗ trợ:

- fine_min;
- fine_max;
- currency;
- points_deducted;
- additional_sanction;
- remedial_measure.

### 4.8. Change Instruction

Biểu diễn có cấu trúc của một câu lệnh sửa đổi pháp luật.

Ví dụ:

~~~text
Sửa đổi điểm a khoản 2 Điều 6 như sau...
Bãi bỏ khoản 3 Điều 5.
Bổ sung điểm c vào khoản 4 Điều 7.
~~~

ChangeInstruction là bridge giữa raw amendment text và ProvisionRelation.

---

## 5. High-level Architecture

~~~text
                    ADMIN
                      │
                VBPL document URL
                      │
                      ▼
             VBPL Source Adapter
                      │
              fetch + snapshot
                      │
                      ▼
           Recursive Document Crawler
                      │
              DocumentRelation graph
                      │
                      ▼
            Provision Segmentation
                      │
                      ▼
          Provision Relevance Classifier
                      │
          ┌───────────┴───────────┐
          │                       │
     irrelevant               relevant
                                  │
                       ┌──────────┴──────────┐
                       ▼                     ▼
              Change Instruction      Violation/Sanction
                  Extraction              Extraction
                       │                     │
                       ▼                     ▼
                ProvisionRelation     ViolationRule IR
                       │                     │
                       └──────────┬──────────┘
                                  ▼
                         Violation Resolver
                                  │
                                  ▼
                       TrafficViolation identity
                                  │
                                  ▼
                           Rule Lineage
                                  │
                                  ▼
                         Semantic Change Engine
                                  │
                                  ▼
                      Current Rule + History
                                  │
                    ┌─────────────┴────────────────────────┐
                    ▼                                      ▼
              Document Search                      Violation Retrieval
                                                          │
                                             ┌────────────┴────────────┐
                                             ▼                         ▼
                                      Manual Full-text Search       AI Chat RAG
                                                                       │
                                                                       ▼
                                                           Answer + Provision References
~~~

---

## 6. Functional Requirements

## FR-01 — Import from CSDL VBPL

Only Admin can initiate import.

Input phải là URL hợp lệ thuộc vbpl.vn và resolve được tới một văn bản.

System phải:

1. validate source;
2. resolve source ItemID / identifier;
3. fetch metadata;
4. fetch full text;
5. fetch document relations;
6. lưu raw source snapshot;
7. tạo ImportJob;
8. bắt đầu recursive crawl.

ImportJob tối thiểu có lifecycle:

~~~text
QUEUED
→ DISCOVERING
→ FETCHING
→ PARSING
→ PROCESSING
→ INDEXING
→ READY
~~~

Nếu một phần related documents không thể fetch/process nhưng root corpus vẫn usable:

~~~text
PARTIAL
~~~

Nếu root document hoặc processing cốt lõi thất bại:

~~~text
FAILED
~~~

Import phải idempotent: import lại cùng source snapshot không được tạo duplicate Document / Provision / relation.

Không hỗ trợ file upload trong MVP.

---

## FR-02 — Recursive Related-document Crawl

Từ root document, system phải crawl recursive các document relations mà nguồn VBPL cung cấp.

Traversal:

~~~text
root
 ↓
related documents
 ↓
their related documents
 ↓
...
until no unseen document remains
~~~

System phải:

- deduplicate document;
- detect cycle;
- persist every discovered DocumentRelation;
- sử dụng source_item_id / canonical source URL làm stable source identity;
- không refetch document đã hoàn thành nếu snapshot còn hợp lệ;
- ghi nhận failed nodes để retry;
- không làm mất toàn bộ import nếu một related document fetch thất bại.

---

## FR-03 — VBPL Relationship Preservation

System phải preserve taxonomy quan hệ có ích từ VBPL để render lại cho user.

Document Relation View phải hỗ trợ các nhóm tương ứng như:

- Văn bản được hướng dẫn áp dụng;
- Văn bản được quy định chi tiết, hướng dẫn thi hành;
- Văn bản bị tác động hiệu lực một phần;
- Văn bản bị tác động hiệu lực toàn bộ;
- Văn bản được đính chính;
- Văn bản được dẫn chiếu;
- Căn cứ ban hành;
- Văn bản được giải thích;
- Văn bản bị đình chỉ thi hành;
- Văn bản bị tạm ngưng / gia hạn / công bố tiếp tục còn hiệu lực;
- các quan hệ inverse tương ứng của văn bản đang xem.

System có thể normalize tên quan hệ nội bộ nhưng phải giữ source category và provenance.

---

## FR-04 — Provision Segmentation

System phải parse hierarchy:

~~~text
Chương
Mục
Điều
Khoản
Điểm
~~~

Mỗi Provision phải giữ:

- document_id;
- parent_id;
- article_no;
- paragraph_no;
- point_no;
- raw_text;
- source anchor nếu có.

Mọi AI output downstream phải trace về Provision.

---

## FR-05 — Provision Relevance Classification

Mỗi provision phải được classify tối thiểu thành một trong:

~~~text
SANCTION_RULE
VIOLATION_RULE
AMENDMENT_INSTRUCTION
REPEAL_INSTRUCTION
REFERENCE
IRRELEVANT
UNCERTAIN
~~~

Chỉ provision liên quan tới traffic violation sanction hoặc legal change của sanction rule mới đi qua semantic pipeline đầy đủ.

---

## FR-06 — Change Instruction Extraction

Với provision sửa đổi / bổ sung / bãi bỏ / thay thế, system phải extract ChangeInstruction.

Ví dụ input:

~~~text
Sửa đổi điểm a khoản 2 Điều 6 như sau...
~~~

Output logic:

~~~json
{
    "operation": "AMEND",
    "target": {
        "article": "6",
        "paragraph": "2",
        "point": "a"
    }
}
~~~

Các operation tối thiểu:

~~~text
AMEND
SUPPLEMENT
REPLACE
REPEAL
CORRECT
~~~

---

## FR-07 — Provision Relation Resolution

System phải resolve ChangeInstruction thành edge giữa provision nguồn và provision bị tác động.

Ví dụ:

~~~text
Provision B
  └── AMENDS → Provision A
~~~

Mỗi edge phải lưu:

- relation_type;
- from_provision_id;
- to_provision_id;
- source_document_relation nếu có;
- evidence;
- evidence_level;
- resolution method;
- confidence.

ProvisionRelation là dữ liệu first-class, không được derive tạm thời chỉ khi render UI.

---

## FR-08 — Traffic Violation Extraction

Provision liên quan phải được parse thành structured violation representation.

Các dimension chính:

~~~text
ACTION
SUBJECT
VEHICLE
TARGET
LOCATION
CONDITION
EXCEPTION
CONSEQUENCE
~~~

Ví dụ:

~~~json
{
    "action": "Đỗ xe",
    "vehicle": "Ô tô",
    "location": "Phần đường xe chạy",
    "conditions": [
        "Ngoài đô thị",
        "Có lề đường"
    ],
    "exceptions": []
}
~~~

Một Provision có thể:

- không tạo TrafficViolation;
- tạo một ViolationRule;
- tạo nhiều ViolationRule.

Không được giả định Provision = TrafficViolation.

---

## FR-09 — Sanction Extraction

System phải extract sanction áp dụng cho từng ViolationRule.

Tối thiểu:

~~~text
fine_min
fine_max
currency
points_deducted
additional_sanction
remedial_measure
~~~

Sanction phải gắn với ViolationRule, không gắn trực tiếp một mức phạt duy nhất vào TrafficViolation.

Cùng hành vi có thể có sanction khác nhau theo:

- subject;
- vehicle;
- location;
- condition;
- consequence;
- effective period.

---

## FR-10 — Violation Identity Resolution

Đây là feature AI trung tâm.

Các ViolationRule từ nhiều văn bản phải được resolve về cùng một TrafficViolation khi chúng biểu diễn cùng hành vi pháp lý hoặc cùng lineage của hành vi.

Flow ưu tiên:

~~~text
normalize
→ canonical / alias match
→ structured field match
→ lexical / semantic retrieval
→ LLM resolver khi cần
~~~

Ví dụ:

~~~text
"không chấp hành hiệu lệnh của đèn tín hiệu giao thông"
≈
"vượt đèn đỏ"
~~~

Việc map không chỉ dựa vào similarity text; phải xét structured context như vehicle, location, condition và exception.

Resolver không được ép merge khi không đủ evidence.

Output tối thiểu:

~~~text
MATCH_EXISTING
CREATE_NEW
AMBIGUOUS
~~~

Nếu AMBIGUOUS, rule vẫn được lưu nhưng không được dùng để tự động tạo history lineage chắc chắn.

---

## FR-11 — Behavior-centric Provision History

TrafficViolation là identity trung tâm của history.

System phải reconstruct:

~~~text
TrafficViolation
   │
   ├── ViolationRule A
   │       └── Provision A
   │
   ├── ViolationRule B
   │       └── Provision B
   │
   └── ViolationRule C
           └── Provision C
~~~

Provision graph phải cho biết:

~~~text
A --AMENDED_BY--> B --REPLACED_BY--> C
~~~

Behavior history phải cho biết theo từng RuleLineage:

~~~text
Lineage 1: Rule A → Rule B → Rule C
Lineage 2: Rule D → Rule E
~~~

Hai graph phải liên kết được với nhau.

Không được nối hai ViolationRule chỉ vì chúng cùng TrafficViolation nếu không có legal / temporal / semantic evidence cho lineage đó.

---

## FR-12 — Current Rule Determination

Với mỗi TrafficViolation, system phải xác định những ViolationRule đang hiện hành dựa trên:

1. document effective status;
2. effective dates;
3. explicit DocumentRelation;
4. explicit ProvisionRelation;
5. ChangeInstruction;
6. semantic alignment.

Rule status tối thiểu:

~~~text
CURRENT
AMENDED
REPEALED
SUPERSEDED
UNCERTAIN
~~~

Không được đánh dấu CURRENT chỉ vì văn bản chứa provision còn hiệu lực nếu chính provision đã bị sửa hoặc bãi bỏ.

### FR-12.1 — Deterministic Current-rule Resolution

Current-rule resolution phải ưu tiên deterministic legal evidence trước AI.

Với một RuleLineage và thời điểm T:

1. loại rule chưa có hiệu lực tại T;
2. loại rule đã hết hiệu lực tại T;
3. apply REPEALS / REPLACES / AMENDS từ ProvisionRelation;
4. xét document effective status;
5. nếu còn nhiều candidate hợp lệ do context khác nhau, giữ tất cả thay vì chọn tùy ý;
6. chỉ dùng semantic inference để resolve phần chưa rõ.

### FR-12.2 — As-of Query

System phải hỗ trợ xác định rule áp dụng tại một ngày cụ thể.

Ví dụ:

~~~text
Mức phạt vượt đèn đỏ ngày 01/06/2022 là bao nhiêu?
~~~

As-of query phải sử dụng effective interval của ViolationRule / source provision, không dùng trạng thái CURRENT hiện tại.

---

## FR-13 — Semantic Change Detection

Khi hai ViolationRule trong cùng history lineage khác nhau, system phải tạo semantic diff.

Các change type tối thiểu:

~~~text
NO_SEMANTIC_CHANGE

VIOLATION_ADDED
VIOLATION_REMOVED

CONDITION_ADDED
CONDITION_REMOVED
CONDITION_CHANGED

EXCEPTION_ADDED
EXCEPTION_REMOVED

SUBJECT_CHANGED
VEHICLE_SCOPE_CHANGED
LOCATION_SCOPE_CHANGED

SANCTION_INCREASE
SANCTION_DECREASE
SANCTION_CHANGED
POINT_DEDUCTION_CHANGED
ADDITIONAL_SANCTION_CHANGED

REPEALED
REPLACED
UNKNOWN
~~~

Một transition có thể có nhiều change type.

---

## FR-14 — Legal Document Search

User có thể search document bằng:

- số hiệu;
- tên;
- từ khóa;
- loại văn bản;
- cơ quan ban hành;
- trạng thái hiệu lực.

Kết quả phải ưu tiên metadata từ nguồn VBPL.

---

## FR-15 — Legal Document View

Trang document có đúng hai tab chính.

### Tab 1 — Nội dung

Hiển thị:

- metadata;
- tình trạng hiệu lực;
- nội dung theo Điều / Khoản / Điểm;
- provision xử phạt bị tác động;
- trạng thái của relevant ViolationRule.

Relevant provision bị sửa đổi / thay thế / bãi bỏ phải được highlight.

User có thể mở history từ provision đó.

### Tab 2 — Quan hệ

Hiển thị relationship groups tương ứng với VBPL.

Mỗi related document có thể click để mở Document View nội bộ nếu đã crawl.

---

## FR-16 — Search by Traffic Violation

Hệ thống phải hỗ trợ hai chế độ tìm kiếm hành vi độc lập nhưng dùng chung TrafficViolation / ViolationRule knowledge base.

### FR-16.1 — Manual Full-text Search

User có thể nhập trực tiếp từ khóa hoặc mô tả hành vi:

~~~text
đỗ xe
vượt đèn đỏ
dừng xe ngoài đô thị
đi quá tốc độ 10 đến 20 km/h
~~~

Manual search không cần LLM để sinh câu trả lời.

Search phải hỗ trợ tối thiểu:

~~~text
full-text search trên canonical behavior
+ aliases
+ provision text
+ structured filtering nếu có
~~~

Kết quả trả về danh sách TrafficViolation / ViolationRule phù hợp, ưu tiên CURRENT rules.

Mỗi result tối thiểu hiển thị:

- hành vi;
- context chính;
- current sanction nếu có;
- current provision;
- source document;
- link tới detail/history.

### FR-16.2 — AI Chat Search

User có thể đặt câu hỏi tự nhiên thay vì tự chọn một hành vi cụ thể.

Ví dụ:

~~~text
Đỗ ô tô ngoài đô thị sai quy định thì bị phạt thế nào?
Vượt đèn đỏ hiện giờ phạt bao nhiêu và trước đây thay đổi ra sao?
Các lỗi liên quan đến dừng đỗ trên phần đường xe chạy là gì?
~~~

AI phải tự:

1. hiểu intent và context của câu hỏi;
2. tìm một hoặc nhiều TrafficViolation liên quan;
3. retrieve CURRENT ViolationRule và history cần thiết;
4. retrieve source Provision tương ứng;
5. tổng hợp câu trả lời;
6. đính kèm reference cho các claim pháp lý.

Pipeline:

~~~text
User question
      ↓
Query understanding
      ↓
Hybrid retrieval
(FTS + alias + structured + semantic)
      ↓
TrafficViolation candidates
      ↓
ViolationRule / Sanction / History retrieval
      ↓
Source Provision retrieval
      ↓
LLM answer synthesis
      ↓
Answer + references
~~~

AI chat phải theo nguyên tắc **retrieval-first, answer-last**.

AI không được:

- tự invent hành vi;
- tự invent mức phạt;
- tự invent trạng thái hiệu lực;
- đưa ra claim pháp lý mà không có evidence trong corpus.

Nếu evidence không đủ hoặc các rule mâu thuẫn / UNCERTAIN, câu trả lời phải thể hiện uncertainty thay vì ép một kết luận.

### FR-16.3 — AI Answer References

Reference phải ở **claim-level**, không chỉ đặt một danh sách nguồn chung ở cuối câu trả lời.

Mỗi claim quan trọng về:

- mức phạt;
- rule hiện hành;
- Điều / Khoản / Điểm;
- trạng thái hiệu lực;
- lịch sử thay đổi;

phải reference về ít nhất một Provision nguồn.

Reference tối thiểu phải cho phép user mở:

~~~text
Document
→ Điều
→ Khoản
→ Điểm
→ raw provision text
~~~

Ví dụ presentation:

~~~text
Phạt từ X đến Y đồng.
[Nghị định ..., Điều 6, Khoản 2, Điểm a]
~~~

Khi câu trả lời dựa trên history, AI phải có thể reference cả provision trước và provision sau của transition.

Mỗi reference phải mang stable Provision ID để UI có thể deep-link đúng Điều / Khoản / Điểm.

---

## FR-17 — Violation Detail

Khi user chọn một TrafficViolation, system phải hiển thị:

- canonical behavior;
- subject / vehicle;
- location / conditions / exceptions;
- current applicable sanction;
- current applicable provisions;
- effective period;
- source documents;
- confidence / uncertainty khi cần;
- link tới history.

Nếu có nhiều current rules do khác vehicle/context, UI phải hiển thị từng applicable rule riêng.

---

## FR-18 — Violation History

History phải hiển thị theo thời gian:

~~~text
Provision A
Fine: 400k–600k
[SUPERSEDED]
      ↓ AMENDED

Provision B
Fine: 600k–800k
[SUPERSEDED]
      ↓ REPLACED

Provision C
Fine: 800k–1m
[CURRENT]
~~~

Mỗi transition phải cho biết:

- provision trước;
- provision sau;
- relation;
- effective date;
- semantic change;
- sanction before / after;
- source document;
- evidence.

---

## FR-19 — Search Index

System phải duy trì ít nhất:

### Document Index

Dùng cho search văn bản.

### Violation Index

Index:

- canonical behavior;
- aliases;
- structured dimensions;
- provision text;
- current / historical rule status;
- embeddings nếu sử dụng.

Manual search phải sử dụng full-text search làm retrieval chính.

AI chat có thể sử dụng hybrid retrieval:

~~~text
full-text
+ alias
+ structured filters
+ vector retrieval
+ reranking nếu cần
~~~

Retrieval result phải giữ stable IDs của TrafficViolation, ViolationRule và Provision để answer layer có thể tạo reference chính xác.

---

## FR-20 — AI Provenance

Mọi AI output quan trọng phải lưu:

- task type;
- model;
- prompt/schema version;
- timestamp;
- confidence;
- raw output;
- normalized output;
- evidence provision;
- extraction run.

Không có human_verified requirement bắt buộc trong MVP.

---

## 7. Data Model

Core model:

~~~text
Document
├── DocumentRelation
└── Provision
    ├── ChangeInstruction
    ├── ProvisionRelation
    └── ViolationRule
        └── Sanction

TrafficViolation
├── ViolationAlias
└── RuleLineage
    └── ViolationRule

ExtractionRun
ChangeEvent
ImportJob
SourceSnapshot
~~~

Hai graph quan trọng:

~~~text
Document Graph
Document ──relation──> Document

Provision Graph
Provision ──AMENDS/REPLACES/...──> Provision
~~~

TrafficViolation đóng vai trò semantic identity nối các ViolationRule thuộc nhiều provision khác nhau.

---

## 8. Core Tables

### document

~~~text
id
source
source_item_id
document_number
title
document_type
issuer
issued_at
effective_from
effective_to
effective_status
source_url
created_at
~~~

### document_relation

~~~text
id
from_document_id
to_document_id
relation_type
source_category
source
raw_label
~~~

### provision

~~~text
id
document_id
parent_id
article_no
paragraph_no
point_no
provision_type
raw_text
source_anchor
~~~

### change_instruction

~~~text
id
source_provision_id
operation
target_document_id
target_locator_json
raw_text
confidence
~~~

### provision_relation

~~~text
id
from_provision_id
to_provision_id
relation_type
evidence
method
confidence
~~~

### traffic_violation

~~~text
id
canonical_name
semantic_ir
created_at
~~~

### violation_alias

~~~text
id
traffic_violation_id
alias
normalized_alias
embedding
~~~

### rule_lineage

~~~text
id
traffic_violation_id
lineage_key
context_ir
status
~~~

### violation_rule

~~~text
id
traffic_violation_id
rule_lineage_id
provision_id
semantic_ir
effective_from
effective_to
status
confidence
evidence_level
~~~

### sanction

~~~text
id
violation_rule_id
fine_min
fine_max
currency
points_deducted
additional_sanction
remedial_measure
~~~

### change_event

~~~text
id
traffic_violation_id
old_violation_rule_id
new_violation_rule_id
provision_relation_id
change_types
effective_at
confidence
~~~

### import_job

~~~text
id
root_document_id
source_url
status
documents_discovered
documents_processed
documents_failed
source_snapshot_hash
started_at
finished_at
error
~~~

---

## 9. Processing Flow

### Phase 1 — Crawl

~~~text
VBPL URL
 ↓
validate
 ↓
fetch document
 ↓
extract metadata + relations
 ↓
enqueue unseen related documents
 ↓
repeat until graph exhausted
~~~

### Phase 2 — Provision parsing

~~~text
Documents
 ↓
segment Điều / Khoản / Điểm
 ↓
classify relevance
~~~

### Phase 3 — Legal change graph

~~~text
Amendment / repeal provisions
 ↓
extract ChangeInstruction
 ↓
resolve target provision
 ↓
create ProvisionRelation
~~~

### Phase 4 — Traffic violation extraction

~~~text
Relevant sanction provisions
 ↓
extract ViolationRule
 ↓
extract Sanction
~~~

### Phase 5 — Behavior resolution

~~~text
ViolationRule
 ↓
normalize
 ↓
retrieve candidate TrafficViolation
 ↓
resolve identity
 ↓
attach rule
 ↓
resolve RuleLineage
~~~

### Phase 6 — History reconstruction

~~~text
ProvisionRelation
+
TrafficViolation identity
+
effective dates
 ↓
Violation history
 ↓
semantic diff
 ↓
current rule
~~~

---

## 10. Change Resolution Priority

Khi xác định legal change, evidence được ưu tiên:

~~~text
1. Explicit VBPL document relation
2. Explicit amendment / repeal wording
3. Resolved ProvisionRelation
4. Effective date / status
5. Semantic inference
~~~

AI semantic inference không được override explicit legal evidence.

Nếu semantic inference mâu thuẫn với explicit source metadata hoặc explicit amendment text, system phải giữ explicit evidence và ghi conflict để debug / evaluation.

Nếu evidence không đủ:

~~~text
UNCERTAIN
~~~

---

## 11. API sơ bộ

### Public — Documents

~~~http
GET /documents/search?q=
GET /documents/:id
GET /documents/:id/content
GET /documents/:id/relations
~~~

### Public — Provisions

~~~http
GET /provisions/:id
GET /provisions/:id/history
GET /provisions/:id/relations
~~~

### Public — Violations

~~~http
GET  /violations/search?q=
GET  /violations/:id
GET  /violations/:id/rules?as_of=
GET  /violations/:id/history
POST /violations/chat
~~~

### Admin

~~~http
POST /admin/imports
GET  /admin/imports
GET  /admin/imports/:id
POST /admin/imports/:id/retry
~~~

Import payload:

~~~json
{
    "url": "https://vbpl.vn/...ItemID=..."
}
~~~

---

## 12. UI Requirements

### 12.1. Document Search

Search box + filters.

Result hiển thị:

- số hiệu;
- tên;
- loại;
- ngày hiệu lực;
- tình trạng hiệu lực.

### 12.2. Document View — Nội dung

~~~text
Document metadata

[Nội dung] [Quan hệ]

Điều 1
Điều 2

⚠ Điểm a Khoản 2 Điều 6
Rule status: SUPERSEDED
Affected behavior: Đỗ xe ngoài đô thị
[View history]
[View rule at date]
~~~

### 12.3. Document View — Quan hệ

Render theo nhóm quan hệ giống mental model của CSDL VBPL.

~~~text
Văn bản được hướng dẫn áp dụng (...)
Văn bản được quy định chi tiết, hướng dẫn thi hành (...)
Văn bản bị tác động hiệu lực một phần (...)
Văn bản bị tác động hiệu lực toàn bộ (...)
...
VĂN BẢN ĐANG XEM
...
Các văn bản tác động / hướng dẫn / thay thế (...)
~~~

### 12.4. Violation Search

UI phải cho phép user chọn giữa hai mode:

~~~text
[ Search ] [ Ask AI ]
~~~

Manual Search:

~~~text
Search:
[ vượt đèn đỏ ]

Results:
- Không chấp hành hiệu lệnh của đèn tín hiệu giao thông
  Current sanction: ...
  Source: ...
~~~

Ask AI:

~~~text
User:
Vượt đèn đỏ hiện giờ phạt bao nhiêu và trước đây thay đổi thế nào?

AI:
<answer tổng hợp từ retrieved rules>

References:
[1] Nghị định ..., Điều ..., Khoản ..., Điểm ...
[2] Nghị định ..., Điều ..., Khoản ..., Điểm ...
~~~

Reference phải click được để mở đúng provision trong Document View.

### 12.5. Violation Detail

~~~text
Không chấp hành hiệu lệnh của đèn tín hiệu giao thông

Current sanction
...

Current provisions
...

[View history]
~~~

### 12.6. Violation History

~~~text
2019 ───────── 2021 ───────── 2025 ───── Current
Rule A          Rule B          Rule C
6–8m            8–10m          18–20m
     ↑                ↑
 AMENDED          REPLACED
~~~

Click một transition hiển thị provision relation và semantic diff.

---

## 13. Non-functional Requirements

### NFR-01 — Traceability

100% kết luận về:

- TrafficViolation;
- Sanction;
- current rule;
- legal change;
- history transition;

phải trace được về ít nhất một Provision nguồn.

### NFR-02 — Explainability

System không được chỉ trả:

~~~text
Rule này đã hết hiệu lực.
~~~

Mà phải chỉ được:

- provision bị tác động;
- provision tác động;
- relation;
- source document;
- effective date;
- semantic change nếu có.

### NFR-03 — Reproducibility

Source HTML / extracted source snapshot cần được lưu đủ để evaluation có thể tái lập.

### NFR-04 — AI Failure Safety

Nếu không đủ evidence:

~~~text
UNCERTAIN
~~~

thay vì ép một mapping hoặc legal status.

### NFR-05 — Source Respect

Crawler phải có throttling, retry/backoff và cache phù hợp.

### NFR-06 — Data Consistency

System phải enforce:

- unique source identity cho Document;
- không duplicate Provision trong cùng snapshot;
- không tạo cyclic successor chain trong cùng RuleLineage;
- effective_from <= effective_to khi effective_to tồn tại;
- CURRENT rules trong cùng lineage không được overlap nếu context giống nhau, trừ khi trạng thái UNCERTAIN được ghi rõ.

### NFR-07 — Grounded AI Answers

AI chat chỉ được trả lời từ evidence đã retrieve trong corpus.

Các claim pháp lý quan trọng phải có reference tới Provision nguồn.

Nếu không retrieve được evidence đủ mạnh, system phải trả lời theo trạng thái không đủ căn cứ thay vì hallucinate.

Answer generation không được thay đổi dữ liệu canonical trong TrafficViolation / ViolationRule / Sanction.

### NFR-08 — Processing Observability

Mỗi ImportJob phải expose đủ trạng thái để xác định document nào:

- discovered;
- fetched;
- parsed;
- processed;
- indexed;
- failed.

Mỗi ExtractionRun phải trace được model / parser version và source snapshot hash để reproduce kết quả.

---

## 14. Evaluation

Dataset evaluation tập trung vào các chuỗi quy định xử phạt giao thông có amendment / replacement thực tế.

| Task | Metric |
|---|---|
| Relevant Provision Classification | Precision / Recall / F1 |
| Change Instruction Extraction | Field F1 / Exact Match |
| Provision Relation Resolution | Precision / Recall / F1 |
| Violation Extraction | Field Precision / Recall / F1 |
| Sanction Extraction | Field F1 / Whole-record Exact Match |
| Violation Identity Resolution | Accuracy / Macro F1 |
| Semantic Change Detection | Precision / Recall / F1 |
| Critical Change Detection | Critical-change Recall |
| Current Rule Determination | Accuracy |
| Manual Violation Search | Recall@K / MRR |
| AI Chat Retrieval | Recall@K / nDCG@K |
| AI Answer Correctness | Accuracy / task-specific QA score |
| AI Citation Coverage | % legal claims with valid Provision reference |
| AI Citation Precision | % references that actually support the claim |
| History Reconstruction | Edge / Timeline Accuracy |
| End-to-end Current Sanction QA | Exact / Structured Answer Accuracy |
| As-of Rule QA | Accuracy |

### Dataset split policy

Train / development / test split không được random theo từng provision nếu các provision cùng một legal lineage có thể rơi vào nhiều split.

Ưu tiên split theo:

~~~text
document lineage / amendment chain
~~~

để tránh leakage giữa rule cũ và rule sửa đổi.

Evaluation report phải có error analysis tối thiểu theo nhóm:

~~~text
crawler/source failure
provision segmentation
change-target resolution
violation identity
rule-lineage resolution
sanction extraction
current-rule resolution
retrieval
answer synthesis
citation
~~~

### Primary research metrics

~~~text
Provision Relation F1
Critical Change Recall
Current Rule Accuracy
~~~

Ba metric này phản ánh trực tiếp khả năng:

1. track Điều/Khoản/Điểm nào tác động tới nhau;
2. detect thay đổi quan trọng;
3. xác định rule hiện hành cho một hành vi.

---

## 15. Baselines

### Provision relation resolution

~~~text
explicit locator / regex only
vs
text retrieval
vs
structured extraction + resolver
~~~

### Violation extraction

~~~text
regex / keyword
vs
LLM zero-shot
vs
structured parser
~~~

### Violation identity resolution

~~~text
exact match
vs
embedding Top-1
vs
structured retrieval + LLM
~~~

### Change detection

~~~text
raw text diff
vs
sanction-field diff
vs
ViolationRule structural semantic diff
~~~

### Current rule determination

~~~text
document effective status only
vs
document relation graph
vs
document + provision relation + behavior history
~~~

### AI chat retrieval / QA

~~~text
FTS Top-K + template answer
vs
vector retrieval + LLM
vs
hybrid retrieval + structured legal context + LLM
~~~

AI QA evaluation phải tách retrieval quality khỏi answer quality để phân biệt lỗi tìm sai evidence và lỗi sinh câu trả lời.

### End-to-end current sanction QA

~~~text
direct LLM over raw provision corpus
vs
RAG over provision text
vs
behavior-centric knowledge base + provision lineage + grounded answer
~~~

---

## 16. MVP Acceptance Criteria

MVP hoàn thành khi:

1. Admin import được một URL hợp lệ từ CSDL VBPL.
2. System recursive crawl được các related documents và chống duplicate/cycle.
3. Document relationships được lưu và hiển thị.
4. System parse được Điều / Khoản / Điểm.
5. System classify được provision liên quan tới xử phạt hành vi giao thông.
6. System extract được amendment / repeal instruction.
7. System tạo được ProvisionRelation giữa các điều khoản ở cùng hoặc khác văn bản.
8. System extract được TrafficViolation từ provision.
9. System extract được ít nhất sanction dạng tiền phạt.
10. Nhiều ViolationRule cùng hành vi được map về một TrafficViolation identity.
11. System xác định được current ViolationRule.
12. User search được văn bản.
13. Document View có đúng hai tab chính: Nội dung và Quan hệ.
14. Provision bị sửa / thay thế / bãi bỏ được highlight và mở được history.
15. User search thủ công được hành vi bằng full-text search.
16. User có thể hỏi bằng AI chat; system tự retrieve hành vi / rule liên quan.
17. AI chat trả lời current sanction / history khi corpus có đủ evidence.
18. Mọi claim pháp lý quan trọng trong AI answer có reference tới source Provision.
19. Violation Detail hiển thị current sanction và current provisions.
20. Violation History hiển thị chuỗi provision relations và semantic changes.
21. Mọi result quan trọng trace được về raw source provision.
22. System hỗ trợ as-of query cho ít nhất một historical violation lineage.
23. System không merge các rule context khác nhau vào cùng history lineage nếu không có evidence.
24. AI xử lý được query thiếu context bằng cách trả nhiều applicable rule hoặc yêu cầu làm rõ.
25. Import cùng source snapshot nhiều lần không tạo duplicate domain entities.
26. Có evaluation dataset độc lập, gồm cả query / QA cases và split tránh lineage leakage.
27. Có baseline cho các task AI chính, bao gồm retrieval / QA.
28. Có ít nhất một end-to-end evaluation từ câu hỏi → current/as-of sanction → supporting Provision reference.

---

## 17. Demo Scenario

~~~text
1. Admin import một URL VBPL.

2. System crawl recursive document graph.

3. System parse provisions.

4. System phát hiện:
   Document B sửa Document A.

5. System resolve xuống:
   Provision B AMENDS Provision A.

6. Cả Provision A và B được map vào:
   TrafficViolation "Đỗ xe ngoài đô thị".

7. System extract:
   Rule A: 400k–600k
   Rule B: 800k–1m

8. Semantic diff:
   SANCTION_INCREASE.

9. User dùng Manual Search:
   "đỗ xe ngoài đô thị"

10. System trả:
    matching TrafficViolation;
    current sanction;
    current provision;
    current source document.

11. User mở History.

12. System hiển thị:
    Provision A → Provision B → ...
    cùng relation, effective date và mức phạt từng thời kỳ.

13. User chuyển sang Ask AI:
    "Đỗ xe ngoài đô thị hiện bị phạt bao nhiêu và mức phạt đã thay đổi thế nào?"

14. AI retrieve TrafficViolation + current rule + history và trả lời kèm references tới từng Provision liên quan.

15. User click reference để mở đúng Điều / Khoản / Điểm trong Document View.

16. Tab Nội dung highlight provision cũ là SUPERSEDED.

17. Tab Quan hệ hiển thị graph quan hệ VBPL của document.

18. User hỏi:
    "Mức phạt hành vi này năm 2022 là bao nhiêu?"

19. System sử dụng as-of resolution để trả historical rule và reference đúng provision tại thời điểm đó.

20. Với câu hỏi thiếu vehicle/context, AI hiển thị nhiều applicable rules hoặc yêu cầu bổ sung context thay vì tự chọn một rule.
~~~

---

## 18. Research Contribution

Project không chỉ scrape hoặc hiển thị dữ liệu VBPL.

VBPL cung cấp document-level source và document relationships.

Contribution của hệ thống nằm ở việc tự động:

1. resolve thay đổi xuống cấp Điều / Khoản / Điểm;
2. tạo ProvisionRelation graph;
3. extract TrafficViolation và Sanction;
4. nhận diện cùng một hành vi qua nhiều wording / provision;
5. dùng hành vi làm identity để nối rule qua thời gian;
6. semantic-diff các rule;
7. xác định rule hiện hành và reconstruct legal history có traceability;
8. tách TrafficViolation identity khỏi RuleLineage để không trộn các rule context song song;
9. hỗ trợ temporal/as-of legal QA;
10. cung cấp cited AI retrieval/QA trên cùng behavior-centric knowledge base.

Core research pipeline:

~~~text
Document relationship
        ↓
Provision relationship
        ↓
TrafficViolation identity
        ↓
Semantic rule change
        ↓
Current sanction + legal history
        ↓
Manual search + grounded AI QA
~~~

---

## 19. Technical Direction

Hệ thống nên giữ abstraction:

~~~text
VBPLSourceAdapter
~~~

thay vì phụ thuộc trực tiếp vào HTML structure ở domain layer.

Adapter tối thiểu:

~~~text
getDocument()
getContent()
getMetadata()
getRelations()
~~~

Implementation MVP có thể dùng scraping nếu không có public API ổn định.

Dữ liệu domain phù hợp với relational database.

Raw HTML / snapshots có thể lưu object storage.

Manual behavior search dùng full-text search.

AI chat dùng retrieval layer tách biệt với answer generation; có thể kết hợp full-text, alias, structured filters và embedding. Answer generator chỉ nhận retrieved legal evidence và phải giữ reference IDs tới Provision.

Không cần graph database trong MVP; DocumentRelation và ProvisionRelation có thể model bằng relational tables.

---

## 20. Nguyên tắc thiết kế cốt lõi

1. **Behavior-centric**  
   TrafficViolation là semantic identity xuyên suốt history.

2. **Provision relations are first-class**  
   Hệ thống phải biết Điều/Khoản/Điểm nào sửa, bổ sung, thay thế hoặc bãi bỏ Điều/Khoản/Điểm nào.

3. **Document relations guide, provision relations explain**  
   Document graph giúp discover và contextualize; provision graph giải thích thay đổi pháp lý cụ thể.

4. **Provision is not Behavior**  
   Một provision có thể chứa 0, 1 hoặc nhiều ViolationRule.

5. **Explicit legal evidence first**  
   Metadata và amendment text có precedence cao hơn semantic inference.

6. **Semantic diff over text diff**  
   Mục tiêu là phát hiện thay đổi về hành vi, phạm vi và sanction chứ không chỉ text.

7. **Every important result is traceable**  
   Không có current sanction hoặc history transition nào không có source provision.

8. **Narrow legal scope, deep change tracking**  
   MVP chỉ tập trung vào xử phạt hành vi giao thông nhưng track sâu document → provision → behavior → sanction.

9. **Search and answer are separate**  
   Manual search phải hoạt động độc lập bằng full-text retrieval; AI chat là lớp grounded QA dùng cùng knowledge base.

10. **No citation, no legal claim**  
    AI answer về mức phạt, hiệu lực hoặc lịch sử phải reference về Provision nguồn.

11. **Same behavior does not imply same lineage**  
    Rule cho ô tô, xe máy hoặc context khác nhau có thể cùng TrafficViolation nhưng phải nằm ở lineage riêng nếu chúng không trực tiếp kế thừa nhau.

12. **Temporal correctness is first-class**  
    CURRENT chỉ là trường hợp đặc biệt của query theo thời gian; mọi rule phải có effective interval rõ nhất có thể.

13. **Prefer ambiguity over false certainty**  
    Khi context hoặc evidence chưa đủ, hệ thống giữ AMBIGUOUS / UNCERTAIN thay vì ép merge, ép lineage hoặc chọn một sanction tùy ý.

14. **Evaluation must avoid legal-lineage leakage**  
    Dataset split phải tránh việc amendment chain gần như giống nhau xuất hiện ở cả train/dev và test.

---

## 21. Alignment with Course Requirements

SRS giữ nguyên các yêu cầu chính của project **Legal Document Change Detection**:

- working prototype;
- real legal documents;
- deterministic/full-text retrieval;
- AI retrieval / grounded question answering;
- LLM / Legal NLP;
- knowledge representation;
- legal change detection;
- baseline comparison;
- quantitative evaluation;
- temporal/as-of legal reasoning;
- end-to-end QA evaluation;
- traceability;
- hallucination awareness;
- reproducible methodology.

Việc giới hạn domain vào xử phạt hành vi giao thông là scope reduction, không thay đổi bài toán nghiên cứu cốt lõi.

Điểm nhấn học thuật của project là:

> Từ document-level legal relationships, tự động resolve provision-level changes, dùng traffic-violation identity để reconstruct semantic sanction history, sau đó hỗ trợ cả full-text retrieval và grounded AI question answering có source references.
