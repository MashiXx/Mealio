# Sinh thực đơn nhiều ngày (Giai đoạn 5A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sinh thực đơn một lượt cho 1–7 ngày, với AI thấy trọn khoảng ngày để xoay vòng đạm, tránh lặp món và cân dinh dưỡng.

**Architecture:** Hai pha. Pha 1 gọi AI **một lần cho cả khoảng** nhưng chỉ đòi *khung* (tên món + vai trò + đạm chính + nhãn dinh dưỡng) — output nhỏ hơn một ngày đầy đủ công thức của luồng hiện tại. Code verify khung rồi sinh lại đúng một vòng nếu phạm luật. Pha 2 nở khung thành công thức thật theo từng ngày: món khớp catalog lấy công thức từ catalog (không gọi AI), món còn lại gom một lời gọi AI cho ngày đó. Mỗi ngày nở xong lưu ngay nên hỏng giữa chừng vẫn giữ được phần trước.

**Tech Stack:** Next.js 16.2.9 (App Router), React 19.2.4, Prisma 6 + Postgres, zod 4, vitest 4.

**Spec:** `docs/superpowers/specs/2026-07-26-thuc-don-nhieu-ngay-design.md`

---

## Bối cảnh cho người triển khai

Đọc trước khi bắt tay:

- `AGENTS.md` — bản Next.js này có breaking change, phải tra
  `node_modules/next/dist/docs/` chứ không viết theo trí nhớ.
- **Lõi đã đa ngày sẵn.** `buildMenuContext(familyId, rawSlots, …)` nhận danh
  sách slot mà mỗi slot mang `date` riêng; `saveMenu` lặp `menu.meals` theo
  `meal.date` và xoá-rồi-tạo theo (ngày, bữa). Nút thắt chỉ ở `src/lib/jobs.ts:154`
  (`date: ymd(job.date)`) và form một ô ngày.
- **`MealPlan` là bảng chết** — có `startDate`/`endDate`/`meals` trong
  `prisma/schema.prisma:267` nhưng không một dòng code nào đụng tới. Việc này
  đánh thức nó.
- **Ollama trên CPU là ràng buộc thiết kế**, không phải ca biên. Xem ghi chú ở
  `src/lib/jobs.ts:169`. Đó là lý do không gọi AI một lần cho cả tuần kèm công thức.
- Toàn bộ chữ hiển thị và comment code bằng **tiếng Việt**, theo đúng phong cách
  các file sẵn có.
- Chạy test: `yarn test`. Một file: `npx vitest run src/lib/<tên>.test.ts`.

## File Structure

| File | Trách nhiệm |
|---|---|
| `src/lib/catalog-match.ts` *(mới)* | Chỉ mục + khớp tên món → catalog. Tách khỏi `dish-image.ts` vì đây là logic catalog, không phải logic ảnh. |
| `src/lib/catalog-match.test.ts` *(mới)* | Test khớp tên (chuyển từ `dish-image.test.ts`). |
| `src/lib/week-plan.ts` *(mới)* | `verifyWeekPlan` — thuần, không I/O. |
| `src/lib/week-plan.test.ts` *(mới)* | Test 4 luật verify. |
| `src/lib/expand-plan.ts` *(mới)* | Nở khung → công thức. Phần thuần (`catalogDishToAiDish`) tách riêng để test. |
| `src/lib/expand-plan.test.ts` *(mới)* | Test phần thuần. |
| `src/lib/ai/schema.ts` | Thêm `aiWeekPlanSchema`, `MAIN_PROTEINS`, `parseWeekPlanJson`. |
| `src/lib/ai/types.ts` | Thêm `generateWeekPlan` vào `AIProvider`, thêm `planContext` vào `MenuContext`. |
| `src/lib/ai/prompt.ts` | Thêm `buildWeekPlanPrompt`; `buildMenuPrompt` đọc thêm `planContext`. |
| `src/lib/ai/{anthropic,openai-compatible,ollama}.ts` | Cài `generateWeekPlan`. |
| `src/lib/catalog.ts` | Xuất `isDishAllowed` (đang private) để `expand-plan` dùng lại. |
| `src/lib/menu.ts` | `saveMenu` nhận thêm `mealPlanId`. |
| `src/lib/jobs.ts` | `runGenerationJob` đổi sang hai pha. |
| `src/lib/actions/menu.ts` | Nhận `days`. |
| `src/app/(app)/menu/new/NewMenuForm.tsx` | Chọn số ngày. |
| `src/app/(app)/dashboard/page.tsx` | Thẻ tiến độ "3/7 ngày". |
| `prisma/schema.prisma` + migration | `days`, `doneDays`, `mealPlanId` trên `GenerationJob`. |

---

## Task 1: Tách bộ khớp tên ra `catalog-match.ts`

Refactor thuần, **không đổi hành vi**. Làm trước để Task 7 dùng được.

**Files:**
- Create: `src/lib/catalog-match.ts`
- Create: `src/lib/catalog-match.test.ts`
- Modify: `src/lib/dish-image.ts`
- Modify: `src/lib/dish-image.test.ts`

- [ ] **Step 1: Tạo module mới, chuyển nguyên phần chỉ mục sang**

Tạo `src/lib/catalog-match.ts` — cắt nguyên các phần `keysFromName`,
`MIN_CONTAIN_LEN`, `byName`, `byAlias`, `containKeys` từ `dish-image.ts` sang,
rồi bọc bằng một hàm tra cứu:

```ts
import { allDishes, type CatalogDishData } from "@/data/catalog";
import { normalizeIngredient } from "./normalize";

// Khớp TÊN món (do AI sinh, hoặc người dùng gõ) về một món trong kho catalog.
// Tách khỏi dish-image.ts vì đây là logic CATALOG chứ không phải logic ảnh:
// việc nở khung thực đơn (expand-plan.ts) cần đúng bộ khớp này để lấy công thức.

/**
 * Các khoá tra cứu sinh ra từ một tên món. Ngoài tên đã chuẩn hoá, còn tách
 * riêng phần ngoài ngoặc và phần trong ngoặc: normalizeIngredient biến dấu
 * ngoặc thành khoảng trắng nên "Thịt kho tàu (thịt kho trứng)" dính lại thành
 * "thit kho tau thit kho trung" — không tách thì AI trả "Thịt kho tàu" sẽ trượt.
 */
function keysFromName(raw: string): string[] {
  const out = new Set<string>();
  const push = (s: string) => {
    const k = normalizeIngredient(s);
    if (k) out.add(k);
  };

  push(raw);
  push(raw.replace(/\([^)]*\)/g, " "));
  for (const m of raw.matchAll(/\(([^)]*)\)/g)) push(m[1]);

  return [...out];
}

/** Khoá ngắn hơn ngưỡng này không được dùng cho khớp chứa. Tên món ngắn nhất
 *  trong catalog là "pho bo"/"com ga" (6 ký tự) — đặt cao hơn là mất hẳn khả
 *  năng khớp "Phở bò tái nạm". */
const MIN_CONTAIN_LEN = 6;

const byName = new Map<string, CatalogDishData>();
const byAlias = new Map<string, CatalogDishData>();

for (const dish of allDishes) {
  for (const k of keysFromName(dish.name)) {
    if (!byName.has(k)) byName.set(k, dish);
  }
}
for (const dish of allDishes) {
  for (const alias of dish.aliases) {
    for (const k of keysFromName(alias)) {
      // Alias không được cướp khoá của một TÊN món khác.
      if (byName.has(k) || byAlias.has(k)) continue;
      byAlias.set(k, dish);
    }
  }
}

// Khoá đủ dài để dùng cho khớp chứa, dài trước để "canh chua ca" thắng "canh chua".
const containKeys: { key: string; dish: CatalogDishData }[] = [
  ...[...byName.entries()].map(([key, dish]) => ({ key, dish })),
  ...[...byAlias.entries()].map(([key, dish]) => ({ key, dish })),
]
  .filter((e) => e.key.length >= MIN_CONTAIN_LEN)
  .sort((a, b) => b.key.length - a.key.length);

/**
 * Tìm món catalog theo tên. Ba tầng, dừng ở tầng đầu trúng:
 * 1. khớp đúng tên (kể cả biến thể tách ngoặc đơn)
 * 2. khớp alias
 * 3. khớp chứa — tên đầu vào chứa trọn tên catalog, CÓ hai chốt chặn: biên từ
 *    và trùng vai trò. Thiếu chúng thì "cá" gán ảnh cá kho tộ cho mọi món có
 *    chữ cá.
 */
export function findCatalogDish(
  name: string,
  dishRole: string,
): CatalogDishData | null {
  const n = normalizeIngredient(name ?? "");
  if (!n) return null;

  const exact = byName.get(n) ?? byAlias.get(n);
  if (exact) return exact;

  const padded = ` ${n} `;
  for (const { key, dish } of containKeys) {
    if (dish.dishRole !== dishRole) continue;
    if (padded.includes(` ${key} `)) return dish;
  }
  return null;
}
```

- [ ] **Step 2: Rút gọn `dish-image.ts` để dùng module mới**

Trong `src/lib/dish-image.ts`: **xoá** `keysFromName`, `MIN_CONTAIN_LEN`,
`byName`, `byAlias`, `containKeys`, và đổi import + thân `resolveDishVisual`:

```ts
import { findCatalogDish } from "./catalog-match";
import { normalizeIngredient } from "./normalize";
```

(bỏ import `allDishes`; giữ `type CatalogDishData` nếu `hit` còn dùng — đổi
import thành `import type { CatalogDishData } from "@/data/catalog";`)

```ts
export function resolveDishVisual(name: string, dishRole: string): DishVisual {
  const dish = findCatalogDish(name, dishRole);
  if (!dish) return fallback(dishRole);
  return hit(dish, dishRole);
}
```

Giữ nguyên `ROLE_VISUAL`, `NEUTRAL_VISUAL`, `DishVisual`, `fallback`, `hit`,
`HERO_PRIORITY`, `NEVER_HERO`, `heroRank`, `HeroCandidate`, `pickHeroDish`.

- [ ] **Step 3: Chuyển test khớp tên sang file mới**

Tạo `src/lib/catalog-match.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { findCatalogDish } from "./catalog-match";

describe("khớp tên chính xác", () => {
  it("khớp đúng tên món", () => {
    expect(findCatalogDish("Cá kho tộ", "MON_MAN")?.slug).toBe("ca-kho-to");
  });

  it("bỏ qua khác biệt dấu và hoa thường", () => {
    expect(findCatalogDish("CÁ KHO TỘ", "MON_MAN")?.slug).toBe("ca-kho-to");
    expect(findCatalogDish("ca kho to", "MON_MAN")?.slug).toBe("ca-kho-to");
  });

  it("khớp tên đúng thì không cần trùng vai trò", () => {
    expect(findCatalogDish("Cá kho tộ", "CANH_SUP")?.slug).toBe("ca-kho-to");
  });
});

describe("khớp qua alias", () => {
  it("alias trỏ đúng món", () => {
    expect(findCatalogDish("Cá kho", "MON_MAN")?.slug).toBe("ca-kho-to");
  });

  // Fixture phải là món CHƯA có ảnh không còn quan trọng ở đây, nhưng giữ ca
  // alias của một món khác để chắc chắn bảng alias được nạp đầy đủ.
  it("alias của món khác cũng khớp", () => {
    expect(findCatalogDish("thịt gà kho gừng", "MON_MAN")?.slug).toBe(
      "ga-kho-gung",
    );
  });
});

describe("biến thể ngoặc đơn", () => {
  it("khớp phần ngoài ngoặc", () => {
    expect(findCatalogDish("Thịt kho tàu", "MON_MAN")?.slug).toBe("thit-kho-tau");
  });

  it("khớp phần trong ngoặc", () => {
    expect(findCatalogDish("Chả giò", "MON_CUON")?.slug).toBe("nem-ran");
    expect(findCatalogDish("Nem rán", "MON_CUON")?.slug).toBe("nem-ran");
  });

  it("vẫn khớp cả tên gốc đầy đủ", () => {
    expect(findCatalogDish("Nem rán (chả giò)", "MON_CUON")?.slug).toBe("nem-ran");
  });
});

describe("khớp chứa có canh gác", () => {
  it("tên dài chứa trọn tên catalog, đúng vai trò -> trúng", () => {
    expect(findCatalogDish("Thịt kho tàu kiểu miền Nam", "MON_MAN")?.slug).toBe(
      "thit-kho-tau",
    );
  });

  it("chứa nhưng SAI vai trò -> trượt", () => {
    expect(findCatalogDish("Thịt kho tàu kiểu miền Nam", "TRANG_MIENG")).toBeNull();
  });

  it("khoá ngắn dưới ngưỡng không được dùng để khớp chứa", () => {
    expect(findCatalogDish("Cá", "MON_MAN")).toBeNull();
  });

  it("không khớp giữa từ", () => {
    expect(findCatalogDish("Bánh comgaxx nướng", "COM_BUN_PHO")).toBeNull();
  });

  it("khoá dài được ưu tiên hơn khoá ngắn", () => {
    expect(findCatalogDish("Món canh chua cá đặc biệt", "CANH_SUP")?.slug).toBe(
      "canh-chua-ca",
    );
  });

  it("tên rỗng hoặc chỉ ký tự lạ trả null, không nổ", () => {
    expect(findCatalogDish("", "MON_MAN")).toBeNull();
    expect(findCatalogDish("!!!", "MON_MAN")).toBeNull();
  });
});

describe("dữ liệu dùng được cho việc nở khung", () => {
  it("món khớp mang đủ nguyên liệu và các bước", () => {
    const d = findCatalogDish("Cá kho tộ", "MON_MAN");
    expect(d).not.toBeNull();
    expect(d!.ingredients.length).toBeGreaterThan(0);
    expect(d!.steps.length).toBeGreaterThan(0);
    expect(d!.cookMinutes).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Xoá các describe đã chuyển khỏi `dish-image.test.ts`**

Trong `src/lib/dish-image.test.ts`, **xoá** các khối `describe` sau (đã chuyển
sang file mới): `"khớp tên chính xác"`, `"khớp qua alias"`,
`"biến thể ngoặc đơn"`, `"khớp chứa có canh gác"`.

**Giữ lại**: `"fallback khi không khớp món nào"`, `"pickHeroDish"`,
`"bất biến toàn catalog"`. Bổ sung hai ca để phần ảnh vẫn được phủ sau khi mất
các ca khớp tên:

```ts
describe("resolveDishVisual gắn ảnh khi khớp được món", () => {
  it("món có ảnh trả imageUrl kèm ghi công", () => {
    const v = resolveDishVisual("Cá kho tộ", "MON_MAN");
    expect(v.slug).toBe("ca-kho-to");
    expect(v.imageUrl).toBe("/dishes/ca-kho-to.jpg");
    expect(v.credit).toBeTruthy();
  });

  // Fixture phải là món CHƯA có ảnh. Nếu sau này ghim được ảnh cho ga-kho-gung
  // thì đổi sang một slug khác còn trống trong image-credits.json.
  it("món khớp nhưng chưa có ảnh rơi về fallback, slug vẫn điền", () => {
    const v = resolveDishVisual("thịt gà kho gừng", "MON_MAN");
    expect(v.slug).toBe("ga-kho-gung");
    expect(v.imageUrl).toBeNull();
    expect(v.emoji).toBe(ROLE_VISUAL.MON_MAN.emoji);
  });
});
```

- [ ] **Step 5: Chạy test — refactor không được đổi hành vi**

Run: `yarn test`
Expected: PASS toàn bộ. Tổng số test có thể đổi (chia lại file) nhưng **không
được có test nào FAIL**.

- [ ] **Step 6: Lint + typecheck**

Run: `yarn lint`
Expected: không lỗi

Run: `npx tsc --noEmit`
Expected: không lỗi

- [ ] **Step 7: Commit**

```bash
git add src/lib/catalog-match.ts src/lib/catalog-match.test.ts src/lib/dish-image.ts src/lib/dish-image.test.ts
git commit -m "refactor(catalog): tách bộ khớp tên món khỏi dish-image sang catalog-match"
```

---

## Task 2: Schema khung tuần

**Files:**
- Modify: `src/lib/ai/schema.ts`
- Test: `src/lib/ai/schema.test.ts`

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `src/lib/ai/schema.test.ts`:

```ts
import { parseWeekPlanJson, MAIN_PROTEINS } from "./schema";

describe("parseWeekPlanJson", () => {
  const ok = {
    meals: [
      {
        date: "2026-07-27",
        mealType: "DINNER",
        dishes: [
          {
            name: "Cá kho tộ",
            dishRole: "MON_MAN",
            mainProtein: "CA",
            nutritionLabels: ["giàu đạm"],
          },
        ],
      },
    ],
  };

  it("nhận khung hợp lệ", () => {
    const p = parseWeekPlanJson(JSON.stringify(ok));
    expect(p.meals[0].dishes[0].mainProtein).toBe("CA");
  });

  it("nutritionLabels thiếu thì mặc định mảng rỗng", () => {
    const noLabels = {
      meals: [
        {
          date: "2026-07-27",
          mealType: "DINNER",
          dishes: [{ name: "Cá kho tộ", dishRole: "MON_MAN", mainProtein: "CA" }],
        },
      ],
    };
    expect(parseWeekPlanJson(JSON.stringify(noLabels)).meals[0].dishes[0].nutritionLabels).toEqual([]);
  });

  it("mainProtein ngoài enum thì ném lỗi", () => {
    const bad = JSON.parse(JSON.stringify(ok));
    bad.meals[0].dishes[0].mainProtein = "THIT";
    expect(() => parseWeekPlanJson(JSON.stringify(bad))).toThrow();
  });

  it("thiếu mainProtein thì ném lỗi — đây là trục để bắt lặp, không được để trống", () => {
    const bad = JSON.parse(JSON.stringify(ok));
    delete bad.meals[0].dishes[0].mainProtein;
    expect(() => parseWeekPlanJson(JSON.stringify(bad))).toThrow();
  });

  it("khung không có bữa nào thì ném lỗi", () => {
    expect(() => parseWeekPlanJson(JSON.stringify({ meals: [] }))).toThrow();
  });

  it("enum đạm chính đủ 8 giá trị", () => {
    expect(MAIN_PROTEINS).toHaveLength(8);
  });
});
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `npx vitest run src/lib/ai/schema.test.ts`
Expected: FAIL — không export `parseWeekPlanJson`

