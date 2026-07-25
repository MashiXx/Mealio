# Lịch sử thực đơn + Nấu lại (Giai đoạn 3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trang `/history` xem lại thực đơn các ngày đã qua (chỉ xem) + nút "Nấu lại" copy một mâm cũ sang ngày mới (ghi đè latest-wins), mâm nấu-lại sửa/chat được như mâm mới gen.

**Architecture:** Không model/migration mới. Tách `DishInfo` (component thuần, dùng chung server+client) để DRY hiển thị món. `/history` là server component đọc `plannedMeal` quá khứ. `recookAction` copy mâm trong transaction, dùng lại `recipeId` cũ.

**Tech Stack:** Next.js 16.2.9, React 19, Prisma 6, vitest.

## Global Constraints

- Next.js **16.2.9**: `searchParams` async; đọc `node_modules/next/dist/docs/` trước khi viết route mới.
- **Không schema change → không migration.**
- `DishInfo` KHÔNG có directive để dùng được ở cả server (history) lẫn client (MealCard).
- `recookAction` gọi `redirect()` NGOÀI transaction.
- Text người dùng: tiếng Việt.
- Sau mỗi task: `yarn build` (+ `yarn test`) phải xanh.

---

### Task 1: Tách `DishInfo` + refactor `MealCard`

**Files:**
- Create: `src/app/(app)/dashboard/DishInfo.tsx`
- Modify: `src/app/(app)/dashboard/MealCard.tsx`

**Interfaces:**
- Produces: `DishInfo({ dish: DishInfoData })` với
  `DishInfoData = { roleLabel: string; name: string; cookMinutes: number; nutritionLabels: string[]; ingredients: string[]; steps: string[] }`.

- [ ] **Step 1: Tạo `DishInfo.tsx`** (không directive — dùng chung)
```tsx
export type DishInfoData = {
  roleLabel: string;
  name: string;
  cookMinutes: number;
  nutritionLabels: string[];
  ingredients: string[];
  steps: string[];
};

/** Hiển thị nội dung một món (read-only). Dùng chung cho dashboard (client) và
 *  history (server) — KHÔNG đặt "use client" để tương thích cả hai. */
export function DishInfo({ dish }: { dish: DishInfoData }) {
  return (
    <>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500">
          {dish.roleLabel}
        </span>
        <h4 className="font-semibold">{dish.name}</h4>
      </div>
      <p className="text-xs text-zinc-500">
        {dish.cookMinutes} phút
        {dish.nutritionLabels.length > 0 &&
          " · " + dish.nutritionLabels.join(", ")}
      </p>
      {dish.ingredients.length > 0 && (
        <p className="mt-2 text-sm text-zinc-600">
          <span className="font-medium">Nguyên liệu: </span>
          {dish.ingredients.join(", ")}
        </p>
      )}
      {dish.steps.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-medium text-emerald-700">
            Cách làm ({dish.steps.length} bước)
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zinc-700">
            {dish.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </details>
      )}
    </>
  );
}
```

- [ ] **Step 2: Dùng `DishInfo` trong `MealCard`**

Thêm import ở đầu `MealCard.tsx`:
```ts
import { DishInfo } from "./DishInfo";
```
Trong `MealCard`, thay khối hiển thị món (từ `<div className="mb-1 flex flex-wrap items-center gap-2">` chứa role + name + spinner, qua `<p>` cookMinutes, ingredients, và `<details>` Cách làm) — tức đoạn TRƯỚC `{/* Nút thao tác nhanh */}` — bằng:
```tsx
              <DishInfo
                dish={{
                  roleLabel: dish.roleLabel,
                  name: dish.name,
                  cookMinutes: dish.cookMinutes,
                  nutritionLabels: dish.nutritionLabels,
                  ingredients: dish.ingredients,
                  steps: dish.steps,
                }}
              />
              {busySet.has(dish.id) && (
                <p className="mt-1 flex items-center gap-1 text-xs text-amber-600">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600" />
                  đang cập nhật…
                </p>
              )}
```
(Giữ nguyên `className` container có `opacity-60` khi busy, hàng nút, và `ChatBox`. Bỏ span spinner inline cạnh tên vì đã có dòng "đang cập nhật…".)

- [ ] **Step 3: Build**

Run: `yarn build`
Expected: xanh; dashboard hiển thị y như trước (thêm dòng "đang cập nhật…" khi món đang sửa).

- [ ] **Step 4: Commit**
```bash
git add "src/app/(app)/dashboard/DishInfo.tsx" "src/app/(app)/dashboard/MealCard.tsx"
git commit -m "refactor(dashboard): tách DishInfo dùng chung"
```

---

### Task 2: `recookAction`

**Files:**
- Create: `src/lib/actions/recook.ts`

