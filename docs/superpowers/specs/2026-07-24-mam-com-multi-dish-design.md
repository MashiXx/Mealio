# Thiết kế: Nâng cấp "Mâm cơm" — thực đơn nhiều món, gợi ý chuyên gia

Ngày: 2026-07-24
Trạng thái: đã duyệt hướng dữ liệu (Hướng A) + bảng số món; đây là spec Giai đoạn 1.

## Bối cảnh & mục tiêu

Người dùng muốn 4 mảng lớn cho Mealio:

1. Lịch sử cụ thể các bữa ăn đã tạo.
2. Mỗi bữa nhiều món, số món tính theo số người (2 người ~2 món, đông hơn 3–4 món), cân nhắc theo lịch sử & lựa chọn của người dùng.
3. Gợi ý chuyên nghiệp hơn (chất chuyên gia dinh dưỡng + đầu bếp).
4. Sau khi ra thực đơn, có tùy chọn đổi/tạo lại từng món và **chat tự do** để chỉnh tới từng món.

Quyết định khi brainstorm:

- **Chia 3 giai đoạn**, mỗi giai đoạn 1 spec riêng.
- **Số món**: theo bữa + số người. Sáng = 1 món; trưa/tối = mâm nhiều món. Cho chỉnh tay.
- **Chỉnh sửa**: nút thao tác nhanh + chat tự do (Giai đoạn 2).
- **Lịch sử**: mỗi (ngày × bữa) chỉ giữ **thực đơn mới nhất** — tạo lại cho ngày đó thì **ghi đè**, xoá cái cũ. (Xem lại ngày đã qua để ở Giai đoạn 3.)

### Lộ trình

- **GĐ 1 (spec này) — Nền tảng "Mâm cơm":** mô hình nhiều món/bữa + số món theo người + prompt chuyên gia + ghi-đè-khi-tạo-lại.
- **GĐ 2 — Chỉnh sửa từng món:** nút nhanh (đổi món khác / tạo lại / "ít cay hơn" / "đổi đạm khác") + ô chat tự do, tác động tới từng `MealDish`.
- **GĐ 3 — Lịch sử:** xem lại thực đơn các ngày đã qua.

Spec này CHỈ đặc tả Giai đoạn 1.

---

## Giai đoạn 1 — Nền tảng "Mâm cơm"

### 1. Mô hình dữ liệu (Hướng A đã duyệt)

Chuyển từ "1 `PlannedMeal` = 1 `Recipe`" sang "1 `PlannedMeal` = một **mâm** chứa nhiều **món** (`MealDish`)".

**`PlannedMeal`** (một bữa/mâm):
- Bỏ `recipeId`.
- Giữ: `familyId`, `mealPlanId?`, `date`, `mealType`, `servings` (số người ăn bữa đó — dùng để tính khẩu phần & số món), `createdAt`.
- Thêm ràng buộc **`@@unique([familyId, date, mealType])`** → mỗi (ngày × bữa) đúng một mâm; tạo lại là thay thế (latest-wins).
- Quan hệ mới: `dishes MealDish[]`.

**`MealDish`** (bảng mới — một món trong mâm):
```prisma
model MealDish {
  id            String   @id @default(cuid())
  plannedMealId String
  plannedMeal   PlannedMeal @relation(fields: [plannedMealId], references: [id], onDelete: Cascade)

  recipeId String
  recipe   Recipe @relation(fields: [recipeId], references: [id], onDelete: Cascade)

  dishRole DishRole @default(MON_MAN) // dùng lại enum sẵn có
  position Int      @default(0)       // thứ tự trong mâm

  @@index([plannedMealId])
}
```

- Dùng lại enum `DishRole` đã có (MON_MAN, MON_XAO, CANH_SUP, RAU_LUOC, LAU, COM_BUN_PHO, MON_CUON, TRANG_MIENG, DO_CHUA).
- `MealHistory` hiện trỏ `plannedMealId` + `recipeId`: **để nguyên, chưa dùng ở GĐ 1** (rating/learning đã được de-scope theo lựa chọn latest-wins). Không xoá model để tránh migration thừa; GĐ 3 quyết định có dùng lại không.

**Migration (Postgres remote):** đây là thay đổi phá vỡ. Migration cần:
1. Tạo bảng `MealDish`.
2. **Data migration bảo toàn dữ liệu**: với mỗi `PlannedMeal` hiện có, chèn 1 `MealDish(plannedMealId, recipeId=<recipeId cũ>, dishRole='MON_MAN', position=0)`.
3. **Khử trùng trước khi thêm unique**: nếu tồn tại nhiều `PlannedMeal` cùng `(familyId, date, mealType)`, giữ bản mới nhất (`createdAt` lớn nhất), gộp/bỏ phần còn lại, rồi mới thêm `@@unique`.
4. Bỏ cột `recipeId` khỏi `PlannedMeal`.

