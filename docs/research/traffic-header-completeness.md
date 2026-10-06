# Kiểm chứng header trong graph văn bản giao thông đường bộ

Ngày kiểm chứng: 06/10/2026. Phạm vi mẫu: chuỗi Nghị định 100/2019, 123/2021, 168/2024 và các luật được viện dẫn. Đây là kiểm chứng phản ví dụ và khả năng xử lý PDF, không phải benchmark toàn bộ pháp luật giao thông.

## Kết quả quyết định

**Header không đầy đủ cho graph quan hệ pháp lý.** Nó hỗ trợ lấy căn cứ ban hành, số hiệu, cơ quan và ngày, nhưng không bao phủ sửa đổi/bãi bỏ/thay thế, phạm vi tác động, hiệu lực khác nhau theo điều khoản, chuyển tiếp hoặc incoming từ văn bản ban hành sau.

| Quan hệ được xác minh từ PDF | Evidence | Có trong header của văn bản tác động? |
|---|---|---|
| 123/2021 tác động một phần tới 100/2019 | Điều 2: sửa đổi, bổ sung, bãi bỏ; PDF bản ký, trang 46 | Không; số 100/2019 không có trong preamble |
| 168/2024 sửa đổi/bổ sung một phần 100/2019 | Điều 52; PDF Công báo phần 2, trang 29 và tiếp theo | Không; preamble chỉ nêu 5 luật làm căn cứ |
| 100/2019 thay thế 46/2016 | Điều 84 khoản 2, PDF gốc trang 151; OCR được đối chiếu ảnh trang | Không |

Trên ba positive document-change links này, header không tìm được cả ba. Đây đủ để bác bỏ giả định header đầy đủ; không được gọi 0/3 là recall trên toàn bộ corpus hoặc mọi loại quan hệ.

Nguồn PDF chính thức:

- [100/2019 PDF gốc VBPL](https://vbpl-bientap-gateway.moj.gov.vn/api/qtdc/public/doc/minio/buckets/vbpl/140152/VanBanGoc_100_2019_ND-CP_426369.pdf/download): 152 trang scan; đã OCR/đối chiếu phần mở đầu và cuối văn bản, không coi toàn bộ OCR đã được nghiệm thu.

- [123/2021 bản ký](https://datafiles.chinhphu.vn/cpp/files/vbpq/2022/01/nd-123_2021-12-28-1-.signed.pdf): 98 trang, trích được text.
- [168/2024 bản ký](https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/01/168-nd-cp.signed.pdf): 111 trang scan; pypdf không lấy được text ở tất cả trang.
- [168/2024 Công báo phần 1](https://congbaocdn.chinhphu.vn/CongBaoCP/VanBan/2024/12/43733/54010-1-202575-76168-2024-nd-cp.pdf): 95 trang có lớp text.
- [168/2024 Công báo phần 2](https://congbaocdn.chinhphu.vn/CongBaoCP/VanBan/2024/12/43733/54013-1-202577-78168-2024-nd-cp.pdf): 34 trang có lớp text, chứa Điều 52–55. Chỉ tải phần 1 sẽ bỏ mất thay đổi/hiệu lực/chuyển tiếp.

Hai phần Công báo có layout/page count khác bản ký; không so sánh số trang như cùng một bản PDF hoặc trộn offsets mà không giữ source/version.

## PDF có xử lý được không?

Khả thi với pipeline kết hợp, nhưng cần các quality gates:

1. Kiểm tra nội dung thực sự là PDF; endpoint download có thể trả HTML dù tên/link trông như PDF.
2. Trích text từng trang; ghi trang thiếu text, lỗi/encrypted hoặc thiếu phần/phụ lục.
3. Nếu scan: render và OCR. Đã thử OCR tiếng Việt bằng macOS Vision (`vi-VT`) trên trang mở đầu và hai trang nội dung của bản ký 168; lấy được text nhưng có lỗi dấu/ký tự. Đây là thử nghiệm local, chưa là engine OCR portable đã triển khai.
4. Giữ PDF hash, page/region, text-layer/OCR method/version và confidence/quality flags. Trường OCR mơ hồ không được tự trở thành cạnh ACCEPTED hoặc scope tác động chính xác.
5. Segment metadata/header, preamble, body, quote, hiệu lực/chuyển tiếp; extract references và actions toàn văn trước relevance filtering.
6. Resolve identity từ loại/số hiệu/ngày/cơ quan/corpus; tách legal basis khỏi amendment; xử lý lists/ranges, exceptions và quoted targets.
7. Materialize graph đã kiểm chứng; xây incoming từ corpus index và thu thập văn bản mới hơn. Không suy “không có thay đổi” từ header/graph rỗng.

Điều 53 của 168 có hiệu lực mặc định và các trường hợp khác theo điều khoản; dữ liệu header không thể thay thế phần này. Cần lấy đủ tất cả phần PDF trước khi kết luận phạm vi/hiệu lực.

## Điều kiện sửa SRS

Nếu tiêu chí là header-only có đủ quan hệ thì kết quả **không đạt**. Phương án kết hợp PDF full text + header phải được phân biệt với giả định này.

SRS 0.6 chọn **PDF full text + header + OCR/quality validation**, với header là một extractor trong pipeline. Input URL được thay bằng upload PDF; URLs chỉ dùng cho provenance/discovery nội bộ. Đổi định dạng input không tự bảo đảm đủ corpus hoặc đúng graph.

## Corpus thu thập

Thư mục dữ liệu:

```text
data/
```

Thành phần: PDF gốc đã lấy, snapshot JSON từ gateway, HTML live, HTML archive, page text và manifests. Danh mục khởi tạo lấy từ snapshot metadata VBPL 23/07/2026 do tác giả dataset công bố; các detail records được crawl lại từ endpoint chính thức, ghi fetched_at/status/hash riêng.

HTTP trực tiếp tới danh mục live VBPL trả 403. Tìm kiếm qua trình duyệt với tiêu đề “đường bộ” hiển thị 3.719 kết quả; hai lần thử chức năng xuất danh mục chưa nhận được file. Vì vậy chưa có catalogue live đã enumerate đầy đủ. Count truy vấn này không so sánh trực tiếp với predicate nhiều keywords/fields của archive. Tập keyword/field đường bộ có 3.875 candidates; archive có HTML cho 3.870, năm ID thiếu content được ghi riêng. 3.312 records giao thông/vận tải rộng hơn nằm trong danh sách review, không bị âm thầm coi là không liên quan. Matching metadata không thay thế phân loại nội dung hoặc gold relevance.

Trạng thái live crawl và số lượng cuối cùng nằm trong manifest/progress/coverage; không ghi số lượng giữa chừng thành kết quả cuối hoặc gọi corpus này là toàn bộ pháp luật Việt Nam. Một HTML `<body>` rỗng không được xem là có toàn văn usable. PDF không có lớp text và nguồn thiếu PDF phải có availability/quality flags.
