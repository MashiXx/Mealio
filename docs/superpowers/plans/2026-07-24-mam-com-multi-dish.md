# Mâm cơm nhiều món (Giai đoạn 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển Mealio từ "1 bữa = 1 món" sang "1 bữa = một mâm nhiều món", số món theo số người, prompt chất chuyên gia dinh dưỡng/đầu bếp, và tạo lại cho một ngày thì ghi đè mâm cũ.

**Architecture:** `PlannedMeal` trở thành "mâm" chứa nhiều `MealDish` (bảng mới, mỗi dòng nối 1 `Recipe` + `dishRole`). Số món & cơ cấu vai trò tính thuần ở server (`planMealStructure`) rồi ghi vào prompt để model AI (kể cả model local yếu) không phải tự suy. Ràng buộc `@@unique(familyId,date,mealType)` + xoá-tạo trong transaction đảm bảo "latest-wins".

**Tech Stack:** Next.js 16.2.9 (App Router, Turbopack), React 19, Prisma 6 + Postgres, zod 4, TypeScript 5. Test: vitest (thêm mới, chỉ cho logic thuần).

## Global Constraints

- Next.js **16.2.9** có breaking changes: `params`/`searchParams`/`cookies()`/`headers()` async; `useActionState` từ `react`; middleware là `proxy.ts`. **Bắt buộc** đọc `node_modules/next/dist/docs/` liên quan trước khi viết code UI/route (theo AGENTS.md).
- Đa provider AI (Anthropic, OpenAI-compatible, Ollama): mọi thay đổi định dạng JSON/prompt CHỈ sửa ở `src/lib/ai/prompt.ts` + `src/lib/ai/schema.ts` (dùng chung), KHÔNG sửa từng adapter.
- DB là **Postgres remote** (host thật trong `.env`, không localhost). Máy dev **không có docker**. Migration áp bằng `prisma migrate deploy` (không dùng `migrate dev` để tránh shadow DB / reset). **Không được mất dữ liệu `PlannedMeal` cũ.**
- Enum `DishRole` đã tồn tại trong schema, tái sử dụng — không tạo enum mới.
- Mọi text người dùng thấy bằng tiếng Việt.
- Sau mỗi task backend đụng Prisma: chạy `npx prisma generate` để client khớp; đảm bảo `npx tsc --noEmit` (hoặc `yarn build`) xanh.

---

### Task 1: Logic số món `planMealStructure` + hằng số vai trò + vitest

**Files:**
- Create: `src/lib/meal-structure.ts`
- Create: `src/lib/meal-structure.test.ts`
- Create: `vitest.config.ts`
- Modify: `src/lib/enums.ts` (thêm `DISH_ROLES`, `DISH_ROLE_LABEL`)
- Modify: `src/lib/ai/types.ts` (thêm `DishRoleStr`)
- Modify: `package.json` (thêm script `test`, devDep `vitest`)

**Interfaces:**
- Produces:
  - `type DishRoleStr = "MON_MAN" | "MON_XAO" | "CANH_SUP" | "RAU_LUOC" | "LAU" | "COM_BUN_PHO" | "MON_CUON" | "TRANG_MIENG" | "DO_CHUA"` (trong `src/lib/ai/types.ts`)
  - `planMealStructure(mealType: MealTypeStr, familySize: number, override?: number | null): DishRoleStr[]` (trong `src/lib/meal-structure.ts`)
  - `DISH_ROLES: readonly {value: DishRoleStr; label: string}[]` và `DISH_ROLE_LABEL: Record<string,string>` (trong `src/lib/enums.ts`)

- [ ] **Step 1: Cài vitest**

Run:
```bash
yarn add -D vitest
```
Expected: `vitest` xuất hiện trong `devDependencies` của `package.json`, cập nhật `yarn.lock`.

- [ ] **Step 2: Thêm script test + tạo vitest config**

Trong `package.json`, thêm vào `"scripts"`:
```json
"test": "vitest run"
```

Tạo `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Thêm `DishRoleStr` vào `src/lib/ai/types.ts`**

Ngay dưới dòng `export type MealTypeStr = ...`, thêm:
```ts
export type DishRoleStr =
  | "MON_MAN"
  | "MON_XAO"
  | "CANH_SUP"
  | "RAU_LUOC"
  | "LAU"
  | "COM_BUN_PHO"
  | "MON_CUON"
  | "TRANG_MIENG"
  | "DO_CHUA";
```

- [ ] **Step 4: Thêm hằng số vai trò vào `src/lib/enums.ts`**

Ở cuối file `src/lib/enums.ts`, thêm:
```ts
export const DISH_ROLES = [
  { value: "MON_MAN", label: "Món mặn" },
  { value: "MON_XAO", label: "Món xào" },
  { value: "RAU_LUOC", label: "Rau luộc/Nộm" },
  { value: "CANH_SUP", label: "Canh/Súp" },
  { value: "COM_BUN_PHO", label: "Cơm/Bún/Phở" },
  { value: "MON_CUON", label: "Món cuốn" },
  { value: "LAU", label: "Lẩu" },
  { value: "TRANG_MIENG", label: "Tráng miệng" },
  { value: "DO_CHUA", label: "Đồ chua ăn kèm" },
] as const;

