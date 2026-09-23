# SRS — Vietnamese Legal Behavior Change Intelligence

**Version:** 0.1  
**Domain:** Pháp luật giao thông đường bộ Việt Nam  
**Project type:** Legal AI / Engineering + R&D  
**Base project:** Legal Document Change Detection

---

## 1. Mục tiêu hệ thống

Hệ thống phân tích văn bản pháp luật giao thông Việt Nam thành một biểu diễn có cấu trúc dựa trên **hành vi pháp lý** (*Legal Behavior*), từ đó cho phép:

1. **Highlight quy định có khả năng đã lỗi thời** khi văn bản mà nó phụ thuộc vào đã bị sửa đổi, thay thế hoặc hết hiệu lực.
2. **Diff văn bản pháp luật theo hành vi**, thay vì chỉ so sánh text.
3. **Query quy định theo hành vi** và xem lịch sử thay đổi của hành vi đó qua các phiên bản văn bản.

Ví dụ người dùng không cần biết hành vi nằm ở Điều/Khoản nào mà có thể truy vấn:

```text
"Đỗ xe trên phần đường xe chạy ngoài đô thị"
```

Hệ thống resolve thành:

```text
Đỗ xe
+ Phần đường xe chạy
+ Ngoài đô thị
```

sau đó trả về:

```text
Quy định hiện hành
Mức phạt
Điều/Khoản nguồn
Văn bản nguồn
Các phiên bản trước
Lịch sử thay đổi mức phạt/phạm vi áp dụng
```

---

## 2. Phạm vi

### 2.1. In scope

Phiên bản MVP tập trung vào **văn bản quy phạm pháp luật giao thông đường bộ**, ưu tiên:

```text
Luật
↓
Nghị định
↓
Thông tư
↓
Văn bản sửa đổi / bổ sung
↓
Văn bản hợp nhất
```

Hệ thống hỗ trợ:

- nhập văn bản qua URL từ CSDL VBPL;
- upload văn bản;
- phân tích cấu trúc Điều / Khoản / Điểm;
- phát hiện quan hệ giữa các văn bản;
- lấy thêm các văn bản liên quan;
- parse quy định thành Legal Behavior IR;
- xây ontology hành vi;
- phát hiện hành vi/concept mới;
- trích xuất chế tài;
- semantic diff;
- xác định provision có khả năng outdated;
- query hành vi hiện tại;
- xem lịch sử thay đổi hành vi.

### 2.2. Out of scope cho MVP

Hệ thống không nhằm:

- đưa ra tư vấn pháp lý cuối cùng thay con người;
- tự xác định một văn bản "trái luật" hay "mâu thuẫn pháp luật" theo nghĩa pháp lý;
- bao phủ toàn bộ hệ thống pháp luật Việt Nam;
- tự động quyết định một người cụ thể có vi phạm pháp luật hay không;
- train foundation model riêng;
- thay thế CSDL pháp luật chính thức.

Hệ thống chỉ thể hiện **nguồn, quan hệ, extraction và change analysis**.

---

## 3. Định nghĩa chính

### 3.1. Document

Một văn bản pháp luật, ví dụ Luật, Nghị định hoặc Thông tư.

### 3.2. Document Version

Trạng thái của một Document tại một thời điểm.

### 3.3. Provision

Một đơn vị pháp lý có thể tham chiếu, ví dụ:

```text
Điều 6
Khoản 2 Điều 6
Điểm a Khoản 2 Điều 6
```

### 3.4. Semantic Atom

Khái niệm pháp lý nhỏ có thể tái sử dụng:

```text
Đỗ xe
Dừng xe
Chấp hành
Phần đường xe chạy
Lề đường
Đèn tín hiệu giao thông
Ngoài đô thị
```

### 3.5. Legal Behavior

Một biểu thức có cấu trúc được tạo bằng cách kết hợp các semantic atom.

Ví dụ:

```text
ĐỖ XE
ON PHẦN ĐƯỜNG XE CHẠY
WHERE NGOÀI ĐÔ THỊ
AND CÓ LỀ ĐƯỜNG
```

