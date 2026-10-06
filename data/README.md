# Corpus ứng viên pháp luật giao thông đường bộ

Thu thập ngày 06/10/2026. Bao gồm văn bản trung ương/địa phương và lịch sử trong danh mục khởi tạo; các trạng thái hiện hành cần đọc từ source snapshots/manifest, không suy từ ngày tải.

## Thư mục

- `pdf/`: PDF gốc đã tải và xác thực từ nguồn Chính phủ/Công báo. Chưa có PDF gốc cho mọi record.
- `text/`: text từng trang của PDF đã kiểm tra; file scan có trạng thái cần OCR. Đây là lớp evidence, không phải graph đã nghiệm thu.
- `snapshots/`: JSON response nguyên bản được crawl từ VBPL gateway, ID giữ dạng string.
- `html/`: HTML từ live response nếu được nguồn cung cấp; không coi `<body>` rỗng là toàn văn hợp lệ.
- `archive-html/`: HTML từ snapshot cộng đồng của VBPL 23/07/2026, giữ provenance riêng; không tráo thành fetch live.
- `manifests/`: catalogue đã chọn, danh sách cần review, nguồn/checksum, fetch logs, tiến độ, coverage và kiểm chứng header.

## Phạm vi và giới hạn

Danh mục khởi tạo có 171.556 records; predicate nhiều title keywords/legal fields chọn 3.875 ứng viên đường bộ và giữ 3.312 records giao thông/vận tải rộng hơn cần review. Đây là corpus ứng viên metadata, chưa phải bộ relevance đã gán nhãn. Source catalogue và keyword match không chứng minh mọi văn bản giao thông đã được liệt kê.

HTTP direct live catalogue trả 403; browser search tiêu đề “đường bộ” báo 3.719 kết quả nhưng chưa export/enumerate hết. Hai predicates khác nhau nên không so count như cùng một tập.

`progress.json` phản ánh run đang chạy; `coverage.json` là báo cáo kết thúc/audit. HTTP200 không tự bảo đảm text đầy đủ hoặc có PDF. `hasOriginalPdf` của nguồn không thay thế kiểm chứng file tải được. Trường unavailable/null không phải negative legal assertion.

Không dùng header-only để build graph thay đổi: hai case kiểm chứng 123/2021→100/2019 và168/2024→100/2019 chỉ xuất hiện trong body. Header hỗ trợ LEGAL_BASIS; full text, effect clauses, exceptions và incoming corpus index vẫn cần thiết.

## Provenance nguồn

- Metadata/content bootstrap: https://huggingface.co/datasets/th1nhng0/vietnamese-legal-documents (tác giả: Thịnh Ngô; compiled dataset khai báo CC BY4.0; snapshot23/07/2026).
- Live detail: https://vbpl-bientap-gateway.moj.gov.vn/api/qtdc/public/doc/{id}.
- PDF gốc kiểm chứng: datafiles.chinhphu.vn và congbaocdn.chinhphu.vn; URL/hash/file pages ghi trong manifests.

Raw records giữ source identity/snapshot; canonical legal identity và ACCEPTED relations chưa được suy diễn chỉ từ dataset.

## Kết quả đợt thu thập

Live selected snapshots: 3858/3875; supporting laws: 4. Archive HTML: 3870. PDF targets: 2178; validated/downloaded: 2154; failed: 24; PDF files total (with Government/Gazette samples): 2158. PDF body/OCR toàn bộ chưa được kiểm chứng. Coverage vẫn PARTIAL_NOT_CERTIFIED_FULL_LEGAL_CORPUS. Xem `manifests/coverage.json`, `pdf-fetch.jsonl`, `text-quality-audit.json`.