export const DISH_ROLE_LABEL: Record<string, string> = Object.fromEntries(
  DISH_ROLES.map((r) => [r.value, r.label]),
);
```

- [ ] **Step 5: Viết test thất bại cho `planMealStructure`**

Tạo `src/lib/meal-structure.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { planMealStructure } from "./meal-structure";

describe("planMealStructure", () => {
  it("bữa sáng luôn 1 món COM_BUN_PHO, bỏ qua override", () => {
    expect(planMealStructure("BREAKFAST", 4)).toEqual(["COM_BUN_PHO"]);
    expect(planMealStructure("BREAKFAST", 4, 3)).toEqual(["COM_BUN_PHO"]);
  });

  it("<=2 người: 2 món (mặn + canh)", () => {
    expect(planMealStructure("LUNCH", 2)).toEqual(["MON_MAN", "CANH_SUP"]);
    expect(planMealStructure("DINNER", 1)).toEqual(["MON_MAN", "CANH_SUP"]);
  });

  it("3-4 người: 3 món, sắp theo thứ tự mâm", () => {
    expect(planMealStructure("LUNCH", 4)).toEqual([
      "MON_MAN",
      "MON_XAO",
      "CANH_SUP",
    ]);
  });

  it(">=5 người: 4 món", () => {
    expect(planMealStructure("DINNER", 6)).toEqual([
      "MON_MAN",
      "MON_XAO",
      "RAU_LUOC",
      "CANH_SUP",
    ]);
  });

  it("override chỉ áp cho bữa chính; N=1 chỉ món mặn", () => {
    expect(planMealStructure("LUNCH", 4, 1)).toEqual(["MON_MAN"]);
  });

  it("override N=5 thêm tráng miệng, sắp đúng thứ tự", () => {
    expect(planMealStructure("LUNCH", 2, 5)).toEqual([
      "MON_MAN",
      "MON_XAO",
      "RAU_LUOC",
      "CANH_SUP",
      "TRANG_MIENG",
    ]);
  });

  it("override ngoài 1..5 hoặc số người lỗi -> quay về auto", () => {
    expect(planMealStructure("LUNCH", 4, 99)).toEqual([
      "MON_MAN",
      "MON_XAO",
      "CANH_SUP",
    ]);
    expect(planMealStructure("LUNCH", 0)).toEqual(["MON_MAN", "CANH_SUP"]);
  });
});
```

- [ ] **Step 6: Chạy test để xác nhận FAIL**

Run: `yarn test src/lib/meal-structure.test.ts`
Expected: FAIL — không import được `planMealStructure` (file chưa tồn tại).

- [ ] **Step 7: Cài đặt `planMealStructure`**

Tạo `src/lib/meal-structure.ts`:
```ts
import type { MealTypeStr, DishRoleStr } from "./ai/types";

// Cơ cấu mâm tính THUẦN ở server để prompt ghi rõ số món + vai trò, không nhờ
// model AI tự đếm. Cơm trắng ngầm định, KHÔNG tính là "món".

// Thứ tự hiển thị chuẩn của một mâm cơm Việt.
const ROLE_RANK: Record<DishRoleStr, number> = {
  MON_MAN: 0,
  MON_XAO: 1,
  RAU_LUOC: 2,
  CANH_SUP: 3,
  TRANG_MIENG: 4,
  DO_CHUA: 5,
  MON_CUON: 6,
  COM_BUN_PHO: 7,
  LAU: 8,
};

/** Số món tự động cho bữa chính theo số người. */
function autoCount(familySize: number): number {
  if (!Number.isFinite(familySize) || familySize < 1) return 2;
  if (familySize <= 2) return 2;
  if (familySize <= 4) return 3;
  return 4;
}

/** Vai trò cho bữa chính (trưa/tối) khi cần `count` món. */
function mainMealRoles(count: number): DishRoleStr[] {
  const n = Math.max(1, Math.min(5, count));
  if (n <= 1) return ["MON_MAN"];
  const roles: DishRoleStr[] = ["MON_MAN", "CANH_SUP"];
  const extras: DishRoleStr[] = ["MON_XAO", "RAU_LUOC", "TRANG_MIENG", "MON_MAN"];
  let i = 0;
  while (roles.length < n && i < extras.length) roles.push(extras[i++]);
  return roles.slice(0, n).sort((a, b) => ROLE_RANK[a] - ROLE_RANK[b]);
}

/**
 * Cơ cấu mâm cho một bữa.
 * - BREAKFAST: luôn 1 món COM_BUN_PHO (bỏ qua override).
 * - LUNCH/DINNER: số món = override (1..5) nếu hợp lệ, ngược lại tự động theo số người.
 */