- [ ] **Step 3: Viết implementation**

Trong `src/lib/ai/schema.ts`, thêm sau `aiMenuSchema` (giữ nguyên mọi thứ sẵn có):

```ts
// ------------------------------------------------------------------
// Khung thực đơn nhiều ngày (pha 1). Cố ý KHÔNG có nguyên liệu và các bước:
// cả tuần đầy đủ công thức là ~42 món, prompt khổng lồ và Ollama trên CPU
// không kham nổi. Khung chỉ mang đủ thứ cần để cân đối và bắt lặp.
// ------------------------------------------------------------------

/**
 * Trục đạm chính. Cố ý HẸP và đóng: enum mở thì model trả "thịt" ở ngày này và
 * "thịt heo" ở ngày kia, luật "hai ngày liền không trùng đạm" mất tác dụng.
 */
export const MAIN_PROTEINS = [
  "THIT_HEO",
  "THIT_BO",
  "THIT_GA",
  "CA",
  "TOM_CUA",
  "TRUNG",
  "DAU_PHU",
  "RAU_CU",
] as const;
export type MainProtein = (typeof MAIN_PROTEINS)[number];

export const aiPlanDishSchema = z.object({
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
  mainProtein: z.enum(MAIN_PROTEINS),
  nutritionLabels: z.array(z.string()).default([]),
});

export const aiPlanMealSchema = z.object({
  date: z.string(), // yyyy-mm-dd
  mealType: z.enum(["BREAKFAST", "LUNCH", "DINNER"]),
  dishes: z.array(aiPlanDishSchema).min(1),
});

export const aiWeekPlanSchema = z.object({
  meals: z.array(aiPlanMealSchema).min(1),
});

export type AiWeekPlan = z.infer<typeof aiWeekPlanSchema>;
export type AiPlanMeal = z.infer<typeof aiPlanMealSchema>;
export type AiPlanDish = z.infer<typeof aiPlanDishSchema>;
```

Và thêm hàm parse cạnh `parseMenuJson`:

```ts
/** Validate JSON khung thực đơn nhiều ngày theo aiWeekPlanSchema. */
export function parseWeekPlanJson(text: string): AiWeekPlan {
  const result = aiWeekPlanSchema.safeParse(extractJson(text));
  if (!result.success) {
    throw new Error(
      "JSON từ AI không đúng cấu trúc khung thực đơn: " + result.error.message,
    );
  }
  return result.data;
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó pass**

Run: `npx vitest run src/lib/ai/schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/schema.ts src/lib/ai/schema.test.ts
git commit -m "feat(ai): schema khung thực đơn nhiều ngày với trục đạm chính"
```

---

## Task 3: `verifyWeekPlan` — bốn luật

**Files:**
- Create: `src/lib/week-plan.ts`
- Create: `src/lib/week-plan.test.ts`

- [ ] **Step 1: Viết test thất bại**

Tạo `src/lib/week-plan.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { verifyWeekPlan } from "./week-plan";
import type { AiWeekPlan } from "./ai/schema";
import type { MenuSlot } from "./ai/types";

const slot = (date: string, roles: string[]): MenuSlot =>
  ({ date, mealType: "DINNER", dishRoles: roles }) as MenuSlot;

const dish = (name: string, dishRole: string, mainProtein: string) => ({
  name,
  dishRole,
  mainProtein,
  nutritionLabels: [],
});

const meal = (date: string, dishes: ReturnType<typeof dish>[]) => ({
  date,
  mealType: "DINNER" as const,
  dishes,
});

const plan = (meals: ReturnType<typeof meal>[]): AiWeekPlan =>
  ({ meals }) as unknown as AiWeekPlan;