**Interfaces:**
- Consumes: `requireFamily`, `prisma`.
- Produces: `recookAction(formData: FormData): Promise<void>`.

- [ ] **Step 1: Tạo `src/lib/actions/recook.ts`**
```ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireFamily } from "@/lib/tenant";
import { prisma } from "@/lib/db";

/** Copy một mâm cũ sang ngày mình chọn (cùng loại bữa), ghi đè latest-wins. */
export async function recookAction(formData: FormData): Promise<void> {
  const { familyId } = await requireFamily();
  const plannedMealId = String(formData.get("plannedMealId") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!plannedMealId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

  const source = await prisma.plannedMeal.findFirst({
    where: { id: plannedMealId, familyId },
    include: { dishes: { orderBy: { position: "asc" } } },
  });
  if (!source) return;

  const targetDate = new Date(`${date}T00:00:00`);

  await prisma.$transaction(async (tx) => {
    // latest-wins: xóa mâm cũ của (ngày đích, cùng loại bữa).
    await tx.plannedMeal.deleteMany({
      where: { familyId, date: targetDate, mealType: source.mealType },
    });
    const planned = await tx.plannedMeal.create({
      data: {
        familyId,
        date: targetDate,
        mealType: source.mealType,
        servings: source.servings,
      },
    });
    // Copy MealDish: dùng lại recipeId cũ (an toàn — sửa sau này sinh Recipe mới).
    for (const d of source.dishes) {
      await tx.mealDish.create({
        data: {
          plannedMealId: planned.id,
          recipeId: d.recipeId,
          dishRole: d.dishRole,
          position: d.position,
        },
      });
    }
  });

  revalidatePath("/dashboard");
  redirect(`/dashboard?date=${date}`);
}
```

- [ ] **Step 2: Build**

Run: `yarn build`
Expected: xanh.

- [ ] **Step 3: Commit**
```bash
git add src/lib/actions/recook.ts
git commit -m "feat(history): recookAction copy mâm sang ngày mới"
```

---

### Task 3: Trang `/history` + link nav

**Files:**
- Create: `src/app/(app)/history/page.tsx`
- Modify: `src/app/(app)/layout.tsx` (link "Lịch sử")

**Interfaces:**
- Consumes: `DishInfo` (Task 1), `recookAction` (Task 2), `MEAL_TYPE_LABEL`/`DISH_ROLE_LABEL`.

