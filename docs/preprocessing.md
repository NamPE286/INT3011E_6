# Preprocessing pipeline

Tài liệu kỹ thuật cho các bước tiền xử lý chạy sau khi PDF đã được LLM đọc thành legal JSON ([PDF upload API](pdf-upload-api.md)). Mỗi bước là deterministic-first: rule/regex và resolver có thể kiểm chứng chạy trước, LLM chỉ dùng ở phần khó và luôn bị kiểm tra lại bằng evidence trong snapshot.

```text
saveLegalDocument (ACCEPTED)
  └─ 1. Provisions (#8)          provisions
  └─ 2. Document graph (#5)      document_metadata, document_relation_candidates, document_relations
  └─ 3. Change graph (#11)       change_instructions, provision_relations (+ cạnh document_relations suy ra)
  └─ 4. Violation rules (#15)    extraction_runs, violation_rules, sanctions, sanction_effects
  └─ 5. Identity (#17)           traffic_violations, violation_aliases, identity_decisions
  └─ 6. History (#18, #19)       rule_lineages, rule_intervals, change_events
```

Các bước chạy theo thứ tự trên (`backend/src/modules/processing/preprocessing.ts`). Lỗi của một bước được ghi vào checklist và có thể chạy lại; nó không biến job đã hoàn tất thành `failed`. Văn bản `REVIEW_REQUIRED` không được phân tích, và dữ liệu phái sinh của lần đọc trước bị xóa.

### Checklist tiền xử lý

Bảng `preprocessing_stages` giữ một dòng cho mỗi `(job_id, stage)` với `status` `PENDING / RUNNING / DONE / FAILED` và `error`. Không có dòng nghĩa là bước chưa chạy, nên văn bản nhập trước khi có checklist sẽ được chạy lại toàn bộ.

- **Khi công bố** — lưu văn bản `ACCEPTED` ngay sau khi đọc, hoặc `POST /api/jobs/:jobId/review` — checklist của lần đọc mới được đặt lại và bước đầu tiên chưa `DONE` được gửi vào queue `pdf-convert` (`{ jobId, stage }`). Vì vậy hành vi vi phạm và từ vựng (bước 4) luôn được trích xuất sau khi đọc được điều khoản hoặc sau khi duyệt.
- **Mỗi bước một lần gọi queue**: consumer chạy một bước, ghi kết quả, rồi gửi bước kế tiếp. Văn bản dài không còn mất các bước sau vì một request duy nhất hết thời gian hoặc CPU. Bước `FAILED` không chặn các bước sau, trừ `PROVISIONS` (các bước khác không có dữ liệu đầu vào).
- **Chạy lại**: chạy từ bước đầu tiên chưa `DONE` đến hết, vì mỗi bước đọc dữ liệu của các bước trước.

| Method | Path | Mô tả |
| --- | --- | --- |
| `GET` | `/api/jobs/:jobId/preprocessing` | Checklist `stages[]` (`stage`, `status`, `error`, `updatedAt`). |
| `POST` | `/api/jobs/:jobId/preprocessing` | Đưa các bước còn thiếu vào queue: `202 { startStage }`, `200 { startStage: null }` khi đã đủ, `409` nếu văn bản cần review. |

Trang `/admin/review/[jobId]` hiển thị checklist và nút chạy lại các bước còn thiếu; trang `/documents/[id]` có tab "Hành vi vi phạm" liệt kê nhãn hành vi và `vocab_id` của từng rule.

