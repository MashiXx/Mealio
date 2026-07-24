# Thiết kế: Chỉnh sửa mâm — nút nhanh + chat có trí nhớ (Giai đoạn 2)

Ngày: 2026-07-24
Trạng thái: đã brainstorm & chốt hướng. Spec Giai đoạn 2 (nối tiếp GĐ 1 "Mâm cơm").

## Bối cảnh

Sau GĐ 1: một bữa = `PlannedMeal` (mâm) chứa nhiều `MealDish` (mỗi món nối 1 `Recipe` + `dishRole`). AI chạy qua `AIProvider` (Anthropic/OpenAI-compat/Ollama) và **tạo menu chạy ngầm** bằng `GenerationJob` + bộ điều phối `pumpJobs` (concurrency toàn hệ thống, mặc định 1 vì endpoint self-host 1 GPU). Dashboard hiển thị mâm; có sẵn `JobPoller` để tự refresh.

## Mục tiêu (yêu cầu #4)

Sau khi ra thực đơn, cho người dùng **chỉnh tới từng món**:
- **Nút thao tác nhanh** mỗi món: Đổi món khác · Đổi đạm/nguyên liệu chính · Điều chỉnh nhanh (ít cay/ít dầu/nhanh hơn/rẻ hơn) · Xóa.
- **Thêm món** cấp mâm.
- **Chat tự do** cấp từng món và cấp cả mâm, **có trí nhớ 4-5 lượt hội thoại** để sinh cho hợp lý.

## Quyết định khi brainstorm

- **`EditJob` là model RIÊNG** (không gộp vào `GenerationJob`).
- **Hàng đợi chung 1 GPU:** `pumpJobs` đếm RUNNING của **cả** `GenerationJob` + `EditJob`, chọn PENDING cũ nhất **liền mạch giữa hai hàng** (FIFO theo `createdAt`) để không vượt trần đồng thời.
- **Chat có trí nhớ:** giữ ~4-5 lượt gần nhất, gộp vào prompt sửa.
- **Xóa món:** tức thì, **không qua AI/job**; chặn xóa món cuối cùng của mâm.
- Chat = một message JSON-out có gộp lịch sử (không dùng multi-turn thật) để ổn định với model local.

---

## 1. Mô hình dữ liệu

### 1.1 `EditJob` (mới)
```prisma
model EditJob {
  id       String @id @default(cuid())
  familyId String
  family   Family @relation(fields: [familyId], references: [id], onDelete: Cascade)

  plannedMealId String
  plannedMeal   PlannedMeal @relation(fields: [plannedMealId], references: [id], onDelete: Cascade)

  scope      EditScope           // DISH | MEAL | ADD
  mealDishId String?             // món đích khi scope=DISH; null khi MEAL/ADD
  instruction String             // lệnh lần này (canned từ nút nhanh hoặc text chat)
  useHistory Boolean @default(false) // true khi đến từ chat (nạp chatHistory làm ngữ cảnh)

  status     JobStatus @default(PENDING)
  error      String?
  createdAt  DateTime  @default(now())
  startedAt  DateTime?
  finishedAt DateTime?

  @@index([familyId, status])
  @@index([plannedMealId])
}

enum EditScope {
  DISH // sửa 1 món (thay MealDish đích)
  MEAL // sửa/viết lại cả mâm
  ADD  // sinh 1 món mới, nối thêm vào mâm
}
```
`JobStatus` dùng lại enum đã có (PENDING/RUNNING/DONE/FAILED).

### 1.2 Trí nhớ hội thoại
Thêm cột `chatHistory Json @default("[]")` vào **`MealDish`** (chat từng món) và **`PlannedMeal`** (chat cả mâm). Mỗi phần tử:
```ts
type ChatTurn = { role: "user" | "assistant"; content: string };
```
- Chat DISH đọc/ghi `MealDish.chatHistory`.
- Chat MEAL đọc/ghi `PlannedMeal.chatHistory`.
- Nút nhanh, ADD, xóa **không** dùng history.

### 1.3 Quan hệ ngược
`PlannedMeal` thêm `editJobs EditJob[]`. (`MealDish` không cần quan hệ ngược vì `mealDishId` là con trỏ mềm, có thể null/đã đổi.)

## 2. Bộ điều phối chung (jobs.ts)

Tổng quát hoá `pumpJobs` để phục vụ 2 loại job trên cùng trần đồng thời:
- `countRunning()` = `generationJob.count(RUNNING)` + `editJob.count(RUNNING)`.
- Trong `pumpOnce`: khi `countRunning() < CONCURRENCY`, tìm PENDING cũ nhất của **mỗi** hàng (`findFirst orderBy createdAt asc`), chọn cái `createdAt` nhỏ hơn, claim nguyên tử (`updateMany where status=PENDING → RUNNING`), rồi chạy `runGenerationJob` hoặc `runEditJob` tương ứng; xong thì `pumpJobs()` lại.
- `failStaleRunning()` áp cho cả hai model (RUNNING quá `STALE_MS` → FAILED).
- Đổi tên `runJob` hiện tại → `runGenerationJob`; thêm `runEditJob`.