export function planMealStructure(
  mealType: MealTypeStr,
  familySize: number,
  override?: number | null,
): DishRoleStr[] {
  if (mealType === "BREAKFAST") return ["COM_BUN_PHO"];
  const valid =
    typeof override === "number" &&
    Number.isInteger(override) &&
    override >= 1 &&
    override <= 5;
  const count = valid ? (override as number) : autoCount(familySize);
  return mainMealRoles(count);
}
```

- [ ] **Step 8: Chạy test để xác nhận PASS**

Run: `yarn test src/lib/meal-structure.test.ts`
Expected: PASS toàn bộ.

- [ ] **Step 9: Commit**

```bash
git add package.json yarn.lock vitest.config.ts src/lib/meal-structure.ts src/lib/meal-structure.test.ts src/lib/enums.ts src/lib/ai/types.ts
git commit -m "feat(meal): planMealStructure + hằng số vai trò món + vitest"
```

---

### Task 2: Mô hình dữ liệu MealDish + migration (giữ app chạy 1 món)

Mục tiêu: đổi schema sang mâm/`MealDish`, áp migration bảo toàn dữ liệu, và cập nhật code tối thiểu để app vẫn chạy đúng như cũ (mỗi bữa hiển thị 1 món qua `MealDish`). Chưa đụng prompt/AI schema.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260724120000_mam_com_multi_dish/migration.sql`
- Modify: `src/lib/menu.ts` (`saveMenu`: tạo `PlannedMeal` + 1 `MealDish` từ `menu.meals[].recipe`, xoá-tạo theo ngày/bữa)
- Modify: `src/app/(app)/dashboard/page.tsx` (đọc `dishes[].recipe` thay vì `recipe`)

**Interfaces:**
- Produces:
  - Model `MealDish { id, plannedMealId, recipeId, dishRole, position }`.
  - `PlannedMeal` không còn `recipeId`; có quan hệ `dishes MealDish[]`; có `@@unique([familyId, date, mealType])`.
  - `GenerationJob.dishCount Int?`.

- [ ] **Step 1: Sửa `prisma/schema.prisma`**

Trong `model Recipe`, thay dòng:
```prisma
  plannedMeals PlannedMeal[]
```
bằng:
```prisma
  mealDishes MealDish[]
```

Thay toàn bộ `model PlannedMeal { ... }` bằng:
```prisma
model PlannedMeal {
  id       String @id @default(cuid())
  familyId String
  family   Family @relation(fields: [familyId], references: [id], onDelete: Cascade)

  mealPlanId String?
  mealPlan   MealPlan? @relation(fields: [mealPlanId], references: [id], onDelete: SetNull)

  date     DateTime
  mealType MealType
  servings Int      @default(4) // số người ăn bữa này

  dishes  MealDish[]
  history MealHistory[]

  @@unique([familyId, date, mealType])
  @@index([familyId, date])
}
```

Thêm model mới (đặt ngay dưới `PlannedMeal`, trước `enum MealType`):
```prisma
model MealDish {
  id            String      @id @default(cuid())
  plannedMealId String
  plannedMeal   PlannedMeal @relation(fields: [plannedMealId], references: [id], onDelete: Cascade)

  recipeId String
  recipe   Recipe @relation(fields: [recipeId], references: [id], onDelete: Cascade)

  dishRole DishRole @default(MON_MAN)
  position Int      @default(0)

  @@index([plannedMealId])
}
```

Trong `model GenerationJob`, thêm dưới `error String?`:
```prisma
  dishCount Int? // số món/bữa chính người dùng chọn; null = tự động
```

- [ ] **Step 2: Viết migration SQL bảo toàn dữ liệu**

Tạo `prisma/migrations/20260724120000_mam_com_multi_dish/migration.sql`:
```sql
-- 1) Khử trùng PlannedMeal theo (familyId, date, mealType): giữ bản mới nhất.
DELETE FROM "PlannedMeal" p
USING "PlannedMeal" q
WHERE p."familyId" = q."familyId"
  AND p."date" = q."date"
  AND p."mealType" = q."mealType"
  AND p."id" <> q."id"
  AND (p."createdAt" < q."createdAt"
       OR (p."createdAt" = q."createdAt" AND p."id" < q."id"));

-- 2) Bảng MealDish.
CREATE TABLE "MealDish" (
    "id" TEXT NOT NULL,
    "plannedMealId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "dishRole" "DishRole" NOT NULL DEFAULT 'MON_MAN',
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "MealDish_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MealDish_plannedMealId_idx" ON "MealDish"("plannedMealId");

-- 3) Chuyển mỗi PlannedMeal cũ thành 1 MealDish (id suy từ id gốc -> không trùng).
INSERT INTO "MealDish" ("id", "plannedMealId", "recipeId", "dishRole", "position")
SELECT 'mdmig_' || "id", "id", "recipeId", 'MON_MAN', 0
FROM "PlannedMeal";

-- 4) Khoá ngoại + ràng buộc duy nhất.
ALTER TABLE "MealDish"
  ADD CONSTRAINT "MealDish_plannedMealId_fkey"
  FOREIGN KEY ("plannedMealId") REFERENCES "PlannedMeal"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MealDish"
  ADD CONSTRAINT "MealDish_recipeId_fkey"
  FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "PlannedMeal_familyId_date_mealType_key"
  ON "PlannedMeal"("familyId", "date", "mealType");

-- 5) Bỏ cột recipeId cũ khỏi PlannedMeal.
ALTER TABLE "PlannedMeal" DROP COLUMN "recipeId";

-- 6) Thêm cột dishCount cho GenerationJob.
ALTER TABLE "GenerationJob" ADD COLUMN "dishCount" INTEGER;
```

- [ ] **Step 3: Generate client + kiểm tra schema hợp lệ**

Run:
```bash
npx prisma validate && npx prisma generate
```
Expected: "The schema is valid" + client sinh lại thành công. (KHÔNG áp migration lên DB ở bước này.)

- [ ] **Step 4: Cập nhật `saveMenu` để ghi qua MealDish (vẫn 1 món)**