### 3.6. Sanction Rule

Chế tài áp dụng cho một Legal Behavior trong một context cụ thể.

### 3.7. Behavior Alias

Cách diễn đạt khác của cùng một semantic atom.

Ví dụ:

```text
Canonical:
Đỗ xe

Aliases:
- đậu xe
- đỗ phương tiện
```

### 3.8. Outdated Provision

Provision có evidence cho thấy nội dung hoặc dependency của nó có khả năng không còn phản ánh trạng thái pháp luật hiện hành.

`OUTDATED` trong hệ thống **không đồng nghĩa với kết luận pháp lý rằng provision vô hiệu**.

---

## 4. User Roles

### 4.1. User

Có thể:

- import văn bản;
- query hành vi;
- xem diff;
- xem dependency;
- xem historical timeline.

### 4.2. Reviewer

Ngoài quyền User, có thể:

- approve/reject concept mới;
- merge concept duplicate;
- approve alias;
- sửa extraction;
- xác nhận relation;
- xác nhận change classification.

### 4.3. System

Tự động:

- parse document;
- search source;
- resolve ontology;
- gọi LLM khi cần;
- index;
- detect changes;
- tính outdated status.

---

## 5. High-level Architecture

```text
                         ┌─────────────────┐
                         │      User       │
                         └────────┬────────┘
                                  │
                    URL / Document upload
                                  │
                                  ▼
                     ┌─────────────────────┐
                     │ Document Ingestion  │
                     └─────────┬───────────┘
                               │
               ┌───────────────┴────────────────┐
               ▼                                ▼
        Raw snapshot                     Metadata parser
               │                                │
               └───────────────┬────────────────┘
                               ▼
                    Provision segmentation
                               │
                               ▼
                     Relation extraction
                               │
                 ┌─────────────┴──────────────┐
                 ▼                            ▼
           Existing corpus             Missing document
                                              │
                                      crawl / request upload
                                              │
                 └─────────────┬──────────────┘
                               ▼
                    Semantic AI Parser
                               │
                               ▼
                      Semantic Atoms
                               │
                               ▼
             Canonical + Alias exact lookup
                               │
                    ┌──────────┴──────────┐
                    │ miss                │ hit
                    ▼                     ▼
            Hybrid retrieval          reuse concept
                    │
                    ▼
              LLM Resolver
          ┌─────────┼────────┬───────────┐
          ▼         ▼        ▼           ▼
        REUSE   ADD_ALIAS  COMPOSE     CREATE
                                         │
                                      PROPOSED
                                         │
                                     review/index
                                         │
          └──────────────────────────────┘
                         │
                         ▼
                    Legal Rule IR
                         │
             ┌───────────┼────────────┐
             ▼           ▼            ▼
        Knowledge     Change        Search
          Graph       Engine         Index
```

---

## 6. Functional Requirements

## FR-01 — Import Legal Document

Hệ thống phải hỗ trợ nhập văn bản bằng URL hoặc file.

### FR-01.1 URL Import

User cung cấp URL từ nguồn pháp luật được hỗ trợ.

System phải:

1. fetch nội dung;
2. lưu raw snapshot;
3. extract metadata;
4. parse nội dung;
5. lưu source URL và thời điểm fetch.

### FR-01.2 File Upload

Hỗ trợ tối thiểu:

```text
PDF
DOCX
TXT / HTML
```

### FR-01.3 Duplicate Detection

Nếu văn bản/version đã tồn tại, system phải phát hiện thông qua:

```text
document number
version/effective date
content hash
```

---

## FR-02 — Document Structure Parsing

System phải tách:

```text
Chương
Mục
Điều
Khoản
Điểm
```

Mỗi Provision phải giữ:

```json
{
    "document_id": "...",
    "article": "6",
    "paragraph": "2",
    "point": "a",
    "raw_text": "..."
}
```

Phải trace được mọi dữ liệu semantic về nguyên văn nguồn.

---

## FR-03 — Legal Document Relation Discovery

Sau khi import, hệ thống phải phát hiện các văn bản liên quan.