Đọc trạng thái cho UI:
- Giữ `getActiveJob` (GenerationJob) cho thẻ tạo menu.
- Thêm `getActiveEditJobs(familyId)`: các EditJob PENDING/RUNNING (kèm `plannedMealId`, `mealDishId`, `scope`) để UI hiện spinner đúng chỗ.
- Thêm `getRecentFailedEditJobs(familyId)` (trong hạn hiển thị) để báo lỗi + cho ack.

## 3. AI: `editMeal` + prompt/schema

### 3.1 Interface
Thêm vào `AIProvider`:
```ts
editMeal(ctx: EditContext): Promise<AiEditResult>;
```
Triển khai ở `AnthropicProvider` và `OpenAICompatibleProvider` (Ollama kế thừa) — **mirror `generateMenu`**: `buildEditPrompt(ctx)` → gọi model (system + 1 user, JSON out) → `parseEditJson`.

### 3.2 `EditContext` (types.ts)
```ts
interface EditContext {
  scope: "DISH" | "MEAL" | "ADD";
  mealType: MealTypeStr;
  servings: number;
  members: MenuMember[];        // dị ứng/kiêng/khẩu vị
  profile: MenuProfile;
  currentDishes: EditDishView[];// trạng thái hiện tại của mâm (nguồn chân lý)
  targetRole?: DishRoleStr;     // vai trò món đích khi scope=DISH
  history: ChatTurn[];          // 4-5 lượt gần nhất (rỗng nếu không dùng)
  instruction: string;          // lệnh mới
  recentRecipeNames: string[];  // tránh lặp
  catalogReference?: CatalogReference;
}
interface EditDishView { name: string; dishRole: DishRoleStr; nutritionLabels: string[]; ingredientNames: string[]; }
```
`buildEditContext(familyId, job)` trong `menu.ts` (hoặc `edit.ts`) dựng từ DB: nạp mâm + dishes hiện tại, members/profile, và history (`useHistory` → đọc chatHistory của MealDish/PlannedMeal, cắt 5 lượt cuối).

### 3.3 Prompt (`buildEditPrompt`)
- Persona giữ "chuyên gia dinh dưỡng + đầu bếp".
- Nêu **trạng thái mâm hiện tại** (tên + vai trò + nguyên liệu mỗi món) làm nguồn chân lý.
- Nếu có `history`: chèn đoạn "Lịch sử trao đổi (cũ → mới)" liệt kê các lượt.
- Ràng buộc an toàn (dị ứng/kiêng), không lặp món gần đây, giữ đúng ẩm thực Việt.
- Yêu cầu theo scope:
  - **DISH:** trả **đúng 1 món** thay cho món `targetRole`, khác món hiện tại, thoả lệnh.
  - **MEAL:** trả **danh sách đầy đủ** món của mâm sau khi áp lệnh (thêm/bớt/điều chỉnh).
  - **ADD:** trả **đúng 1 món mới** phù hợp bổ sung vào mâm (không trùng món đang có).
- JSON: `{"dishes":[{...aiDish}]}` (dùng lại `aiDishSchema` của GĐ 1).

### 3.4 Schema (`schema.ts`)
```ts
export const aiEditSchema = z.object({ dishes: z.array(aiDishSchema).min(1) });
export type AiEditResult = z.infer<typeof aiEditSchema>;
export function parseEditJson(text: string): AiEditResult; // dùng lại extractJson
```

## 4. Áp kết quả (edit apply)

`applyEdit(job, result)` trong transaction:
- **DISH:** lấy `result.dishes[0]` → tạo `Recipe` mới (+ upsert Ingredient như `saveMenu`) → `mealDish.update({ where: id=job.mealDishId }, data: { recipeId })` (giữ `dishRole`, `position`). Nếu `mealDishId` không còn (đã bị xóa) → bỏ qua/FAILED nhẹ.
- **MEAL:** xóa toàn bộ `MealDish` của mâm → tạo lại theo `result.dishes` (Recipe + MealDish, `position` tăng dần) — như một `saveMenu` cho riêng mâm đó.
- **ADD:** lấy `result.dishes[0]` → tạo Recipe + `MealDish` mới với `position = max(position)+1`.
- Sau DISH/MEAL đến từ chat: ghi lượt `assistant` (vd "Đã đổi sang: <tên món mới>") vào `chatHistory` tương ứng.

Tách logic dùng chung với `saveMenu` (tạo Recipe + upsert Ingredient) thành helper `createRecipeFromDish(tx, familyId, dish)` để DRY.

## 5. Server actions (`src/lib/actions/edit.ts`)

