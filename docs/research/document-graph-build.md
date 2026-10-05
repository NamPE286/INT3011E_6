# Tự xây dựng lược đồ quan hệ văn bản pháp luật

Nghiên cứu ngày 05/10/2026, phục vụ thay đổi SRS và các issue về thu thập, DocumentRelation, ProvisionRelation, lịch sử và evaluation. Đây là thiết kế nghiên cứu và kế hoạch PoC; chưa phải crawler hoặc bộ trích xuất đã triển khai và chưa có số đo chất lượng của hệ thống.

## 1. Quyết định

**Hệ thống tự xây dựng lược đồ từ nội dung văn bản gốc, định danh văn bản, chỉ dẫn sửa đổi và bằng chứng hiệu lực.** Lược đồ VBPL/Công báo, nếu lấy được, là nguồn quan sát phụ để tìm ứng viên hoặc đối chiếu. Không coi danh sách của bất kỳ nguồn nào là đầy đủ, không lấy nhãn trong lược đồ làm kết luận pháp lý có precedence cao hơn toàn văn, và không bắt buộc scrape lược đồ nguồn để import được nội dung.

Thiết kế tách ba việc: thu thập nội dung; phát hiện/resolve/phân loại quan hệ; kiểm chứng kết quả. Hoàn tất crawl hay queue không chứng minh đã tìm mọi quan hệ thực tế. Kết quả phải công bố corpus, khoảng thời gian, nguồn, snapshot và các thiếu sót đã biết. Không đặt nghiệm thu là “đầy đủ tuyệt đối”; đo precision/recall trên gold set độc lập và báo cáo coverage trong phạm vi được khai báo.

## 2. Nguồn và nền tảng nghiên cứu

