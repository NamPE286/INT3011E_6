# Tester Workflow Guide

## TL;DR

```text
1. Chỉ nhận task ở Wait to test.
2. Nhận test → Wait to test → Testing.
3. Test theo Acceptance Criteria + edge cases + regression liên quan.
4. Test pass → Done.
5. Test fail → In progress.
6. Nếu phát hiện bug → tạo sub-issue bằng Bug Report Template.
7. Bug report phải có reproduce steps, expected, actual, environment và evidence.
8. Không tự sửa code trong vai trò tester trừ khi đồng thời được assign developer.
```

Flow tester:

```text
Wait to test
  ↓
Testing
  ├── Pass → Done
  └── Fail → In progress
               ↓
          Developer fix
               ↓
         Review lại PR
               ↓
         Wait to test
               ↓
            Testing
```

---

## 1. Khi nào bắt đầu test

Tester chỉ bắt đầu test khi issue ở trạng thái:

```text
Wait to test
```

Điều này có nghĩa là PR đã pass review và sẵn sàng để kiểm thử.

Khi bắt đầu:

```text
Wait to test → Testing
```

Không test feature chưa pass review, trừ khi team thống nhất rõ đó là exploratory/pre-review testing.

---

## 2. Nội dung cần test

Tester phải kiểm tra tối thiểu:

- Acceptance Criteria của issue.
- Happy path.
- Edge cases.
- Error handling.
- Regression liên quan.
- UI/UX nếu feature có giao diện.
- Permission/role nếu có.
- Dữ liệu đầu vào không hợp lệ nếu có.
- Behavior trên environment được yêu cầu.

Nếu issue hoặc PR có hướng dẫn test riêng, phải ưu tiên kiểm tra theo hướng dẫn đó.

---

## 3. Test pass

Nếu toàn bộ acceptance criteria đạt và không còn blocker trong scope:

```text
Testing → Done
```

Trước khi chuyển `Done`, tester cần đảm bảo:

- Không còn bug blocker/major trong scope.
- Kết quả đúng với expected behavior.
- Các case chính đã được test.
- Regression liên quan không bị ảnh hưởng.

---

## 4. Test fail

Nếu feature không đạt acceptance criteria:

```text
Testing → In progress
```

Developer sẽ sửa lỗi.

Sau khi sửa xong, task phải đi lại qua review:

```text
In progress
→ Wait to review
→ Reviewing
→ Wait to test
→ Testing
```

Tester không chuyển trực tiếp từ `Testing` về `Wait to test` khi chưa có vòng fix + review mới.

---

## 5. Bug phát hiện trong lúc test

Mọi bug phát hiện trong quá trình testing phải được tạo thành **sub-issue** của issue đang test.

Sub-issue phải sử dụng **Bug Report Template**.

Ví dụ:

```text
#123 Integrate OpenAI
└── #130 [Bug] OpenAI request timeout is not handled
```

Nếu bug làm acceptance criteria của issue cha không đạt:

```text
Testing → In progress
```

---

## 6. Nội dung Bug Report

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

### Quy tắc viết bug report

Bug report phải:

- Có thể reproduce được.
- Viết steps theo thứ tự rõ ràng.
- Phân biệt rõ Expected và Actual.
- Ghi đúng environment đang test.
- Đính kèm screenshot/video/log nếu chúng giúp developer debug nhanh hơn.
- Không gộp nhiều bug không liên quan vào cùng một issue.

---

## 7. Retest sau khi fix

Khi developer báo đã fix:

1. Chờ PR pass review lại.
2. Issue quay về `Wait to test`.
3. Chuyển sang `Testing`.
4. Retest bug đã báo.
5. Test thêm regression liên quan.

Nếu vẫn fail:

```text
Testing → In progress
```

Nếu pass:

```text
Testing → Done
```

---

## 8. Trách nhiệm của tester

Tester chịu trách nhiệm xác nhận behavior, không chỉ xác nhận rằng "app chạy được".

Tester cần trả lời được:

- Feature có đúng acceptance criteria không?
- Có case nào dễ gây lỗi mà chưa được xử lý không?
- Fix có gây regression không?
- Bug report có đủ thông tin để developer reproduce không?

Tester không approve code review thay reviewer, trừ khi tester đồng thời được assign role reviewer.
