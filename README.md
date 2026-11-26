# INT3011E_6 — Soạn Luật Studio (Soạn thảo Luật, Soát Logic Luật & Phân tích Phạm vi Tác động)

Nền tảng **soạn thảo văn bản quy phạm pháp luật** dành cho nhà soạn luật / chuyên viên pháp chế, tích hợp sẵn hai năng lực kiểm định cốt lõi:

1. **Soát logic luật tự động (16 quy tắc tất định thuộc 5 nhóm):** kiểm tra kết cấu Chương/Mục/Điều/Khoản/Điểm, thứ tự hiệu lực theo thời gian, sửa đổi văn bản đã bãi bỏ/thay thế toàn bộ, chu trình mâu thuẫn, dẫn chiếu nội/ngoại văn bản bị treo, khung phạt đảo ngược/trừ điểm GPLX vượt chuẩn và nguy cơ xung đột quy phạm ngầm.
2. **Phân tích phạm vi tác động (trực tiếp & dây chuyền đa tầng):** xác định văn bản và Điều/Khoản/Điểm chịu tác động trực tiếp (tầng 1), lan truyền dây chuyền sang thông tư hướng dẫn/văn bản căn cứ (tầng 2–5), biến động khung xử phạt, nhóm đối tượng chịu tác động, khoảng trống đối chiếu (frontier) và danh mục văn bản cần sửa đổi đồng bộ.
3. **LexIDE — Môi trường soạn thảo & kiểm định pháp luật ([chi tiết](docs/lexide.md) · [slide báo cáo đồ án](docs/project-defense-slides.md)):** giao diện VS Code Dark/Light Modern, khởi đầu với **Workspace trống** (hỗ trợ chọn thư mục trên máy hoặc **Nạp bộ dự thảo mẫu 10 tệp**), **Neuro-Symbolic Pipeline v4.1** (Gemini Interactions + Decisions API + Lean 4 tối ưu token), **tự động đẩy số** `Điều`/`Khoản`/`Điểm`, nút **Sửa bằng AI** cho toàn bộ lỗi, Hover dẫn chiếu thuật ngữ, icon chỉ báo hành vi bấm để mở & highlight trong tab Hành vi, Tòa án giả lập (Run & Debug), Lược đồ quan hệ và **Token Usage** trên Status Bar.

Repository bao gồm: **LexIDE (`/`)**, **Bàn soạn thảo cấu trúc (`/drafting`)**, **Trung tâm Soát Logic & Phạm vi Tác động (`/audit`)**, **Lược đồ tác động 2 chế độ (`/graph`)**, xác thực Better Auth & đa không gian làm việc độc lập (`/workspaces`), luồng nhập PDF văn bản hiện hành bằng LLM ([chi tiết](docs/pdf-upload-api.md)), pipeline tiền xử lý 6 bước ([chi tiết](docs/preprocessing.md)), MCP server nội bộ cho vocabulary ([chi tiết](docs/mcp-server.md)), tra cứu lịch sử `as-of` và trợ lý AI rà soát có dẫn chiếu nguồn ([chi tiết](docs/query-frontend.md)). Đặc tả đầy đủ xem tại [SRS v1.0](docs/srs.md).

## Overview

### Bắt đầu đọc tài liệu từ đâu?

Tài liệu nguồn của dự án nằm trong thư mục [`docs`](docs):

| Vai trò | Tài liệu nên đọc | Mục đích |
| --- | --- | --- |
| Lead | [Software Requirements Specification (v1.0)](docs/srs.md), đặc biệt các mục 1–6 (bao gồm System Design tại mục 5 và FR-21–25), 11–12 và 16–21 | Nắm toàn bộ định hướng sản phẩm soạn thảo luật, soát logic, phạm vi tác động và kiến trúc kỹ thuật; duyệt thiết kế và review thay đổi. |
| Developer | [SRS](docs/srs.md), [API & Frontend Guide](docs/query-frontend.md), sau đó [Developer Workflow Guide](docs/workflow/dev.md) | Hiểu yêu cầu nghiệp vụ, hợp đồng API và quy trình estimate, branch, PR, review, Definition of Done. |
| Tester | [SRS](docs/srs.md), [SRS Coverage](docs/srs-coverage.md), sau đó [Tester Workflow Guide](docs/workflow/tester.md) | Xây dựng test case từ acceptance criteria (AC 1–38); kiểm tra happy path, edge case, regression và báo lỗi đúng mẫu. |

Thứ tự đọc:

