# CI/CD với GitHub Actions

Workflow: [`.github/workflows/ci-cd.yml`](../.github/workflows/ci-cd.yml).

## Khi nào workflow chạy?

- Pull request vào `main`: chạy test, typecheck, migration D1 local và build backend; chạy Svelte check và build frontend. Không cần credential Cloudflare.
- Push vào `main`: chạy cùng các check, sau đó deploy production nếu tất cả pass.
- `workflow_dispatch`: chạy check từ tab Actions; chỉ deploy khi chọn branch `main`.

Các job dùng Bun `1.3.13`, Node.js 22 cho công cụ build và `bun install --frozen-lockfile`. Actions được pin bằng commit SHA. Dependency hoặc script từ pull request không được cấp secret production.

Frontend dùng `@sveltejs/adapter-cloudflare` để tạo bundle Cloudflare Pages tại `web/.svelte-kit/cloudflare`, bao gồm route server `/api/health`.

## Thiết lập một lần

1. Kiểm tra tài khoản Cloudflare đích và các tài nguyên trong `backend/wrangler.jsonc`: Worker `int3011e-backend`, D1 `int3011e-db` với database ID đã khai báo, R2 `int3011e-files`, Queue `int3011e-processing`. Các tài nguyên phải tồn tại trong tài khoản được chọn trước lần deploy đầu tiên.
2. Tạo một Cloudflare Pages project dùng Direct Upload, đặt production branch là `main`. Dùng GitHub Actions làm nguồn deploy để tránh deploy trùng qua Git integration.
3. Trong GitHub repository, tạo environment `production` tại **Settings → Environments**. Giới hạn deployment branch về `main`; bật required reviewers nếu nhóm cần duyệt trước khi deploy.
4. Thêm các secrets và variables bên dưới vào environment `production` (hoặc repository Settings → Secrets and variables → Actions).

| Loại | Tên | Giá trị |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | API token giới hạn vào tài khoản đích, có quyền deploy Worker/Pages và quản lý binding D1/R2/Queue cần thiết. |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Account ID chứa các tài nguyên của dự án. |
| Variable | `PUBLIC_BACKEND_URL` | HTTPS URL của Worker production, ví dụ URL `workers.dev` hoặc custom domain đã cấu hình. Không dùng localhost. |
| Variable | `CLOUDFLARE_PAGES_PROJECT_NAME` | Tên Pages project đã tạo, ví dụ `int3011e-web`. |

Quyền token thông thường: Account → Workers Scripts: Edit, Workers R2 Storage: Edit, D1: Edit, Queues: Edit, Cloudflare Pages: Edit; Account Settings: Read để Wrangler tra cứu account. Nếu triển khai custom route, bổ sung Workers Routes: Edit cho đúng zone. Chỉ cấp quyền vào account/zone đích. Kiểm tra [quyền Wrangler](https://developers.cloudflare.com/workers/authorization/workers/#wrangler) theo tài nguyên thực tế.

Không ghi giá trị token vào mã nguồn, file cấu hình hoặc log. `PUBLIC_BACKEND_URL` được nhúng vào frontend lúc build, nên phải là cấu hình public và không chứa credential. Frontend CI dùng URL local chỉ để kiểm tra build; job production build lại với URL thật.

## Thứ tự deploy và xử lý lỗi

Sau khi hai job check pass và environment cho phép deploy:

1. Kiểm tra đủ secrets/variables và URL HTTPS trước mọi mutation remote.
2. Cài dependency và build frontend với URL production.
3. Áp dụng migration D1 remote bằng `bun run d1:migrate:remote`.
4. Deploy Worker bằng `bun run deploy`.
5. Kiểm tra HTTP `/health` của backend, có retry khi deployment vừa cập nhật.
6. Upload frontend tới Pages project, production branch `main`.

Nếu một bước lỗi, workflow dừng trước bước tiếp theo. Deployment production được chạy tuần tự, không hủy giữa chừng khi có push mới; run pull request cũ được hủy khi có commit mới. Push chỉ sửa tài liệu cũng chạy check và deploy.

Migration phải tương thích với Worker đang chạy vì database được cập nhật trước code. Đây không phải một transaction cho cả hai ứng dụng: migration hoặc Worker đã deploy sẽ giữ nguyên nếu bước sau lỗi. Rollback Worker/Pages không rollback database; kiểm tra migration và dữ liệu trước khi rollback. `/health` chỉ kiểm tra HTTP availability, không thay thế kiểm thử đầy đủ D1/R2/Queue hoặc frontend.

Chọn **Actions → CI / CD → Run workflow → main** để deploy lại commit hiện tại sau khi sửa cấu hình. Pull request và manual run trên branch khác không deploy production.

## Kiểm tra local

Backend:

```bash
cd backend
bun install --frozen-lockfile
bun run test
bun run typecheck
bun run d1:migrate:local
bun run build
```

Frontend:

```bash
cd web
cp .env.example .env
bun install --frozen-lockfile
bun run check
bun run build
```

Các lệnh trên không deploy remote. `bun run build` trong backend dùng Wrangler dry run; trong frontend tạo bundle Pages. Kiểm tra cú pháp workflow bằng `actionlint .github/workflows/ci-cd.yml` nếu đã cài actionlint.

Tài liệu: [Cloudflare Workers GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/), [Pages Direct Upload trong CI](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/), [SvelteKit Cloudflare adapter](https://svelte.dev/docs/kit/adapter-cloudflare).