Trong `src/lib/menu.ts`, thay vòng lặp trong `saveMenu` — phần từ `const recipe = await tx.recipe.create(...)` tới hết `plannedIds.push(planned.id);` — bằng: xoá mâm cũ theo (familyId, date, mealType), tạo `PlannedMeal`, rồi tạo `Recipe` + `MealDish`:
```ts
      const mealDate = new Date(`${meal.date}T00:00:00`);

      // latest-wins: xoá mâm cũ của đúng (ngày, bữa) trước khi tạo mới.
      await tx.plannedMeal.deleteMany({
        where: { familyId, date: mealDate, mealType: meal.mealType },
      });

      const planned = await tx.plannedMeal.create({
        data: {
          familyId,
          date: mealDate,
          mealType: meal.mealType,
          servings: r.servings,
        },
      });

      const recipe = await tx.recipe.create({
        data: {
          familyId,
          name: r.name,
          source: "AI",
          servings: r.servings,
          cookMinutes: r.cookMinutes,
          steps: r.steps,
          nutritionLabels: r.nutritionLabels,
          ingredients: { create: recipeIngredients },
        },
      });

      await tx.mealDish.create({
        data: {
          plannedMealId: planned.id,
          recipeId: recipe.id,
          dishRole: "MON_MAN",
          position: 0,
        },
      });

      plannedIds.push(planned.id);
```
(Phần upsert `Ingredient` ở trên giữ nguyên. `meal.recipe` vẫn là `r` như hiện tại — Task 3 mới đổi sang nhiều dish.)

- [ ] **Step 5: Cập nhật dashboard đọc qua `dishes`**

Trong `src/app/(app)/dashboard/page.tsx`, đổi include của `plannedMeal.findMany`:
```ts
      include: {
        dishes: {
          orderBy: { position: "asc" },
          include: {
            recipe: { include: { ingredients: { include: { ingredient: true } } } },
          },
        },
      },
```
Và trong phần render `<article>` cho mỗi `meal`, thay các chỗ dùng `meal.recipe` bằng món đầu tiên tạm thời để build xanh (Task 5 sẽ render đầy đủ mâm):
```tsx
                {byDay.get(key)!.map((meal) => {
                  const dish = meal.dishes[0];
                  if (!dish) return null;
                  const recipe = dish.recipe;
                  return (
                  <article
                    key={meal.id}
                    className="rounded-xl border border-zinc-100 bg-zinc-50 p-4"
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        {MEAL_TYPE_LABEL[meal.mealType] ?? meal.mealType}
                      </span>
                      <h3 className="font-semibold">{recipe.name}</h3>
                    </div>
                    <p className="text-xs text-zinc-500">
                      {meal.servings} phần · {recipe.cookMinutes} phút
                      {recipe.nutritionLabels.length > 0 &&
                        " · " + recipe.nutritionLabels.join(", ")}
                    </p>
                    {recipe.ingredients.length > 0 && (
                      <p className="mt-2 text-sm text-zinc-600">
                        <span className="font-medium">Nguyên liệu: </span>
                        {recipe.ingredients
                          .map(
                            (ri) =>
                              `${ri.ingredient.name} (${ri.quantity} ${ri.unit})`,
                          )
                          .join(", ")}
                      </p>
                    )}
                    {recipe.steps.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-sm font-medium text-emerald-700">
                          Cách làm ({recipe.steps.length} bước)
                        </summary>
                        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zinc-700">
                          {recipe.steps.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ol>
                      </details>
                    )}
                  </article>
                  );
                })}
```

- [ ] **Step 6: Build để xác nhận TS xanh**

Run: `yarn build`
Expected: build thành công (dùng client Prisma mới). Nếu lỗi type ở nơi khác còn tham chiếu `PlannedMeal.recipe`/`recipeId`, sửa cho khớp `dishes[].recipe`.

- [ ] **Step 7: CHECKPOINT — xác nhận trước khi áp migration lên DB remote**

⚠️ Thao tác khó đảo ngược trên Postgres remote (xoá cột, xoá dòng trùng). **Dừng và xin xác nhận người dùng** trước khi chạy. Khi được đồng ý:
```bash
npx prisma migrate deploy
```
Expected: "Applying migration `20260724120000_mam_com_multi_dish`" + "All migrations have been successfully applied."

Kiểm tra nhanh (không bắt buộc): tạo thực đơn thử 1 ngày → dashboard hiển thị 1 món như cũ, không nhân đôi khi tạo lại.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/menu.ts "src/app/(app)/dashboard/page.tsx"
git commit -m "feat(db): PlannedMeal -> mâm + MealDish, migration bảo toàn dữ liệu"
```

---

### Task 3: Sinh mâm nhiều món (AI schema + prompt chuyên gia + context/lưu)

Sau Task 2 đường ống MealDish đã có; task này khiến AI thật sự trả nhiều món theo cơ cấu server tính, và `saveMenu` lưu tất cả.

**Files:**
- Modify: `src/lib/ai/types.ts` (`MenuSlot` thêm `dishRoles`; `MenuContext.slots` dùng nó)
- Modify: `src/lib/ai/schema.ts` (`aiDishSchema`, `aiMealSchema.dishes`)
- Create: `src/lib/ai/schema.test.ts`
- Modify: `src/lib/ai/prompt.ts` (persona + cơ cấu mâm + JSON dishes)
- Modify: `src/lib/menu.ts` (`buildMenuContext` tính `dishRoles`; `saveMenu` lặp `meal.dishes`)
- Modify: `src/lib/jobs.ts` (slots không cần dishRoles; buildMenuContext tự tính)

**Interfaces:**
- Consumes: `planMealStructure` (Task 1), `MealDish` (Task 2).
- Produces:
  - `aiMealSchema` = `{ date, mealType, dishes: aiDishSchema[] }`, `aiDishSchema` = recipe cũ + `dishRole`.
  - `MenuSlot = { date, mealType, dishRoles: DishRoleStr[] }`.
  - `buildMenuContext(familyId, rawSlots: {date: string; mealType: MealTypeStr}[], dishCount?: number | null)`.

- [ ] **Step 1: Viết test thất bại cho schema nhiều món**

Tạo `src/lib/ai/schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseMenuJson } from "./schema";