Relation tối thiểu:

```text
AMENDS
AMENDED_BY
SUPPLEMENTS
REPLACES
REPLACED_BY
REFERENCES
LEGAL_BASIS
DETAILS
IMPLEMENTED_BY
INVALIDATES
```

Nguồn relation có thể là:

```text
VBPL metadata
explicit citation parser
AI semantic extraction
human verification
```

Mỗi relation phải lưu provenance và confidence.

Ví dụ:

```json
{
    "type": "AMENDS",
    "source": "VBPL_METADATA",
    "confidence": 1.0
}
```

---

## FR-04 — Related Document Acquisition

Khi phát hiện document dependency chưa tồn tại trong corpus:

```text
Missing related document
        ↓
source available?
   ┌────┴────┐
  yes        no
   ↓          ↓
Import       Ask user
automatically to upload/provide source
```

Không crawl recursion vô hạn.

Auto-import ưu tiên:

```text
AMENDS
AMENDED_BY
REPLACES
DETAILS
```

Các relation yếu như `LEGAL_BASIS` chỉ suggest import nếu không cần thiết trực tiếp.

---

## FR-05 — Semantic Atom Extraction

LLM phải phân tích Provision bằng **open vocabulary**, không bị giới hạn bởi ontology hiện có.

Ví dụ:

```text
Dừng xe, đỗ xe trên phần đường xe chạy ở đoạn đường ngoài đô thị nơi có lề đường
```

Output:

```json
{
    "actions": [
        "Dừng xe",
        "Đỗ xe"
    ],
    "target": {
        "relation": "trên",
        "concept": "Phần đường xe chạy"
    },
    "conditions": [
        "Ngoài đô thị",
        "Có lề đường"
    ]
}
```

Mục tiêu của phase này là **extract semantic meaning**, chưa resolve ontology.

---

## FR-06 — Concept Resolution

Mỗi extracted atom phải được resolve theo flow:

```text
Normalize
   ↓
Canonical exact search
   ↓ miss
Alias exact search
   ↓ miss
Hybrid search
   ↓
Top-K candidate concepts
   ↓
LLM resolver
```

LLM resolver chỉ được trả một trong:

```text
REUSE
ADD_ALIAS
COMPOSE
CREATE
UNCERTAIN
```

Thứ tự preference:

```text
REUSE
>
ADD_ALIAS
>
COMPOSE
>
CREATE
```

`CREATE` chỉ được dùng khi concept thực sự không thể biểu diễn bởi ontology hiện có.

---

## FR-07 — Alias Management

Một Concept phải hỗ trợ nhiều alias.

Ví dụ:

```text
Concept:
Đỗ xe

Aliases:
đậu xe
đỗ phương tiện
```

Alias phải tham gia search/index.

Nếu một wording mới được xác định semantic-equivalent với concept đã có, system phải có khả năng:

```text
ADD_ALIAS
```

mà không tạo Concept mới.

---

## FR-08 — Missing Concept Detection

Nếu:

```text
canonical lookup = miss
AND alias lookup = miss
AND no semantically equivalent candidate exists
AND expression cannot be composed from existing concepts
```

thì system có thể tạo:

```text
PROPOSED CONCEPT
```

Ví dụ:

```json
{
    "canonical_name": "Điều khiển phương tiện từ xa",
    "status": "PROPOSED"
}
```

Concept không trở thành canonical ontology entry cho tới khi được approve hoặc đạt policy confidence do hệ thống quy định.

---

## FR-09 — Legal Behavior IR Generation

Provision phải được convert thành structured JSON.

Ví dụ:

```json
{
    "subject": {
        "concept": "Người điều khiển xe"
    },

    "behavior": {
        "actions": [
            "Dừng xe",
            "Đỗ xe"
        ],

        "target": {
            "relation": "trên",
            "concept": "Phần đường xe chạy"
        },

        "conditions": [
            {
                "concept": "Ngoài đô thị"
            },
            {
                "concept": "Có lề đường"
            }
        ],

        "exceptions": []
    }
}
```

---

## FR-10 — Sanction Extraction