describe("verifyWeekPlan", () => {
  it("khung đúng mọi luật thì không vi phạm", () => {
    const slots = [
      slot("2026-07-27", ["MON_MAN", "CANH_SUP"]),
      slot("2026-07-28", ["MON_MAN", "CANH_SUP"]),
    ];
    const p = plan([
      meal("2026-07-27", [
        dish("Cá kho tộ", "MON_MAN", "CA"),
        dish("Canh chua cá", "CANH_SUP", "CA"),
      ]),
      meal("2026-07-28", [
        dish("Thịt kho tàu", "MON_MAN", "THIT_HEO"),
        dish("Canh khoai mỡ", "CANH_SUP", "RAU_CU"),
      ]),
    ]);
    expect(verifyWeekPlan(p, slots)).toEqual([]);
  });

  it("R1: thiếu một bữa đã yêu cầu", () => {
    const slots = [slot("2026-07-27", ["MON_MAN"]), slot("2026-07-28", ["MON_MAN"])];
    const p = plan([meal("2026-07-27", [dish("Cá kho tộ", "MON_MAN", "CA")])]);
    const v = verifyWeekPlan(p, slots);
    expect(v.some((x) => x.includes("2026-07-28"))).toBe(true);
  });

  it("R1: sai vai trò trong một bữa", () => {
    const slots = [slot("2026-07-27", ["MON_MAN", "CANH_SUP"])];
    const p = plan([
      meal("2026-07-27", [
        dish("Cá kho tộ", "MON_MAN", "CA"),
        dish("Rau muống xào tỏi", "MON_XAO", "RAU_CU"),
      ]),
    ]);
    expect(verifyWeekPlan(p, slots).length).toBeGreaterThan(0);
  });

  it("R2: trả về ngày ngoài danh sách yêu cầu", () => {
    const slots = [slot("2026-07-27", ["MON_MAN"])];
    const p = plan([
      meal("2026-07-27", [dish("Cá kho tộ", "MON_MAN", "CA")]),
      meal("2026-07-29", [dish("Thịt kho tàu", "MON_MAN", "THIT_HEO")]),
    ]);
    expect(verifyWeekPlan(p, slots).some((x) => x.includes("2026-07-29"))).toBe(true);
  });

  it("R3: hai món trùng tên khác ngày", () => {
    const slots = [slot("2026-07-27", ["MON_MAN"]), slot("2026-07-28", ["MON_MAN"])];
    const p = plan([
      meal("2026-07-27", [dish("Cá kho tộ", "MON_MAN", "CA")]),
      meal("2026-07-28", [dish("Cá kho tộ", "MON_MAN", "THIT_HEO")]),
    ]);
    expect(verifyWeekPlan(p, slots).some((x) => x.includes("lặp"))).toBe(true);
  });

  it("R3: trùng tên nhưng khác dấu/hoa thường vẫn là lặp", () => {
    const slots = [slot("2026-07-27", ["MON_MAN"]), slot("2026-07-28", ["MON_MAN"])];
    const p = plan([
      meal("2026-07-27", [dish("Cá kho tộ", "MON_MAN", "CA")]),
      meal("2026-07-28", [dish("CA KHO TO", "MON_MAN", "THIT_HEO")]),
    ]);
    expect(verifyWeekPlan(p, slots).some((x) => x.includes("lặp"))).toBe(true);
  });

  it("R3 THA vai trò DO_CHUA — dưa cà ăn quanh năm", () => {
    const slots = [
      slot("2026-07-27", ["MON_MAN", "DO_CHUA"]),
      slot("2026-07-28", ["MON_MAN", "DO_CHUA"]),
    ];
    const p = plan([
      meal("2026-07-27", [
        dish("Cá kho tộ", "MON_MAN", "CA"),
        dish("Dưa cải chua", "DO_CHUA", "RAU_CU"),
      ]),
      meal("2026-07-28", [
        dish("Thịt kho tàu", "MON_MAN", "THIT_HEO"),
        dish("Dưa cải chua", "DO_CHUA", "RAU_CU"),
      ]),
    ]);
    expect(verifyWeekPlan(p, slots)).toEqual([]);
  });

  it("R4: món mặn hai ngày LIỀN cùng đạm chính", () => {
    const slots = [slot("2026-07-27", ["MON_MAN"]), slot("2026-07-28", ["MON_MAN"])];
    const p = plan([
      meal("2026-07-27", [dish("Cá kho tộ", "MON_MAN", "CA")]),
      meal("2026-07-28", [dish("Cá basa chiên sả", "MON_MAN", "CA")]),
    ]);
    expect(verifyWeekPlan(p, slots).some((x) => x.includes("Đạm chính"))).toBe(true);
  });

  it("R4: cùng đạm nhưng CÁCH một ngày thì không sao", () => {
    const slots = [
      slot("2026-07-27", ["MON_MAN"]),
      slot("2026-07-28", ["MON_MAN"]),
      slot("2026-07-29", ["MON_MAN"]),
    ];
    const p = plan([
      meal("2026-07-27", [dish("Cá kho tộ", "MON_MAN", "CA")]),
      meal("2026-07-28", [dish("Thịt kho tàu", "MON_MAN", "THIT_HEO")]),
      meal("2026-07-29", [dish("Cá basa chiên sả", "MON_MAN", "CA")]),
    ]);
    expect(verifyWeekPlan(p, slots)).toEqual([]);
  });

  it("khoảng chỉ có 1 ngày thì R4 không bao giờ kích hoạt", () => {
    const slots = [slot("2026-07-27", ["MON_MAN", "MON_MAN"])];
    const p = plan([
      meal("2026-07-27", [
        dish("Cá kho tộ", "MON_MAN", "CA"),
        dish("Cá basa chiên sả", "MON_MAN", "CA"),
      ]),
    ]);
    expect(verifyWeekPlan(p, slots)).toEqual([]);
  });

  it("khung rỗng thì báo vi phạm chứ không ném lỗi", () => {
    const slots = [slot("2026-07-27", ["MON_MAN"])];
    expect(() => verifyWeekPlan(plan([]), slots)).not.toThrow();
    expect(verifyWeekPlan(plan([]), slots).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `npx vitest run src/lib/week-plan.test.ts`
Expected: FAIL — `Cannot find module './week-plan'`

- [ ] **Step 3: Viết implementation**

Tạo `src/lib/week-plan.ts`:

```ts
import { normalizeIngredient } from "./normalize";
import { MEAL_TYPE_LABEL, DISH_ROLE_LABEL } from "./enums";
import type { AiWeekPlan } from "./ai/schema";
import type { MenuSlot } from "./ai/types";

// Kiểm khung thực đơn nhiều ngày do AI trả về. Thuần, không chạm DB.
//
// Vì sao cần: prompt có nêu luật, nhưng model (nhất là model nhỏ tự host) hay
// phớt lờ. Đây là cùng một lập luận đã dùng cho verifyMenuAgainstPantry.

/** Số thứ tự ngày từ chuỗi yyyy-mm-dd. Dùng Date.UTC để không lệch múi giờ. */
function dayNumber(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return NaN;
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

const keyOf = (date: string, mealType: string) => `${date}|${mealType}`;

const roleText = (roles: string[]) =>
  roles.map((r) => DISH_ROLE_LABEL[r] ?? r).join(", ");

const mealText = (date: string, mealType: string) =>
  `${MEAL_TYPE_LABEL[mealType] ?? mealType} ngày ${date}`;

/**
 * Trả về danh sách vi phạm bằng tiếng Việt (rỗng = đạt). Bốn luật:
 *
 * - R1: mỗi slot đã yêu cầu phải có mặt, đúng multiset vai trò.
 * - R2: không có (ngày, bữa) nào ngoài danh sách slot.
 * - R3: không hai món trùng tên trong cả khoảng — TRỪ vai trò DO_CHUA, vì dưa
 *   cà là thứ ăn kèm quanh năm, bắt mỗi ngày một loại là luật vô lý và chỉ tổ
 *   đốt một vòng sinh lại cho thứ người dùng còn chẳng coi là lỗi.
 * - R4: món mặn hai ngày LIỀN NHAU không cùng đạm chính. Không cấm trùng toàn
 *   khoảng: 7 ngày mà cấm tuyệt đối thì cần 7 loại đạm trong khi enum có 8, và
 *   nhà ăn chay sẽ không có lời giải nào.
 */
export function verifyWeekPlan(
  plan: AiWeekPlan,
  slots: MenuSlot[],
): string[] {
  const violations: string[] = [];

  const bySlot = new Map(slots.map((s) => [keyOf(s.date, s.mealType), s]));
  const byPlan = new Map(
    plan.meals.map((m) => [keyOf(m.date, m.mealType), m]),
  );

  // R1
  for (const s of slots) {
    const m = byPlan.get(keyOf(s.date, s.mealType));
    if (!m) {
      violations.push(`Thiếu ${mealText(s.date, s.mealType)}.`);
      continue;
    }
    const want = [...s.dishRoles].sort();
    const got = m.dishes.map((d) => d.dishRole).sort();
    if (want.join(",") !== got.join(",")) {
      violations.push(
        `${mealText(s.date, s.mealType)}: cần ${want.length} món (${roleText(want)}) nhưng nhận ${got.length} món (${roleText(got)}).`,
      );
    }
  }

  // R2
  for (const m of plan.meals) {
    if (!bySlot.has(keyOf(m.date, m.mealType))) {
      violations.push(
        `${mealText(m.date, m.mealType)} không nằm trong các bữa được yêu cầu.`,
      );
    }
  }

  // R3 — duyệt theo thứ tự ngày/bữa để thông báo tất định.
  const sortedMeals = [...plan.meals].sort((a, b) =>
    keyOf(a.date, a.mealType).localeCompare(keyOf(b.date, b.mealType)),
  );
  const seenName = new Map<string, string>();
  for (const m of sortedMeals) {
    for (const d of m.dishes) {
      if (d.dishRole === "DO_CHUA") continue;
      const n = normalizeIngredient(d.name);
      if (!n) continue;
      const prev = seenName.get(n);
      if (prev) {
        violations.push(`Món "${d.name}" lặp lại (đã có ở ${prev}).`);
      } else {
        seenName.set(n, mealText(m.date, m.mealType));
      }
    }
  }

  // R4
  const proteinsByDate = new Map<string, Set<string>>();
  for (const m of plan.meals) {
    for (const d of m.dishes) {
      if (d.dishRole !== "MON_MAN") continue;
      const set = proteinsByDate.get(m.date) ?? new Set<string>();
      set.add(d.mainProtein);
      proteinsByDate.set(m.date, set);
    }
  }
  const dates = [...proteinsByDate.keys()].sort();
  for (let i = 1; i < dates.length; i++) {
    const prev = dates[i - 1];
    const cur = dates[i];
    // Chỉ xét hai ngày SÁT NHAU thật; khung có lỗ ngày thì bỏ qua.
    if (dayNumber(cur) - dayNumber(prev) !== 1) continue;
    const dup = [...proteinsByDate.get(cur)!].filter((p) =>
      proteinsByDate.get(prev)!.has(p),
    );
    if (dup.length > 0) {
      violations.push(
        `Đạm chính (${dup.join(", ")}) lặp ở hai ngày liền ${prev} và ${cur}.`,
      );
    }
  }

  return violations;
}

/** Câu nhắc gửi lại cho AI khi khung phạm luật. */
export function weekPlanRetryNote(violations: string[]): string {
  return [
    "LẦN TRƯỚC BẠN TRẢ VỀ KHUNG SAI. Các lỗi cần sửa:",
    ...violations.map((v) => `  - ${v}`),
    "Hãy trả lại khung ĐẦY ĐỦ cho mọi bữa được yêu cầu, sửa hết các lỗi trên.",
  ].join("\n");
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó pass**

Run: `npx vitest run src/lib/week-plan.test.ts`
Expected: PASS — 11 test

- [ ] **Step 5: Commit**

```bash
git add src/lib/week-plan.ts src/lib/week-plan.test.ts
git commit -m "feat(menu): verify khung thực đơn nhiều ngày, 4 luật chống lặp"
```

---

## Task 4: Prompt khung tuần + `planContext`

**Files:**
- Modify: `src/lib/ai/types.ts`
- Modify: `src/lib/ai/prompt.ts`

- [ ] **Step 1: Thêm `planContext` vào `MenuContext`**

Trong `src/lib/ai/types.ts`, thêm vào cuối interface `MenuContext` (sau `retryNote`):

```ts
  /**
   * Khung cả khoảng ngày ở dạng gọn, để lời gọi NỞ của một ngày vẫn biết các
   * ngày khác ăn gì mà không lặp nguyên liệu chính. null/undefined = luồng một
   * ngày, prompt không đổi gì.
   *
   * Dùng trường RIÊNG chứ không mượn retryNote: retryNote mang nghĩa "lần trước
   * sai, sửa đi" và prompt đặt nó ở vị trí sửa lỗi — nhồi khung tuần vào đó sẽ
   * khiến mọi lời gọi nở trông như một lần sinh lại sau lỗi.
   */
  planContext?: string | null;
```

- [ ] **Step 2: Chèn `planContext` vào prompt sinh mâm**

Trong `src/lib/ai/prompt.ts`, hàm `buildMenuPrompt`, thêm một phần tử vào mảng
`user` — đặt **ngay trước** `ctx.retryNote ?? ""`:

```ts
    ctx.planContext
      ? [
          "Khung thực đơn cả đợt (các ngày khác đã có gì — TRÁNH lặp nguyên liệu chính):",
          ctx.planContext,
        ].join("\n")
      : "",
```

- [ ] **Step 3: Thêm `buildWeekPlanPrompt`**

Vẫn trong `src/lib/ai/prompt.ts`, thêm hàm mới (đặt sau `buildMenuPrompt`):

```ts
/**
 * Prompt PHA 1: dựng khung cho cả khoảng ngày. Cố ý KHÔNG đòi nguyên liệu và
 * các bước — đó là việc của pha 2. Nhờ vậy model thấy trọn khoảng ngày trong
 * một lượt (điều kiện để xoay vòng đạm và cân dinh dưỡng thật) mà output vẫn
 * nhỏ hơn một ngày đầy đủ công thức.
 */
export function buildWeekPlanPrompt(ctx: MenuContext): {
  system: string;
  user: string;
} {
  const p = ctx.profile;
  const dates = [...new Set(ctx.slots.map((s) => s.date))].sort();

  const system = [
    "Bạn vừa là CHUYÊN GIA DINH DƯỠNG, vừa là ĐẦU BẾP gia đình người Việt giàu kinh nghiệm.",
    `Nhiệm vụ: lên KHUNG thực đơn cho ${dates.length} ngày liên tiếp — chỉ TÊN MÓN, vai trò, đạm chính và nhãn dinh dưỡng.`,
    "TUYỆT ĐỐI KHÔNG trả về nguyên liệu hay các bước nấu ở bước này.",
    "QUY TẮC BẮT BUỘC (an toàn):",
    "- TUYỆT ĐỐI không dùng nguyên liệu gây dị ứng của bất kỳ thành viên nào.",
    "- Tôn trọng các kiêng khem (ăn chay, không thịt bò, v.v.).",
    "QUY TẮC CẢ ĐỢT (đây là lý do bạn được xem hết các ngày cùng lúc):",
    "- KHÔNG có hai món trùng tên trong toàn bộ khoảng ngày (đồ chua ăn kèm thì được lặp).",
    "- Món mặn của hai ngày LIỀN NHAU phải khác đạm chính.",
    "- Xoay vòng đạm chính cho đều cả đợt; trải đều nhãn dinh dưỡng, không dồn món nhiều dầu mỡ vào cùng vài ngày.",
    `- mainProtein CHỈ được là một trong: ${MAIN_PROTEINS.join(", ")}.`,
    "Trả về JSON đúng cấu trúc: { meals: [ { date, mealType, dishes: [ { name, dishRole, mainProtein, nutritionLabels } ] } ] }",
  ].join("\n");

  const slotsText = ctx.slots
    .map((s) => {
      const roles = s.dishRoles.map((r) => DISH_ROLE_LABEL[r] ?? r).join(", ");
      return `  - ${s.date} · ${MEALTYPE_LABEL[s.mealType] ?? s.mealType}: ${s.dishRoles.length} món — ${roles}`;
    })
    .join("\n");

  const membersText = ctx.members
    .map((m) => {
      const bits = [
        m.allergies.length ? `dị ứng: ${m.allergies.join(", ")}` : "",
        m.dietaryRestrictions.length ? `kiêng: ${m.dietaryRestrictions.join(", ")}` : "",
        m.likes.length ? `thích: ${m.likes.join(", ")}` : "",
        m.dislikes.length ? `ghét: ${m.dislikes.join(", ")}` : "",
      ].filter(Boolean);
      return `  - ${m.name} (${m.ageGroup})${bits.length ? " — " + bits.join("; ") : ""}`;
    })
    .join("\n");

  const user = [
    `Số người trong gia đình: ${ctx.familySize}`,
    "",
    "Thành viên & sở thích:",
    membersText || "  (chưa có)",
    "",
    "Hồ sơ ăn uống:",
    `  - Khẩu vị vùng: ${REGION_LABEL[p.cuisineRegion] ?? p.cuisineRegion}`,
    `  - Độ cay: ${SPICE_LABEL[p.spiceLevel] ?? p.spiceLevel}`,
    `  - Ngân sách: ${BUDGET_LABEL[p.budgetLevel] ?? p.budgetLevel}`,
    `  - Thời gian nấu tối đa mỗi món: ${p.maxCookMinutes} phút`,
    `  - Mục tiêu healthy: ${p.healthGoals.length ? p.healthGoals.join(", ") : "cân bằng chung"}`,
    p.notes ? `  - Ghi chú: ${p.notes}` : "",
    "",
    "Thực phẩm nhà đang có (ưu tiên dùng sớm, nhất là thứ sắp hết hạn):",
    ctx.pantry.length
      ? ctx.pantry
          .map((x) => `  - ${x.name}${x.expiringSoon ? " (sắp hết hạn)" : ""}`)
          .join("\n")
      : "  (kho trống)",
    "",
    "Món đã ăn gần đây (TRÁNH lặp lại):",
    ctx.recentRecipeNames.length
      ? ctx.recentRecipeNames.map((n) => `  - ${n}`).join("\n")
      : "  (chưa có)",
    "",
    "Hãy lên KHUNG cho ĐÚNG các bữa sau — mỗi bữa đúng số món và vai trò ghi kèm:",
    slotsText,
    "",
    catalogReferenceText(ctx.catalogReference),
    ctx.retryNote ?? "",
    "Nhắc lại: CHỈ trả tên món + vai trò + đạm chính + nhãn dinh dưỡng. Không nguyên liệu, không các bước.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { system, user };
}
```

Thêm import `MAIN_PROTEINS` ở đầu `prompt.ts`:

```ts
import { MAIN_PROTEINS } from "./schema";
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: không lỗi. Nếu báo `MEALTYPE_LABEL`/`REGION_LABEL`/`SPICE_LABEL`/
`BUDGET_LABEL`/`DISH_ROLE_LABEL`/`catalogReferenceText` chưa thấy, kiểm lại — tất
cả đều đã được định nghĩa sẵn trong chính `prompt.ts`, chỉ cần dùng, không cần
import thêm.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/types.ts src/lib/ai/prompt.ts
git commit -m "feat(ai): prompt khung thực đơn cả đợt và trường planContext"
```

---

## Task 5: `generateWeekPlan` trên cả ba adapter

**Files:**
- Modify: `src/lib/ai/types.ts`
- Modify: `src/lib/ai/anthropic.ts`
- Modify: `src/lib/ai/openai-compatible.ts`
- Modify: `src/lib/ai/ollama.ts`

- [ ] **Step 1: Thêm vào interface**

Trong `src/lib/ai/types.ts`, sửa import dòng 1 và interface `AIProvider`:

```ts
import type { AiMenu, AiWeekPlan, AiEditResult, MemberRecognition } from "./schema";
```

```ts
export interface AIProvider {
  /** Pha 1: khung cho cả khoảng ngày (chỉ tên món + vai trò + đạm chính). */
  generateWeekPlan(ctx: MenuContext): Promise<AiWeekPlan>;
  generateMenu(ctx: MenuContext): Promise<AiMenu>;
  editMeal(ctx: EditContext): Promise<AiEditResult>;
  recognizeMember(image: MemberImage): Promise<MemberRecognition>;
  testConnection(): Promise<TestConnectionResult>;
}
```

- [ ] **Step 2: Anthropic**

Trong `src/lib/ai/anthropic.ts`, thêm import và method (đặt ngay **trước**
`generateMenu`):

```ts
import { buildWeekPlanPrompt } from "./prompt";
import { parseWeekPlanJson, type AiWeekPlan } from "./schema";
```

```ts
  async generateWeekPlan(ctx: MenuContext): Promise<AiWeekPlan> {
    const { system, user } = buildWeekPlanPrompt(ctx);
    const msg = await this.client().messages.create({
      model: this.model,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
    });
    return parseWeekPlanJson(this.textOf(msg));
  }
```

- [ ] **Step 3: OpenAI-compatible**

Trong `src/lib/ai/openai-compatible.ts`, thêm import tương tự rồi method:

```ts
  async generateWeekPlan(ctx: MenuContext): Promise<AiWeekPlan> {
    const { system, user } = buildWeekPlanPrompt(ctx);
    const res = await this.client().chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    });
    return parseWeekPlanJson(res.choices[0]?.message?.content ?? "");
  }
```

- [ ] **Step 4: Ollama**

Trong `src/lib/ai/ollama.ts`, thêm import tương tự rồi method:

```ts
  async generateWeekPlan(ctx: MenuContext): Promise<AiWeekPlan> {
    const { system, user } = buildWeekPlanPrompt(ctx);
    const content = await this.chat([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    return parseWeekPlanJson(content);
  }
```

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit`
Expected: không lỗi (nếu còn adapter nào thiếu method, TS sẽ chỉ đúng chỗ)

Run: `yarn lint`
Expected: không lỗi

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/types.ts src/lib/ai/anthropic.ts src/lib/ai/openai-compatible.ts src/lib/ai/ollama.ts
git commit -m "feat(ai): generateWeekPlan cho cả ba adapter"
```

---

## Task 6: Thay đổi dữ liệu

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260726180000_multi_day_menu/migration.sql`
- Modify: `src/lib/menu.ts`

- [ ] **Step 1: Sửa schema**

Trong `prisma/schema.prisma`, model `GenerationJob`, thêm ba cột sau `pantryMode`:

```prisma
  // Sinh nhiều ngày: `date` giữ nguyên nghĩa là ngày ĐẦU của khoảng.
  days       Int     @default(1) // số ngày trong khoảng, 1..7
  doneDays   Int     @default(0) // đã lưu xong mấy ngày (cho thẻ tiến độ)
  mealPlanId String? // MealPlan của lượt sinh này
```

- [ ] **Step 2: Viết migration SQL tay**

Tạo `prisma/migrations/20260726180000_multi_day_menu/migration.sql`:

```sql
-- Sinh thực đơn nhiều ngày. Cả ba cột đều có DEFAULT nên job cũ đọc được
-- nguyên vẹn như job một ngày; không cần data migration.
ALTER TABLE "GenerationJob" ADD COLUMN "days" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "GenerationJob" ADD COLUMN "doneDays" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GenerationJob" ADD COLUMN "mealPlanId" TEXT;
```

- [ ] **Step 3: Sinh lại Prisma client**

Run: `npx prisma generate`
Expected: "Generated Prisma Client"

- [ ] **Step 4: `saveMenu` nhận `mealPlanId`**

Trong `src/lib/menu.ts`, sửa chữ ký và chỗ tạo `PlannedMeal`:

```ts
export async function saveMenu(
  familyId: string,
  menu: AiMenu,
  slots: MenuSlot[] = [],
  // Gắn mâm vào MealPlan của lượt sinh nhiều ngày. Bỏ trống -> hành vi y như cũ,
  // nên luồng một ngày không đổi gì.
  mealPlanId: string | null = null,
): Promise<string[]> {
```

Trong `tx.plannedMeal.create({ data: { … } })`, thêm một dòng sau `familyId`:

```ts
          mealPlanId,
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: không lỗi

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ src/lib/menu.ts
git commit -m "feat(db): GenerationJob mang khoảng ngày, saveMenu gắn MealPlan"
```

---

## Task 7: Nở khung thành công thức

**Files:**
- Create: `src/lib/expand-plan.ts`
- Create: `src/lib/expand-plan.test.ts`
- Modify: `src/lib/catalog.ts`

- [ ] **Step 1: Xuất `isDishAllowed` từ `catalog.ts`**

Trong `src/lib/catalog.ts`, hàm `dishAllowed` hiện là private. Đổi tên + xuất
(và sửa hai chỗ gọi nội bộ trong chính file đó):

```ts
/** Món có hợp lệ với ràng buộc ăn uống không. Xuất ra để expand-plan dùng lại —
 *  đường lấy công thức từ catalog PHẢI đi qua đúng bộ lọc này. */
export function isDishAllowed(
  d: CatalogDishData,
  excludeTags: Set<string>,
  vegetarianOnly: boolean,
): boolean {
  if (vegetarianOnly && !d.tags.includes("chay")) return false;
  return !d.tags.some((t) => excludeTags.has(t));
}
```

Sửa hai chỗ gọi `dishAllowed(...)` trong `buildCatalogReference` thành
`isDishAllowed(...)`.

- [ ] **Step 2: Viết test thất bại cho phần thuần**

Tạo `src/lib/expand-plan.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { catalogDishToAiDish, canUseCatalogRecipe } from "./expand-plan";
import { getDishBySlug } from "@/data/catalog";

describe("catalogDishToAiDish", () => {
  it("chuyển đủ nguyên liệu, các bước và thời gian nấu", () => {
    const cat = getDishBySlug("ca-kho-to")!;
    const d = catalogDishToAiDish(cat, "MON_MAN", 4, ["giàu đạm"]);
    expect(d.name).toBe(cat.name);
    expect(d.dishRole).toBe("MON_MAN");
    expect(d.servings).toBe(4);
    expect(d.cookMinutes).toBe(cat.cookMinutes);
    expect(d.steps).toEqual(cat.steps);
    expect(d.ingredients.length).toBe(cat.ingredients.length);
    expect(d.ingredients[0]).toHaveProperty("name");
    expect(d.ingredients[0]).toHaveProperty("quantity");
    expect(d.ingredients[0]).toHaveProperty("unit");
  });

  it("giữ vai trò do khung chỉ định, không lấy vai trò của catalog", () => {
    // Khung nói đây là món mặn thì mâm phải nhận món mặn, kể cả khi catalog
    // xếp nó vào vai trò khác — cơ cấu mâm đã được server chốt từ trước.
    const cat = getDishBySlug("ca-kho-to")!;
    expect(catalogDishToAiDish(cat, "CANH_SUP", 4, []).dishRole).toBe("CANH_SUP");
  });

  it("dùng nhãn dinh dưỡng của khung khi có, ngược lại lấy của catalog", () => {
    const cat = getDishBySlug("ca-kho-to")!;
    expect(catalogDishToAiDish(cat, "MON_MAN", 4, ["ít dầu mỡ"]).nutritionLabels).toEqual([
      "ít dầu mỡ",
    ]);
    expect(catalogDishToAiDish(cat, "MON_MAN", 4, []).nutritionLabels).toEqual(
      cat.nutritionLabels,
    );
  });
});

describe("canUseCatalogRecipe — chốt chặn dị ứng", () => {
  it("cho phép khi không vướng ràng buộc nào", () => {
    const cat = getDishBySlug("ca-kho-to")!;
    expect(canUseCatalogRecipe(cat, new Set(), false)).toBe(true);
  });

  it("CHẶN món mang tag bị loại — đây là chốt chống đi vòng qua bộ lọc dị ứng", () => {
    const cat = getDishBySlug("ca-kho-to")!;
    expect(cat.tags).toContain("chua-ca");
    expect(canUseCatalogRecipe(cat, new Set(["chua-ca"]), false)).toBe(false);
  });

  it("CHẶN món không phải món chay khi nhà ăn chay", () => {
    const cat = getDishBySlug("ca-kho-to")!;
    expect(canUseCatalogRecipe(cat, new Set(), true)).toBe(false);
  });
});
```

- [ ] **Step 3: Chạy test để chắc chắn nó fail**

Run: `npx vitest run src/lib/expand-plan.test.ts`
Expected: FAIL — `Cannot find module './expand-plan'`

- [ ] **Step 4: Viết implementation**

Tạo `src/lib/expand-plan.ts`:

```ts
import { findCatalogDish } from "./catalog-match";
import { isDishAllowed, deriveDietConstraints } from "./catalog";
import { MEAL_TYPE_LABEL } from "./enums";
import type { CatalogDishData } from "@/data/catalog";
import type { AiDish, AiMeal, AiWeekPlan } from "./ai/schema";
import type { AIProvider, MenuContext, MenuSlot, MealTypeStr } from "./ai/types";

// Pha 2: nở KHUNG (chỉ tên món) thành công thức thật.
//
// Hai đường cho mỗi món:
//  1. Khớp một món trong catalog -> lấy thẳng nguyên liệu + các bước từ đó,
//     KHÔNG tốn một lời gọi AI nào.
//  2. Không khớp (hoặc khớp nhưng vướng dị ứng) -> gom vào một lời gọi AI cho
//     ngày đó.

/**
 * Món catalog có được phép dùng làm công thức cho gia đình này không.
 *
 * BẮT BUỘC gọi trước khi lấy công thức từ catalog. buildCatalogReference đã lọc
 * dị ứng TRƯỚC KHI đưa tên món vào prompt, nhưng findCatalogDish khớp trên TOÀN
 * BỘ catalog — kể cả món vừa bị lọc. Nếu model tự nghĩ ra một cái tên trùng món
 * chứa chất gây dị ứng, bỏ qua chốt này là ta nạp thẳng nguyên liệu gây dị ứng
 * vào mâm, trong khi chính AI có thể đã viết công thức tránh nó. Nói cách khác:
 * thiếu hàm này thì đường rẽ sang catalog trở thành đường vòng qua bộ lọc dị ứng.
 */
export function canUseCatalogRecipe(
  dish: CatalogDishData,
  excludeTags: Set<string>,
  vegetarianOnly: boolean,
): boolean {
  return isDishAllowed(dish, excludeTags, vegetarianOnly);
}

/**
 * Dựng AiDish từ một món catalog.
 *
 * `dishRole` lấy từ KHUNG chứ không từ catalog: cơ cấu mâm do server chốt bằng
 * planMealStructure, mâm phải nhận đúng vai trò đã yêu cầu.
 */
export function catalogDishToAiDish(
  dish: CatalogDishData,
  dishRole: string,
  servings: number,
  nutritionLabels: string[],
): AiDish {
  return {
    name: dish.name,
    dishRole: dishRole as AiDish["dishRole"],
    servings,
    cookMinutes: dish.cookMinutes,
    steps: [...dish.steps],
    nutritionLabels:
      nutritionLabels.length > 0 ? nutritionLabels : [...dish.nutritionLabels],
    ingredients: dish.ingredients.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unit: i.unit,
    })),
  };
}

/** Khung cả đợt ở dạng gọn, nhồi vào prompt của lời gọi nở từng ngày. */
export function renderPlanContext(plan: AiWeekPlan): string {
  return [...plan.meals]
    .sort((a, b) => `${a.date}|${a.mealType}`.localeCompare(`${b.date}|${b.mealType}`))
    .map((m) => {
      const names = m.dishes
        .map((d) => `${d.name} (${d.mainProtein})`)
        .join(", ");
      return `  - ${m.date} · ${MEAL_TYPE_LABEL[m.mealType] ?? m.mealType}: ${names}`;
    })
    .join("\n");
}

/**
 * Nở toàn bộ các bữa của MỘT ngày thành AiMeal[] sẵn sàng cho saveMenu.
 *
 * Chạm AI nên KHÔNG test bằng vitest — phần thuần đã tách ra ở trên.
 */
export async function expandDay(
  plan: AiWeekPlan,
  date: string,
  opts: {
    provider: AIProvider;
    baseCtx: MenuContext;
    slots: MenuSlot[];
    servings: number;
  },
): Promise<AiMeal[]> {
  const { provider, baseCtx, slots, servings } = opts;
  const { excludeTags, vegetarianOnly } = deriveDietConstraints(baseCtx.members);

  const dayMeals = plan.meals.filter((m) => m.date === date);
  const out: AiMeal[] = [];
  // Vai trò của những món KHÔNG lấy được từ catalog, gom theo bữa để gọi AI một lượt.
  const missing = new Map<MealTypeStr, string[]>();
  const resolved = new Map<MealTypeStr, AiDish[]>();

  for (const m of dayMeals) {
    const dishes: AiDish[] = [];
    for (const d of m.dishes) {
      const cat = findCatalogDish(d.name, d.dishRole);
      if (cat && canUseCatalogRecipe(cat, excludeTags, vegetarianOnly)) {
        dishes.push(
          catalogDishToAiDish(cat, d.dishRole, servings, d.nutritionLabels),
        );
      } else {
        const arr = missing.get(m.mealType) ?? [];
        arr.push(d.dishRole);
        missing.set(m.mealType, arr);
      }
    }
    resolved.set(m.mealType, dishes);
  }

  // Còn món chưa nở -> một lời gọi AI cho ngày này, slot thu hẹp còn đúng phần thiếu.
  if (missing.size > 0) {
    const narrowSlots: MenuSlot[] = [...missing.entries()].map(
      ([mealType, dishRoles]) => ({ date, mealType, dishRoles }),
    );
    const menu = await provider.generateMenu({
      ...baseCtx,
      slots: narrowSlots,
      planContext: renderPlanContext(plan),
    });
    for (const m of menu.meals) {
      const arr = resolved.get(m.mealType as MealTypeStr) ?? [];
      arr.push(...m.dishes);
      resolved.set(m.mealType as MealTypeStr, arr);
    }
  }

  for (const s of slots.filter((x) => x.date === date)) {
    const dishes = resolved.get(s.mealType) ?? [];
    // Bữa không nở ra món nào thì BỎ HẲN thay vì đẩy mâm rỗng xuống saveMenu:
    // aiMealSchema đòi dishes tối thiểu 1 phần tử.
    if (dishes.length === 0) continue;
    out.push({ date, mealType: s.mealType, dishes });
  }

  return out;
}
```

- [ ] **Step 5: Chạy test để chắc chắn nó pass**

Run: `npx vitest run src/lib/expand-plan.test.ts`
Expected: PASS — 6 test

- [ ] **Step 6: Chạy toàn bộ test**

Run: `yarn test`
Expected: PASS toàn bộ

- [ ] **Step 7: Commit**

```bash
git add src/lib/expand-plan.ts src/lib/expand-plan.test.ts src/lib/catalog.ts
git commit -m "feat(menu): nở khung thành công thức, ưu tiên catalog kèm chốt dị ứng"
```

---

## Task 8: `runGenerationJob` hai pha

**Files:**
- Modify: `src/lib/jobs.ts`

- [ ] **Step 1: Thêm import**

Ở đầu `src/lib/jobs.ts`, thêm:

```ts
import { verifyWeekPlan, weekPlanRetryNote } from "./week-plan";
import { expandDay } from "./expand-plan";
```

- [ ] **Step 2: Dựng slot cho cả khoảng ngày**

Thay khối `rawSlots` (dòng 154-157 hiện tại):

```ts
    const rawSlots = job.mealTypes.map((mealType) => ({
      date: ymd(job.date),
      mealType: mealType as MealTypeStr,
    }));
```

bằng:

```ts
    // Khoảng ngày: job.date là ngày ĐẦU, job.days là số ngày. days=1 -> y hệt cũ.
    const days = Math.max(1, Math.min(7, job.days));
    const dateList: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(job.date);
      d.setDate(d.getDate() + i);
      dateList.push(ymd(d));
    }
    const rawSlots = dateList.flatMap((date) =>
      job.mealTypes.map((mealType) => ({
        date,
        mealType: mealType as MealTypeStr,
      })),
    );
```

- [ ] **Step 3: Chèn pha 1 + pha 2 dưới dạng NHÁNH, giữ nguyên đường một ngày**

Đây là điểm quan trọng nhất của task. **Không** thay thế đường cũ — bọc nó vào
nhánh `days === 1` và thêm nhánh mới cho `days > 1`.

Lý do: nhánh `AVAILABLE_ONLY` hiện tại verify kết quả `generateMenu` bằng
`verifyMenuAgainstPantry`. Ở luồng hai pha, `generateMenu` chỉ còn nở phần món
KHÔNG khớp catalog, nên verify ở đó là soi nhầm đối tượng — mà bỏ hẳn verify thì
chế độ "Nấu bằng đồ có sẵn" mất chốt kiểm, tức hồi quy chức năng.

Lối thoát đúng: **"Nấu bằng đồ có sẵn" chỉ cho phép 1 ngày.** Nấu cả tuần thuần
bằng kho hiện có vốn đã vô nghĩa — kho cạn ngay sau một hai ngày. Chốt này được
đặt ở server action (Task 9), còn ở đây chỉ cần giữ nguyên đường cũ cho
`days === 1`, nên hai chế độ không bao giờ gặp nhau.

Bọc toàn bộ khối hiện có — từ `const provider = await getAIProvider(job.familyId);`
tới hết `await saveMenu(job.familyId, menu, ctx.slots);` — vào:

```ts
    const provider = await getAIProvider(job.familyId);

    if (days === 1) {
      // ĐƯỜNG CŨ, GIỮ NGUYÊN TỪNG DÒNG: một ngày vẫn sinh một lượt kèm công thức,
      // và nhánh AVAILABLE_ONLY vẫn verify kho như trước. Đây là cách bảo đảm
      // "chọn 1 ngày -> hành vi y hệt hiện tại" mà không phải tin vào suy luận.
      …toàn bộ khối cũ, chỉ BỎ dòng `const provider = …` đã nâng lên trên…
    } else {
      …khối hai pha bên dưới…
    }
```

Nội dung nhánh `else` (hai pha):

```ts
    // ---------- PHA 1: khung cho cả khoảng ----------
    let plan = await provider.generateWeekPlan(ctx);

    // Model hay phớt lờ luật cứng -> code kiểm lại. Chỉ sinh lại MỘT lần: vi phạm
    // hai lần thì nhận khung đó còn hơn bắt người dùng chờ thêm một vòng Ollama
    // trên CPU. Cùng lập luận với nhánh AVAILABLE_ONLY ở trên.
    const violations = verifyWeekPlan(plan, ctx.slots);
    if (violations.length > 0) {
      plan = await provider.generateWeekPlan({
        ...ctx,
        retryNote: weekPlanRetryNote(violations),
      });
    }

    // MealPlan tạo SAU khi khung đã qua verify (lúc đó mới chắc khoảng ngày hợp
    // lệ) và TRƯỚC lần saveMenu đầu tiên, để mọi PlannedMeal gắn được mealPlanId.
    const mealPlan = await prisma.mealPlan.create({
      data: {
        familyId: job.familyId,
        startDate: new Date(`${dateList[0]}T00:00:00`),
        endDate: new Date(`${dateList[dateList.length - 1]}T00:00:00`),
      },
      select: { id: true },
    });
    await prisma.generationJob.update({
      where: { id: jobId },
      data: { mealPlanId: mealPlan.id },
    });

    // ---------- PHA 2: nở từng ngày, lưu ngay từng ngày ----------
    const servings = Math.max(1, ctx.familySize);
    for (const date of dateList) {
      try {
        const meals = await expandDay(plan, date, {
          provider,
          baseCtx: ctx,
          slots: ctx.slots,
          servings,
        });
        if (meals.length > 0) {
          await saveMenu(
            job.familyId,
            { meals },
            ctx.slots.filter((s) => s.date === date),
            mealPlan.id,
          );
        }
      } catch (err) {
        // Các ngày trước đã lưu xong và đang hiện trên bảng chính. Nói rõ hỏng từ
        // ngày nào thay vì nuốt lỗi hoặc xoá sạch phần đã làm được.
        const done = await prisma.generationJob.findUnique({
          where: { id: jobId },
          select: { doneDays: true },
        });
        await prisma.generationJob.update({
          where: { id: jobId },
          data: {
            status: "FAILED",
            error: `Đã tạo xong ${done?.doneDays ?? 0}/${days} ngày. Ngày ${date} lỗi: ${
              err instanceof Error ? err.message : String(err)
            }. Các ngày đã tạo vẫn giữ nguyên.`,
            finishedAt: new Date(),
          },
        });
        return;
      }

      await prisma.generationJob.update({
        where: { id: jobId },
        data: { doneDays: { increment: 1 } },
      });
    }
```

**Lưu ý:** nhánh `else` này chỉ chạy khi `days > 1`, mà server action đã chặn
`AVAILABLE_ONLY` khi `days > 1` (Task 9). Nên ở đây `pantryMode` luôn là
`FLEXIBLE` và không cần `verifyMenuAgainstPantry`. Ghi rõ bằng comment tại chỗ để
người đọc sau không tưởng là bỏ sót:

```ts
      // Tới nhánh này thì pantryMode luôn là FLEXIBLE: server action chặn
      // AVAILABLE_ONLY khi days > 1 (nấu cả tuần thuần bằng kho hiện có là vô
      // nghĩa, kho cạn sau một hai ngày). Nên KHÔNG có verifyMenuAgainstPantry ở
      // đây — không phải bỏ sót.
```

- [ ] **Step 4: Giữ nguyên phần còn lại**

`syncShopping` và cập nhật `status: "DONE"` giữ nguyên, chạy **một lần** sau vòng
lặp — không gọi trong vòng lặp, vì `syncShopping` quét lại toàn bộ mâm sắp tới
nên gọi bảy lần là bảy lần làm cùng một việc.

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit`
Expected: không lỗi

Run: `yarn lint`
Expected: không lỗi. Nếu báo `verifyMenuAgainstPantry`/`violationNote`/
`toPantrySet`/`kindLookupFrom` import thừa thì xoá khỏi dòng import.

- [ ] **Step 6: Commit**

```bash
git add src/lib/jobs.ts
git commit -m "feat(jobs): sinh thực đơn hai pha, lưu và đếm tiến độ từng ngày"
```

---

## Task 9: Server action + form

**Files:**
- Modify: `src/lib/actions/menu.ts`
- Modify: `src/app/(app)/menu/new/NewMenuForm.tsx`

- [ ] **Step 1: Nhận `days` ở action**

Trong `src/lib/actions/menu.ts`, thêm sau khối `dishCount` (trước `pantryMode`):

```ts
  // Số ngày sinh liên tiếp, tính từ `date`. Mặc định 1 = hành vi cũ.
  const rawDays = String(formData.get("days") ?? "1");
  const days = parseInt(rawDays, 10);
  if (!Number.isInteger(days) || days < 1 || days > 7) {
    return { error: "Số ngày phải từ 1 đến 7." };
  }
```

Và ngay **sau** khối tính `pantryMode`, thêm chốt chặn:

```ts
  // "Nấu bằng đồ có sẵn" chỉ có nghĩa cho MỘT ngày: kho hiện có cạn ngay sau
  // một hai bữa, nên bảy ngày thuần bằng kho là yêu cầu không có lời giải. Chốt
  // này cũng giữ cho luồng nhiều ngày luôn là FLEXIBLE, nhờ đó đường một ngày
  // (kèm verifyMenuAgainstPantry) không phải đụng tới.
  if (pantryMode === "AVAILABLE_ONLY" && days > 1) {
    return {
      error:
        'Chế độ "Nấu bằng đồ có sẵn" chỉ tạo được cho 1 ngày, vì kho nhà không đủ cho nhiều ngày liên tiếp. Chọn 1 ngày, hoặc đổi sang chế độ Thoải mái.',
    };
  }
```

Và thêm `days` vào `prisma.generationJob.create({ data: { … } })`:

```ts
      days,
```

- [ ] **Step 2: Thêm chọn số ngày vào form**

Trong `src/app/(app)/menu/new/NewMenuForm.tsx`:

Thêm hằng sau `QUICK_DAYS`:

```ts
// Số ngày sinh liên tiếp.
const DAY_COUNTS = [1, 3, 5, 7];

/** Ngày kết thúc của khoảng, dạng dd/mm. */
function endLabel(startYmd: string, days: number): string {
  const [y, m, d] = startYmd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days - 1);
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}`;
}
```

Thêm state cạnh `date`:

```ts
  const [days, setDays] = useState(1);
  // Theo dõi chế độ kho để khoá các mốc nhiều ngày — server đã chặn, nhưng để
  // người dùng bấm rồi mới báo lỗi là thiết kế tồi.
  const [pantryMode, setPantryMode] = useState("FLEXIBLE");
```

Gắn `onChange` cho hai radio `pantryMode` sẵn có (cả hai thẻ `<input type="radio"
name="pantryMode" …>`). Phải kéo `days` về 1 luôn, nếu không người dùng chọn 7
ngày rồi mới bấm sang "đồ có sẵn" sẽ gửi đi `days=7` với nút đã bị khoá — bấm
Tạo là ăn lỗi từ server mà không hiểu vì sao:

```tsx
              onChange={(e) => {
                setPantryMode(e.target.value);
                if (e.target.value === "AVAILABLE_ONLY") setDays(1);
              }}
```

Thêm khối UI ngay **sau** thẻ `</label>` của ô ngày:

```tsx
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-zinc-700">
          Số ngày
        </legend>
        <input type="hidden" name="days" value={days} />
        <div className="flex flex-wrap gap-2">
          {DAY_COUNTS.map((n) => {
            // Khoá mốc nhiều ngày ở chế độ "đồ có sẵn": kho cạn sau một hai bữa.
            const locked = pantryMode === "AVAILABLE_ONLY" && n > 1;
            return (
              <button
                key={n}
                type="button"
                disabled={locked}
                title={
                  locked
                    ? 'Chế độ "Nấu bằng đồ có sẵn" chỉ tạo được cho 1 ngày'
                    : undefined
                }
                onClick={() => setDays(n)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  days === n
                    ? "border-emerald-500 bg-emerald-50 font-medium text-emerald-700"
                    : "border-zinc-300 text-zinc-600 hover:border-zinc-400"
                }`}
              >
                {n === 1 ? "1 ngày" : `${n} ngày`}
              </button>
            );
          })}
        </div>
        {days > 1 && (
          <p className="mt-2 text-xs text-zinc-500">
            Sẽ tạo thực đơn từ {endLabel(date, 1)} đến {endLabel(date, days)}.
            AI xem cả đợt cùng lúc để không lặp món và xoay vòng đạm.
          </p>
        )}
        {days >= 5 && (
          <p className="mt-1 text-xs text-amber-600">
            Đợt dài có thể mất 10–20 phút nếu bạn dùng Ollama tự host. Thực đơn
            chạy ngầm, bạn cứ rời trang.
          </p>
        )}
      </fieldset>
