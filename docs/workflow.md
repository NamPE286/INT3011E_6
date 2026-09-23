# Git Workflow Guide

## 1. Overview

Tài liệu này quy định workflow phát triển, review và testing cho project.

Mọi thay đổi code phải đi theo flow:

```text
To do
  ↓
In progress
  ↓
Wait to review
  ↓
Reviewing
  ↓
Wait to test
  ↓
Testing
  ↓
Done
```

Các trường hợp fail:

```text
Reviewing --fail--> In progress
Testing   --fail--> In progress
```

Nếu trong quá trình testing phát hiện bug, tester phải tạo **sub-issue** sử dụng **Bug Report Template**.

---

## 2. Branching Strategy

### 2.1. Branch gốc

Mọi branch phát triển phải được tạo từ `main`.

Trước khi tạo branch mới:

```bash
git checkout main
git pull origin main
```

Sau đó tạo branch:

```bash
git checkout -b <name>/<type>/<feature>
```

---

### 2.2. Quy tắc đặt tên branch

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

Trong đó:

- `[tên]`: tên hoặc username của developer.
- `[loại]`: loại thay đổi.
- `[feature]`: mô tả ngắn gọn nội dung thay đổi, sử dụng `kebab-case`.

Các loại branch khuyến nghị:

| Type | Mục đích |
|---|---|
| `feat` | Thêm feature mới |
| `fix` | Sửa bug |
| `refactor` | Refactor code, không thay đổi behavior |
| `docs` | Cập nhật tài liệu |
| `test` | Thêm hoặc sửa test |
| `chore` | Công việc kỹ thuật, config, dependency, CI/CD |

Ví dụ chuẩn:

```text
nambh/feat/integrate-open-ai
```

Không sử dụng:

```text
feature/openai
openai-feature
nambh-openai
test123
```

---

## 3. Issue Workflow

Mỗi task/issue phải được quản lý theo các trạng thái sau:

### `To do`

Issue đã được tạo nhưng chưa bắt đầu xử lý.

Khi developer bắt đầu làm:

```text
To do → In progress
```

---

### `In progress`

Developer đang thực hiện task.

Tại bước này developer phải:

1. Pull `main` mới nhất.
2. Tạo branch từ `main`.
3. Implement feature/fix.
4. Tự kiểm tra code.
5. Đảm bảo test và CI liên quan pass.

Khi hoàn thành implementation và đã mở Pull Request:

```text
In progress → Wait to review
```

---

### `Wait to review`

Pull Request đã được mở và đang chờ reviewer.

PR phải:

- Link tới issue tương ứng.
- Có mô tả rõ thay đổi.
- Có hướng dẫn test nếu cần.
- Pass CI/check bắt buộc.
- Không chứa thay đổi ngoài scope.

Khi reviewer bắt đầu review:

```text
Wait to review → Reviewing
```

---

### `Reviewing`

Reviewer kiểm tra:

- Logic.
- Code quality.
- Coding convention.
- Test coverage.
- Edge cases.
- Scope của thay đổi.
- Khả năng gây regression.

Nếu review **pass**:

```text
Reviewing → Wait to test
```

Nếu review **fail** hoặc có change request:

```text
Reviewing → In progress
```

Developer tiếp tục sửa trên branch hiện tại và update Pull Request.

Sau khi sửa xong:

```text
In progress → Wait to review
```

---

### `Wait to test`

PR đã pass review và sẵn sàng cho tester kiểm tra.

Tester nhận task:

```text
Wait to test → Testing
```

---

### `Testing`

Tester kiểm tra feature theo:

- Acceptance Criteria.
- Expected behavior.
- Edge cases.
- Regression liên quan.
- UI/UX nếu có.
- Error handling.

Nếu test **pass**:

```text
Testing → Done
```

Nếu test **fail**:

```text
Testing → In progress
```

Developer sửa lỗi và workflow chạy lại từ bước development/review.

---

### `Done`

Issue chỉ được chuyển sang `Done` khi:

- Implementation hoàn tất.
- Pull Request đã pass review.
- Testing đã pass.
- Không còn blocker liên quan đến scope của issue.

---

## 4. Pull Request Workflow

Sau khi hoàn thành code, developer push branch:

```bash
git push -u origin <branch-name>
```

Ví dụ:

```bash
git push -u origin nambh/feat/integrate-open-ai
```

Sau đó mở Pull Request:

```text
<nambh/feat/integrate-open-ai> → main
```

Không push trực tiếp vào `main`.