System phải liên kết một behavior với chế tài tương ứng.

Tối thiểu extract:

```text
subject
vehicle/context
fine_min
fine_max
currency
point deduction
additional sanction
conditions
```

Ví dụ:

```json
{
    "behavior_id": "...",

    "sanction": {
        "fine": {
            "min": 400000,
            "max": 600000,
            "currency": "VND"
        }
    }
}
```

Không được coi:

```text
Behavior → một mức phạt cố định
```

vì cùng behavior có thể khác chế tài tùy subject, vehicle, consequence và thời điểm.

---

## FR-11 — Highlight Outdated Law

Đây là feature chính thứ nhất.

### FR-11.1 Detection

System phải phát hiện Provision có nguy cơ outdated nếu xảy ra một hoặc nhiều điều kiện:

```text
Văn bản bị hết hiệu lực
Văn bản bị thay thế
Provision bị sửa đổi
Provision bị bãi bỏ
Dependency của Provision bị sửa
Semantic rule phụ thuộc vào clause đã thay đổi
```

### FR-11.2 Status

Không chỉ dùng boolean.

```text
CURRENT
POTENTIALLY_OUTDATED
OUTDATED_BY_EXPLICIT_AMENDMENT
REPEALED
SUPERSEDED
UNCERTAIN
```

### FR-11.3 UI

Provision bị ảnh hưởng phải được highlight.

Ví dụ:

```text
⚠ Có khả năng lỗi thời

Điều 6 Khoản 2 Điểm a

Lý do:
Nghị định X đã được sửa đổi bởi Nghị định Y.

Affected behavior:
Đỗ xe → Phần đường xe chạy → Ngoài đô thị

[View change]
```

### FR-11.4 Evidence

Mọi warning phải có source/evidence.

Không được để AI tự đánh dấu `outdated` mà không giải thích được dependency dẫn tới kết quả.

---

## FR-12 — Behavior-based Legal Diff

Feature chính thứ hai.

Thay vì:

```diff
- 400.000 đồng
+ 600.000 đồng
```

system phải tạo semantic diff.

Ví dụ:

```text
Behavior:
Đỗ xe
ON Phần đường xe chạy
WHERE Ngoài đô thị

Version A:
Có lề đường = TRUE
Fine = 400k–600k

Version B:
Không còn condition "Có lề đường"
Fine = 800k–1m
```

Semantic diff:

```text
CONDITION_REMOVED:
Có lề đường

→ SCOPE_EXPANSION

SANCTION:
400k–600k
→
800k–1m

→ SANCTION_INCREASE
```

---

## FR-13 — Change Classification

Tối thiểu hỗ trợ:

```text
NO_SEMANTIC_CHANGE

BEHAVIOR_ADDED
BEHAVIOR_REMOVED

CONDITION_ADDED
CONDITION_REMOVED
CONDITION_CHANGED

EXCEPTION_ADDED
EXCEPTION_REMOVED

SUBJECT_SCOPE_EXPANSION
SUBJECT_SCOPE_REDUCTION

BEHAVIOR_SCOPE_EXPANSION
BEHAVIOR_SCOPE_REDUCTION

SANCTION_INCREASE
SANCTION_DECREASE
SANCTION_CHANGED

POINT_DEDUCTION_CHANGED

REFERENCE_CHANGED

EDITORIAL_CHANGE
UNKNOWN
```

Một change có thể có nhiều classification.

---

## FR-14 — Query by Behavior

Feature chính thứ ba.

User có thể query bằng:

```text
đỗ xe
vượt đèn đỏ
dừng xe ngoài đô thị
không chấp hành tín hiệu đèn
```

Query pipeline:

```text
User query
    ↓
semantic atom extraction
    ↓
alias/canonical resolution
    ↓
behavior expression
    ↓
behavior index
    ↓
matching rules
```

Kết quả phải ưu tiên **quy định hiện hành**.

Mỗi result hiển thị tối thiểu:

```text
Behavior
Subject
Conditions
Exception
Sanction
Effective period
Document
Điều / Khoản / Điểm
Source
```

---