```

Cảnh báo thời gian phải nằm **ở form**, không giấu: bấm rồi mới biết phải chờ 20
phút là trải nghiệm tệ hơn nhiều so với một dòng chữ.

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit`
Expected: không lỗi

Run: `yarn lint`
Expected: không lỗi

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/menu.ts "src/app/(app)/menu/new/NewMenuForm.tsx"
git commit -m "feat(menu): chọn sinh 1-7 ngày ở form tạo thực đơn"
```

---

## Task 10: Thẻ tiến độ trên dashboard

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Sửa thẻ job đang chạy**

Trong `src/app/(app)/dashboard/page.tsx`, khối `{activeJob && (…)}`, thay nhánh
`else` (câu "Đang tạo thực đơn cho ngày …") bằng:

```tsx
            ) : activeJob.days > 1 ? (
              <>
                Đang tạo thực đơn {formatDay(dayKey(activeJob.date))} → hết{" "}
                {activeJob.days} ngày —{" "}
                <strong>
                  xong {activeJob.doneDays}/{activeJob.days} ngày
                </strong>
                . Bạn có thể rời trang, kết quả sẽ tự hiện ở đây.
              </>
            ) : (
              <>
                Đang tạo thực đơn cho ngày{" "}
                <strong>{formatDay(dayKey(activeJob.date))}</strong>… Bạn có thể
                rời trang, kết quả sẽ tự hiện ở đây.
              </>
            )}
