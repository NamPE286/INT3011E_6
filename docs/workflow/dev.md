# Developer Workflow Guide

## TL;DR

```text
1. Nhận task → Estimate số giờ dự kiến cần để hoàn thành.
2. To do → In progress.
3. Tạo branch từ main.
4. Branch: [tên]/[loại]/[feature]
   Ví dụ: nambh/feat/integrate-open-ai
5. Implement + self-test + đảm bảo CI pass.
6. Push branch → mở PR vào main.
7. In progress → Wait to review → Reviewing.
8. Review fail → In progress.
9. Review pass → Wait to test.
10. Tester test.
11. Test fail → In progress.
12. Test pass → Done.
13. Không push trực tiếp vào main.
```

Flow đầy đủ:

```text
To do
  ↓
Estimate
  ↓
In progress
  ↓
Wait to review
  ↓
Reviewing
  ├── Fail → In progress
  ↓ Pass
Wait to test
  ↓
Testing
  ├── Fail → In progress
  ↓ Pass
Done
```

---

## 1. Nhận task và estimate

Trước khi bắt đầu implementation, developer **bắt buộc phải estimate task**.

Estimate là **số giờ dự kiến cần để hoàn thành task**. Ghi estimate bằng số giờ, ví dụ:

```text
Estimate: 4 giờ
```

Sau khi estimate xong:

```text
To do → In progress
```

Nếu trong quá trình làm phát hiện scope thay đổi đáng kể, developer phải cập nhật estimate và ghi rõ lý do.

---

## 2. Tạo branch

Mọi branch phải được tách từ `main`.

Trước khi tạo branch:

```bash
git checkout main
git pull origin main
```

Sau đó:

```bash
git checkout -b <name>/<type>/<feature>
```

### Branch naming

Format:

```text
[tên]/[loại]/[feature]
```

Ví dụ:

```text
nambh/feat/integrate-open-ai
nambh/fix/calendar-sync-error
nambh/refactor/auth-service
```

`feature` phải dùng `kebab-case`.

Các type khuyến nghị:

| Type | Mục đích |
|---|---|
| `feat` | Feature mới |
| `fix` | Sửa bug |
| `refactor` | Refactor không đổi behavior |
| `docs` | Tài liệu |
| `test` | Test |
| `chore` | Config, dependency, CI/CD, maintenance |

Không dùng các tên branch mơ hồ như:

```text
feature/openai
test123
fix-bug
```

---

## 3. Implement

Trong trạng thái `In progress`, developer phải:

1. Chỉ làm đúng scope của issue.
2. Tuân thủ coding convention của repository.
3. Tự kiểm tra các happy path và edge case liên quan.
4. Thêm/cập nhật test khi cần.
5. Đảm bảo CI/check liên quan pass.
6. Không để debug code, log hoặc dead code không cần thiết.

Commit message phải ngắn gọn, mô tả rõ thay đổi và tuân theo đặc tả [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/), ví dụ: `feat: add document search` hoặc `fix: handle failed processing job`.

Ví dụ:

```bash
git add .
git commit -m "feat: integrate OpenAI"
```

---

## 4. Push và mở Pull Request

Push branch:

```bash
git push -u origin <branch-name>
```

Ví dụ:

```bash
git push -u origin nambh/feat/integrate-open-ai
```

Sau đó mở PR:

```text
nambh/feat/integrate-open-ai → main
```

PR phải:

- Link issue tương ứng.
- Mô tả rõ thay đổi.
- Nêu cách test nếu cần.
- Pass CI/check bắt buộc.
- Không chứa thay đổi ngoài scope.

Sau khi mở PR, mọi trao đổi liên quan đến PR phải thực hiện trực tiếp trên PR để lưu lại đầy đủ context. Không nhắn riêng để trao đổi về PR; chỉ được nhắn riêng khi cần nhắc reviewer kiểm tra PR.

Sau khi mở PR:

```text
In progress → Wait to review
```

**Không push trực tiếp vào `main`.**

---

## 5. Review

Khi reviewer bắt đầu:

```text
Wait to review → Reviewing
```

Nếu review pass:

```text
Reviewing → Wait to test
```

Nếu reviewer request changes hoặc review fail:

```text
Reviewing → In progress
```

Developer sửa trực tiếp trên branch hiện tại, push thêm commit vào PR rồi chuyển lại:

```text
In progress → Wait to review
```

Không tạo PR mới chỉ vì review fail.

---

## 6. Sau khi review pass

Developer không tự chuyển thẳng issue sang `Done`.

Sau review:

```text
Reviewing → Wait to test
```

Tester sẽ tiếp nhận task và thực hiện test.

Nếu test fail:

```text
Testing → In progress
```

Developer sửa lỗi, sau đó task phải đi lại qua review trước khi tester test lại:

```text
In progress
→ Wait to review
→ Reviewing
→ Wait to test
→ Testing
```

Nếu test pass:

```text
Testing → Done
```

---

## 7. Definition of Done

Task chỉ được coi là hoàn thành khi:

- Implementation hoàn tất.
- PR đã pass review.
- Testing đã pass.
- CI/check bắt buộc pass.
- Không còn blocker trong scope của issue.

Developer không tự đánh dấu `Done` chỉ vì đã code xong hoặc PR đã được approve.