> Các endpoint dưới đây chưa có xác thực Admin (TODO #4, giống `/api/jobs*`).

## 1. Provisions — Điều/Khoản/Điểm và vai trò (#8, FR-04/FR-05)

- `flattenLegalDocument` duyệt legal JSON theo thứ tự đọc, tạo id ổn định `<document_id>:dieu_6_khoan_1_diem_a` (cùng scheme với MCP), giữ parent, locator Điều/Khoản/Điểm, trang, source quote, vùng PDF và chất lượng đọc. Dòng `Căn cứ …` của phần đầu thành provision `PREAMBLE`.
- Mỗi provision lưu provenance FR-04: `source_snapshot_id`, `pdf_sha256`, `read_method` (`LLM:<model>;prompt=…;schema=…`).
- `classifyRole` gán `content_role` (`OPERATIVE_INSTRUCTION`, `QUOTED_NEW_TEXT`, `HISTORICAL_DESCRIPTION`, …) và `relevance` (`SANCTION_RULE`, `VIOLATION_RULE`, `AMENDMENT_INSTRUCTION`, `REPEAL_INSTRUCTION`, `REFERENCE`, `IRRELEVANT`, `UNCERTAIN`). Trạng thái ngoặc kép được mang qua các provision để nội dung trích dẫn của lệnh sửa đổi không bị đọc như lệnh của chính văn bản.

| Method | Path | Mô tả |
| --- | --- | --- |
| `GET` | `/api/jobs/:jobId/provisions` | Danh sách provision theo thứ tự đọc. |
| `POST` | `/api/jobs/:jobId/provisions/analyze` | Chạy lại phân tích; `409` nếu văn bản cần review. |

## 2. Document graph — lược đồ quan hệ văn bản (#5, FR-03)

1. **Metadata định danh** (`document_metadata`): số hiệu (header `Số: …`), loại, cơ quan, ngày ban hành, ngày có hiệu lực đọc từ câu "có hiệu lực (thi hành) kể từ ngày …" (không đoán khi chỉ có "kể từ ngày ký").
2. **Candidate** (`document_relation_candidates`): `extractDocumentRelationCandidates` quét tiêu đề văn bản, tiêu đề Điều và nội dung từng provision. Provision trích dẫn/lịch sử bị bỏ qua và nội dung trong ngoặc kép bị che (giữ nguyên offset). Mỗi candidate giữ provision nguồn, offset, câu trích, cue, citation thô, action, type theo taxonomy SRS §4.3, scope `FULL / PARTIAL / UNKNOWN`, method/version.
3. **Resolve** (`resolveCandidate`): khớp số hiệu chuẩn hóa với corpus.
   - không có số hiệu hoặc không có trong corpus → `UNRESOLVED` (frontier cần thu thập);
   - nhiều văn bản cùng số → `AMBIGUOUS`; trỏ về chính nó → `REJECTED`;
   - loại văn bản hoặc ngày ban hành trong citation mâu thuẫn → `CONFLICT`;
   - type `UNKNOWN` hoặc không so được loại văn bản → `CANDIDATE`;
   - số hiệu + loại văn bản khớp đúng một văn bản và action đọc từ câu chữ pháp lý → `ACCEPTED`.
4. **Cạnh** (`document_relations`): mỗi `(from, to, type, scope)` là một cạnh, evidence là toàn bộ candidate `ACCEPTED` cùng khóa (`EXPLICIT_LEGAL_TEXT`). Quan hệ ngược (incoming) suy từ cùng cạnh, không lưu cạnh trùng.

Mỗi lần build, toàn bộ candidate trong corpus được resolve lại: văn bản nhập sau sẽ nhận incoming edge từ văn bản nhập trước (graph cập nhật tăng dần).

| Method | Path | Mô tả |
| --- | --- | --- |
| `GET` | `/api/documents/:documentId/relations` | `outgoing`/`incoming` (cạnh ACCEPTED + evidence), `candidates` chưa xác minh, `coverage` (số lượng theo status, `frontier`), `disclaimer`. |
| `POST` | `/api/documents/:documentId/relations/rebuild` | Build lại graph của văn bản và resolve lại corpus; `409` nếu cần review. |

Giới hạn hiện tại: chưa tự thu thập văn bản ở frontier (FR-02 acquisition) — frontier được trả về để Admin upload; citation không có số hiệu luôn `UNRESOLVED`.

## 3. Change graph — ChangeInstruction và ProvisionRelation (#11, FR-06/FR-07)

1. **ChangeInstruction** (`change_instructions`): mỗi provision `OPERATIVE_INSTRUCTION` có relevance `AMENDMENT_INSTRUCTION`/`REPEAL_INSTRUCTION` thành một instruction. Chỉ đọc câu lệnh (nội dung trong ngoặc kép bị che):
   - operation `AMEND / SUPPLEMENT / REPLACE / REPEAL / CORRECT / SUBSTITUTE_TEXT`;
   - địa chỉ đích (`parseLocators`): danh sách, khoảng ("từ khoản 1 đến khoản 3"), "các điểm a, b và c"; Điều/Khoản thiếu được lấy từ instruction bao ngoài ("Sửa đổi một số khoản của Điều 5: a) Sửa đổi khoản 2 …"); "Bổ sung điểm e vào khoản 5 Điều 5" giữ insertion locator;
   - văn bản đích: câu lệnh → các provision bao ngoài (ví dụ tiêu đề Điều "Sửa đổi, bổ sung một số điều của Nghị định số …") → tiêu đề văn bản; "… của Nghị định này" là nội văn bản;
   - nội dung mới (`new_text_provision_ids` = các provision trích dẫn thuộc instruction), ngoại lệ ("trừ …"), ngày hiệu lực = ngày có hiệu lực của văn bản sửa đổi (null nếu chưa đọc được).
2. **Resolve**: văn bản đích dùng chung luật định danh với document graph. Mỗi địa chỉ được map sang id provision của văn bản đích; địa chỉ không có trong bản đã lưu giữ `UNRESOLVED`/`PARTIALLY_RESOLVED` kèm lý do, không nối tạm vào provision gần đúng. Văn bản đích ngoài corpus → `UNRESOLVED`, không tạo cạnh.
3. **ProvisionRelation** (`provision_relations`): cạnh first-class từ provision chứa lệnh → provision bị tác động (`AMENDS / SUPPLEMENTS / REPLACES / REPEALS / CORRECTS`), giữ locator, insertion locator, nội dung mới, evidence, ngày hiệu lực, method/version. `verification_status` = `ACCEPTED` khi văn bản đích đã xác minh, `CANDIDATE` khi mới khớp số hiệu.
4. **Bổ sung document graph**: ProvisionRelation `ACCEPTED` giữa hai văn bản được tổng hợp thành cạnh `document_relations` scope `PARTIAL` (`STRUCTURED_DERIVATION`, method `PROVISION_RELATION`) với `evidence_provision_relation_ids`; cạnh từ câu chữ và cạnh suy ra được giữ riêng.

Instruction tác động toàn văn bản (ví dụ "Nghị định số 46/2016/NĐ-CP hết hiệu lực") có `target_scope = DOCUMENT` và không lan truyền xuống từng provision.

| Method | Path | Mô tả |
| --- | --- | --- |
| `GET` | `/api/documents/:documentId/changes` | Instruction của văn bản kèm ProvisionRelation đã resolve. |
| `POST` | `/api/documents/:documentId/changes/rebuild` | Trích xuất lại instruction và resolve lại toàn corpus; `409` nếu cần review. |
| `GET` | `/api/provisions/:provisionId/relations` | `outgoing`/`incoming` của một provision, mỗi cạnh kèm instruction làm evidence. |

## 4. ViolationRule và Sanction (#15, FR-08/FR-09)

**Vị trí của rule.** Mỗi provision được đặt tại địa chỉ nó điều chỉnh: văn bản thường điều chỉnh chính nó; nội dung mới trong ngoặc kép của văn bản sửa đổi điều chỉnh địa chỉ mà instruction đã resolve (ví dụ điểm a mới của Nghị định 123 điều chỉnh `nd-100-2019:dieu_5_khoan_5_diem_a`). Nội dung trích dẫn không resolve được đúng một địa chỉ bị bỏ qua.

**Tách rule (deterministic).**
- Khoản có mức phạt và liệt kê hành vi ("… một trong các hành vi vi phạm sau đây:") → mỗi điểm là một rule; khoản có mức phạt nêu trực tiếp hành vi → chính khoản đó là một rule.
- Điểm được sửa mà khoản bao ngoài không bị sửa → rule kế thừa mức phạt của khoản trong văn bản gốc.
- Khoản phạt khác nhau cho cá nhân/tổ chức → một rule cho mỗi chủ thể (`subject_scope`).

**Sanction.** `fine_min/fine_max/currency`, `warning_allowed`, `point_deduction_applicability` (`APPLIES` chỉ khi có câu "trừ điểm giấy phép lái xe N điểm" trích dẫn đúng hành vi; còn lại `UNKNOWN`, không suy `NOT_APPLICABLE` từ việc thiếu dữ liệu), `sanction_effects` typed (`LICENSE_SUSPENSION` có thời hạn, `LICENSE_POINT_DEDUCTION`, `VEHICLE_CONFISCATION`, `OTHER`), biện pháp khắc phục. Hình thức bổ sung được gắn qua câu dẫn chiếu "Thực hiện hành vi quy định tại điểm a, điểm b khoản 5 Điều này …"; "tạm giữ" là thủ tục, không thành effect. Mỗi sanction giữ `evidence_provision_ids`.

**Behaviour signature (FR-08.1).**
- Baseline deterministic: action = câu chữ hành vi, polarity, phương tiện/chủ thể/địa điểm/điều kiện/ngoại lệ/hậu quả chỉ khi câu chữ nêu.
- Khi có `OPENAI_API_KEY`: LLM nhận snapshot vocabulary (`get_vocab_snapshot`) và trả từng dimension kèm `evidence`. Backend kiểm tra evidence phải là trích dẫn nguyên văn từ rule/tiêu đề Điều và `vocab_id` phải tồn tại đúng loại trong snapshot; giá trị sai bị loại và ghi vào `rejected_values`. Giá trị chưa có id được gửi tuần tự qua `add_vocab` (provenance = provision của rule): `EXISTING`/`CREATED` gắn canonical id, `AMBIGUOUS` giữ unresolved, `STALE_VERSION` nạp lại version.
- Lỗi model không làm hỏng rule: signature deterministic được giữ, run `FAILED` ghi lỗi.

**Trạng thái.** `UNCERTAIN` khi thiếu mức phạt, nhiều mức phạt không phân biệt được chủ thể, chất lượng đọc thấp, effect mâu thuẫn hoặc model báo không chắc chắn.

**ExtractionRun.** Mỗi lần trích xuất ghi method, model, prompt version, vocabulary version trước/sau, vocab id đã dùng/tạo, giá trị bị loại, trạng thái.

Văn bản sửa đổi nhập trước văn bản gốc được trích xuất lại khi văn bản gốc được nhập.

| Method | Path | Mô tả |
| --- | --- | --- |
| `GET` | `/api/documents/:documentId/violation-rules` | Rule + sanction + effects và các extraction run. |
| `POST` | `/api/documents/:documentId/violation-rules/extract` | Trích xuất lại (dùng LLM nếu có key); `409` nếu cần review. |

## 5. Violation identity và alias (#17, FR-10)

Mỗi ViolationRule được resolve về một `TrafficViolation` (identity của **hành vi**; phương tiện, chủ thể, mức phạt và thời gian thuộc rule), theo thứ tự ưu tiên:

1. **Alias**: câu chữ hành vi (chuẩn hóa bỏ dấu) trùng alias đã đăng ký.
2. **Structured signature** (SRS §4.6.2): `action vocab id | polarity | target | location | conditions` trùng nhau.
3. **Cùng provision bị sửa**: rule viết lại một địa chỉ mà rule cũ của violation V điều chỉnh (qua ProvisionRelation) và câu chữ còn chồng lấp → V. Khác biệt cấu trúc ở đây là thay đổi ngữ nghĩa (#19), không phải hành vi khác; nếu câu chữ gần như thay hoàn toàn → `AMBIGUOUS`.
4. **Lexical**: Dice trên bigram từ (tránh nhiễu từ đơn âm tiết lặp lại như "không chấp hành … giao thông"); ≥ 0,92 và duy nhất → match; < 0,5 → `CREATE_NEW`; ở giữa → `AMBIGUOUS`.
5. **LLM resolver** (khi có key) chỉ cho `AMBIGUOUS` vùng xám: model chỉ được chọn một candidate đã cho (`SAME`), `DIFFERENT` hoặc `UNSURE`; câu trả lời khác giữ `AMBIGUOUS`.

Similarity văn bản không bao giờ gộp hai hành vi có polarity/target/location/conditions khác nhau. `AMBIGUOUS` vẫn lưu rule nhưng không gắn violation (không dùng cho lineage chắc chắn). Mỗi quyết định lưu trong `identity_decisions` (method, score, candidates, lý do, model). Khi `MATCH_EXISTING`/`CREATE_NEW`, câu chữ hành vi và nhãn action được lưu thành alias để tìm kiếm.

| Method | Path | Mô tả |
| --- | --- | --- |
| `GET` | `/api/violations?q=&limit=` | Tìm violation theo alias (không dấu). |
| `GET` | `/api/violations/:violationId` | Violation, alias, các rule và quyết định identity. |
| `GET` | `/api/documents/:documentId/identities` | Quyết định identity của các rule trong văn bản. |
| `POST` | `/api/documents/:documentId/identities/resolve` | Resolve lại (kết quả ổn định, id violation deterministic). |

## 6. Lineage, quy tắc hiện hành và as-of (#18, FR-11/FR-12)

**RuleLineage** chỉ nối hai rule khi có evidence pháp lý (không nối chỉ vì cùng TrafficViolation):
- `PROVISION_RELATION`: các phiên bản của cùng một provision (cùng violation, cùng địa chỉ, cùng chủ thể) — văn bản sửa đổi đã viết lại provision đó;
- `DOCUMENT_REPLACEMENT`: cạnh `ACCEPTED` `FULLY_REPLACES`/`FULLY_REPEALS` từ văn bản B tới A, và đúng một nhóm rule ở mỗi bên có cùng violation + context (phương tiện, chủ thể).
Rule cùng hành vi nhưng khác phương tiện/chủ thể không có evidence nối → lineage song song.

**Khoảng hiệu lực** (`rule_intervals`): `valid_from` = ngày có hiệu lực của văn bản chứa rule; `valid_to` = sự kiện kết thúc sớm nhất có ngày:
- ProvisionRelation `ACCEPTED` từ văn bản sau tác động lên provision của rule hoặc khoản chứa mức phạt → `AMENDED` (successor = rule mới cùng địa chỉ) hoặc `REPEALED`;
- văn bản bị thay thế/bãi bỏ toàn bộ → `SUPERSEDED` nếu lineage có rule trong văn bản mới, ngược lại `REPEALED`.

**Cảnh báo → `UNCERTAIN`** (chỉ từ thời điểm cảnh báo có hiệu lực): ngày hiệu lực chưa đọc được, quan hệ tác động chưa xác minh (`CANDIDATE`), quan hệ đã xác minh nhưng không rõ ngày, instruction không resolve được nhưng nêu đúng provision, candidate cấp văn bản `CANDIDATE`/`AMBIGUOUS`/`CONFLICT` tác động lên văn bản.

**Trạng thái tại ngày T** được suy ra khi truy vấn (không lưu): `NOT_YET_EFFECTIVE`, `CURRENT`, `AMENDED`, `REPEALED`, `SUPERSEDED`, `UNCERTAIN`. Không có cạnh tác động không được hiểu là "chưa từng bị sửa": mọi kết quả trả kèm phạm vi corpus (số văn bản, lần nhập cuối, frontier chưa nhập) và disclaimer.

| Method | Path | Mô tả |
| --- | --- | --- |
| `GET` | `/api/violations/:violationId/rules?as_of=YYYY-MM-DD` | Theo từng lineage: rule áp dụng tại ngày (mặc định hôm nay) và rule `UNCERTAIN` kèm lý do; kèm `scope`. |
| `GET` | `/api/violations/:violationId/history` | Mọi lineage, rule theo thứ tự, khoảng hiệu lực, evidence kết thúc, trạng thái hôm nay. |
| `POST` | `/api/history/rebuild` | Tính lại lineage và khoảng hiệu lực cho toàn corpus. |

## 7. Thay đổi ngữ nghĩa giữa các phiên bản (#19, FR-13)

`change_events` được tính cùng lúc với history, chỉ giữa các rule liên tiếp trong **cùng lineage** (đã có evidence pháp lý nối), không bao giờ giữa hai rule bất kỳ của cùng violation:

- chuyển tiếp rule → successor: diff trên trường có cấu trúc — điều kiện/ngoại lệ (`*_ADDED/REMOVED/CHANGED`), chủ thể, phương tiện, địa điểm (`*_CHANGED`), mức phạt (`SANCTION_INCREASE/DECREASE/CHANGED`), trừ điểm (`POINT_DEDUCTION_APPLICABILITY_CHANGED`, `POINT_DEDUCTION_CHANGED`), tước GPLX, tịch thu, chế tài bổ sung/khắc phục; thay thế văn bản thêm `REPLACED`;
- rule bị bãi bỏ không có successor → `REPEALED` + `VIOLATION_REMOVED`; lineage bắt đầu bằng rule do văn bản sửa đổi thêm vào → `VIOLATION_ADDED`;
- không có khác biệt cấu trúc: câu chữ giống hệt → `NO_SEMANTIC_CHANGE`; câu chữ khác nhưng action cùng canonical vocab id → `NO_SEMANTIC_CHANGE` (ghi chú "wording changed"); câu chữ khác mà không chứng minh được tương đương → `UNKNOWN` (không mặc định là thay đổi hay không thay đổi).

Mỗi event giữ rule trước/sau, chi tiết trước/sau từng trường, evidence (ProvisionRelation hoặc DocumentRelation) và ngày hiệu lực.

| Method | Path | Mô tả |
| --- | --- | --- |
| `GET` | `/api/violations/:violationId/changes` | Các change event của violation theo thời gian. |
| `GET` | `/api/violations/:violationId/history` | Như trên, nhóm theo lineage (`changeEvents`). |

## 8. Đánh giá

`bun run eval` chạy toàn bộ pipeline trên `data/eval/preprocessing-dev-v1.json` (D1 in-memory) và tính metric cho từng bước so với nhãn gold cùng một baseline (xem [data/eval/README.md](../data/eval/README.md)). Kết quả dev-v1 (2026-10-26):

| Bước | Metric | Hệ thống (deterministic) | + LLM (gpt-5.4) | Baseline |
| --- | --- | --- | --- | --- |
| #8 Relevance | accuracy (16 provision) | 1.00 | 1.00 | — |
| #5 Document graph | F1 cạnh ACCEPTED (6) | 1.00 | 1.00 | header-only 0.29 |
| #11 Provision relation | F1 (3) | 1.00 | 1.00 | — |
| #15 Rule + sanction | F1 rule (8); fine/suspension/points accuracy | 1.00; 1.00/1.00/1.00 | 1.00; 1.00/1.00/1.00 | — |
| #17 Identity | pairwise F1 | 1.00 | 1.00 | so khớp nguyên văn 0.75 |
| #18 As-of | exact match (10 truy vấn) | 1.00 | 1.00 | rule mới nhất 0.40 |
| #19 Change types | micro F1 (16) | 1.00 | 0.94 | — |

Dev set được xây cùng lúc với hệ thống nên điểm cao là kỳ vọng (regression), không phải bằng chứng độ chính xác trên corpus thật. Lỗi còn lại ở chế độ LLM: danh sách phương tiện model đọc không ổn định giữa các văn bản (`VEHICLE_SCOPE_CHANGED` sai). Dev set đã phát hiện và giúp sửa một lỗi thật: nội dung mới trong ngoặc kép bị gán `IRRELEVANT`.

### Smoke test LLM thật

Trên corpus mẫu, bước semantic gọi Responses API ~3,5–12 s/văn bản; registry vocabulary được tạo qua `add_vocab` (12 entry), backend loại các giá trị có evidence không nằm trong câu chữ (ví dụ model lấy mức phạt làm "consequence"). Hạn chế đã thấy: `add_vocab` coi "xe mô tô" ≈ "xe ô tô" (similarity ký tự 0,875) là `AMBIGUOUS`, nên giá trị đó giữ unresolved.