## FR-15 — Historical Behavior Query

User có thể mở:

```text
History
```

của một behavior.

Ví dụ:

```text
ĐỖ XE
    │
    ├── 2019
    │   Fine: ...
    │
    ├── 2021
    │   Fine changed
    │
    ├── 2025
    │   Scope changed
    │
    └── Current
        Fine: ...
```

Hệ thống phải cho phép query:

```text
Quy định hiện tại
Quy định tại ngày X
Toàn bộ timeline
```

---

## FR-16 — Behavior History Diff

Mỗi history item phải thể hiện:

```text
What changed?
Before
After
Change type
Effective date
Source document
Affected provision
```

Ví dụ:

```text
01/01/2025

SANCTION_INCREASE

Before:
6–8 triệu

After:
18–20 triệu

Affected behavior:
Không chấp hành tín hiệu đèn

Source:
Nghị định ...
Điểm ... Khoản ... Điều ...
```

---

## FR-17 — Search Index

System phải duy trì ít nhất hai logical index.

### Concept Index

Search:

```text
Đỗ xe
Đậu xe
Dừng phương tiện
...
```

Dữ liệu gồm:

```text
canonical concept
aliases
embeddings
```

### Provision Index

Search các Điều/Khoản có nội dung tương đồng hoặc dependency.

Search strategy:

```text
Exact match
+
full-text
+
embedding
+
structured filtering
```

---

## FR-18 — AI Provenance

Mọi output AI quan trọng phải lưu:

```text
model
prompt/schema version
timestamp
confidence
raw output
normalized output
evidence
human_verified
```

Ví dụ:

```json
{
    "method": "LLM",
    "model": "...",
    "parser_version": "1.2",
    "confidence": 0.91,
    "human_verified": false
}
```

---

## FR-19 — Human Review

Reviewer phải có queue cho:

```text
New concept
Ambiguous concept mapping
New alias
Low-confidence extraction
Potential semantic relation
Potentially outdated provision
```

Reviewer có thể:

```text
Approve
Reject
Edit
Merge concepts
Mark uncertain
```

---

## 7. Data Model

Core relational model:

```text
Document
└── DocumentVersion
    └── Provision
        ├── ProvisionRelation
        └── BehaviorRule
            ├── BehaviorAction
            ├── BehaviorTarget
            ├── BehaviorCondition
            ├── BehaviorException
            └── SanctionRule

Concept
├── ConceptAlias
└── ConceptRelation

ExtractionRun
ChangeEvent
```

Database đề xuất:

```text
PostgreSQL
+ JSONB
+ pgvector
```

Raw PDF/HTML có thể lưu ở object storage.

---

## 8. Core Tables

### `concept`

```text
id
code
canonical_name
concept_type
status
merged_into
created_at
```

### `concept_alias`

```text
id
concept_id
alias
normalized_alias
embedding
source
status
```

### `document`

```text
id
document_number
title
document_type
issuer
source_url
```

### `document_version`

```text
id
document_id
issued_at
effective_from
effective_to
content_hash
raw_source_uri
```

### `provision`

```text
id
document_version_id
parent_id
article_no
paragraph_no
point_no
raw_text
raw_ir
```

### `provision_relation`

```text
id
from_provision_id
to_provision_id
relation_type
source
confidence
human_verified
```

### `behavior_rule`

```text
id
provision_id
subject_concept_id
semantic_ir
confidence
human_verified
```

### `sanction_rule`

```text
id
behavior_rule_id

fine_min
fine_max
currency

points_deducted

effective_from
effective_to
```

### `change_event`

```text
id

old_behavior_rule_id
new_behavior_rule_id

change_type
significance

effective_at

source_document_id
confidence
```

---

## 9. LLM Parsing & Ontology Resolution Flow

Hệ thống sử dụng LLM ở hai phase riêng biệt.

### Phase 1 — Open-vocabulary semantic extraction

LLM không nhìn ontology hiện có.

```text
Raw provision
    ↓
LLM semantic parser
    ↓
Semantic atoms
```

Mục đích là tránh ép concept mới vào keyword cũ.