describe("parseMenuJson (nhiều món)", () => {
  it("parse mâm 2 món có dishRole", () => {
    const json = JSON.stringify({
      meals: [
        {
          date: "2026-07-25",
          mealType: "DINNER",
          dishes: [
            { name: "Thịt kho", dishRole: "MON_MAN", servings: 4, cookMinutes: 40, steps: ["kho"], nutritionLabels: ["giàu đạm"], ingredients: [{ name: "thịt", quantity: 300, unit: "g" }] },
            { name: "Canh cải", dishRole: "CANH_SUP", servings: 4, cookMinutes: 15, steps: ["nấu"], nutritionLabels: ["nhiều rau"], ingredients: [{ name: "cải", quantity: 1, unit: "bó" }] },
          ],
        },
      ],
    });
    const menu = parseMenuJson(json);
    expect(menu.meals[0].dishes).toHaveLength(2);
    expect(menu.meals[0].dishes[1].dishRole).toBe("CANH_SUP");
  });

  it("từ chối dish thiếu dishRole", () => {
    const json = JSON.stringify({
      meals: [{ date: "2026-07-25", mealType: "LUNCH", dishes: [{ name: "X", servings: 2, cookMinutes: 10, steps: [], nutritionLabels: [], ingredients: [] }] }],
    });
    expect(() => parseMenuJson(json)).toThrow();
  });
});
```

- [ ] **Step 2: Chạy test — xác nhận FAIL**

Run: `yarn test src/lib/ai/schema.test.ts`
Expected: FAIL (schema hiện dùng `recipe`, chưa có `dishes`/`dishRole`).

- [ ] **Step 3: Đổi `src/lib/ai/schema.ts`**

Thay `aiRecipeSchema` + `aiMealSchema` bằng:
```ts
export const aiDishSchema = z.object({
  name: z.string().min(1),
  dishRole: z.enum([
    "MON_MAN",
    "MON_XAO",
    "CANH_SUP",
    "RAU_LUOC",
    "LAU",
    "COM_BUN_PHO",
    "MON_CUON",
    "TRANG_MIENG",
    "DO_CHUA",
  ]),
  servings: z.number().int().positive().default(4),
  cookMinutes: z.number().int().positive().default(30),
  steps: z.array(z.string()).default([]),
  nutritionLabels: z.array(z.string()).default([]),
  ingredients: z.array(aiIngredientSchema).default([]),
});

export const aiMealSchema = z.object({
  date: z.string(),
  mealType: z.enum(["BREAKFAST", "LUNCH", "DINNER"]),
  dishes: z.array(aiDishSchema).min(1),
});
```
Cập nhật export type:
```ts
export type AiDish = z.infer<typeof aiDishSchema>;
```
Xoá `aiRecipeSchema`/`AiRecipe` (không còn dùng). Giữ `aiMenuSchema`, `AiMenu`, `AiMeal`, `aiIngredientSchema`, `extractJson`, `parseMenuJson` như cũ.

- [ ] **Step 4: Chạy test — xác nhận PASS**

Run: `yarn test src/lib/ai/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: `MenuSlot` mang `dishRoles`**

Trong `src/lib/ai/types.ts`, sửa `MenuSlot`:
```ts
export interface MenuSlot {
  date: string; // yyyy-mm-dd
  mealType: MealTypeStr;
  dishRoles: DishRoleStr[]; // cơ cấu mâm do server tính
}
```

- [ ] **Step 6: `buildMenuContext` tính cơ cấu mâm + `saveMenu` lặp dishes**

Trong `src/lib/menu.ts`:

(a) Thêm import:
```ts
import { planMealStructure } from "./meal-structure";
import type { MealTypeStr, MenuContext, MenuSlot, MenuMember, MenuProfile } from "./ai/types";
```

(b) Đổi chữ ký `buildMenuContext` nhận slot thô + `dishCount`, và tự tính `dishRoles`:
```ts
export async function buildMenuContext(
  familyId: string,
  rawSlots: { date: string; mealType: MealTypeStr }[],
  dishCount?: number | null,
): Promise<MenuContext> {
```
Ở cuối, thay `slots,` trong object trả về bằng:
```ts
    slots: rawSlots.map((s) => ({
      ...s,
      dishRoles: planMealStructure(s.mealType, members.length, dishCount),
    })),
```

