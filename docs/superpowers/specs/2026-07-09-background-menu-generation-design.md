# Thiết kế: Tạo thực đơn chạy ngầm (background generation)

Ngày: 2026-07-09

## Vấn đề

`generateMenuAction` hiện chạy **đồng bộ**: form submit và chờ AI 10–30s rồi mới
`redirect`. Nếu user rời trang giữa chừng, request bị huỷ → công việc mất (có khi
chưa kịp `saveMenu`). Ngoài ra không có gì ngăn user bấm tạo nhiều lần cùng lúc.

## Mục tiêu

1. Tạo thực đơn chạy **ngầm ở server**, độc lập với việc user ở lại hay rời trang.
2. **Chống trùng**: mỗi gia đình tối đa 1 task đang chạy tại một thời điểm.
3. Dashboard hiển thị trạng thái đang tạo và **tự cập nhật** khi xong.

## Quyết định thiết kế (đã chốt)

- **Cơ chế**: in-process — Server Action tạo record Job rồi chạy nền bằng Next
  `after()`. Không thêm hạ tầng (Redis/queue). Phù hợp self-host 1 process
  (`next start`, Node — không có timeout serverless nên job 10–30s chạy được).
- **Chống trùng**: 1 task/gia đình.
- **Trải nghiệm**: sau khi bấm Tạo → về dashboard, thẻ "đang tạo" tự cập nhật.

## 1. Data model

Thêm vào `prisma/schema.prisma`:

```prisma
model GenerationJob {
  id         String    @id @default(cuid())
  familyId   String
  family     Family    @relation(fields: [familyId], references: [id], onDelete: Cascade)
  date       DateTime            // ngày mục tiêu (midnight)
  mealTypes  MealType[]          // bữa cần tạo
  status     JobStatus @default(PENDING)
  error      String?             // lý do nếu FAILED
  createdAt  DateTime  @default(now())
  startedAt  DateTime?
  finishedAt DateTime?

  @@index([familyId, status])
}

enum JobStatus {
  PENDING
  RUNNING
  DONE
  FAILED
}
```

Thêm quan hệ ngược vào `Family`:

```prisma
generationJobs GenerationJob[]
```

Tạo migration mới bằng `prisma migrate dev --name add_generation_job`.

## 2. Luồng chạy ngầm

### `startGenerationAction(prev, formData)` (thay `generateMenuAction`)

1. `requireFamily()`.
2. Validate `date` (yyyy-mm-dd) + `mealTypes` (như logic hiện tại).
3. Kiểm tra active job: nếu tồn tại job `PENDING`/`RUNNING` của gia đình →
   trả `{ error: "Đang có thực đơn đang được tạo, vui lòng đợi." }`.
4. Tạo `GenerationJob` status `PENDING` (date lưu dạng DateTime midnight local).
5. `after(() => processGenerationJob(job.id))` — đăng ký TRƯỚC redirect
   (redirect ném lỗi để ngắt; `after` vẫn chạy theo tài liệu Next).
6. `redirect('/dashboard?date=' + date)`.

### `processGenerationJob(jobId)` (hàm nội bộ, không phải action)

1. Cập nhật job → `RUNNING`, `startedAt = now`.
2. `try`: `getAIProvider(familyId)` → `buildMenuContext(familyId, slots)` →
   `provider.generateMenu(ctx)` → `saveMenu(familyId, menu)` →
   job → `DONE`, `finishedAt = now`.
3. `catch`: job → `FAILED`, `error = message`, `finishedAt = now`.

Slots dựng lại từ `job.date` + `job.mealTypes`.

### Chống job treo

Khi đọc job active (dashboard / menu-new / action check), nếu job `RUNNING`/`PENDING`
có `startedAt` (hoặc `createdAt` khi chưa start) cũ hơn `STALE_MS` (~5 phút) →
cập nhật thành `FAILED` với error "Quá thời gian (server có thể đã khởi động lại)".
Đặt trong helper `getActiveJob(familyId)` để mọi nơi đọc đều nhất quán.

Ghi chú: chống trùng dựa vào app-level check + khoá nút client. Không dùng partial
unique index (đủ cho app gia đình; ghi lại như hướng hardening tương lai nếu cần
chống double-submit tuyệt đối).

## 3. Chống trùng phía UI

- `src/lib/jobs.ts` (mới): `getActiveJob(familyId)`, `getRecentFailedJob(familyId)`,
  `ackJob(jobId)` (xoá/đánh dấu đã xem job FAILED). Xử lý job treo tập trung ở đây.
- `/menu/new/page.tsx` đổi thành **server component**:
  - Fetch active job. Nếu có → render panel "Đang tạo thực đơn cho ngày X…" +
    link về dashboard (không hiện form).
  - Nếu không → render `<NewMenuForm />` (client, tách từ code hiện tại: date +
    nút nhanh Hôm nay/Ngày mai + chọn bữa + submit).
- `NewMenuForm` dùng `startGenerationAction`; nút submit khoá khi `pending`.

## 4. Dashboard tự cập nhật

- `dashboard/page.tsx` (server) fetch thêm `getActiveJob` + `getRecentFailedJob`.
- Active job → thẻ "⏳ Đang tạo thực đơn cho ngày X…" + `<JobPoller />`.
- `dashboard/JobPoller.tsx` (mới, client): `setInterval` gọi `router.refresh()`
  mỗi 3s trong khi còn active; dọn interval khi unmount. Khi job xong, refresh
  re-render server component → thẻ biến mất, món hiện ra.
- FAILED job → thẻ đỏ hiện `error` + nút "Thử lại" (link `/menu/new`) và "Bỏ qua"
  (gọi `ackJob`). Sau khi ack, thẻ biến mất.

## Files

| File | Việc |
|---|---|
| `prisma/schema.prisma` + migration mới | Model `GenerationJob`, enum `JobStatus`, quan hệ `Family.generationJobs` |
| `src/lib/actions/menu.ts` | `startGenerationAction`, `processGenerationJob`, action `ackJob` |
| `src/lib/jobs.ts` (mới) | `getActiveJob`, `getRecentFailedJob`, xử lý job treo, hằng `STALE_MS` |
| `src/app/(app)/menu/new/page.tsx` | Server page: check active → panel hoặc form |
| `src/app/(app)/menu/new/NewMenuForm.tsx` (mới) | Client form tách ra |
| `src/app/(app)/dashboard/page.tsx` | Fetch job + render thẻ trạng thái |
| `src/app/(app)/dashboard/JobPoller.tsx` (mới) | Client poll `router.refresh()` |

## Kiểm thử / verify

- Typecheck + lint sạch.
- Migration apply được, `prisma generate` ra client mới.
- E2E thật: tạo job → dashboard hiện thẻ đang tạo → (endpoint AI hợp lệ) job DONE,
  món hiện ra; bấm tạo lần 2 khi đang chạy → bị chặn; job lỗi → thẻ FAILED.

## Ngoài phạm vi (YAGNI)

- Không làm hàng đợi phân tán / nhiều worker.
- Không partial unique index (ghi nhận là hardening tương lai).
- Không huỷ job đang chạy giữa chừng (chỉ ack job đã FAILED).