- [VBPL gateway](https://vbpl-bientap-gateway.moj.gov.vn/api/qtdc/public/doc/110978) cung cấp metadata và HTML trong `data.documentContent.content`. Bốn snapshot đã có trong nghiên cứu trước đều có `references=null`; giá trị này không chứng minh không có quan hệ. Endpoint chưa có tài liệu cam kết ổn định hoặc bulk export. Adapter cần giữ snapshot và tách khỏi domain model.
- [Công báo 53/2016](https://congbao.chinhphu.vn/van-ban/thong-tu-so-53-2016-tt-btc-19379/13841.htm), [Cổng Chính phủ 75/2015](https://chinhphu.vn/default.aspx?docid=184742&pageid=27160), [Công báo 99/2025](https://congbao.chinhphu.vn/van-ban/thong-tu-so-99-2025-tt-btc-46529.htm) là điểm đối chiếu chính thức và có tài liệu gốc. Văn bản dài có thể nằm trong nhiều tệp Công báo; phải kiểm tra cả nội dung chính và phụ lục.
- [Akoma Ntoso 1.0, OASIS Standard](https://docs.oasis-open.org/legaldocml/akn-core/v1.0/os/part1-vocabulary/akn-core-v1.0-os-part1-vocabulary.html) phân biệt reference, active/passive modification, quoted structure, nguồn/đích sửa đổi, nội dung cũ/mới, thời gian và ngoại lệ. Đây là nền tảng tham khảo cho mô hình dưới đây; không yêu cầu MVP chuyển mọi văn bản sang XML hoặc áp dụng toàn bộ chuẩn.
- Nghiên cứu [Reference Extraction from Vietnamese Legal Documents, SoICT 2019](https://doi.org/10.1145/3368926.3369731) đặt bài toán nhận diện reference thành sequence labeling. Bài [Phân loại quan hệ tham chiếu trong văn bản pháp quy, PTIT 2020](https://jstic.ptit.edu.vn/jstic-ptit/index.php/jstic/article/download/311/144/1588) tách nhận diện reference khỏi phân loại quan hệ và sử dụng ngữ cảnh của reference, văn bản hiện tại và tên điều khoản. Bài [Joint Reference and Relation Extraction, 2023](https://reference-global.com/article/10.2478/cait-2023-0014?tab=abstract) nghiên cứu trích xuất kết hợp. Các công trình này giúp thiết kế baseline; điểm số trong dataset của tác giả không phải điểm số hay bảo đảm coverage của dự án này.

Các quyết định chi tiết dưới đây là đề xuất engineering của dự án dựa trên các nguồn và mẫu đã đọc, không phải kết luận rằng nguồn công bố sẵn một graph hoàn chỉnh.

## 3. Mẫu thực tế và lỗi phải tránh

Các quan sát dùng bốn JSON snapshot: `gateway-66801.json` (200/2014), `gateway-53.json` (53/2016), `gateway-67306.json` (75/2015), `gateway-187356.json` (99/2025). Đây là các mẫu kế toán dùng để kiểm tra cơ chế graph, không mở rộng domain MVP ra ngoài xử phạt giao thông. Bộ đánh giá cuối cùng còn cần các chuỗi giao thông thật.

| Nội dung quan sát | Quan hệ cần xây | Điều không được suy ra |
|---|---|---|
| 53/2016, Điều 1 khoản 1 tác động điểm g khoản 1 Điều 15 của 200/2014 | `53 → 200: AMENDS_OR_SUPPLEMENTS`, scope có locator; ProvisionRelation nối chỉ dẫn Điều 1.1 với đích 200 Điều 15.1.g | Mọi điều của 200 đều được sửa; hoặc một cạnh document đủ để quyết định hiệu lực từng provision |
| 53/2016, Điều 1 khoản 4 thay cụm từ tại nhiều locator | Một change instruction có nhiều target scope, kèm thao tác `SUBSTITUTE_TEXT`; expand target sau khi resolve | Chỉ giữ locator đầu tiên; ép mỗi instruction chỉ có một đích |
| 53/2016, nội dung thay vào Điều 69.4.1 nhắc Điều 69.4.2 | Reference trong quoted replacement content; giữ vai trò và owner của nội dung | Điều 69.4.2 cũng là target được sửa chỉ vì nằm trong cùng block |
| 75/2015, Điều 1 thay nội dung Điều 128 của 200 | `75 → 200: AMENDS_OR_SUPPLEMENTS`, scope Điều 128; quoted Điều 128 là nội dung mới của đích | Quoted Điều 128 là một điều độc lập của 75 |
| Nội dung quoted của 75 nhắc Quyết định 15/2006 và Thông tư 244/2009 | Lưu reference và context của Điều 128 được thay vào 200; tác động lồng nhau cần owner/timeline riêng | Thấy từ thay thế rồi tự tạo `75 → 15/2006: REPLACES` như một thay thế mới độc lập |
| 99/2025, Điều 31 khoản 1 liệt kê 200, 75, 53, 195/2012; khoản 2 giữ một số nội dung của 200 | Tách từng target; `99 → 200: REPLACES` có ngoại lệ, các target khác có scope riêng; ghi các phần được tiếp tục áp dụng | Gán toàn bộ provisions của 200 thành hết hiệu lực chỉ từ nhãn document hoặc nhãn nguồn |

Đọc các điều tương ứng trong [toàn văn chính thức VBPL 53](https://vbpl-bientap-gateway.moj.gov.vn/api/qtdc/public/doc/110978), [75](https://vbpl-bientap-gateway.moj.gov.vn/api/qtdc/public/doc/67306) và [99](https://vbpl-bientap-gateway.moj.gov.vn/api/qtdc/public/doc/187356). Bảng là phân tích cấu trúc từ snapshot, chưa phải bộ gold đã được thẩm định toàn bộ với PDF.

HTML của 53 Điều 1.2 có dấu hiệu mất cụm từ thay thế/dấu đóng ngoặc kép. Không sửa bằng suy đoán hoặc yêu cầu LLM điền từ trí nhớ; đặt `SOURCE_TEXT_INCOMPLETE` và đối chiếu bản gốc. Numbering trong HTML 99 Điều 31 cũng cần kiểm tra với PDF trước khi resolve mọi locator. Có văn bản gốc không đồng nghĩa bản HTML đã chuyển đổi là chính xác tuyệt đối.

Ngày hiệu lực và điều kiện áp dụng là hai trường khác nhau: 53 có mốc hiệu lực 21/03/2016 nhưng quy định năm tài chính và lựa chọn áp dụng cho báo cáo trước đó; 75 có mốc 14/07/2015 nhưng quoted Điều 128 nói về năm tài chính 2015; 99 có mốc 01/01/2026 kèm điều kiện năm tài chính. [Bộ Tài chính trả lời trường hợp năm tài chính bắt đầu trước 01/01/2026](https://portal.mof.gov.vn/hoidapcstc/home/cthoidap/159102), cho thấy một `effective_at` đơn lẻ không đủ để quyết định applicability.

## 4. Phân loại và chiều quan hệ

Chiều canonical đối với tác động là **văn bản/provision chứa chỉ dẫn → văn bản/provision bị tác động**. Incoming là truy vấn đảo cạnh canonical, không phải bản ghi domain thứ hai. Một cặp văn bản có thể có nhiều quan hệ, nhiều scopes và nhiều thời điểm.

| Family | Nghĩa và evidence cần có |
|---|---|
| `LEGAL_BASIS` | Văn bản A được ban hành dựa trên B; preamble và cú pháp căn cứ hỗ trợ quan hệ. Tên B chỉ nằm trong tên/trích yếu của C chưa chắc có cạnh A → B |
| `REFERENCES` | Nội dung A thực sự dẫn chiếu B/provision của B; không làm thay đổi hiệu lực B |
| `DETAILS_OR_GUIDES_EXECUTION`, `GUIDES_APPLICATION`, `APPLIES`, `EXPLAINS` | Nội dung xác định vai trò hướng dẫn, chi tiết, áp dụng hoặc giải thích; tiêu đề giúp tạo candidate, chưa đủ cho scope pháp lý |
| `AMENDS_OR_SUPPLEMENTS` | Giữ nhãn kết hợp khi câu chỉ dẫn không tách được sửa/bổ sung; operation chi tiết có thể là chèn, thay từ, thay nội dung, đổi số hoặc bổ sung |
| `REPLACES` | Chỉ dẫn thay thế văn bản hoặc phần quy định; scope và exception bắt buộc được xét. Thay cụm từ là `SUBSTITUTE_TEXT` operation, không phải thay thế toàn bộ document |
| `REPEALS`, `CORRECTS`, `SUSPENDS_EXECUTION` | Bãi bỏ, đính chính, đình chỉ có chỉ dẫn và target riêng; không đổi tất cả thành thay thế |
| `EFFECT_DURATION_CHANGE`, `CONTINUES_APPLICATION` | Tạm ngưng, gia hạn, tiếp tục áp dụng; giữ raw action và điều kiện chấm dứt nếu chưa có ngày cụ thể |
| `CONSOLIDATES` | Văn bản hợp nhất chứa các văn bản thành phần; không tự sinh một thay đổi hiệu lực mới từ ngày ban hành bản hợp nhất |
| `UNKNOWN` | Gặp hành động chưa map được: giữ evidence và đưa review; không bỏ record hoặc tự map vào quan hệ gần giống |

Các family ở bảng là cách nhóm khái niệm cho nghiên cứu. Khi lưu domain theo SRS, `REPLACES`/`REPEALS` map sang `PARTIALLY_*` hoặc `FULLY_*` chỉ khi scope đã được evidence xác minh; các nhánh hướng dẫn map `GUIDES`/`DETAILS`; đình chỉ map `SUSPENDS`; gia hạn map `EXTENDS_EFFECT`, có hiệu lực lại map `RESUMES_EFFECT`. Không ép `CONTINUES_APPLICATION` thành `RESUMES_EFFECT` khi quy định chỉ duy trì áp dụng. `AMENDS_OR_SUPPLEMENTS` và `UNKNOWN` giữ kết quả chưa tách được subtype thay vì tự gán sửa hay bổ sung.

Scope dùng `WHOLE_DOCUMENT`, `PROVISION_SET`, `TEXT_SPAN`, `CONDITIONAL` hoặc `UNRESOLVED` bên trong `scope_json` của SRS. Không dùng boolean `partial` thay cho danh sách locator/exceptions. Evidence chỉ xác nhận tồn tại quan hệ document có thể đủ để publish cạnh discovery, trong khi scope/provision/time còn unresolved; cạnh đó không được quyết định legal status của từng rule.

Không tạo legal change từ mức độ giống nội dung, việc ban hành sau, cùng lĩnh vực hoặc cùng tên. Một reference mention có thể được gắn `MENTION_ONLY` và không sinh quan hệ pháp lý; một đoạn mô tả văn bản đã sửa văn bản khác không phải chỉ dẫn sửa mới của văn bản đang đọc.

## 5. Pipeline đề xuất

### 5.1. Thu thập và chuẩn hóa có thể tái lập

1. Lưu source URL, namespace/source ID, thời điểm fetch, byte/hash snapshot, metadata và các tệp gốc. ID nguồn là string; không coi ID nguồn là ID canonical xuyên website.
2. Tách text từ HTML/PDF, giữ bảng, phụ lục, block boundary, heading và quote. Dùng Unicode NFC, chuẩn hóa khoảng trắng/dấu gạch cho lookup nhưng giữ text gốc và mapping offset về snapshot.
3. Cố định quy ước evidence offsets, ví dụ Unicode code-point offsets trong immutable extracted text. Không trộn offsets JavaScript UTF-16 với Python code points. Evidence về PDF lưu page/locator hoặc vùng OCR cùng hash và OCR version.
4. Gắn text-quality flags: thiếu phần, OCR nghi ngờ, dấu quote không cân, locator thiếu, numbering lệch. Không coi parse error là không có reference.

### 5.2. Segment cấu trúc và vai trò

Parse preamble, chương, Điều, Khoản, Điểm, phụ lục, phần hiệu lực và chuyển tiếp. Decimal khoản như `3.11` không được tách thành Điều 3/Khoản 11. Quote có `Điều ...` tạo cây nội dung được chèn vào target, không thay đổi outer instruction tree.

Mỗi span có `content_role`: `OPERATIVE_INSTRUCTION`, `PREAMBLE_BASIS`, `QUOTED_NEW_TEXT`, `QUOTED_OLD_TEXT`, `HISTORICAL_DESCRIPTION`, `TITLE_REFERENCE`, hoặc `ORDINARY_TEXT`. Giữ `container_provision_id`, `quote_depth`, `target_document_context` và `target_provision_context`. Các đại từ như văn bản này, Điều này, khoản này resolve bằng cây và context; nếu nhiều nghĩa thì giữ ambiguous.

### 5.3. Trích reference mention để tạo candidate

Baseline rule nhận dạng loại, số/ký hiệu, năm, cơ quan, ngày ban hành, tên văn bản và locator; mở rộng được danh sách nhiều điểm/khoản, ranges và các locator chia sẻ suffix. Rule phải có cửa sổ ngữ cảnh cấu trúc, không chỉ tìm keyword cùng một câu.

Ví dụ pattern về số/ký hiệu có thể tìm `200 / 2014 / TT-BTC` sau chuẩn hóa; văn bản cũ có định dạng khác, chỉ có tên/ngày hoặc không có năm trong số hiệu vẫn phải tạo unresolved mention. Đừng dùng một regex mẫu như grammar hoàn chỉnh của mọi thời kỳ.

Mỗi mention giữ raw text, normalized identifiers, span, section role, candidate document IDs và trạng thái resolution. Tạo cả mentions trong quoted text/historical description để phục vụ discovery, nhưng phân biệt khỏi instruction có tác động hiệu lực. Nhánh semantic/LLM có thể bổ sung mention không tìm được bằng rule; phải chỉ rõ span có thật và được đánh giá riêng về candidate recall.

### 5.4. Resolve document rồi resolve provision

Lookup số/ký hiệu đầy đủ, loại, cơ quan, ngày và tên; dùng thông tin cấu trúc/ngữ cảnh để phân biệt số hiệu trùng. Alias giữa nguồn chỉ được ghi sau đối chiếu metadata/nội dung. Không dùng số hiệu đơn lẻ hoặc embedding Top-1 để tự merge.

Reference chỉ có tên luật được tìm trong catalogue, rồi kiểm tra ngày/phiên bản được nhắc. Reference về Điều/Khoản/Điểm resolve trên document version thích hợp với chỉ dẫn; đối chiếu locator có tồn tại, các renumbering đã biết và old-text nếu có. Nếu target chưa có trong corpus: tạo placeholder có source mention, enqueue fetch, giữ `UNRESOLVED`; không tạo provision giả để làm graph có vẻ hoàn chỉnh.

Nếu hai candidates đều phù hợp, giữ `AMBIGUOUS` và review. Thời gian giúp chọn candidates, không chứng minh quan hệ. Một bản hợp nhất hoặc snapshot HTML được cập nhật không tự thay thế identity của văn bản gốc đã ban hành.

### 5.5. Xác định action, scope, thời gian, điều kiện

Rules xử lý cú pháp rõ ràng để tạo DocumentRelationCandidate và ChangeInstruction. Nhận diện actor/action/target và phủ định/ngoại lệ; phân biệt tiêu đề mô tả, chỉ dẫn trực tiếp, quoted content và lịch sử. Không giả định mọi reference dưới Điều sửa đổi đều bị sửa.

LLM dùng cho câu dài, nhiều đích, viết tắt, anaphora hoặc exception khó. Input gồm span, heading cha, quote context, candidate document/provision IDs và đoạn hiệu lực/chuyển tiếp cần thiết. Output cấu trúc có action, target chọn từ candidate IDs, scopes, exclusions, applicability condition, evidence span cho từng trường, hoặc abstain. Context có thể vượt một chunk; trường chưa thấy đầy đủ không được suy đoán từ trí nhớ model.

Validator kiểm tra schema; ID có trong candidate set; span trỏ về đúng snapshot; subtype thực sự được evidence hỗ trợ; scope có locator resolve được; lists/exceptions không bị mất; trường thời gian có evidence. LLM confidence chỉ là tín hiệu xếp hàng review, không phải xác suất đã được hiệu chuẩn. Evidence hỗ trợ phải thực sự nói về quan hệ, không chỉ chứa hai tên văn bản.

Chỉ nâng `ACCEPTED` theo quy tắc validator đã quy định hoặc quyết định review có audit trail. Cases xung đột, thiếu text, implicit repeal hoặc target mơ hồ cần review/abstain. Deterministic extraction cũng phải đi qua cùng validation, không mặc nhiên đúng vì không dùng LLM. Tên `CONFIRMED` trong các thiết kế trích xuất khác tương đương `ACCEPTED` trong SRS này, không phải một status domain bổ sung.

### 5.6. Materialize và tìm incoming

Từ candidates đã xác nhận, tạo DocumentRelation và ProvisionRelation có evidence. Một DocumentRelationCandidate có thể cho document edge trước, provision scopes sau; link giữa hai lớp để biết giới hạn chi tiết. Derive incoming bằng reverse query; giữ cycles của reference/legal basis và multi-edge, không ép document graph thành DAG.

Tìm incoming cần **corpus discovery độc lập với adjacency của root**:

1. Lập catalogue có nguồn, loại/cơ quan, phạm vi trung ương/địa phương, khoảng thời gian và ngày cập nhật đã khai báo.
2. Ingest/index mentions trong mọi văn bản của corpus đã chọn, bao gồm văn bản mới hơn root và các văn bản sửa đổi tổng hợp nhiều văn bản. Không cắt bỏ văn bản chỉ vì title không chứa từ giao thông trước khi chạy relation discovery.
3. Dùng inverted index `normalized_reference → containing_document/span` để tìm văn bản nhắc root/aliases; trích action/scope từ những span này. Ngày ký hiệu số, title aliases và reference có lỗi cần search bổ sung.
4. Fetch missing target và xử lý đến khi không còn work items trong phạm vi. Catalogue delta đưa các văn bản mới/cập nhật vào pipeline, không chỉ recrawl root.
5. Search trên nguồn chính thức/lược đồ nguồn hỗ trợ tìm candidate bên ngoài corpus. Search engine và nhãn nguồn không chứng minh mọi văn bản đã được phát hiện.

Chuỗi 200/75/53/99 là kiểm tra incoming quan trọng: import 200 mà toàn văn root không nhắc văn bản ban hành sau phải vẫn tìm được 53/75/99 khi chúng có trong corpus. Nếu chỉ lấy root và follow citations outgoing, sẽ không có khả năng bảo đảm phát hiện các văn bản mới này.

## 6. Schema tối thiểu

MVP có thể dùng bảng relational; chưa cần chọn graph database hoặc framework extraction để kiểm chứng phương pháp.

| Entity | Trường bắt buộc/ý nghĩa |
|---|---|
| `Document` / `DocumentSource` / `SourceSnapshot` | Canonical ID; source identities đã kiểm chứng; loại, số/ký hiệu, cơ quan, ngày; phiên bản nội dung/hash và thời điểm thu thập |
| `Provision` | Document/snapshot/version, parent, locator, content_role, quote/context, text span; versioned provision identity khi nội dung thay đổi |
| `DocumentReference` (reference mention) | Raw text/span, identifiers, locator, role; candidate IDs; resolution `RESOLVED / UNRESOLVED / AMBIGUOUS`; không phải edge đã xác nhận |
| `DocumentRelationCandidate` | Actor, target/mention, family/raw action, operation, scope/exclusions, time/conditions; status `CANDIDATE / UNRESOLVED / AMBIGUOUS / CONFLICT / ACCEPTED / REJECTED`; extractor run; resolution reason/reviewer |
| `ChangeInstruction` | Provision chứa chỉ dẫn, affected document context, action, nhiều target scopes, old/new text, insertion position, effective/applicability evidence |
| `DocumentRelation` | Source/target canonical IDs, family, scope status; candidate/evidence links; cạnh chỉ tồn tại trong canonical graph khi được xác nhận |
| `ProvisionRelation` | Instruction/source provision version và target provision version/set; operation/scope, valid-time/conditions, evidence links; không tự gán current status cho cả document |
| `RelationEvidence` | Snapshot/source URL/hash, span/page/locator, field được hỗ trợ, content_role/context; nhiều evidence và provenance cho cùng assertion |
| `SourceRelationObservation` | Nhãn raw của UI/API nguồn; observed document/side; related raw identifier; fetched_at/hash; mapped candidate nếu có. Observation còn được giữ dù candidate bị reject |
| `ExtractionRun` / `GraphBuildRun` | Parser/rules/model/prompt version, input hashes, corpus manifest, fetch/parse/discovery counts, unresolved/conflicts/failures, review decisions và checkpoint |

Candidate status, target resolution và legal status có ý nghĩa riêng: một candidate bị `REJECTED` không có nghĩa văn bản bị bãi bỏ; `ACCEPTED` không có nghĩa toàn bộ target đang hết hiệu lực. MVP theo SRS lưu trạng thái tổng hợp của candidate và `resolution_reason`, còn trạng thái resolve của mention nằm ở `DocumentReference`. Có thể tách `resolution_state`/`decision_state` sau này nếu cần biểu diễn đồng thời nhiều vấn đề; không bắt buộc mở rộng schema trước PoC. Thay đổi review decision lưu lịch sử; không xóa evidence cũ.

Mỗi cạnh dùng semantic identity gồm endpoints, family và scope/event. Các evidence bổ sung không tạo cạnh trùng; cùng cặp endpoints khác family/scope/event không bị gộp. Document edges có thể tổng hợp nhiều provision instructions nhưng vẫn phải mở được từng instruction.

Giữ hai loại thời gian: thời gian pháp lý (`effective_from/to`, `applicability_condition`, ngoại lệ, điều kiện kết thúc) và thời gian hệ thống quan sát (`fetched_at`, `extracted_at`, `reviewed_at`). Không dùng thời điểm fetch hoặc ngày của bản hợp nhất làm ngày sửa đổi. Ngày kết thúc có điều kiện mà chưa biết văn bản thay thế phải giữ chưa xác định.

## 7. Coverage, conflict và cập nhật

`READY` theo SRS chỉ xác nhận các bước bắt buộc đã đạt theo discovery policy/cutoff khai báo, tương đương ý nghĩa đã xử lý trong phạm vi. `PARTIAL` dùng khi fetch/parse failure, cap/frontier, missing corpus segment hoặc unresolved/conflict ảnh hưởng tới phần chuỗi pháp lý cần xử lý. Candidate phụ chưa được review vẫn phải báo trong coverage nhưng không tự động làm mọi root import thất bại. `UNCERTAIN` gắn assertion/legal-status khi evidence không đủ. Dù run đã xử lý xong, không được đổi nhãn UI thành “mọi quan hệ pháp lý đầy đủ”.

Manifest phải ghi source, catalogue/query/filter, khoảng thời gian, cutoff, document/snapshot inventory, phần phụ lục thiếu và văn bản chưa fetch được. Tách discovery coverage, text-quality coverage, resolution coverage và evaluation quality. Danh sách unresolved/conflicts là kết quả cần hiển thị, không phải sự im lặng.

Quan hệ nhãn UI và text mâu thuẫn tạo conflict observation. Ưu tiên bằng chứng chỉ dẫn trong bản văn đã đối chiếu với nguồn gốc cho tác động pháp lý; metadata/lược đồ là support. Nếu hai bản text chính thức khác nhau, phải kiểm tra bản đính chính/phiên bản và review, không tự overwrite theo thứ tự fetch. Không thể giải quyết bằng cách đơn giản ưu tiên LLM hoặc metadata.

Khi snapshot đổi, diff input và chạy lại phần bị ảnh hưởng; version candidates/evidence rồi tái đánh giá materialized graph. Có văn bản mới phải cập nhật mention index và incoming của target. Import lặp cùng hashes không tạo duplicate; thay đổi version model/rule cần run mới để reproduce. Legal history giữ evidence phiên bản cũ.

## 8. PoC và đánh giá

PoC phải **tắt nguồn lược đồ** và vẫn xây được graph bằng toàn văn. Source diagram có thể được thêm lại để so sánh nhưng không làm gold labels và không phải điều kiện bắt buộc cho pipeline chính.

Gold set được đọc độc lập từ toàn văn/tệp chính thức, gồm cả những văn bản không có quan hệ và mentions không phải action. Gán nhãn entire documents thay vì chỉ chọn những câu đã được extractor tìm thấy; có hai người gán nhãn độc lập hoặc một vòng review độc lập, adjudicate disagreements và giữ guideline/decision log. Graph gold phải nói rõ corpus/snapshot; chưa đọc được target phải ghi unknown chứ không coi negative.

Các strata cần có: preamble căn cứ; title reference; citations thường; sửa/bổ sung nhiều đích; thay cụm từ; bãi bỏ; thay thế có ngoại lệ; đính chính; đình chỉ/gia hạn/tiếp tục; bản hợp nhất; quoted/nested references; aliases/không có số hiệu; document địa phương; OCR/HTML lỗi; scope chưa resolve. Trong domain giao thông cần thêm nhiều context/phương tiện và chuỗi thay đổi có ảnh hưởng sanction thật.

| Task | Đo riêng để không che lỗi |
|---|---|
| Corpus acquisition | Inventory fetched/failed, snapshot/text/attachment coverage, cutoff và giới hạn discovery; không gọi tỷ lệ crawl là recall pháp lý |
| Reference/target candidate discovery | Span P/R/F1, candidate recall trên gold references, Recall@K target catalogue nếu dùng top-K |
| Entity resolution | Accuracy target ID với denominator rõ; unresolved/ambiguous rate và accuracy trên phần resolve; báo cả lỗi tự merge |
| Document relation extraction | Micro/macro P/R/F1 và per-type trên tuple `(source_id, target_id, type)`; tách directed edge đúng/sai |
| Scope và provision resolution | P/R/F1 target locator/set; exact match whole instruction; errors về quote owner và list expansion |
| Temporal/exception extraction | Field F1/exact match ngày, application condition, exception set; không gộp với document triple F1 |
| Evidence | Span/locator validity và evidence-support precision; tỷ lệ accepted edges có provenance mở lại được |
| Review/abstention | Candidate/accepted/rejected counts; abstention rate; chất lượng trên phần tự xác nhận và số gold edges còn nằm trong abstention |
| End-to-end | Edge quality + current/as-of provision/rule QA; phân biệt lỗi corpus, parser, target, action, scope, time và reasoning |

Gold triples lấy document-level đúng vẫn chưa đủ cho current-rule QA. Vì vậy document relation F1 phải đi kèm scope/time/provision metrics. Đừng tính unknown outside-corpus là false negative xác định rồi trình bày số đo như recall trên toàn bộ luật Việt Nam; báo nó là giới hạn coverage. Cũng không được loại hết unresolved khỏi denominator để làm điểm số tốt lên.

So sánh các baseline cùng corpus/gold: rules-only; reference extraction + context classifier/resolver; hybrid rules + evidence-constrained LLM/resolver. Ablation cần bỏ quote context hoặc incoming corpus index để đo tác động, không để model tự nhìn gold UI diagrams. Split theo document lineage/amendment chain và giữ test độc lập, tránh cùng chain/near-duplicate snapshot đi vào train/dev và test.

Chưa có số đo thực nghiệm của dự án trong nghiên cứu này. Ngưỡng chấp nhận chất lượng cần được thống nhất sau pilot trên dev, cố định trước khi chạy held-out test và ghi trong evaluation report. Không mượn F1 của công trình khác để đặt claim cho PoC.

### Các case bắt buộc của PoC

1. Tìm được 53 → 200 và 75 → 200 từ chỉ dẫn toàn văn khi source diagram không có/không dùng; show source provision và target locators.
2. Tìm incoming từ corpus index sau import root 200; phân biệt root-only run chưa có các văn bản mới với corpus run đã thu thập chúng.
3. 53 Điều 1.4 expand đủ các target được chỉ dẫn; reference đến 69.4.2 trong quoted content không biến thành amendment target sai.
4. 75 outer Điều 1 và quoted Điều 128 có context khác nhau; không tạo thay thế sai từ 75 đối với 15/2006 chỉ vì keyword nằm trong quote.
5. 99 Điều 31 resolve từng target, giữ exception set đối với 200 và điều kiện năm tài chính; không gán hết hiệu lực mọi provision của 200.
6. Text thiếu, target ngoài corpus, alias mơ hồ, source label conflict và implicit/generic repeal đều để trạng thái phù hợp kèm evidence/reason, không ép accept.
7. Import lại không nhân đôi cạnh/evidence; giữ nhiều actions/scopes cùng endpoints và incoming derived; snapshot/model version đổi trace được run.
8. Có gold dataset, metrics/per-type errors và corpus manifest được tái lập. Hoàn thành các case cấu trúc là điều kiện PoC, không thay cho đánh giá định lượng hay chứng nhận graph đầy đủ.

## 9. Thay đổi cần phản ánh vào SRS và issue

Thu thập metadata/toàn văn trở thành nhiệm vụ source adapter; xây DocumentRelation là task riêng gồm mention discovery, resolver, extraction/validation và incoming corpus index. ProvisionRelation tiêu thụ ChangeInstruction và cùng provenance/context, không tự suy ra từ cạnh document. UI hiển thị graph do hệ thống xây kèm evidence/trạng thái và phạm vi coverage; source observations có thể mở đối chiếu.

Thứ tự xử lý nên là `acquire → segment/context → reference candidates + identity resolution → relation/action/scope extraction → validate/review → materialize document/provision graph → traffic processing/history/QA`. Có thể lặp acquire khi resolver phát hiện target thiếu. Technical direction giữ source adapter với nội dung/metadata và optional source observations; không yêu cầu `getRelations()` trả canonical graph có sẵn từ nguồn.

Research contribution bắt đầu từ raw legal texts, bao gồm tự xây document graph có evidence và scope, sau đó provision graph và behavior/sanction history. Source graphs là baseline/comparison data hữu ích nếu lấy được, còn completeness luôn phải gắn với corpus và measured evaluation.