- `quickEditAction(mealDishId, kind)` — kind ∈ {đổi món, đổi đạm, ít cay, ít dầu, nhanh hơn, rẻ hơn}: map sang câu lệnh canned, tạo `EditJob` scope=DISH `useHistory=false`, `after(pumpJobs)`.
- `chatDishAction(mealDishId, message)` — append lượt user vào `MealDish.chatHistory`, tạo `EditJob` scope=DISH `useHistory=true`.
- `chatMealAction(plannedMealId, message)` — tương tự cấp mâm (`PlannedMeal.chatHistory`), scope=MEAL.
- `addDishAction(plannedMealId)` (hoặc kèm gợi ý vai trò) — tạo `EditJob` scope=ADD.
- `deleteDishAction(mealDishId)` — **tức thì**, xóa `MealDish` (guard: mâm phải còn ≥ 2 món trước khi xóa), revalidate. Không tạo job.
- `ackEditJobAction(jobId)` — xóa job FAILED của gia đình.

Mọi action `requireFamily()` + scope theo `familyId` (đi qua `plannedMeal.familyId`). Chống trùng: cho phép nhiều EditJob khác món, nhưng chặn tạo EditJob mới cho **cùng một `mealDishId`/mâm** khi đã có job active cho đúng đích đó.

## 6. Giao diện

Dashboard mâm card (chuyển phần render dishes sang **client component** `MealCard`/`DishRow` để có tương tác + polling):
- **Mỗi món (`DishRow`):** ngoài nội dung GĐ 1, thêm hàng nút: **Đổi món** · **Đổi đạm** · **Điều chỉnh nhanh ▾** (menu con: ít cay/ít dầu/nhanh hơn/rẻ hơn) · **Xóa**. Kèm nút mở **ô chat món** (hiện `chatHistory` + input gửi `chatDishAction`).
- **Mỗi mâm (`MealCard`):** nút **+ Thêm món** và ô **chat mâm** (hiện `PlannedMeal.chatHistory` + input gửi `chatMealAction`).
- **Trạng thái chạy:** khi có EditJob active cho món/mâm → phủ spinner + disable nút trên đúng đích. Một `EditPoller` (kiểu `JobPoller`) gọi `router.refresh()` định kỳ tới khi hết job active; server component nạp lại dishes + `getActiveEditJobs` để biết chỗ nào đang chạy.
- **Lỗi edit:** thẻ nhỏ báo `EditJob` FAILED + nút "Bỏ qua" (`ackEditJobAction`).

Xóa dùng `confirm()` phía client hoặc form submit trực tiếp (tức thì, không spinner AI).

## 7. Migration (áp khi deploy)

Migration mới `..._edit_mam_chat`:
- Tạo enum `EditScope`, bảng `EditJob` (+ index + FK cascade).
- `ALTER TABLE "MealDish" ADD COLUMN "chatHistory" JSONB NOT NULL DEFAULT '[]'`.
- `ALTER TABLE "PlannedMeal" ADD COLUMN "chatHistory" JSONB NOT NULL DEFAULT '[]'`.

Như GĐ 1: **không áp tay lên DB remote**; `docker-entrypoint.sh` chạy `prisma migrate deploy` khi deploy. Lưu ý: GĐ 2 dựa trên bảng `MealDish` của GĐ 1 → migration GĐ 1 phải áp trước (thứ tự timestamp đảm bảo điều này).

## 8. Ràng buộc kỹ thuật

- Next.js 16.2.9 breaking: `params`/`searchParams` async; `useActionState` từ `react`; đọc `node_modules/next/dist/docs/` trước khi viết client component/route.
- Concurrency: chỉ 1 GPU → pump chung là bắt buộc, không để edit vượt trần.
- Đa provider: `editMeal` chỉ thêm ở interface + 2 adapter (Ollama kế thừa); prompt/schema dùng chung.
- Model yếu: prompt nêu rõ scope + số món kỳ vọng; JSON `response_format` cho nhánh OpenAI-compat.

## 9. Tiêu chí hoàn thành (GĐ 2)

1. Bấm **Đổi món** trên một món → sau khi job xong, đúng món đó đổi thành món khác cùng vai trò; các món khác giữ nguyên.
2. **Đổi đạm** → cùng kiểu món, nguyên liệu chính đổi.
3. **Điều chỉnh nhanh** (ít cay…) → công thức món đổi theo hướng đó.
4. **Chat món** 2-3 lượt liên tiếp → lượt sau hiểu ngữ cảnh lượt trước (nhờ history); lịch sử hiển thị trong ô chat.
5. **Chat mâm** "thêm món tráng miệng" / "bớt 1 món" → số món của mâm thay đổi đúng.
6. **Thêm món** → mâm có thêm 1 món hợp lệ.
7. **Xóa** → món biến mất tức thì (không chờ AI); không cho xóa khi mâm còn 1 món.
8. Mọi chỉnh sửa vẫn tránh dị ứng/kiêng.
9. Khi đang tạo menu (GenerationJob) mà bấm sửa → EditJob xếp hàng, không chạy đồng thời quá 1 GPU.
10. `next build` + test PASS; migration áp khi deploy.

## 10. Ngoài phạm vi
Multi-turn thật với streaming; hoàn tác (undo) chỉnh sửa; dọn recipe mồ côi; lịch sử ngày đã qua (GĐ 3).