Máy dev không có docker nhưng `prisma migrate deploy/dev` chạy trực tiếp qua `DATABASE_URL` (host thật trong `.env`). Viết migration tay (SQL) cho bước data migration + dedupe để không mất dữ liệu.

### 2. Số món theo số người (tính ở server)

Tính hoàn toàn **ở server** rồi ghi rõ "cơ cấu mâm" vào prompt, để model local (30B) không phải tự suy số món.

Hàm `planMealStructure(mealType, familySize, override?)` trả về danh sách vai trò (`DishRole[]`) mong muốn cho một bữa.

**Bữa sáng:** luôn 1 món, vai trò `COM_BUN_PHO` (phở/bún/xôi/cháo/bánh mì...). Không áp bảng dưới.

**Trưa/tối** (cơm trắng ngầm định, KHÔNG tính là "món"):

| Số người | Số món | Cơ cấu (roles) |
|---|---|---|
| ≤ 2 | 2 | MON_MAN, CANH_SUP |
| 3–4 | 3 | MON_MAN, (MON_XAO \| RAU_LUOC), CANH_SUP |
| ≥ 5 | 4 | MON_MAN, MON_XAO, RAU_LUOC, CANH_SUP |

**Chỉnh tay:** form tạo thực đơn thêm ô "Số món mỗi bữa chính" — mặc định **Tự động** (theo bảng), hoặc chọn 1–5. Override **chỉ áp cho bữa chính (trưa/tối)**; **bữa sáng luôn 1 món** bất kể override. Khi người dùng đặt số N cho trưa/tối: luôn giữ MON_MAN + CANH_SUP làm nòng cốt, thêm/bớt MON_XAO/RAU_LUOC/TRANG_MIENG để đủ N (thứ tự ưu tiên thêm: MON_XAO → RAU_LUOC → TRANG_MIENG → MON_MAN thứ 2; nếu N=1 thì chỉ MON_MAN).

`servings` của mâm = số thành viên gia đình (từ `FamilyMember`), có thể để người dùng chỉnh ở form sau (ngoài phạm vi GĐ 1 nếu phức tạp — mặc định = số thành viên).

### 3. Prompt "chuyên gia" (dinh dưỡng + đầu bếp)

Nâng `buildMenuPrompt` trong `src/lib/ai/prompt.ts`:

- **Persona:** "Bạn vừa là chuyên gia dinh dưỡng, vừa là đầu bếp gia đình người Việt giàu kinh nghiệm."
- **Quy tắc cân bằng cả MÂM (mới):**
  - Cân đối nhóm chất trong toàn mâm: đủ đạm (món mặn), rau xanh (xào/luộc/canh), tinh bột (cơm ngầm định).
  - Đa dạng phương pháp chế biến trong một mâm — tránh 2 món cùng kiểu (không 2 món chiên/rán).
  - Tránh trùng nguyên liệu chính giữa các món (không cả mâm đều thịt heo).
  - Món canh phải "đưa cơm", hài hoà với món mặn.
  - Ưu tiên nguyên liệu theo mùa, tận dụng kho.
  - Gắn nhãn dinh dưỡng cho từng món.
- **Giữ nguyên** các ràng buộc cứng: tuyệt đối tránh dị ứng/kiêng; ưu tiên khẩu vị; không lặp món gần đây; ưu tiên catalog món Việt tham khảo.
- **Server truyền "cơ cấu mâm"** cho từng bữa (số món + vai trò cụ thể). AI phải trả **đúng số món và đúng vai trò** đã yêu cầu.

**Cấu trúc JSON mới AI phải trả:**
```json
{"meals":[{"date":"yyyy-mm-dd","mealType":"BREAKFAST|LUNCH|DINNER","dishes":[
  {"name":"string","dishRole":"MON_MAN|MON_XAO|CANH_SUP|RAU_LUOC|COM_BUN_PHO|MON_CUON|LAU|TRANG_MIENG|DO_CHUA",
   "servings":number,"cookMinutes":number,"steps":["string"],"nutritionLabels":["string"],
   "ingredients":[{"name":"string","quantity":number,"unit":"string"}]}
]}]}
```

### 4. Schema AI (zod) — `src/lib/ai/schema.ts`

- Thêm `aiDishSchema` = recipe cũ + `dishRole: z.enum([...DishRole])`.
- `aiMealSchema` đổi từ `recipe` → `dishes: z.array(aiDishSchema).min(1)`.
- `aiMenuSchema` giữ `meals: [...]`.
- `extractJson`/`parseMenuJson` giữ nguyên cơ chế, chỉ đổi schema.