1. Đọc mục tiêu, phạm vi và actor trong [SRS v1.0](docs/srs.md).
2. Đọc [System Design](docs/srs.md#5-system-design) để nắm luồng soạn thảo, bộ máy soát logic/tác động, pipeline AI PDF, cô lập Workspace và lưu trữ.
3. Đọc các functional requirement liên quan (đặc biệt FR-21–25 cho soạn thảo, soát logic, phạm vi tác động, đồ thị 2 chế độ).
4. Đọc guide dành cho vai trò của mình và tiếp tục phần [Setup](#setup) bên dưới trước khi làm việc với mã nguồn.

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
| Frontend | [Svelte 5](https://svelte.dev/docs/svelte/overview), [SvelteKit](https://svelte.dev/docs/kit/introduction), [Vite](https://vite.dev/guide/) | Bàn soạn thảo, Trung tâm Soát logic & Tác động, Lược đồ 2 chế độ, quản lý Workspace và giao diện tra cứu. |
| UI | [Tailwind CSS](https://tailwindcss.com/docs), [shadcn-svelte](https://www.shadcn-svelte.com/docs), [Lucide Svelte](https://lucide.dev/guide/packages/lucide-svelte) | Styling và component giao diện. |
| Backend API | [Elysia](https://elysiajs.com/) chạy trên [Cloudflare Workers](https://developers.cloudflare.com/workers/) | HTTP API (Auth, Workspaces, Manual Drafting, Legal Logic Audit, Impact Scope, Graph, Ask, Upload) và queue consumer. |
| Xác thực | [Better Auth](https://www.better-auth.com/) (`email + password`) | Đăng ký, đăng nhập, quản lý phiên cookie và phân quyền sở hữu Workspace. |
| Lưu trữ | [Cloudflare D1](https://developers.cloudflare.com/d1/) và [Cloudflare R2](https://developers.cloudflare.com/r2/) | Lưu dữ liệu auth/workspace/dự thảo/đồ thị/quy tắc và tệp PDF nguồn. |
| ORM | [Drizzle ORM](https://orm.drizzle.team/) | Khai báo schema TypeScript, sinh migration và truy vấn Cloudflare D1. |
| Xử lý bất đồng bộ | [Cloudflare Queues](https://developers.cloudflare.com/queues/) | Tách yêu cầu upload PDF khỏi pipeline trích xuất AI chạy nền. |
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

Tạo cấu hình môi trường local từ các file mẫu trước khi chạy ứng dụng:

```bash
cp backend/.env.example backend/.env
cp backend/.dev.vars.example backend/.dev.vars
cp web/.env.example web/.env
```

Không commit các file `.env` và `.dev.vars`. Wrangler đọc secret local (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `INTERNAL_MCP_TOKEN`, `INTERNAL_MCP_WRITE_TOKEN`) từ `backend/.dev.vars`. Frontend đọc `PUBLIC_BACKEND_URL`, mặc định trong file mẫu là `http://localhost:8787`.

### 2. Khởi tạo cơ sở dữ liệu local

Schema Drizzle nằm trong `backend/src/db/schema.ts`. Khi thay đổi schema, sinh migration mới trước khi áp dụng:

```bash
cd backend
bun run db:generate
```

Áp dụng các migration vào D1 local:

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
curl http://localhost:8787/api/dummy
```

Kết quả mong đợi:

```json
{"status":"ok"}
```

Endpoint `/api/dummy` dùng Drizzle ORM để đọc hàng mẫu được seed bởi migration từ D1 và trả về:

```json
{"id":1,"message":"Drizzle is connected"}
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

### Deploy frontend

Frontend deploy lên [Cloudflare Workers](https://developers.cloudflare.com/workers/static-assets/) theo [`web/wrangler.jsonc`](web/wrangler.jsonc) (adapter `@sveltejs/adapter-cloudflare`). `npx wrangler deploy` tự chạy `bun run build` trước khi upload, nên dùng được cả khi chạy tay lẫn với Workers Builds (Git integration):

| Thiết lập | Giá trị |
| --- | --- |
| Root directory | `web` (chạy ở thư mục gốc repository sẽ báo "Missing entry-point") |
| Build command | để trống hoặc `bun run build` |
| Deploy command | `npx wrangler deploy` |
| Biến runtime | `PUBLIC_BACKEND_URL` = URL Worker backend, đặt trong Worker > Settings > Variables |

`PUBLIC_BACKEND_URL` được đọc lúc chạy (`$env/dynamic/public`), không cần có lúc build; `keep_vars` giữ giá trị đã đặt qua các lần deploy. Khi chưa đặt, frontend gọi `http://localhost:8787`.

Backend deploy riêng: `cd backend && bun run d1:migrate:remote && npx wrangler deploy`.

### Các lệnh thường dùng

| Thư mục | Lệnh | Chức năng |
| --- | --- | --- |
| `backend` | `bun run dev` | Chạy Worker cùng D1, R2 và Queue local bằng Wrangler. |
| `backend` | `bun test` | Chạy test backend. |
| `backend` | `bun run typecheck` | Kiểm tra kiểu TypeScript. |
| `backend` | `bun run db:generate` | Sinh migration Drizzle từ schema. |
| `backend` | `bun run d1:migrate:local` | Áp dụng migration cho D1 local. |
| `backend` | `bun run d1:migrate:remote` | Áp dụng migration cho D1 remote. |
| `web` | `bun run dev` | Chạy frontend ở chế độ phát triển. |
| `web` | `bun run check` | Kiểm tra Svelte và TypeScript. |
| `web` | `bun run build` | Build frontend cho production. |
| `web` | `bun run preview` | Xem thử production build. |
| `web` | `npx wrangler deploy` | Build và deploy frontend lên Cloudflare Workers. |

## Architecture

### Kiến trúc hiện tại trong repository

```text
Trình duyệt (SvelteKit — Soạn Luật Studio)
  ├── /drafting    Bàn soạn thảo cấu trúc + tab Soát logic & Phạm vi tác động live
  ├── /audit       Trung tâm Soát logic luật & Phân tích phạm vi tác động toàn Workspace
  ├── /graph       Lược đồ tác động 2 chế độ (Biến động xử phạt & Ảnh hưởng văn bản)
  ├── /workspaces  Quản lý đa Workspace cô lập theo tài khoản (Better Auth)
  └── /documents, /violations, /ask, /admin (Nhập PDF AI + Review)
        │
        │ Cookie phiên Better Auth + Header X-Workspace-Id
        ▼
Cloudflare Worker (Elysia API)
  ├── auth + workspaces    Better Auth (email/password) & phân quyền sở hữu Workspace
  ├── manual               CRUD dự thảo, Điều/Khoản/Điểm, cạnh quan hệ & xử phạt thủ công
  ├── analysis             Soát logic luật tất định (16 quy tắc) & Phạm vi tác động (BFS đa tầng)
  ├── graph                Hợp nhất cạnh AI + Thủ công (2 chế độ)
  ├── upload + processing  Lưu PDF vào R2 → Queue → LLM đọc theo cụm trang → 6 bước tiền xử lý
  └── documents, violations, history, ask, mcp
        ├── D1 / DB             Auth, Workspaces, Dự thảo, Đồ thị, Hành vi, Chế tài, Jobs
        ├── R2 / FILE_STORAGE   Snapshot PDF nguồn và checkpoint LLM
        └── Queue               Xử lý PDF và từng stage tiền xử lý bất đồng bộ
```

### Cấu trúc mã nguồn

```text
.
├── backend/
│   ├── migrations/             # 16 migration D1 (tới 0015_create_draft_documents.sql)
│   ├── src/
│   │   ├── modules/
│   │   │   ├── analysis/       # Soát logic luật (logic-audit.ts) & Phạm vi tác động (impact-scope.ts)
│   │   │   ├── auth/           # Better Auth (email + password)
│   │   │   ├── workspaces/     # Multi-workspace isolation & seed dữ liệu lập pháp mẫu
│   │   │   ├── manual/         # Soạn thảo thủ công văn bản, Điều/Khoản/Điểm và cạnh đồ thị
│   │   │   ├── graph/          # Lược đồ 2 chế độ (sanction_change & document_influence)
│   │   │   ├── ide/            # LexIDE + Lean 4 + Debug + Library
│   │   │   └── upload, processing, provisions, documents, changes, violations, identity, history, ask, mcp
│   │   ├── plugins/            # Context Cloudflare và auth session helper
│   │   ├── app.ts              # Khai báo ứng dụng Elysia
│   │   └── index.ts            # Worker fetch handler và queue consumer
│   ├── test/                   # 36 file test backend (unit + integration + e2e)
│   └── wrangler.jsonc          # D1, R2, Queue bindings
├── web/
│   └── src/
│       ├── lib/api/            # API client + runtime parsers (analysis, graph, documents, workspaces, ask, violations)
│       ├── lib/components/     # LogicAuditPanel, ImpactScopePanel, RelationGraph, SiteHeader, UI primitives
│       └── routes/             # /drafting, /audit, /graph, /workspaces, /login, /documents, /violations, /ask, /admin
└── docs/
    ├── srs.md                  # Đặc tả yêu cầu v1.0 (Soạn thảo · Soát logic · Phạm vi tác động)
    ├── srs-coverage.md         # Ma trận đối chiếu SRS với mã nguồn
    ├── query-frontend.md       # Hợp đồng API & hướng dẫn giao diện
    ├── preprocessing.md        # Pipeline tiền xử lý 6 bước sau đọc PDF
    └── workflow/               # Quy trình theo vai trò
```

### Cloudflare bindings

Các binding được khai báo tại [`backend/wrangler.jsonc`](backend/wrangler.jsonc):

| Binding | Dịch vụ | Trách nhiệm |
| --- | --- | --- |
| `DB` | D1 | Lưu auth, workspaces, văn bản/dự thảo, đồ thị quan hệ, quy tắc xử phạt và trạng thái job. |
| `FILE_STORAGE` | R2 | Lưu tệp PDF gốc và checkpoint LLM theo key của job. |
| `PROCESSING_QUEUE` | Queues | Gửi và nhận lệnh xử lý PDF và từng stage tiền xử lý bất đồng bộ. |

Khi triển khai feature mới, [SRS v1.0](docs/srs.md) là nguồn quyết định cho nghiệp vụ; README này phản ánh chính xác kiến trúc và tính năng đang chạy trong repository.