Ví dụ:

```json
{
    "actions": [
        {
            "surface": "đỗ phương tiện",
            "normalized": "đỗ phương tiện"
        }
    ]
}
```

### Phase 2 — Concept resolution

```text
Semantic atom
    ↓
Normalize
    ↓
Canonical exact lookup
    ↓ miss
Alias exact lookup
    ↓ miss
FTS + embedding retrieval
    ↓
Top-K existing concepts
    ↓
LLM resolver
```

Resolver trả một trong:

```text
REUSE
ADD_ALIAS
COMPOSE
CREATE
UNCERTAIN
```

### Resolution priority

```text
REUSE
  ↓
ADD_ALIAS
  ↓
COMPOSE
  ↓
CREATE
  ↓
UNCERTAIN
```

`CREATE` chỉ dùng cho **atomic semantic concept mới thực sự**.

---

## 10. Alias Strategy

Alias table được sử dụng để tránh duplicate concepts.

Ví dụ:

```text
Canonical:
Đỗ xe

Aliases:
- đậu xe
- đỗ phương tiện
- đỗ phương tiện giao thông
```

Resolution:

```text
"đậu xe"
    ↓
exact alias lookup
    ↓
DO_XE
```

Không cần gọi LLM.

Embedding được tạo cho từng alias riêng nhưng search result phải aggregate theo `concept_id`.

Ví dụ:

```text
alias #1 → DO_XE    0.93
alias #2 → DO_XE    0.89
canonical → DO_XE   0.86

aggregate:
DO_XE = 0.93
```

---

## 11. Missing Concept Detection

Nếu không tìm thấy concept:

```text
No canonical hit
AND no alias hit
AND no semantic equivalent
AND cannot compose from existing concepts
```

thì resolver có thể:

```json
{
    "decision": "CREATE",
    "proposed_concept": {
        "canonical_name": "Điều khiển phương tiện từ xa",
        "type": "ACTION"
    }
}
```

Concept mới có lifecycle:

```text
PROPOSED
↓
ACTIVE
↓
DEPRECATED / MERGED
```

Concept mới không nên trở thành `ACTIVE` ngay nếu confidence thấp hoặc chưa review.

---

## 12. Behavior Composition

Không tạo một keyword cho mọi tổ hợp.

Sai:

```text
DO_XE_TREN_PHAN_DUONG_XE_CHAY_NGOAI_DO_THI_CO_LE_DUONG
```

Đúng:

```text
ACTION:
    Đỗ xe

TARGET:
    Phần đường xe chạy

CONDITIONS:
    Ngoài đô thị
    Có lề đường
```

Các primitive semantic atom có thể tái sử dụng trong nhiều Legal Behavior.

---

## 13. Outdated Detection Algorithm

MVP algorithm:

```text
Provision P
    ↓
Check own DocumentVersion
    ├── expired?
    ├── replaced?
    └── explicitly amended?
    ↓
Traverse dependency edges
    ↓
Dependency changed?
    ↓
Compare old/new Behavior IR
    ↓
Semantic impact?
    ↓
Assign status
```

Một provision chỉ được đánh dấu mạnh:

```text
OUTDATED_BY_EXPLICIT_AMENDMENT
```

khi có explicit evidence.

Semantic inference chỉ nên tạo:

```text
POTENTIALLY_OUTDATED
```

---

## 14. Diff Algorithm

```text
Version A
   ↓
Provision alignment

Version B
   ↓

Aligned provision pairs
   ↓
Legal Behavior IR
   ↓
Canonicalize atom IDs
   ↓
Structural diff
   ↓
Semantic change classifier
```

Ví dụ:

```text
OLD:
Đỗ xe
ON Phần đường xe chạy
WHERE Ngoài đô thị
AND Có lề đường

NEW:
Đỗ xe
ON Phần đường xe chạy
WHERE Ngoài đô thị
```

Structural diff:

```text
REMOVE CONDITION:
Có lề đường
```

Semantic classification:

```text
SCOPE_EXPANSION
```

---

## 15. Query Flow