- [ ] **Step 1: Tạo `src/app/(app)/history/page.tsx`**
```tsx
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireFamily } from "@/lib/tenant";
import { MEAL_TYPE_LABEL, DISH_ROLE_LABEL } from "@/lib/enums";
import { recookAction } from "@/lib/actions/recook";
import { DishInfo } from "../dashboard/DishInfo";

const MEAL_RANK: Record<string, number> = { BREAKFAST: 0, LUNCH: 1, DINNER: 2 };
const PAGE_SIZE = 60;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function formatDay(key: string): string {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}
function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string }>;
}) {
  const { familyId } = await requireFamily();
  const { before } = await searchParams;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const dateFilter: { lt: Date } = { lt: startOfToday };
  if (before && /^\d{4}-\d{2}-\d{2}$/.test(before)) {
    dateFilter.lt = new Date(`${before}T00:00:00`);
  }

  const meals = await prisma.plannedMeal.findMany({
    where: { familyId, date: dateFilter },
    orderBy: { date: "desc" },
    include: {
      dishes: {
        orderBy: { position: "asc" },
        include: {
          recipe: { include: { ingredients: { include: { ingredient: true } } } },
        },
      },
    },
    take: PAGE_SIZE,
  });

  // Nhóm theo ngày (giữ thứ tự mới -> cũ), sắp bữa sáng/trưa/tối trong ngày.
  const byDay = new Map<string, typeof meals>();
  for (const meal of meals) {
    const key = dayKey(meal.date);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(meal);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => MEAL_RANK[a.mealType] - MEAL_RANK[b.mealType]);
  }
  const days = [...byDay.keys()]; // đã desc theo thứ tự query
  const oldestKey = days.length ? days[days.length - 1] : null;
  const hasMore = meals.length === PAGE_SIZE;
  const today = todayStr();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Lịch sử thực đơn</h1>
          <p className="text-sm text-zinc-500">Các bữa đã qua — chỉ xem lại</p>
        </div>
        <Link
          href="/dashboard"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:border-zinc-400"
        >
          ← Bảng chính
        </Link>
      </div>

      {days.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center">
          <p className="text-zinc-500">Chưa có thực đơn nào đã qua.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {days.map((key) => (
            <section
              key={key}
              className="rounded-2xl border border-zinc-200 bg-white p-5"
            >
              <h2 className="mb-3 text-sm font-semibold text-zinc-500">
                {formatDay(key)}
              </h2>
              <div className="space-y-3">
                {byDay.get(key)!.map((meal) => {
                  const totalMinutes = meal.dishes.reduce(
                    (max, d) => Math.max(max, d.recipe.cookMinutes),
                    0,
                  );
                  return (
                    <article
                      key={meal.id}
                      className="rounded-xl border border-zinc-100 bg-zinc-50 p-4"
                    >
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            {MEAL_TYPE_LABEL[meal.mealType] ?? meal.mealType}
                          </span>
                          <span className="text-xs text-zinc-500">
                            {meal.servings} người · {meal.dishes.length} món
                            {totalMinutes > 0 && ` · ~${totalMinutes} phút`}
                          </span>
                        </div>
                        <form
                          action={recookAction}
                          className="flex items-center gap-1.5"
                        >
                          <input type="hidden" name="plannedMealId" value={meal.id} />
                          <input
                            type="date"
                            name="date"
                            defaultValue={today}
                            className="rounded border border-zinc-300 px-2 py-1 text-xs outline-none focus:border-emerald-500"
                          />
                          <button
                            type="submit"
                            className="rounded border border-emerald-300 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                          >
                            Nấu lại
                          </button>
                        </form>
                      </div>
                      <div className="space-y-3">
                        {meal.dishes.map((dish) => (
                          <div
                            key={dish.id}
                            className="rounded-lg border border-zinc-200 bg-white p-3"
                          >
                            <DishInfo
                              dish={{
                                roleLabel:
                                  DISH_ROLE_LABEL[dish.dishRole] ?? dish.dishRole,
                                name: dish.recipe.name,
                                cookMinutes: dish.recipe.cookMinutes,
                                nutritionLabels: dish.recipe.nutritionLabels,
                                ingredients: dish.recipe.ingredients.map(
                                  (ri) =>
                                    `${ri.ingredient.name} (${ri.quantity} ${ri.unit})`,
                                ),
                                steps: dish.recipe.steps,
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}

          {hasMore && oldestKey && (
            <div className="text-center">
              <Link
                href={`/history?before=${oldestKey}`}
                className="inline-block rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:border-zinc-400"
              >
                Xem thêm ngày cũ hơn
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Thêm link "Lịch sử" vào nav**

Trong `src/app/(app)/layout.tsx`, thêm sau link "Kho món":
```tsx
            <Link href="/history" className="text-zinc-600 hover:text-zinc-900">
              Lịch sử
            </Link>
```

- [ ] **Step 3: Build**

Run: `yarn build`
Expected: xanh; route `/history` xuất hiện trong danh sách.

- [ ] **Step 4: Commit**
```bash
git add "src/app/(app)/history/page.tsx" "src/app/(app)/layout.tsx"
git commit -m "feat(history): trang /history + nút Nấu lại + link nav"
```

---

### Task 4: Kiểm thử tổng thể

- [ ] **Step 1: Test + build sạch**

Run: `yarn test && yarn build`
Expected: mọi test PASS; build xanh; có route `/history`.

- [ ] **Step 2: Đối chiếu tiêu chí GĐ 3** (runtime cần DB đã migrate GĐ1/GĐ2 + có dữ liệu quá khứ)

1. `/history` liệt kê ngày đã qua (mới → cũ), read-only.
2. "Xem thêm" tải trang cũ hơn.
3. "Nấu lại" + chọn ngày → mâm copy sang, redirect dashboard hiển thị đúng.
4. Mâm nấu-lại sửa/chat được; không đổi mâm lịch sử gốc.
5. Nấu lại vào ngày đã có mâm cùng bữa → thay thế (latest-wins).
6. Link "Lịch sử" trên nav.

- [ ] **Step 3: Ghi chú kết quả** (mục nào chưa kiểm được vì chưa deploy/chưa có dữ liệu quá khứ).

---

## Self-Review (đã chạy)

**Spec coverage:**
- `/history` read-only + phân trang → Task 3. ✓
- `DishInfo` DRY → Task 1. ✓
- "Nấu lại" copy + latest-wins + redirect → Task 2 + Task 3 (form). ✓
- Mâm nấu-lại sửa/chat được (không code thêm) → tự thoả nhờ GĐ 2. ✓
- Nav link → Task 3. ✓

**Placeholder scan:** không có TBD/TODO.

**Type consistency:** `DishInfoData` khớp props `DishInfo` ở cả `MealCard` và `/history`; `recookAction(formData)` khớp `<form action={recookAction}>`; cursor `before` khớp query `date.lt`.

## Ngoài phạm vi (đã đóng lộ trình)
Rating/đánh giá, thống kê khẩu vị, sửa mâm quá khứ, dọn recipe mồ côi.
