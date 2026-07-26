# Thiết kế: Xoá mâm cơm & Gợi ý tự nhập khi sinh thực đơn

Ngày: 2026-07-26
Trạng thái: đã brainstorm & chốt hướng.

Hai tính năng độc lập, gộp một đợt vì đều nhỏ và đều đụng luồng sinh/sửa mâm.

---

# A. Xoá mâm cơm

## Bối cảnh

Người dùng chỉnh được từng món (`quickEditAction`, `chatDishAction`,
`deleteDishAction`) nhưng **không xoá được cả mâm**. `deleteDishAction`
(`src/lib/actions/edit.ts:160`) còn chặn xoá món cuối cùng, nên mâm dở luôn kẹt
lại ít nhất một món. Sinh 7 ngày là 14 mâm — không có đường dọn.

Xoá `PlannedMeal` là cascade sạch: `MealDish` và `EditJob` đều
`onDelete: Cascade`. `PlannedMeal.mealPlanId` là `SetNull` ở chiều ngược nên
`MealPlan` không bị ảnh hưởng (có thể còn lại rỗng — vô hại).

## Lỗi có sẵn phát hiện khi khảo sát

`deleteDishAction` **không gọi `syncShopping`**. Mọi đường ghi khác đều gọi
(`cook.ts:94`, `pantry.ts:26`, `recook.ts:56`, `edit.ts:254`, `jobs.ts:238`).
Hệ quả: xoá một món xong, nguyên liệu của nó vẫn nằm trong danh sách đi chợ tới
lượt đồng bộ sau. Sửa luôn trong đợt này vì cùng một loại lỗi.

## Phạm vi (người dùng đã chốt)

- Xoá được ở **cả Dashboard lẫn Lịch sử**, kể cả mâm **đã nấu**.
- Có nút xoá **từng mâm** và nút xoá **cả ngày**. Không làm xoá cả đợt.

## Hai cái bẫy phải xử lý

### Mâm zombie

Đợt nhiều ngày giờ là job `PLAN` + N job `EXPAND_DAY` chạy lần lượt. Xoá mâm của
một ngày mà job-ngày đó **chưa chạy** thì lát sau nó sinh lại — mâm "sống dậy",
người dùng tưởng nút xoá hỏng.

Nên `deleteMealAction`/`deleteDayAction` phải **huỷ luôn các job `EXPAND_DAY`
đang `PENDING`** trỏ vào ngày đó (xoá dòng job). Chỉ nhắm `PENDING`: job đang
`RUNNING` mà xoá dòng thì worker nổ lúc cập nhật trạng thái.

### Xoá lúc đang sửa

`EditJob` đang `PENDING`/`RUNNING` cho mâm đó mà xoá mâm thì cascade xoá luôn
dòng job, worker sẽ nổ khi áp kết quả. Chặn trước: còn job sửa đang hoạt động
thì **từ chối xoá**, trả thông báo "Mâm đang được cập nhật, thử lại sau."

### Mâm đã nấu — nói thật, không chặn

`markCookedAction` đã **trừ kho** lúc bấm "Đã nấu". Xoá mâm **không hoàn lại
kho**, và cố hoàn lại còn tệ hơn (không biết đã ăn hết hay chưa). Không chặn,
nhưng hộp xác nhận phải nói thẳng câu đó.

## Thiết kế

File mới `src/lib/actions/meal.ts` (không nhét vào `edit.ts` — file đó lo việc
sửa bằng AI, xoá là việc khác):

```ts
export async function deleteMealAction(formData: FormData): Promise<void>;
export async function deleteDayAction(formData: FormData): Promise<void>;
```

Dùng `FormData` + `<form action={...}>` theo đúng lệ `markCookedAction`, để bấm
được cả khi JS chưa hydrate.

Trình tự mỗi hàm:

1. `requireFamily()` → lấy `familyId`
2. Xác minh mâm/ngày **thuộc gia đình này** (chống xoá chéo nhà)
3. Từ chối nếu còn `EditJob` `PENDING`/`RUNNING` cho mâm đó
4. Xoá `GenerationJob` `kind = EXPAND_DAY`, `status = PENDING`, đúng `date` đó
5. `prisma.plannedMeal.deleteMany({ where: { id / date, familyId } })`
6. `syncShopping(familyId)`
7. `revalidatePath("/dashboard")` **và** `revalidatePath("/history")`

Bước 4 và 5 nằm trong **một transaction**: nếu xoá mâm xong mà huỷ job hỏng thì
mâm zombie quay lại.

`deleteDayAction` nhận chuỗi `yyyy-mm-dd`, quy về `new Date(\`${d}T00:00:00\`)`
đúng cách `PlannedMeal.date` được lưu (midnight local, xem `saveMenu`).

## Giao diện

- **Dashboard** (`MealCard.tsx`): nút "Xoá mâm" trong hàng header, cạnh "Đã nấu".
  Hộp `confirm()` nêu tên bữa + ngày; nếu mâm đã nấu thì thêm câu "Kho đã trừ lúc
  bấm Đã nấu và sẽ không được hoàn lại."