```text
User query
    ↓
Semantic atom extraction
    ↓
Canonical + alias resolution
    ↓
Behavior expression
    ↓
Behavior search
    ↓
Current sanction rules
    ↓
Historical versions
```

Ví dụ:

```text
"vượt đèn đỏ"
```

có thể resolve thành một behavior expression dựa trên các concept:

```text
Chấp hành
+
NEGATIVE polarity
+
Đèn tín hiệu giao thông
```

---

## 16. API sơ bộ

### Import

```http
POST /documents/import-url
POST /documents/upload
```

### Documents

```http
GET /documents/:id
GET /documents/:id/relations
GET /documents/:id/versions
GET /documents/:id/outdated
```

### Behavior

```http
GET /behaviors/search?q=
GET /behaviors/:id
GET /behaviors/:id/rules
GET /behaviors/:id/history
```

### Diff

```http
GET /documents/:id/diff?from=&to=
GET /behaviors/:id/diff?from=&to=
```

### Review

```http
GET  /review/queue
POST /review/concepts/:id/approve
POST /review/concepts/:id/reject
POST /review/concepts/:id/merge
```

---

## 17. UI Requirements

MVP cần 4 màn hình chính.

### 17.1. Document View

```text
Document metadata

[CURRENT / OUTDATED warnings]

Điều 1
Điều 2
⚠ Điều 3 — potentially outdated
Điều 4
```

Click warning:

```text
Affected by:
Nghị định X → Nghị định Y

Changed behaviors:
- Đỗ xe
- Dừng xe
```

### 17.2. Document Diff

Hai version side-by-side, nhưng highlight theo behavior:

```text
ĐỖ XE

Before                     After
-----------------------------------------------
Ngoài đô thị               Ngoài đô thị
Có lề đường

400k–600k                  800k–1m

Changes:
Scope expanded
Fine increased
```

### 17.3. Behavior Search

```text
Search:
[ vượt đèn đỏ                    ]

Resolved:
Không chấp hành tín hiệu đèn

Current rules:
...
```

### 17.4. Behavior History

```text
Không chấp hành tín hiệu đèn

2019 ───── 2021 ───── 2025 ───── Current
           ↑             ↑
        Fine changed   New rule
```

---

## 18. Non-functional Requirements

### NFR-01 — Traceability

100% kết luận về:

```text
behavior
sanction
change
outdated status
```

phải trace được về ít nhất một Provision.

### NFR-02 — Reproducibility

Raw source phải được snapshot/cache để evaluation không phụ thuộc nội dung website thay đổi.

### NFR-03 — Explainability

Không được chỉ output:

```text
OUTDATED
```

mà phải output:

```text
why
affected dependency
old provision
new provision
source
```

### NFR-04 — Extensibility

Schema ontology không được phụ thuộc vào fixed columns kiểu:

```text
is_parking
is_highway
is_red_light
```

Concept mới không được yêu cầu DB migration.

### NFR-05 — AI Failure Safety

Nếu confidence thấp:

```text
UNCERTAIN
```

thay vì ép một classification.

---

## 19. Evaluation

Mỗi task phải có baseline và evaluation riêng.

| Task | Metric |
|---|---|
| Semantic Atom Extraction | Precision / Recall / F1 |
| Concept Resolution | Accuracy / Macro F1 |
| Sanction Extraction | Field F1 / Whole-record Exact Match |
| Change Detection | Precision / Recall / Critical-change Recall |
| Outdated Detection | Precision / Recall |
| Behavior Search | Recall@K / MRR |
| Behavior History Reconstruction | Accuracy |

### Primary metric

```text
Critical Change Recall
```

Mục tiêu:

> Trong tất cả thay đổi pháp lý quan trọng thực sự, hệ thống phát hiện được bao nhiêu?

---

## 20. Baselines

### Semantic extraction

```text
Rule/regex
vs
LLM zero-shot
vs
proposed structured parser
```

### Concept resolution

```text
Exact only
vs
Embedding Top-1
vs
Hybrid retrieval + LLM
```

### Change detection

```text
Text diff
vs
IR structural diff
vs
IR diff + semantic classifier
```