```

`JobPoller` đã refresh định kỳ nên tiến độ tự cập nhật, không cần cơ chế mới.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: không lỗi

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/dashboard/page.tsx"
git commit -m "feat(dashboard): thẻ tiến độ theo ngày cho đợt sinh nhiều ngày"
```

---

## Task 11: Xác minh lần cuối

**Files:** không sửa file nào.

- [ ] **Step 1: Test**

Run: `yarn test`
Expected: PASS toàn bộ

- [ ] **Step 2: Lint**

Run: `yarn lint`
Expected: không lỗi

- [ ] **Step 3: Build**

Run: `yarn build`
Expected: build thành công

- [ ] **Step 4: Kiểm không hồi quy luồng một ngày**

Đọc lại `src/lib/jobs.ts` và xác nhận: `days = 1` → `dateList` đúng một phần tử →
`rawSlots` y hệt bản cũ → `saveMenu` nhận `mealPlanId` mới nhưng `PlannedMeal`
vẫn tạo bình thường. Đây là tiêu chí hoàn thành số 5.

- [ ] **Step 5: Commit nếu còn sót**

```bash
git status
```
Expected: sạch

---

## Chưa kiểm được ở môi trường này

Máy phát triển hiện **không có `.env` và không có Postgres**, docker không chạy —
mọi trang đều qua `requireFamily()`. Nghĩa là **không chạy thử được đầu-cuối**:
migration chưa áp lên DB thật, và chưa lần nào gọi AI thật.

Người chạy plan này phải tự làm nốt trên máy có DB:

1. `npx prisma migrate deploy` (hoặc áp SQL tay qua `DATABASE_URL`).
2. Tạo thực đơn **1 ngày** → xác nhận không khác gì trước.
3. Tạo thực đơn **3 ngày** → thẻ tiến độ chạy 1/3, 2/3, 3/3; không có hai món
   trùng tên; món mặn hai ngày liền khác đạm.
4. Tạo **7 ngày** với Ollama → đo thời gian thật để chỉnh lại con số "10–20 phút"
   trong form nếu lệch.

## Tiêu chí hoàn thành (đối chiếu spec)

1. Chọn 7 ngày → một job duy nhất, tiến độ tăng dần tới 7/7 → Task 6, 8, 10
2. Không hai món trùng tên; món mặn hai ngày liền khác đạm → Task 3, 4, 8
3. Món có trong catalog dùng công thức catalog, không gọi AI → Task 7
4. Hỏng ở ngày 5 → bốn ngày đầu còn nguyên, lỗi nêu rõ ngày → Task 8
5. Chọn 1 ngày → hành vi y hệt hiện tại → Task 8, 11
6. `yarn test`, `yarn lint`, `yarn build` sạch → Task 11