(c) `saveMenu`: lặp qua `meal.dishes` thay vì 1 `recipe`. Thay khối trong `for (const meal of menu.meals)` bằng:
```ts
    for (const meal of menu.meals) {
      const mealDate = new Date(`${meal.date}T00:00:00`);
      await tx.plannedMeal.deleteMany({
        where: { familyId, date: mealDate, mealType: meal.mealType },
      });

      const planned = await tx.plannedMeal.create({
        data: {
          familyId,
          date: mealDate,
          mealType: meal.mealType,
          servings: meal.dishes[0]?.servings ?? 4,
        },
      });

      let position = 0;
      for (const dish of meal.dishes) {
        const recipeIngredients: {
          ingredientId: string;
          quantity: number;
          unit: string;
        }[] = [];

        for (const ing of dish.ingredients) {
          const normalized = normalizeIngredient(ing.name);
          if (!normalized) continue;
          const ingredient = await tx.ingredient.upsert({
            where: { familyId_normalized: { familyId, normalized } },
            create: { familyId, name: ing.name.trim(), normalized, defaultUnit: ing.unit },
            update: {},
          });
          recipeIngredients.push({
            ingredientId: ingredient.id,
            quantity: ing.quantity,
            unit: ing.unit,
          });
        }

        const recipe = await tx.recipe.create({
          data: {
            familyId,
            name: dish.name,
            source: "AI",
            servings: dish.servings,
            cookMinutes: dish.cookMinutes,
            steps: dish.steps,
            nutritionLabels: dish.nutritionLabels,
            ingredients: { create: recipeIngredients },
          },
        });

        await tx.mealDish.create({
          data: {
            plannedMealId: planned.id,
            recipeId: recipe.id,
            dishRole: dish.dishRole,
            position: position++,
          },
        });
      }

      plannedIds.push(planned.id);
    }
```

- [ ] **Step 7: `jobs.ts` truyền slot thô**

Trong `src/lib/jobs.ts`, trong `runJob`, thay:
```ts
    const slots: MenuSlot[] = job.mealTypes.map((mealType) => ({
      date: ymd(job.date),
      mealType: mealType as MealTypeStr,
    }));

    const provider = await getAIProvider(job.familyId);
    const ctx = await buildMenuContext(job.familyId, slots);
```
bằng:
```ts
    const rawSlots = job.mealTypes.map((mealType) => ({
      date: ymd(job.date),
      mealType: mealType as MealTypeStr,
    }));

    const provider = await getAIProvider(job.familyId);
    const ctx = await buildMenuContext(job.familyId, rawSlots, job.dishCount);
```
Bỏ import `MenuSlot` nếu không còn dùng (giữ `MealTypeStr`).

- [ ] **Step 8: Nâng prompt lên "chuyên gia" + JSON dishes**

Trong `src/lib/ai/prompt.ts`:

(a) Thêm import ở đầu:
```ts
import type { MenuContext } from "./types";
import { DISH_ROLE_LABEL } from "../enums";
```

(b) Thay mảng `system` trong `buildMenuPrompt` bằng:
```ts
  const system = [
    "Bạn vừa là CHUYÊN GIA DINH DƯỠNG, vừa là ĐẦU BẾP gia đình người Việt giàu kinh nghiệm.",
    "Nhiệm vụ: lên MÂM CƠM cho từng bữa được yêu cầu, mỗi mâm gồm nhiều món theo đúng cơ cấu chỉ định, kèm công thức ngắn gọn.",
    "QUY TẮC BẮT BUỘC (an toàn):",
    "- TUYỆT ĐỐI không dùng nguyên liệu gây dị ứng của bất kỳ thành viên nào.",
    "- Tôn trọng các kiêng khem (ăn chay, không thịt bò, v.v.).",
    "- Ưu tiên món/nguyên liệu hợp khẩu vị, tránh món bị ghét.",
    "- Không lặp lại các món đã ăn gần đây.",
    "QUY TẮC CÂN BẰNG CẢ MÂM (chuyên môn):",
    "- Mỗi mâm phải cân đối nhóm chất: đủ đạm (món mặn), rau xanh (xào/luộc/canh), tinh bột (cơm trắng ngầm định, KHÔNG cần liệt kê).",
    "- Đa dạng phương pháp chế biến trong một mâm — KHÔNG hai món cùng kiểu (tránh 2 món chiên/rán).",
    "- Tránh trùng nguyên liệu chính giữa các món trong mâm (đừng để cả mâm đều thịt heo).",
    "- Món canh phải 'đưa cơm', hài hoà với món mặn.",
    "- Ưu tiên nguyên liệu theo mùa và tận dụng thực phẩm đang có trong kho.",
    "- Gắn nhãn dinh dưỡng phù hợp cho TỪNG món.",
    "- Nếu có 'Món Việt tham khảo', ưu tiên chọn/biến tấu từ đó cho quen thuộc, đúng ẩm thực Việt.",
    "- Mỗi bữa phải trả ĐÚNG SỐ MÓN và ĐÚNG VAI TRÒ được yêu cầu bên dưới.",
    "- Tên món và công thức viết bằng tiếng Việt.",
    "CHỈ trả về JSON đúng cấu trúc, KHÔNG kèm giải thích, KHÔNG markdown.",
    "Cấu trúc JSON:",
    `{"meals":[{"date":"yyyy-mm-dd","mealType":"BREAKFAST|LUNCH|DINNER","dishes":[{"name":"string","dishRole":"MON_MAN|MON_XAO|CANH_SUP|RAU_LUOC|LAU|COM_BUN_PHO|MON_CUON|TRANG_MIENG|DO_CHUA","servings":number,"cookMinutes":number,"steps":["string"],"nutritionLabels":["string"],"ingredients":[{"name":"string","quantity":number,"unit":"string"}]}]}]}`,
    'Ví dụ nhãn dinh dưỡng: "nhiều rau", "ít dầu mỡ", "thanh đạm", "giàu đạm", "ít tinh bột".',
  ].join("\n");
```