PR bắt buộc phải được review trước khi merge.

Workflow:

```text
Developer
   ↓
Open Pull Request
   ↓
Wait to review
   ↓
Reviewer
   ↓
Reviewing
   ├── Fail → In progress
   └── Pass → Wait to test
                  ↓
                Tester
                  ↓
                Testing
                  ├── Fail → In progress
                  └── Pass → Done
```

---

## 5. Review Rules

Một PR chưa được coi là hoàn thành chỉ vì code chạy được.

Reviewer cần kiểm tra tối thiểu:

- Code đúng yêu cầu.
- Không có thay đổi ngoài scope.
- Không duplicate logic không cần thiết.
- Naming rõ ràng.
- Error handling phù hợp.
- Không để debug code/log thừa.
- Test cần thiết đã được thêm hoặc cập nhật.
- CI pass.

Nếu cần sửa code, reviewer sử dụng **Request changes**.

Issue phải chuyển:

```text
Reviewing → In progress
```

Sau khi developer sửa xong, issue quay lại:

```text
In progress → Wait to review → Reviewing
```

---

## 6. Testing Rules

Tester chỉ bắt đầu test sau khi PR đã pass review.

Tester không approve code review thay cho reviewer trừ khi tester đồng thời được assign role reviewer.

Nếu test fail:

```text
Testing → In progress
```

Tester phải ghi rõ:

- Steps to reproduce.
- Expected result.
- Actual result.
- Environment.
- Screenshot/video/log nếu có.

---

## 7. Bug Found During Testing

Nếu tester phát hiện bug trong quá trình test, tester phải tạo **sub-issue** của issue hiện tại.

Sub-issue phải sử dụng **Bug Report Template**.

Ví dụ hierarchy:

```text
#123 Integrate OpenAI
└── #130 [Bug] OpenAI request timeout is not handled
```

Bug report tối thiểu phải có:

```md
## Description

Mô tả ngắn gọn bug.

## Steps to Reproduce

1. ...
2. ...
3. ...

## Expected Behavior

Kết quả mong đợi.

## Actual Behavior

Kết quả thực tế.

## Environment

- Branch:
- Environment:
- Browser / Device:
- Version / Commit:

## Evidence

Screenshot, video hoặc log nếu có.
```

Nếu bug làm cho acceptance criteria của issue cha không đạt, issue cha phải:

```text
Testing → In progress
```

Developer xử lý bug, sau đó workflow review và testing được thực hiện lại.

---

## 8. Complete Workflow Example

Ví dụ developer `nambh` implement feature tích hợp OpenAI.

### Step 1 — Nhận task

```text
To do → In progress
```

### Step 2 — Tạo branch

```bash
git checkout main
git pull origin main
git checkout -b nambh/feat/integrate-open-ai
```

### Step 3 — Implement

Developer code và commit:

```bash
git add .
git commit -m "feat: integrate OpenAI"
git push -u origin nambh/feat/integrate-open-ai
```

### Step 4 — Open PR

Mở PR:

```text
nambh/feat/integrate-open-ai → main
```

Issue:

```text
In progress → Wait to review
```

### Step 5 — Review

Reviewer bắt đầu:

```text
Wait to review → Reviewing
```

Nếu có change request:

```text
Reviewing → In progress
```

Developer sửa xong:

```text
In progress → Wait to review → Reviewing
```

Nếu pass:

```text
Reviewing → Wait to test
```

### Step 6 — Testing

Tester bắt đầu:

```text
Wait to test → Testing
```

Nếu phát hiện bug:

1. Tạo sub-issue bằng Bug Report Template.
2. Ghi đầy đủ reproduction steps.
3. Chuyển issue cha:

```text
Testing → In progress
```

Sau khi developer fix và PR pass review/test lại:

```text
In progress
→ Wait to review
→ Reviewing
→ Wait to test
→ Testing
→ Done
```

---

## 9. Summary

Quy tắc chính:

```text
Branch luôn tạo từ main.

Branch naming:
[tên]/[loại]/[feature]

Ví dụ:
nambh/feat/integrate-open-ai

Không push trực tiếp vào main.

Mọi thay đổi phải thông qua Pull Request.

PR phải pass review trước khi tester test.

Review fail:
Reviewing → In progress

Test fail:
Testing → In progress

Bug phát hiện trong testing:
Tạo sub-issue bằng Bug Report Template.

Flow chuẩn:
To do
→ In progress
→ Wait to review
→ Reviewing
→ Wait to test
→ Testing
→ Done
```
