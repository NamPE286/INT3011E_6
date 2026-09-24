# INT3011E_6 - Document Processing Platform

Initial Cloudflare infrastructure and end-to-end asynchronous file processing verification demo.

---

## Architecture Overview

```text
Frontend (SvelteKit / Next.js)
  │
  │ 1. POST /api/uploads (multipart/form-data)
  ▼
ElysiaJS Worker
  ├──▶ R2 (FILE_STORAGE): stores raw uploaded file
  ├──▶ D1 (DB): records job in processing_jobs (status="queued", step="queued", progress=0)
  └──▶ Cloudflare Queue (PROCESSING_QUEUE): enqueues { jobId }
         │
         ▼
     Queue Consumer (Worker queue handler)
         ├── 0s:  status="processing", step="preparing", progress=10
         ├── 3s:  step="extracting", progress=30
         ├── 6s:  step="analyzing", progress=55
         ├── 9s:  step="analyzing", progress=75
         ├── 12s: step="finalizing", progress=90
         ├── 15s: status="completed", step="completed", progress=100, completed_at=now
         └── Updates D1 at every stage change

Frontend
  │
  └── 2. Polls GET /api/jobs/:jobId every 1s until completed or failed
```

### Component Roles & Source of Truth

- **Cloudflare R2 (`FILE_STORAGE`)**: Dedicated object storage for original uploaded files. Keys are formatted as `uploads/{jobId}/{sanitizedFilename}`.
- **Cloudflare D1 (`DB`)**: Relational SQLite database serving as the **single source of truth** for all job metadata, current step, and completion state (`processing_jobs` table). State persists across Worker requests and runtime restarts.
- **Cloudflare Queue (`PROCESSING_QUEUE`)**: Asynchronous buffer delivering processing commands (`{ jobId: string }`) to the queue consumer.
- **Frontend**: Shows real client-side byte upload percentage (via `XMLHttpRequest.upload.onprogress`) during upload, then switches to polling D1 for server-driven processing steps without faking stage progression.

---

## Cloudflare Resources & Bindings

Configured in [`backend/wrangler.jsonc`](backend/wrangler.jsonc):

| Binding Name | Type | Resource Name | Purpose |
|---|---|---|---|
| `DB` | D1 Database | `int3011e-db` | Persistent job metadata and stage progress |
| `FILE_STORAGE` | R2 Bucket | `int3011e-files` | Uploaded raw file storage |
| `PROCESSING_QUEUE` | Queue Producer/Consumer | `int3011e-processing` | Async processing task queue |

---

## Prerequisites

- [Bun](https://bun.sh/) (v1.1+)
- Node.js (v18+)

---

## Quick Start (Local Development)

### 1. Install Dependencies

```bash
# Backend dependencies
cd backend
bun install

# Frontend dependencies
cd ../web
bun install
```

### 2. Apply Local D1 Database Migrations

From `backend/`:

```bash
bun run d1:migrate:local
```

### 3. Run Backend (Cloudflare Worker Locally)

From `backend/`:

```bash
bun run dev:worker
```

The Worker will start with local D1, R2, and Queue emulation on `http://localhost:8787`.

### 4. Run Frontend

From `web/` in a separate terminal:

```bash
bun run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Running Automated Tests

From `backend/`:

```bash
# Run unit and integration tests (0ms injected delay for instant runs)
bun test

# Run TypeScript type check
bun run typecheck
```

From `web/`:

```bash
# Run Svelte and TypeScript checks
bun run check

# Run production build check
bun run build
```

---

## Manual End-to-End Verification Flow

1. Ensure the backend is running (`bun run dev:worker` on `http://localhost:8787`).
2. Open `http://localhost:5173` in your browser.
3. Select any test file (e.g., PDF or document up to 50MB).
4. Click **"Upload & Process"**.
5. Observe **Real Upload %**:
   - Client-side upload progress bar reflects true transferred bytes (e.g., `63% 4.2 MB / 6.7 MB`).
6. Upon upload completion (100%):
   - Backend stores file in R2 and inserts D1 job record.
   - Backend pushes job into Cloudflare Queue.
   - Frontend transitions from **Uploading** to **Processing**.
7. Observe **Processing Steps** over ~15 seconds:
   - `✓ Upload completed`
   - `● Preparing document` (10%)
   - `● Extracting content` (30%)
   - `● Analyzing provisions` (55% -> 75%)
   - `● Finalizing` (90%)
   - `✓ Processing completed` (100%)
8. Job status reaches **Completed**.

---

## Remote Cloudflare Deployment Commands

To deploy to real Cloudflare remote resources:

```bash
# 1. Create remote resources (one-time setup)
bunx wrangler d1 create int3011e-db
bunx wrangler r2 bucket create int3011e-files
bunx wrangler queues create int3011e-processing

# 2. Update database_id in backend/wrangler.jsonc with the ID returned by d1 create

# 3. Apply migrations remotely
bun run d1:migrate:remote

# 4. Deploy Worker to Cloudflare
bunx wrangler deploy
```

