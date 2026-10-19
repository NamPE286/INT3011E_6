# Internal MCP server (#36)

MCP server nội bộ cho preprocessing pipeline, chạy trong Worker backend tại `POST /mcp` (Streamable HTTP, stateless, JSON response). Đây **không** phải API công khai.

## Tools

| Tool | Quyền | Mục đích |
| --- | --- | --- |
| `get_vocab_snapshot(version?)` | đọc | Toàn bộ vocabulary dạng compact, sắp xếp ổn định theo `type, canonical_id`. Truyền `version` đang cache → `NOT_MODIFIED`, `entries: []`. |
| `add_vocab(type, canonical_label, aliases?, definition?, evidence, source_provision_id, source_document_id?, base_vocabulary_version)` | ghi | Server kiểm tra trùng label/alias/độ tương đồng và provenance, rồi trả `EXISTING`, `CREATED`, `AMBIGUOUS` hoặc `STALE_VERSION`. |
| `search_legal_documents(query, document_number?, document_type?, agency?, issued_from?, issued_to?, limit?)` | đọc | Ứng viên văn bản trong `legal_documents`; không canonicalize. Kết quả rỗng không chứng minh văn bản không tồn tại. |

### Provenance cho `add_vocab`

- `source_provision_id` dạng `"<document_id>:dieu_6_khoan_1_diem_a"`, hoặc truyền `source_document_id` riêng. `document_id` là `id` trong `legal_documents` (hiện bằng job ID).
- `evidence` phải là câu chữ có trong Điều/Khoản/Điểm đó, tính cả **tên Điều** (phương tiện và chủ thể thường chỉ nêu ở tên Điều).
- Tham chiếu không kèm `document_id` mà khớp nhiều văn bản sẽ bị từ chối vì mơ hồ.

### Quy trình gợi ý cho LLM

1. Gọi `get_vocab_snapshot` một lần, cache theo `vocabulary_version`.
2. Dùng lại `canonical_id` khi cùng khái niệm (khác cách viết không phải khái niệm mới).
3. Gọi `add_vocab` **tuần tự**. Sau `CREATED`, dùng `vocabulary_version` trả về làm `base_vocabulary_version` tiếp theo. Nếu nhận `STALE_VERSION` → tải lại snapshot. Nếu nhận `AMBIGUOUS` → không tạo mới.
4. Backend phải kiểm tra lại mọi `canonical_id` mà LLM trả về với registry, vì khi thử nghiệm, model đã trả về ID chưa từng được tạo sau khi nhận `STALE_VERSION`.

## Xác thực

Một token ứng với một quyền, truyền qua `Authorization: Bearer <token>` hoặc `X-Internal-MCP-Token: <token>`:

| Biến | Quyền |
| --- | --- |
| `INTERNAL_MCP_TOKEN` | Gọi tool đọc. Không cấu hình → mọi request bị 401 (fail closed). |
| `INTERNAL_MCP_WRITE_TOKEN` | Gọi được cả `add_vocab`. Không cấu hình → không ai ghi được. |

Token so sánh constant-time, chỉ đặt trong `backend/.dev.vars` (local) hoặc `wrangler secret put` (remote).

## Kết nối

Bằng MCP SDK chính thức:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "preprocessing-worker", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost:8787/mcp"), {
    requestInit: { headers: { Authorization: `Bearer ${process.env.INTERNAL_MCP_TOKEN}` } },
}));

const snapshot = await client.callTool({ name: "get_vocab_snapshot", arguments: {} });
```

Bằng JSON-RPC thuần:

```bash
curl -s http://localhost:8787/mcp \
    -H "Authorization: Bearer $INTERNAL_MCP_TOKEN" -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_legal_documents","arguments":{"query":"xử phạt","document_number":"100/2019/NĐ-CP"}}}'
```

Muốn LLM dùng tool, chuyển `listTools()` thành function definitions (`name`, `description`, `inputSchema`) của provider và chuyển mỗi tool call sang `client.callTool`.

## Giới hạn đã biết

- Similarity của `add_vocab` chỉ dựa trên chữ (Levenshtein/token). Ví dụ "xe gắn máy" bị xếp `AMBIGUOUS` với alias "xe gắn máy điện" dù là hai khái niệm khác nhau.
- Vocabulary khởi tạo rỗng; SRS §4.6.4 chưa có seed.
- Search dùng `LIKE` + chấm điểm trong bộ nhớ, chưa có FTS5. `LIKE` của SQLite chỉ không phân biệt hoa thường với ASCII.
- Chưa ghi `vocabulary_version` vào extraction run, vì pipeline trích xuất hành vi (#15) chưa có.