### 5. Ngữ cảnh & luồng tạo

**`MenuContext` / `MenuSlot`** (`src/lib/ai/types.ts`): mỗi `MenuSlot` mang thêm cơ cấu mâm mong muốn:
```ts
interface MenuSlot {
  date: string;
  mealType: MealTypeStr;
  dishRoles: DishRoleStr[]; // cơ cấu mâm từ planMealStructure()
}
```
`buildMenuContext` (`src/lib/menu.ts`) nhận `familySize` + `override` và tính `dishRoles` cho từng slot qua `planMealStructure`.

**`GenerationJob`**: thêm `dishCount Int?` (null = tự động). `startGenerationAction` đọc từ form; `runJob` truyền vào `buildMenuContext`.

**`saveMenu`** (ghi-đè-khi-tạo-lại): trong transaction, với mỗi meal slot:
1. `deleteMany` các `PlannedMeal` cũ khớp `(familyId, date, mealType)` → cascade xoá `MealDish`.
2. Tạo `PlannedMeal` mới.
3. Với mỗi dish: upsert `Ingredient` (như hiện tại) → tạo `Recipe` + `RecipeIngredient` → tạo `MealDish(dishRole, position)` nối vào mâm.

Giữ `maxWait/timeout` đã nới (10s/30s) vì mâm nhiều món ⇒ nhiều lượt ghi hơn.

*Ghi chú "recipe mồ côi":* mỗi lần tạo lại sinh `Recipe` mới; recipe cũ vẫn nằm trong "kho công thức gia đình" (được `availableRecipeNames` tham chiếu). Chấp nhận ở GĐ 1; dọn rác để sau nếu cần.

### 6. Hiển thị dashboard

`src/app/(app)/dashboard/page.tsx`: mỗi thẻ bữa render **cả mâm**:
- Header: nhãn bữa + số người + tổng thời gian nấu ước tính (max hoặc tổng cookMinutes).
- Thân: danh sách món, mỗi món hiển thị **nhãn vai trò** (Món mặn/Canh/Xào/Rau...), tên món, nhãn dinh dưỡng, nguyên liệu, và `details` "Cách làm".
- Query đổi include từ `recipe` → `dishes: { include: { recipe: { include: { ingredients... } } } }`, sắp theo `position`.

`src/lib/enums.ts`: thêm `DISH_ROLES` (value + label tiếng Việt) và `DISH_ROLE_LABEL` để UI + prompt dùng chung.

### 7. Form tạo thực đơn

`NewMenuForm.tsx` + `startGenerationAction`: thêm control "Số món mỗi bữa chính" (Tự động | 1–5). Gửi kèm `dishCount`. Validate ở action.

---

## Ràng buộc & lưu ý kỹ thuật

- **Next.js 16.2.9 (breaking):** trước khi code phải đọc `node_modules/next/dist/docs/` theo AGENTS.md. `params`/`searchParams` async, `useActionState` từ `react`.
- **Đa provider AI:** thay đổi schema JSON áp cho cả Anthropic, OpenAI-compatible, Ollama — chỉ sửa ở `prompt.ts` + `schema.ts` (dùng chung), không sửa từng adapter.
- **Migration remote:** viết SQL tay cho data migration + dedupe; chạy qua `DATABASE_URL`. Test `next build` sau khi generate client.
- **Đa dạng model:** prompt phải chịu được model yếu — cơ cấu mâm tính sẵn ở server, không nhờ AI tự đếm.

## Tiêu chí hoàn thành (GĐ 1)

1. Tạo thực đơn cho một ngày (trưa+tối, gia đình N người) → mỗi bữa chính có đúng số món theo bảng, đúng vai trò; sáng 1 món.
2. Tạo lại cho cùng ngày → mâm cũ bị thay thế hoàn toàn (không nhân đôi).
3. Prompt thể hiện rõ tính cân bằng dinh dưỡng & đa dạng phương pháp.
4. Dashboard hiển thị mâm nhiều món có nhãn vai trò + cách làm từng món.
5. `next build` pass; migration áp thành công trên DB remote, không mất dữ liệu cũ.
6. Vẫn tôn trọng dị ứng/kiêng và không lặp món gần đây.

## Ngoài phạm vi GĐ 1

- Chỉnh sửa/đổi/chat từng món (GĐ 2).
- Xem lại lịch sử ngày đã qua, rating/learning (GĐ 3).
- Dọn recipe mồ côi; chỉnh `servings` per-mâm ở UI; kho/đi chợ.