- **Dashboard** (`page.tsx`): nút "Xoá cả ngày" ở header mỗi khối ngày.
- **Lịch sử** (`history/page.tsx`): nút "Xoá" cạnh nút "Nấu lại" của mỗi mâm.

---

# B. Gợi ý tự nhập khi sinh thực đơn

## Bối cảnh

Hồ sơ ăn uống (`EatingProfile.notes`) là sở thích **lâu dài**. Không có chỗ nào
nhập ý muốn **của riêng hôm nay** — "nay thèm đồ ngọt", "tuần này ăn gà".

## Thiết kế

Một cột `GenerationJob.userNote String?`, một ô text ở form, chảy vào prompt.

```
NewMenuForm (ô text, tối đa 300 ký tự)
  → startGenerationAction (cắt về 300, trim, rỗng -> null)
    → GenerationJob.userNote
      → buildMenuContext(..., userNote)
        → MenuContext.userNote
          → buildMenuPrompt   (đường một ngày + nở từng ngày)
          → buildWeekPlanPrompt (dựng khung cả đợt)
```

Job `EXPAND_DAY` **kế thừa `userNote` từ job `PLAN`** (copy cột lúc `createMany`),
nên cả đợt cùng một gợi ý.

## Điểm an toàn — gợi ý KHÔNG được thắng luật dị ứng

Đây là ràng buộc bắt buộc, không phải tuỳ chọn. Nhà có người dị ứng hải sản mà
người dùng gõ "nay thèm tôm" thì tôm **vẫn phải bị loại**.

Cách làm:

- Gợi ý đặt trong khối **"Ý muốn riêng cho lần này"** ở phần *user*, **không**
  đặt trong phần *system* nơi chứa luật an toàn.
- Thêm một câu cứng trong system prompt của cả hai hàm dựng prompt:
  *"Ý muốn riêng của người dùng chỉ được điều chỉnh trong phạm vi các luật an
  toàn ở trên. Nếu nó mâu thuẫn với dị ứng hoặc kiêng khem, luật an toàn THẮNG."*
- Cắt 300 ký tự ở **server**, không chỉ ở form: `maxLength` trên input là gợi ý
  giao diện, không phải chốt chặn.

## Giới hạn cố ý

Không parse, không suy diễn gì từ câu người dùng gõ — đưa nguyên văn vào prompt.
Cố phân tích "ngọt" thành tag rồi lọc catalog là tự chuốc lấy một bộ luật mới
phải bảo trì, trong khi model vốn hiểu câu tiếng Việt tự nhiên tốt hơn.

---

# Kiểm thử

Phần thuần duy nhất đáng test là việc cắt/chuẩn hoá gợi ý. Tách thành hàm nhỏ
trong `src/lib/actions/menu.ts` hoặc `src/lib/menu.ts` và test:

| Ca | Kỳ vọng |
|---|---|
| Chuỗi thường | giữ nguyên, đã trim |
| Chuỗi chỉ khoảng trắng | `null` |
| Chuỗi rỗng / thiếu hẳn | `null` |
| Chuỗi > 300 ký tự | cắt còn đúng 300 |

Các action xoá chạm DB nên **không** test bằng vitest, đúng lệ repo
(`shopping.ts`, `expand-plan.ts` cũng vậy).

# Ràng buộc kỹ thuật

- **Next.js 16.2.9 (breaking):** tra `node_modules/next/dist/docs/` trước khi sửa
  form/server action, theo `AGENTS.md`.
- Migration thêm một cột nullable → an toàn, không cần data migration.
- Xoá mâm phải revalidate **cả hai** trang; quên `/history` thì mâm đã xoá vẫn
  hiện ở đó tới lần điều hướng sau.

# Tiêu chí hoàn thành

1. Xoá được một mâm ở Dashboard và ở Lịch sử; danh sách đi chợ cập nhật theo.
2. Xoá cả ngày xoá đúng mọi bữa của ngày đó, không đụng ngày khác.
3. Xoá mâm của một ngày chưa sinh xong → job-ngày `PENDING` bị huỷ, mâm **không**
   sống dậy.
4. Mâm đang có `EditJob` hoạt động → từ chối xoá kèm thông báo rõ.
5. Xoá một món (`deleteDishAction`) cũng cập nhật danh sách đi chợ.
6. Gợi ý tự nhập xuất hiện trong prompt của cả đường một ngày lẫn đường nhiều ngày.
7. `yarn test`, `yarn lint`, `yarn build` sạch.

# Ngoài phạm vi

- Hoàn tác sau khi xoá.
- Xoá cả đợt theo `MealPlan`.
- Dọn `Recipe` mồ côi (đã ngoài phạm vi từ Giai đoạn 1).
- Hoàn kho khi xoá mâm đã nấu.