(c) Thay phần dựng `slotsText` và câu chốt cuối. Tìm:
```ts
  const slotsText = ctx.slots
    .map((s) => `  - ${s.date}: ${MEALTYPE_LABEL[s.mealType] ?? s.mealType}`)
    .join("\n");
```
thay bằng:
```ts
  const slotsText = ctx.slots
    .map((s) => {
      const roles = s.dishRoles
        .map((r) => DISH_ROLE_LABEL[r] ?? r)
        .join(", ");
      return `  - ${s.date} · ${MEALTYPE_LABEL[s.mealType] ?? s.mealType}: ${s.dishRoles.length} món — ${roles}`;
    })
    .join("\n");
```
Và trong mảng `user`, đổi dòng:
```ts
    "Hãy lên thực đơn cho ĐÚNG các bữa sau (mỗi bữa một món chính phù hợp):",
```
thành:
```ts
    "Hãy lên MÂM CƠM cho ĐÚNG các bữa sau — mỗi bữa đúng số món và vai trò ghi kèm:",
```
Đổi câu chốt cuối:
```ts
    "Trả về JSON theo đúng cấu trúc đã nêu, mỗi phần tử meals ứng với một bữa ở trên.",
```
thành:
```ts
    "Trả về JSON theo đúng cấu trúc: mỗi phần tử meals ứng một bữa, dishes có đúng số món & vai trò yêu cầu.",
```

- [ ] **Step 9: Build + test toàn bộ**

Run: `yarn test && yarn build`
Expected: test PASS, build thành công.

- [ ] **Step 10: Commit**

```bash
git add src/lib/ai/schema.ts src/lib/ai/schema.test.ts src/lib/ai/types.ts src/lib/ai/prompt.ts src/lib/menu.ts src/lib/jobs.ts
git commit -m "feat(ai): sinh mâm nhiều món theo cơ cấu server + prompt chuyên gia"
```

---

### Task 4: Người dùng chọn số món (override end-to-end)

**Files:**
- Modify: `src/lib/actions/menu.ts` (đọc + validate `dishCount`, lưu vào job)
- Modify: `src/app/(app)/menu/new/NewMenuForm.tsx` (control "Số món mỗi bữa chính")

**Interfaces:**
- Consumes: `GenerationJob.dishCount` (Task 2), `buildMenuContext(..., dishCount)` (Task 3).

- [ ] **Step 1: `startGenerationAction` đọc `dishCount`**

Trong `src/lib/actions/menu.ts`, sau khối validate `selected`, thêm:
```ts
  // "auto" hoặc rỗng -> null (server tự tính theo số người); ngược lại 1..5.
  const rawCount = String(formData.get("dishCount") ?? "");
  let dishCount: number | null = null;
  if (rawCount && rawCount !== "auto") {
    const n = parseInt(rawCount, 10);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      return { error: "Số món phải từ 1 đến 5." };
    }
    dishCount = n;
  }
```
Và trong `prisma.generationJob.create({ data: {...} })`, thêm field:
```ts
      dishCount,
```

- [ ] **Step 2: Thêm control vào `NewMenuForm`**

Trong `src/app/(app)/menu/new/NewMenuForm.tsx`, thêm một `<label>` (đặt sau `<fieldset>` bữa ăn, trước `state.error`):
```tsx
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-zinc-700">
          Số món mỗi bữa chính (trưa/tối)
        </span>
        <select
          name="dishCount"
          defaultValue="auto"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        >
          <option value="auto">Tự động (theo số người)</option>
          <option value="1">1 món</option>
          <option value="2">2 món</option>
          <option value="3">3 món</option>
          <option value="4">4 món</option>
          <option value="5">5 món</option>
        </select>
        <span className="mt-1 block text-xs text-zinc-400">
          Bữa sáng luôn 1 món. Cơm trắng không tính là món.
        </span>
      </label>
```

- [ ] **Step 3: Build**

Run: `yarn build`
Expected: build thành công.

- [ ] **Step 4: Kiểm tra thủ công (nếu AI đã cấu hình)**

