# INT3011E_6 — Vietnamese Traffic Violation Sanction Intelligence

Nền tảng Legal AI hỗ trợ truy vết quy định xử phạt vi phạm giao thông đường bộ Việt Nam theo từng hành vi, căn cứ pháp lý và lịch sử thay đổi của quy định.

Repository hiện chứa hạ tầng mẫu cho luồng xử lý bất đồng bộ: frontend tải tệp lên, Cloudflare Worker lưu tệp và tạo job, Queue xử lý job, còn frontend theo dõi tiến độ. Đây là nền tảng kỹ thuật ban đầu; phạm vi sản phẩm hoàn chỉnh và nguồn nhập liệu chính thức được quy định trong SRS.

## Overview

### Bắt đầu đọc tài liệu từ đâu?

Tài liệu nguồn của dự án nằm trong thư mục [`docs`](docs):

| Vai trò | Tài liệu nên đọc | Mục đích |
| --- | --- | --- |
| Lead | [Software Requirements Specification](docs/srs.md), đặc biệt các mục 1–6, 13, 16 và 19–21 | Nắm toàn bộ định hướng sản phẩm và kỹ thuật; quản lý phạm vi, phân rã yêu cầu, duyệt thiết kế và review thay đổi trước khi chuyển sang kiểm thử. |
| Developer | [SRS](docs/srs.md), sau đó [Developer Workflow Guide](docs/workflow/dev.md) | Hiểu yêu cầu của task trước khi triển khai; tuân thủ quy trình estimate, branch, pull request, review và Definition of Done. |
| Tester | [SRS](docs/srs.md), sau đó [Tester Workflow Guide](docs/workflow/tester.md) | Xây dựng test case từ acceptance criteria; kiểm tra happy path, edge case, regression và báo lỗi đúng mẫu. |

Thứ tự đọc:

1. Đọc mục tiêu, phạm vi và actor trong SRS.
2. Đọc các functional requirement liên quan đến task được giao.
3. Đọc guide dành cho vai trò của mình; Lead sử dụng cả hai workflow guide để điều phối vòng review và kiểm thử.
4. Lead và Developer tiếp tục phần [Setup](#setup) và [Architecture](#architecture) bên dưới trước khi làm việc với mã nguồn.

## Setup

### Yêu cầu môi trường

Dự án **chỉ sử dụng [Bun](https://bun.sh/docs)** để cài dependency, chạy script và test. Không dùng `npm`, `yarn` hoặc `pnpm`, đồng thời không tạo thêm lockfile ngoài `bun.lock`.

- [Bun](https://bun.sh/docs/installation) phiên bản 1.1 trở lên.
- Hai terminal riêng để chạy backend và frontend đồng thời.
- Tài khoản Cloudflare chỉ cần khi tạo tài nguyên hoặc deploy lên môi trường remote; chạy local sử dụng tài nguyên mô phỏng của Wrangler.

Kiểm tra Bun:

```bash
bun --version
```

### Công nghệ chính

| Thành phần | Công nghệ | Vai trò |
| --- | --- | --- |
| Frontend | [Svelte 5](https://svelte.dev/docs/svelte/overview), [SvelteKit](https://svelte.dev/docs/kit/introduction), [Vite](https://vite.dev/guide/) | Xây dựng giao diện, routing và development server. |
| UI | [Tailwind CSS](https://tailwindcss.com/docs), [shadcn-svelte](https://www.shadcn-svelte.com/docs), [Lucide Svelte](https://lucide.dev/guide/packages/lucide-svelte) | Styling và component giao diện. |
| Backend API | [Elysia](https://elysiajs.com/) chạy trên [Cloudflare Workers](https://developers.cloudflare.com/workers/) | Cung cấp HTTP API và queue consumer. |
| Lưu trữ | [Cloudflare D1](https://developers.cloudflare.com/d1/) và [Cloudflare R2](https://developers.cloudflare.com/r2/) | Lưu trạng thái job và tệp nguồn. |
| Xử lý bất đồng bộ | [Cloudflare Queues](https://developers.cloudflare.com/queues/) | Tách yêu cầu upload khỏi pipeline xử lý nền. |
| Công cụ phát triển | [Wrangler](https://developers.cloudflare.com/workers/wrangler/) và TypeScript | Mô phỏng tài nguyên Cloudflare, chạy Worker, kiểm tra kiểu và deploy. |

### 1. Cài dependency

Từ thư mục gốc của repository:

```bash
cd backend
bun install

cd ../web
bun install
```

Mỗi ứng dụng có `package.json` và `bun.lock` riêng. Hãy commit thay đổi trong `bun.lock` nếu dependency thay đổi.

### 2. Khởi tạo cơ sở dữ liệu local

```bash
cd backend
bun run d1:migrate:local
```

Lệnh này áp dụng các migration trong `backend/migrations` vào D1 local do Wrangler quản lý.

### 3. Chạy backend

Tại terminal thứ nhất:

```bash
cd backend
bun run dev
```

Backend mặc định chạy tại `http://localhost:8787`. Có thể kiểm tra bằng:

```bash
curl http://localhost:8787/health
```

Kết quả mong đợi:

```json
{"status":"ok"}
```

Lệnh `bun run dev` sử dụng Wrangler để chạy Worker và cung cấp các binding D1, R2, Queue trên môi trường local.

### 4. Chạy frontend

Tại terminal thứ hai:

```bash
cd web
bun run dev
```

Mở [http://localhost:5173](http://localhost:5173). Giao diện demo hiện kết nối tới backend tại `http://localhost:8787`.

### 5. Kiểm tra dự án

Backend:

```bash
cd backend
bun test
bun run typecheck
```

Frontend:

```bash
cd web
bun run check
bun run build
```

### Các lệnh thường dùng

| Thư mục | Lệnh | Chức năng |
| --- | --- | --- |
| `backend` | `bun run dev` | Chạy Worker cùng D1, R2 và Queue local bằng Wrangler. |
| `backend` | `bun test` | Chạy test backend. |
| `backend` | `bun run typecheck` | Kiểm tra kiểu TypeScript. |
| `backend` | `bun run d1:migrate:local` | Áp dụng migration cho D1 local. |
| `backend` | `bun run d1:migrate:remote` | Áp dụng migration cho D1 remote. |
| `web` | `bun run dev` | Chạy frontend ở chế độ phát triển. |
| `web` | `bun run check` | Kiểm tra Svelte và TypeScript. |
| `web` | `bun run build` | Build frontend cho production. |
| `web` | `bun run preview` | Xem thử production build. |

## Architecture

### Kiến trúc hiện tại trong repository

```text
Trình duyệt (SvelteKit)
        │
        │ POST /api/uploads (multipart/form-data)
        ▼
Cloudflare Worker (Elysia)
        ├── R2 / FILE_STORAGE
        │     Lưu tệp tại uploads/{jobId}/{filename}
        ├── D1 / DB
        │     Lưu metadata, trạng thái và tiến độ job
        └── Queue / PROCESSING_QUEUE
              Gửi message { jobId }
                    │
                    ▼
              Queue Consumer
                    │ cập nhật từng giai đoạn xử lý
                    ▼
                   D1

Trình duyệt ── GET /api/jobs/:jobId mỗi 1 giây ──► Worker ──► D1
```

Luồng xử lý:

1. Frontend gửi tệp tới `POST /api/uploads` và hiển thị tiến độ upload theo số byte thực tế.
2. Backend kiểm tra tệp (không rỗng, có tên, tối đa 50 MB), lưu nội dung vào R2 và tạo bản ghi `processing_jobs` trong D1.
3. Backend đẩy `{ jobId }` vào Cloudflare Queue.
4. Queue consumer chạy pipeline nền và cập nhật `status`, `step`, `progress` trong D1.
5. Frontend gọi `GET /api/jobs/:jobId` mỗi giây cho đến khi job ở trạng thái `completed` hoặc `failed`.

D1 là nguồn dữ liệu chuẩn cho trạng thái xử lý. R2 chỉ lưu nội dung tệp, còn Queue đảm nhiệm vận chuyển công việc bất đồng bộ; không thành phần nào trong hai thành phần này thay thế trạng thái bền vững trong D1.

### Cấu trúc mã nguồn

```text
.
├── backend/
│   ├── migrations/             # Schema và migration D1
│   ├── src/
│   │   ├── modules/            # Health, upload và processing
│   │   ├── plugins/            # Context Cloudflare và auth
│   │   ├── types/              # Kiểu cho environment/binding
│   │   ├── app.ts              # Khai báo ứng dụng Elysia
│   │   └── index.ts            # Worker fetch handler và queue consumer
│   ├── test/                   # Test backend
│   └── wrangler.jsonc          # D1, R2, Queue bindings
├── web/
│   └── src/
│       ├── lib/components/     # Component UI và FileProcessor
│       └── routes/             # Route SvelteKit
└── docs/
    ├── srs.md                  # Đặc tả yêu cầu và kiến trúc đích
    └── workflow/               # Quy trình theo vai trò
```

### Cloudflare bindings

Các binding được khai báo tại [`backend/wrangler.jsonc`](backend/wrangler.jsonc):

| Binding | Dịch vụ | Trách nhiệm |
| --- | --- | --- |
| `DB` | D1 | Lưu metadata và trạng thái hiện tại của job. |
| `FILE_STORAGE` | R2 | Lưu tệp nguồn theo key của job. |
| `PROCESSING_QUEUE` | Queues | Gửi và nhận lệnh xử lý bất đồng bộ. |

### Kiến trúc đích

Theo [SRS](docs/srs.md#5-high-level-architecture), hệ thống cuối cùng mở rộng từ nền tảng trên thành pipeline Legal AI: nhập URL VBPL, crawl đồ thị văn bản liên quan, phân tách Điều/Khoản/Điểm, trích xuất quan hệ sửa đổi và chế tài, xác định danh tính hành vi, tái dựng lịch sử quy định, lập chỉ mục tìm kiếm và cung cấp câu trả lời AI có dẫn chiếu nguồn.

Khi triển khai feature mới, SRS là nguồn quyết định cho nghiệp vụ; README này mô tả trạng thái kỹ thuật đang có để hỗ trợ chạy và phát triển local.