### Outdated detection

```text
Document metadata only
vs
Explicit dependency graph
vs
Dependency graph + semantic behavior impact
```

---

## 21. MVP Acceptance Criteria

MVP được coi là hoàn thành nếu:

1. Import được ít nhất một chuỗi văn bản thực tế gồm original + amendment/new version.
2. Parse được Điều/Khoản/Điểm.
3. Extract được Legal Behavior IR.
4. Có concept + alias ontology.
5. Detect được missing concept.
6. Extract được ít nhất các sanction dạng tiền phạt.
7. Query được hành vi và trả đúng nguồn Điều/Khoản.
8. Hiển thị được current rule.
9. Hiển thị được history của behavior.
10. Diff được hai version theo semantic behavior.
11. Highlight được provision bị sửa/thay thế/hết hiệu lực.
12. Mọi result đều trace được về văn bản gốc.
13. Có evaluation dataset độc lập.
14. Có ít nhất một baseline.

---

## 22. Demo Scenario đề xuất

```text
1. Import một Nghị định phiên bản cũ

2. System parse:
   behavior
   conditions
   sanctions

3. Query:
   "đỗ xe ngoài đô thị"

4. Hiển thị:
   current rule + mức phạt + nguồn

5. Import văn bản sửa đổi mới

6. System tự phát hiện:
   Nghị định cũ bị sửa

7. Highlight:
   ⚠ provision potentially outdated

8. Open Diff

9. Hiển thị:
   Condition removed
   → SCOPE_EXPANSION

   Fine changed
   → SANCTION_INCREASE

10. Quay lại behavior:
    "Đỗ xe"

11. History:
    Version A → Version B
```

Ba feature chính nằm trong cùng một end-to-end story:

```text
Highlight outdated law
        ↓
Semantic behavior diff
        ↓
Behavior query + historical diff
```

---

## 23. Định hướng kỹ thuật

Stack DB đề xuất:

```text
PostgreSQL
+ JSONB
+ pgvector
```

Nguyên tắc:

- SQL cho dữ liệu relational, versioning và integrity;
- JSONB cho raw LLM/parser IR;
- pgvector cho semantic retrieval;
- object storage cho raw PDF/HTML;
- không cần Neo4j ở MVP;
- không cần MongoDB ở MVP.

LLM nên được dùng theo hướng:

```text
retrieval-first
LLM-last
```

Không gọi LLM để invent ontology từ đầu nếu hệ thống có thể:

```text
exact match
→ alias match
→ hybrid retrieval
→ compose existing concepts
```

Chỉ khi các bước trên thất bại mới đề xuất concept mới.

---

## 24. Nguyên tắc thiết kế cốt lõi

1. **Vietnamese-first ontology**  
   Canonical concept giữ bằng tiếng Việt, không cần map sang tiếng Anh.

2. **Open-world ontology**  
   Hệ thống phải chấp nhận khả năng luật mới sinh ra concept chưa tồn tại.

3. **Prefer reuse over creation**  
   `REUSE > ADD_ALIAS > COMPOSE > CREATE`.

4. **Behavior is composition, not giant keyword**  
   Không tạo keyword dài cho mọi tổ hợp điều kiện.

5. **Every AI output needs evidence**  
   Mọi extraction, relation và outdated warning phải trace được về source.

6. **Semantic diff over text diff**  
   Mục tiêu không phải chỉ phát hiện text thay đổi mà phải nhận diện thay đổi về phạm vi, điều kiện, chế tài và hành vi.

7. **Reproducible corpus**  
   Raw source phải được snapshot để benchmark có thể tái lập.

---

## 25. Tài liệu nguồn môn học

SRS này được xây dựa trên định hướng của môn **Legal AI and Its Applications**, đặc biệt:

- project-based workflow;
- yêu cầu working prototype;
- Legal Document Change Detection;
- baseline requirement;
- quantitative evaluation;
- Legal AI pipeline có retrieval, LLM, knowledge base và evaluation;
- yêu cầu traceability, hallucination awareness và methodology rõ ràng.