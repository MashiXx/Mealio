# Thiết kế: Lịch sử thực đơn + Nấu lại (Giai đoạn 3)

Ngày: 2026-07-24
Trạng thái: đã brainstorm & chốt hướng. Spec Giai đoạn 3 (cuối lộ trình "Mâm cơm").

## Bối cảnh

Sau GĐ 1 + GĐ 2: mỗi bữa là `PlannedMeal` (mâm) chứa nhiều `MealDish`, ràng buộc `@@unique([familyId,date,mealType])` đảm bảo mỗi (ngày × bữa) chỉ một mâm mới nhất. Dashboard hiện chỉ hiển thị `date >= hôm nay` và cho sửa/chat từng món (GĐ 2). Các mâm ngày đã qua **vẫn nằm trong DB** nhưng không có nơi xem.

## Mục tiêu (phần còn lại của yêu cầu #1)

- Trang **`/history`** xem lại thực đơn các ngày đã qua (chỉ xem).
- **"Nấu lại":** copy một mâm cũ sang một ngày mình chọn; sau khi copy, mâm mới là mâm dashboard bình thường — **sửa/chat được như vừa gen xong** (yêu cầu bổ sung của người dùng).

## Quyết định khi brainstorm

- Trang `/history` **riêng** (không nhồi vào dashboard).
- Mâm quá khứ **chỉ xem** (read-only, không nút sửa/chat/xóa).
- **Có "Nấu lại"** — copy sang **cùng loại bữa** với mâm nguồn, ghi đè latest-wins ngày đích.
- Mâm nấu-lại là mâm bình thường → tự có đủ nút sửa/chat của GĐ 2.

**Không cần model mới / không migration.**

---

## 1. Tách `DishInfo` (DRY)

Phần hiển thị một món hiện đang lặp: read-only cần cho `/history`, và `MealCard` (client) đã có sẵn. Tách JSX hiển thị một món thành component thuần **`src/app/(app)/dashboard/DishInfo.tsx`** — **không có directive `"use client"`/`"use server"`** để dùng được ở cả server component (history) lẫn client component (MealCard).

```ts
type DishInfoData = {
  roleLabel: string;
  name: string;
  cookMinutes: number;
  nutritionLabels: string[];
  ingredients: string[]; // "name (qty unit)"
  steps: string[];
};
export function DishInfo({ dish }: { dish: DishInfoData }): JSX.Element;
```

Nội dung: nhãn vai trò + tên + `cookMinutes` + nhãn dinh dưỡng + "Nguyên liệu: …" + `<details>` Cách làm. **`MealCard` refactor** để render `<DishInfo dish={...}/>` rồi bọc thêm hàng nút/chat quanh nó (giữ nguyên hành vi GĐ 2). `/history` render `<DishInfo/>` **không** kèm nút.

## 2. Trang `/history`

`src/app/(app)/history/page.tsx` (server component):
- Query `plannedMeal` với `date < startOfToday`, `orderBy date desc`, `take 60`, include `dishes → recipe → ingredients`.
- Cursor phân trang: `searchParams.before` (yyyy-mm-dd). Nếu có, thêm `date: { lt: before }`. Nút "Xem thêm" link `/history?before=<ngày cũ nhất đang hiện>` khi số bản ghi = 60 (còn nữa).
- Nhóm theo ngày, mỗi ngày một `<section>` (giống dashboard nhưng **read-only**): tiêu đề ngày, các mâm; mỗi mâm hiện header (loại bữa · số người · số món) + danh sách `<DishInfo/>`, kèm **nút "Nấu lại"** (mục 3).
- Empty state khi chưa có lịch sử.
- `startOfToday` tính như dashboard (`setHours(0,0,0,0)`).

## 3. "Nấu lại" — `recookAction`

Server action `src/lib/actions/recook.ts` (`"use server"`):
```ts
export async function recookAction(formData: FormData): Promise<void>;
```
- Đọc `plannedMealId` + `date` (yyyy-mm-dd) từ form; validate định dạng ngày.
- Nạp mâm nguồn scope theo `familyId` (qua `requireFamily`), include `dishes` (id, recipeId, dishRole, position) + `mealType`, `servings`.
- Trong transaction:
  - Ghi đè latest-wins: `deleteMany` `PlannedMeal` khớp `(familyId, dateĐích, source.mealType)`.
  - Tạo `PlannedMeal` mới (cùng `mealType`, `servings`; `chatHistory` mặc định `[]`).
  - Copy từng `MealDish`: **trỏ lại đúng `recipeId` cũ** + giữ `dishRole`/`position`, `chatHistory` `[]`. (An toàn: sửa món về sau luôn sinh Recipe mới rồi trỏ lại, nên Recipe dùng chung không bị đột biến; xóa món chỉ xóa MealDish của mâm mới.)
- `revalidatePath("/dashboard")` rồi `redirect("/dashboard?date=<dateĐích>")`.

**UI Nấu lại:** trên mỗi mâm ở `/history`, một `<form action={recookAction}>` nhỏ với `<input type="hidden" name="plannedMealId">` + `<input type="date" name="date">` (mặc định hôm nay) + nút "Nấu lại". Không cần client JS.

## 4. Mâm nấu-lại sửa/chat như mới gen

Không cần code thêm: mâm đích là `PlannedMeal` ngày hiện tại/tương lai → xuất hiện trên dashboard và **tự có đủ nút nhanh + chat (GĐ 2)**. Vì recook chỉ mượn `recipeId` cũ và tạo `MealDish` mới:
- Sửa 1 món (DISH) → `applyEdit` tạo Recipe mới, cập nhật `MealDish.recipeId` của **mâm mới** → mâm lịch sử gốc không đổi.
- Sửa cả mâm (MEAL) → thay bộ `MealDish` của mâm mới → gốc không đổi.
- Xóa món → xóa `MealDish` của mâm mới → gốc không đổi.
- `chatHistory` mâm mới bắt đầu rỗng.

## 5. Điều hướng

Thêm link **"Lịch sử"** vào `nav` trong `src/app/(app)/layout.tsx` (giữa "Kho món" và "Thành viên", trỏ `/history`).

## 6. Ràng buộc kỹ thuật

- Next.js 16.2.9: `searchParams` async ở `/history`; đọc `node_modules/next/dist/docs/` trước khi viết route mới.
- Không schema change → không migration → không phụ thuộc deploy để chạy (ngoài GĐ1/GĐ2 đã cần migrate).
- `recookAction` redirect: gọi `redirect()` NGOÀI transaction (redirect ném lỗi để ngắt).

## 7. Tiêu chí hoàn thành (GĐ 3)

1. `/history` liệt kê các ngày đã qua (mới → cũ) với mâm read-only; không có nút sửa/chat/xóa.
2. "Xem thêm" tải trang cũ hơn (cursor `before`).
3. Bấm "Nấu lại" + chọn ngày → mâm copy sang ngày đó, redirect về dashboard hiển thị đúng.
4. Trên dashboard, mâm nấu-lại **sửa/chat được** như mâm mới gen; thao tác đó **không** làm đổi mâm lịch sử gốc.
5. Ghi đè đúng: nấu lại vào ngày đã có mâm cùng bữa thì thay thế (latest-wins).
6. Link "Lịch sử" xuất hiện trên nav.
7. `next build` + test PASS.

## 8. Ngoài phạm vi
Rating/đánh giá, thống kê khẩu vị, sửa trực tiếp mâm quá khứ, dọn recipe mồ côi, chọn loại bữa khác khi nấu lại.