Tạo thực đơn trưa/tối với "3 món" → mỗi bữa chính có 3 món; đổi "Tự động" với gia đình 2 người → 2 món.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/menu.ts "src/app/(app)/menu/new/NewMenuForm.tsx"
git commit -m "feat(menu): cho người dùng chọn số món mỗi bữa chính"
```

---

### Task 5: Hiển thị mâm cơm đầy đủ trên dashboard

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `meal.dishes[].recipe`, `DISH_ROLE_LABEL` (Task 1).

- [ ] **Step 1: Import nhãn vai trò**

Trong `src/app/(app)/dashboard/page.tsx`, thêm:
```ts
import { MEAL_TYPE_LABEL, DISH_ROLE_LABEL } from "@/lib/enums";
```
(đổi dòng import `MEAL_TYPE_LABEL` hiện có thành dòng trên).

- [ ] **Step 2: Render cả mâm (thay khối `<article>` từ Task 2)**

Thay toàn bộ callback `.map((meal) => { ... })` (đã sửa ở Task 2) bằng bản render mâm nhiều món:
```tsx
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
                      <div className="mb-3 flex items-center gap-2">
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          {MEAL_TYPE_LABEL[meal.mealType] ?? meal.mealType}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {meal.servings} người · {meal.dishes.length} món
                          {totalMinutes > 0 && ` · ~${totalMinutes} phút`}
                        </span>
                      </div>
                      <div className="space-y-3">
                        {meal.dishes.map((dish) => {
                          const recipe = dish.recipe;
                          return (
                            <div
                              key={dish.id}
                              className="rounded-lg border border-zinc-200 bg-white p-3"
                            >
                              <div className="mb-1 flex flex-wrap items-center gap-2">
                                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500">
                                  {DISH_ROLE_LABEL[dish.dishRole] ?? dish.dishRole}
                                </span>
                                <h4 className="font-semibold">{recipe.name}</h4>
                              </div>
                              <p className="text-xs text-zinc-500">
                                {recipe.cookMinutes} phút
                                {recipe.nutritionLabels.length > 0 &&
                                  " · " + recipe.nutritionLabels.join(", ")}
                              </p>
                              {recipe.ingredients.length > 0 && (
                                <p className="mt-2 text-sm text-zinc-600">
                                  <span className="font-medium">Nguyên liệu: </span>
                                  {recipe.ingredients
                                    .map(
                                      (ri) =>
                                        `${ri.ingredient.name} (${ri.quantity} ${ri.unit})`,
                                    )
                                    .join(", ")}
                                </p>
                              )}
                              {recipe.steps.length > 0 && (
                                <details className="mt-2">
                                  <summary className="cursor-pointer text-sm font-medium text-emerald-700">
                                    Cách làm ({recipe.steps.length} bước)
                                  </summary>
                                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zinc-700">
                                    {recipe.steps.map((s, i) => (
                                      <li key={i}>{s}</li>
                                    ))}
                                  </ol>
                                </details>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  );
                })}
```

- [ ] **Step 3: Build**

Run: `yarn build`
Expected: build thành công.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/dashboard/page.tsx"
git commit -m "feat(dashboard): hiển thị mâm cơm nhiều món có nhãn vai trò"
```

---

### Task 6: Kiểm thử tổng thể (acceptance)

**Files:** (không sửa code; nếu phát hiện lỗi thì quay lại task tương ứng)

- [ ] **Step 1: Test + build sạch**

Run: `yarn test && yarn build`
Expected: mọi test PASS; build thành công.

- [ ] **Step 2: Đối chiếu tiêu chí hoàn thành GĐ 1 (spec)**

Kiểm tra thủ công (cần AI đã cấu hình — Ollama/Anthropic):
1. Tạo thực đơn trưa+tối cho gia đình N người → mỗi bữa chính đúng số món theo bảng (≤2→2, 3–4→3, ≥5→4), đúng vai trò; sáng 1 món.
2. Tạo lại cùng ngày → mâm cũ bị thay, KHÔNG nhân đôi.
3. Dashboard hiển thị mâm có nhãn vai trò + nhãn dinh dưỡng + cách làm từng món.
4. Có thành viên dị ứng → không món nào chứa nguyên liệu đó.
5. Prompt (đọc `buildMenuPrompt`) thể hiện rõ cân bằng dinh dưỡng & đa dạng phương pháp.

- [ ] **Step 3: Ghi chú kết quả**

Ghi lại (trong PR/commit message hoặc cho người dùng) kết quả từng tiêu chí; nêu rõ mục nào chưa kiểm được (vd chưa cấu hình AI).

---

## Self-Review (đã chạy)

**Spec coverage:**
- Nhiều món/bữa + số món theo người → Task 1 (`planMealStructure`) + Task 2 (MealDish) + Task 3 (sinh nhiều món) + Task 4 (override). ✓
- Ghi đè khi tạo lại (latest-wins) → Task 2 `@@unique` + `deleteMany` trong `saveMenu`. ✓
- Gợi ý chuyên gia → Task 3 prompt persona + quy tắc cân bằng mâm. ✓
- Hiển thị mâm → Task 5. ✓
- Bảo toàn dữ liệu + DB remote → Task 2 migration SQL + checkpoint xác nhận. ✓

**Placeholder scan:** không còn TBD/TODO; mọi step có lệnh/code cụ thể.

**Type consistency:** `DishRoleStr` (types.ts) khớp `dishRole` enum trong `aiDishSchema` và `DISH_ROLES` (enums.ts); `buildMenuContext(familyId, rawSlots, dishCount?)` khớp lời gọi ở `jobs.ts`; `MenuSlot.dishRoles` do `buildMenuContext` sinh và `buildMenuPrompt` đọc; `meal.dishes[].recipe` khớp include ở dashboard.

## Ngoài phạm vi (GĐ 2/3)
Chỉnh sửa/đổi/chat từng món; xem lịch sử ngày đã qua; rating/learning; dọn recipe mồ côi.
