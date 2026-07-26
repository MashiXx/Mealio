# Ảnh món ăn & bố cục mâm cơm — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mâm cơm ở dashboard, lịch sử và kho món hiện ảnh món ăn theo bố cục hero + lưới thumbnail, món không có ảnh vẫn trông tử tế.

**Architecture:** Thêm một module thuần `src/lib/dish-image.ts` khớp tên món (do AI sinh, lưu trong `Recipe`) về slug catalog **lúc đọc** — không migration, không đụng DB. Một component `DishPhoto` dùng chung cho cả server lẫn client component. `MealCard` đổi từ danh sách dọc sang hero + lưới + panel chi tiết.

**Tech Stack:** Next.js 16.2.9 (App Router), React 19.2.4, Tailwind v4, Prisma 6, vitest 4.

**Spec:** `docs/superpowers/specs/2026-07-26-anh-mon-mam-com-design.md`

---

## Bối cảnh cho người triển khai

Đọc trước khi bắt tay:

- `AGENTS.md` — bản Next.js này có breaking change, phải tra
  `node_modules/next/dist/docs/` chứ không viết theo trí nhớ.
- Ba sự thật quyết định thiết kế:
  1. Mâm ở dashboard render `Recipe` (AI sinh), **không** có khoá ngoại nào về
     `CatalogDish`. Đó là lý do 27 ảnh sẵn có không dùng được.
  2. `normalizeIngredient` biến `"Thịt kho tàu (thịt kho trứng)"` thành
     `"thit kho tau thit kho trung"` — phải tách ngoặc, nếu không món phổ biến
     nhất sẽ trượt.
  3. `imageCredit` đang được tính nhưng không hiển thị ở đâu → vi phạm CC BY.

- Toàn bộ chữ hiển thị là **tiếng Việt**. Comment code cũng tiếng Việt, theo
  đúng phong cách các file sẵn có.
- Chạy test: `yarn test`. Một file: `npx vitest run src/lib/dish-image.test.ts`.

## File Structure

| File | Trách nhiệm |
|---|---|
| `src/lib/dish-image.ts` *(mới)* | Bảng vai trò (emoji + gradient), chỉ mục catalog, `resolveDishVisual`, `pickHeroDish`. Thuần, không I/O. |
| `src/lib/dish-image.test.ts` *(mới)* | Test cho module trên. |
| `src/app/(app)/dashboard/DishPhoto.tsx` *(mới)* | Render ảnh hoặc fallback. Không `"use client"`. |
| `src/app/(app)/dashboard/MealCard.tsx` | Bố cục hero + lưới + panel chi tiết. |
| `src/app/(app)/history/page.tsx` | Hero + lưới tĩnh, giữ danh sách chi tiết. |
| `src/app/(app)/catalog/CatalogBrowser.tsx` | Bỏ `ROLE_META` cục bộ, thêm ghi công, mâm gợi ý có ảnh. |
| `src/app/(app)/catalog/page.tsx` | Bổ sung `dishRole`/`imageUrl` vào dữ liệu set menu. |
| `scripts/fetch_dish_images.py`, `scripts/pin_images.py` | Mở rộng phủ ảnh. |

---

## Task 1: Bảng vai trò + fallback

**Files:**
- Create: `src/lib/dish-image.ts`
- Test: `src/lib/dish-image.test.ts`

- [ ] **Step 1: Viết test thất bại**

Tạo `src/lib/dish-image.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveDishVisual, ROLE_VISUAL } from "./dish-image";

describe("fallback khi không khớp món nào", () => {
  it("món lạ hoàn toàn trả emoji + gradient theo vai trò, slug null", () => {
    const v = resolveDishVisual("Món do AI bịa ra chưa từng có", "CANH_SUP");
    expect(v.slug).toBeNull();
    expect(v.imageUrl).toBeNull();
    expect(v.credit).toBeNull();
    expect(v.emoji).toBe(ROLE_VISUAL.CANH_SUP.emoji);
    expect(v.gradientClass).toBe(ROLE_VISUAL.CANH_SUP.gradientClass);
  });

  it("vai trò lạ không ném lỗi, dùng emoji trung tính", () => {
    const v = resolveDishVisual("Món lạ", "VAI_TRO_KHONG_TON_TAI");
    expect(v.emoji).toBe("🍽️");
    expect(v.gradientClass).toContain("bg-gradient");
  });

  it("đủ 9 vai trò đều có emoji và gradient riêng", () => {
    const roles = [
      "MON_MAN", "MON_XAO", "CANH_SUP", "RAU_LUOC", "LAU",
      "COM_BUN_PHO", "MON_CUON", "TRANG_MIENG", "DO_CHUA",
    ];
    for (const r of roles) {
      expect(ROLE_VISUAL[r]).toBeDefined();
      expect(ROLE_VISUAL[r].emoji).toBeTruthy();
      expect(ROLE_VISUAL[r].gradientClass).toContain("bg-gradient");
    }
  });
});
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `npx vitest run src/lib/dish-image.test.ts`
Expected: FAIL — `Failed to resolve import "./dish-image"`

- [ ] **Step 3: Viết implementation tối thiểu**

Tạo `src/lib/dish-image.ts`:

```ts
// Nối món trên mâm (Recipe do AI sinh) với ảnh trong kho món catalog. Recipe
// KHÔNG có khoá ngoại nào trỏ về CatalogDish, nên phải khớp theo TÊN lúc đọc.
// Chọn khớp lúc đọc thay vì lưu vào DB: không cần migration, và mâm cũ trong
// Lịch sử cũng đẹp lên ngay mà không phải backfill.

/** Emoji + nền gradient cho từng vai trò món, dùng khi không có ảnh thật. */
export type RoleVisual = { emoji: string; gradientClass: string };

export const ROLE_VISUAL: Record<string, RoleVisual> = {
  MON_MAN: { emoji: "🍖", gradientClass: "bg-gradient-to-br from-amber-100 to-orange-200" },
  MON_XAO: { emoji: "🥘", gradientClass: "bg-gradient-to-br from-orange-100 to-amber-200" },
  CANH_SUP: { emoji: "🍲", gradientClass: "bg-gradient-to-br from-sky-100 to-cyan-200" },
  RAU_LUOC: { emoji: "🥗", gradientClass: "bg-gradient-to-br from-lime-100 to-green-200" },
  LAU: { emoji: "🍲", gradientClass: "bg-gradient-to-br from-red-100 to-rose-200" },
  COM_BUN_PHO: { emoji: "🍜", gradientClass: "bg-gradient-to-br from-yellow-100 to-amber-200" },
  MON_CUON: { emoji: "🌯", gradientClass: "bg-gradient-to-br from-emerald-100 to-teal-200" },
  TRANG_MIENG: { emoji: "🍧", gradientClass: "bg-gradient-to-br from-pink-100 to-fuchsia-200" },
  DO_CHUA: { emoji: "🥬", gradientClass: "bg-gradient-to-br from-teal-100 to-emerald-200" },
};

const NEUTRAL_VISUAL: RoleVisual = {
  emoji: "🍽️",
  gradientClass: "bg-gradient-to-br from-zinc-100 to-zinc-200",
};

export type DishVisual = {
  /** đường dẫn ảnh nội bộ, vd "/dishes/thit-kho-tau.jpg"; null nếu không có. */
  imageUrl: string | null;
  /** ghi công nguồn ảnh; BẮT BUỘC hiển thị khi có imageUrl (giấy phép CC BY). */
  credit: string | null;
  emoji: string;
  gradientClass: string;
  /** slug catalog đã khớp; null nếu trượt. */
  slug: string | null;
};

function fallback(dishRole: string): DishVisual {
  const rv = ROLE_VISUAL[dishRole] ?? NEUTRAL_VISUAL;
  return {
    imageUrl: null,
    credit: null,
    emoji: rv.emoji,
    gradientClass: rv.gradientClass,
    slug: null,
  };
}

export function resolveDishVisual(name: string, dishRole: string): DishVisual {
  return fallback(dishRole);
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó pass**

Run: `npx vitest run src/lib/dish-image.test.ts`
Expected: PASS — 3 test

- [ ] **Step 5: Commit**

```bash
git add src/lib/dish-image.ts src/lib/dish-image.test.ts
git commit -m "feat(dish-image): bảng emoji+gradient theo vai trò và đường fallback"
```

---

## Task 2: Khớp tên chính xác + alias + biến thể ngoặc đơn

Tầng 1 và tầng 2 của thuật toán, cộng phần vá lỗ ngoặc đơn.

**Files:**
- Modify: `src/lib/dish-image.ts`
- Test: `src/lib/dish-image.test.ts`

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `src/lib/dish-image.test.ts`:

```ts
describe("khớp tên chính xác", () => {
  it("khớp đúng tên món có ảnh, trả kèm ghi công", () => {
    const v = resolveDishVisual("Cá kho tộ", "MON_MAN");
    expect(v.slug).toBe("ca-kho-to");
    expect(v.imageUrl).toBe("/dishes/ca-kho-to.jpg");
    expect(v.credit).toBeTruthy();
  });

  it("bỏ qua khác biệt dấu và hoa thường", () => {
    expect(resolveDishVisual("CÁ KHO TỘ", "MON_MAN").slug).toBe("ca-kho-to");
    expect(resolveDishVisual("ca kho to", "MON_MAN").slug).toBe("ca-kho-to");
  });

  it("khớp tên đúng thì không cần trùng vai trò", () => {
    // Tầng 1 tin tên tuyệt đối; chỉ tầng khớp chứa mới cần vai trò canh gác.
    expect(resolveDishVisual("Cá kho tộ", "CANH_SUP").slug).toBe("ca-kho-to");
  });
});

describe("khớp qua alias", () => {
  it("alias trỏ đúng món", () => {
    const v = resolveDishVisual("Cá kho", "MON_MAN");
    expect(v.slug).toBe("ca-kho-to");
    expect(v.imageUrl).toBe("/dishes/ca-kho-to.jpg");
  });

  it("alias của món chưa có ảnh vẫn khớp nhưng rơi về fallback ảnh", () => {
    const v = resolveDishVisual("sườn heo xào chua ngọt", "MON_MAN");
    expect(v.slug).toBe("suon-xao-chua-ngot");
    expect(v.imageUrl).toBeNull();
    expect(v.emoji).toBe(ROLE_VISUAL.MON_MAN.emoji);
  });
});

describe("biến thể ngoặc đơn", () => {
  // "Thịt kho tàu (thịt kho trứng)" chuẩn hoá thành chuỗi dính
  // "thit kho tau thit kho trung" -> không tách ngoặc thì món phổ biến nhất
  // trong catalog, lại đang CÓ ảnh, sẽ trượt sạch cả ba tầng.
  it("khớp phần ngoài ngoặc", () => {
    const v = resolveDishVisual("Thịt kho tàu", "MON_MAN");
    expect(v.slug).toBe("thit-kho-tau");
    expect(v.imageUrl).toBe("/dishes/thit-kho-tau.jpg");
  });

  it("khớp phần trong ngoặc", () => {
    expect(resolveDishVisual("Chả giò", "MON_CUON").slug).toBe("nem-ran");
    expect(resolveDishVisual("Nem rán", "MON_CUON").slug).toBe("nem-ran");
  });

  it("vẫn khớp cả tên gốc đầy đủ", () => {
    expect(resolveDishVisual("Nem rán (chả giò)", "MON_CUON").slug).toBe("nem-ran");
  });
});

describe("bất biến toàn catalog", () => {
  it("mọi món có ảnh đều có ghi công", async () => {
    const { allDishes } = await import("@/data/catalog");
    for (const d of allDishes) {
      if (d.imageUrl) expect(d.imageCredit, `món ${d.slug}`).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `npx vitest run src/lib/dish-image.test.ts`
Expected: FAIL — các test khớp tên báo `expected null to be "ca-kho-to"`

- [ ] **Step 3: Viết implementation**

Trong `src/lib/dish-image.ts`, thêm import ở đầu file:

```ts
import { allDishes, type CatalogDishData } from "@/data/catalog";
import { normalizeIngredient } from "./normalize";
```

Thêm phần dựng chỉ mục (đặt sau `NEUTRAL_VISUAL`, trước `fallback`):

```ts
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
```

Đổi thân `resolveDishVisual` — thêm hàm dựng kết quả và hai tầng khớp:

```ts
function hit(dish: CatalogDishData, dishRole: string): DishVisual {
  if (!dish.imageUrl) return { ...fallback(dishRole), slug: dish.slug };
  return {
    imageUrl: dish.imageUrl,
    credit: dish.imageCredit ?? null,
    emoji: (ROLE_VISUAL[dish.dishRole] ?? NEUTRAL_VISUAL).emoji,
    gradientClass: (ROLE_VISUAL[dish.dishRole] ?? NEUTRAL_VISUAL).gradientClass,
    slug: dish.slug,
  };
}

export function resolveDishVisual(name: string, dishRole: string): DishVisual {
  const n = normalizeIngredient(name ?? "");
  if (!n) return fallback(dishRole);

  const exact = byName.get(n) ?? byAlias.get(n);
  if (exact) return hit(exact, dishRole);

  return fallback(dishRole);
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó pass**

Run: `npx vitest run src/lib/dish-image.test.ts`
Expected: PASS — tất cả test tới giờ

- [ ] **Step 5: Commit**

```bash
git add src/lib/dish-image.ts src/lib/dish-image.test.ts
git commit -m "feat(dish-image): khớp tên, alias và biến thể ngoặc đơn"
```

---

## Task 3: Khớp chứa có canh gác

**Files:**
- Modify: `src/lib/dish-image.ts`
- Test: `src/lib/dish-image.test.ts`

- [ ] **Step 1: Viết test thất bại**

Thêm vào `src/lib/dish-image.test.ts`:

```ts
describe("khớp chứa có canh gác", () => {
  it("tên AI dài chứa trọn tên catalog, đúng vai trò -> trúng", () => {
    const v = resolveDishVisual("Thịt kho tàu kiểu miền Nam", "MON_MAN");
    expect(v.slug).toBe("thit-kho-tau");
    expect(v.imageUrl).toBe("/dishes/thit-kho-tau.jpg");
  });

  it("chứa nhưng SAI vai trò -> trượt", () => {
    // Cùng chuỗi trên, chỉ đổi vai trò. Vai trò là chốt chặn chính chống gán
    // nhầm ảnh cho món chỉ trùng chữ.
    const v = resolveDishVisual("Thịt kho tàu kiểu miền Nam", "TRANG_MIENG");
    expect(v.slug).toBeNull();
    expect(v.imageUrl).toBeNull();
  });

  it("khoá ngắn dưới ngưỡng không được dùng để khớp chứa", () => {
    // "Cá" quá ngắn, nếu lọt sẽ nuốt mọi món có chữ cá.
    expect(resolveDishVisual("Cá", "MON_MAN").slug).toBeNull();
  });

  it("không khớp giữa từ", () => {
    // Chuỗi con "com ga" nằm trong "comgaxx" nhưng không phải ranh giới từ.
    expect(resolveDishVisual("Bánh comgaxx nướng", "COM_BUN_PHO").slug).toBeNull();
  });

  it("khoá dài được ưu tiên hơn khoá ngắn", () => {
    const v = resolveDishVisual("Món canh chua cá đặc biệt", "CANH_SUP");
    expect(v.slug).toBe("canh-chua-ca");
  });

  it("tên rỗng hoặc chỉ ký tự lạ trả fallback, không nổ", () => {
    expect(resolveDishVisual("", "MON_MAN").slug).toBeNull();
    expect(resolveDishVisual("!!!", "MON_MAN").slug).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `npx vitest run src/lib/dish-image.test.ts`
Expected: FAIL — ca "tên AI dài chứa trọn tên catalog" báo `expected null to be "thit-kho-tau"`

- [ ] **Step 3: Viết implementation**

Trong `src/lib/dish-image.ts`, thêm sau khối dựng `byName`/`byAlias`:

```ts
// Khoá đủ dài để dùng cho khớp chứa, dài trước để "canh chua ca" thắng "canh chua".
const containKeys: { key: string; dish: CatalogDishData }[] = [
  ...[...byName.entries()].map(([key, dish]) => ({ key, dish })),
  ...[...byAlias.entries()].map(([key, dish]) => ({ key, dish })),
]
  .filter((e) => e.key.length >= MIN_CONTAIN_LEN)
  .sort((a, b) => b.key.length - a.key.length);
```

Thêm tầng 3 vào `resolveDishVisual`, ngay trước `return fallback(dishRole)`:

```ts
  // Tầng 3: tên AI chứa trọn tên catalog. Hai chốt chặn bắt buộc — đệm khoảng
  // trắng hai đầu để chỉ khớp theo biên từ, và phải trùng vai trò. Thiếu chúng
  // thì "cá" sẽ gán ảnh cá kho tộ cho mọi món có chữ cá.
  const padded = ` ${n} `;
  for (const { key, dish } of containKeys) {
    if (dish.dishRole !== dishRole) continue;
    if (padded.includes(` ${key} `)) return hit(dish, dishRole);
  }
```

- [ ] **Step 4: Chạy test để chắc chắn nó pass**

Run: `npx vitest run src/lib/dish-image.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/dish-image.ts src/lib/dish-image.test.ts
git commit -m "feat(dish-image): khớp chứa với chốt chặn biên từ và vai trò"
```

---

## Task 4: Chọn món hero

**Files:**
- Modify: `src/lib/dish-image.ts`
- Test: `src/lib/dish-image.test.ts`

- [ ] **Step 1: Viết test thất bại**

Thêm vào `src/lib/dish-image.test.ts` (nhớ bổ sung `pickHeroDish` vào dòng import ở đầu file):

```ts
describe("pickHeroDish", () => {
  const d = (id: string, name: string, dishRole: string) => ({ id, name, dishRole });

  it("chọn theo thứ tự ưu tiên vai trò khi không món nào có ảnh", () => {
    const dishes = [
      d("1", "Món canh lạ", "CANH_SUP"),
      d("2", "Món mặn lạ", "MON_MAN"),
      d("3", "Món rau lạ", "RAU_LUOC"),
    ];
    expect(pickHeroDish(dishes)?.id).toBe("2");
  });

  it("ưu tiên món CÓ ảnh thật hơn món cùng nhóm không ảnh", () => {
    const dishes = [
      d("1", "Món mặn AI bịa", "MON_MAN"),
      d("2", "Canh chua cá", "CANH_SUP"),
    ];
    expect(pickHeroDish(dishes)?.id).toBe("2");
  });

  it("không để tráng miệng/đồ chua làm hero dù có ảnh", () => {
    const dishes = [
      d("1", "Món mặn AI bịa", "MON_MAN"),
      d("2", "Chè chuối", "TRANG_MIENG"),
    ];
    expect(pickHeroDish(dishes)?.id).toBe("1");
  });

  it("mâm một món trả chính món đó", () => {
    expect(pickHeroDish([d("1", "Món lạ", "RAU_LUOC")])?.id).toBe("1");
  });

  it("mâm rỗng trả null", () => {
    expect(pickHeroDish([])).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy test để chắc chắn nó fail**

Run: `npx vitest run src/lib/dish-image.test.ts`
Expected: FAIL — `pickHeroDish is not a function` / lỗi import

- [ ] **Step 3: Viết implementation**

Thêm vào cuối `src/lib/dish-image.ts`:

```ts
// Thứ tự ưu tiên khi chọn món làm ảnh bìa của mâm.
const HERO_PRIORITY = [
  "MON_MAN",
  "LAU",
  "COM_BUN_PHO",
  "MON_XAO",
  "CANH_SUP",
  "MON_CUON",
  "RAU_LUOC",
  "DO_CHUA",
  "TRANG_MIENG",
];

/** Vai trò không được làm ảnh bìa chỉ vì tình cờ có ảnh — chè làm bìa bữa tối
 *  là sai, thà để gradient của món mặn. */
const NEVER_HERO = new Set(["TRANG_MIENG", "DO_CHUA"]);

function heroRank(dishRole: string): number {
  const i = HERO_PRIORITY.indexOf(dishRole);
  return i === -1 ? HERO_PRIORITY.length : i;
}

export type HeroCandidate = { id: string; name: string; dishRole: string };

/**
 * Chọn món làm ảnh bìa: món có ảnh thật đứng đầu theo ưu tiên vai trò. Nếu chỉ
 * các món thuộc nhóm đáy có ảnh thì bỏ qua ảnh, lấy món đầu theo ưu tiên.
 */
export function pickHeroDish<T extends HeroCandidate>(dishes: T[]): T | null {
  if (dishes.length === 0) return null;

  const sorted = [...dishes].sort(
    (a, b) => heroRank(a.dishRole) - heroRank(b.dishRole),
  );
  const withImage = sorted.find(
    (x) =>
      !NEVER_HERO.has(x.dishRole) &&
      resolveDishVisual(x.name, x.dishRole).imageUrl !== null,
  );
  return withImage ?? sorted[0];
}
```

- [ ] **Step 4: Chạy test để chắc chắn nó pass**

Run: `npx vitest run src/lib/dish-image.test.ts`
Expected: PASS

- [ ] **Step 5: Chạy toàn bộ test và lint**

Run: `yarn test`
Expected: PASS toàn bộ, kể cả `pantry.test.ts`, `meal-structure.test.ts`, `schema.test.ts`

Run: `yarn lint`
Expected: không lỗi

- [ ] **Step 6: Commit**

```bash
git add src/lib/dish-image.ts src/lib/dish-image.test.ts
git commit -m "feat(dish-image): chọn món hero theo ưu tiên vai trò và ảnh sẵn có"
```

---

## Task 5: Component `DishPhoto`

**Files:**
- Create: `src/app/(app)/dashboard/DishPhoto.tsx`

Không có test tự động (component thuần trình bày, không logic phân nhánh nào
chưa được `dish-image.test.ts` phủ). Kiểm bằng mắt ở Task 9.

- [ ] **Step 1: Viết component**

Tạo `src/app/(app)/dashboard/DishPhoto.tsx`:

```tsx
import Image from "next/image";
import { resolveDishVisual } from "@/lib/dish-image";

// KHÔNG đặt "use client": component này dùng ở cả dashboard (client) lẫn
// history/catalog (server), giống DishInfo.tsx.

type Size = "hero" | "thumb";

const BOX: Record<Size, string> = {
  hero: "relative w-full aspect-[16/9] overflow-hidden rounded-xl",
  thumb: "relative w-full aspect-square overflow-hidden rounded-lg",
};

// fill yêu cầu phần tử cha có position: relative (đã có trong BOX).
const SIZES: Record<Size, string> = {
  hero: "(max-width: 768px) 100vw, 640px",
  thumb: "(max-width: 768px) 50vw, 160px",
};

const EMOJI_SIZE: Record<Size, string> = {
  hero: "text-6xl",
  thumb: "text-3xl",
};

export function DishPhoto({
  name,
  dishRole,
  size,
  className = "",
}: {
  name: string;
  dishRole: string;
  size: Size;
  className?: string;
}) {
  const v = resolveDishVisual(name, dishRole);

  return (
    <div className={`${BOX[size]} ${v.imageUrl ? "bg-zinc-100" : v.gradientClass} ${className}`}>
      {v.imageUrl ? (
        <Image
          src={v.imageUrl}
          alt={name}
          fill
          sizes={SIZES[size]}
          // Next 16 đã deprecate `priority`; tài liệu khuyên dùng loading="eager"
          // cho ảnh nằm trên màn hình đầu thay vì preload.
          loading={size === "hero" ? "eager" : "lazy"}
          className="object-cover"
        />
      ) : (
        <div
          className={`flex h-full w-full items-center justify-center opacity-40 ${EMOJI_SIZE[size]}`}
        >
          {v.emoji}
        </div>
      )}
    </div>
  );
}

/**
 * Dòng ghi công nguồn ảnh. BẮT BUỘC hiển thị ở nơi món được trình bày chi tiết
 * khi ảnh có giấy phép CC BY / CC BY-SA. Trả null nếu món không dùng ảnh ngoài.
 */
export function DishPhotoCredit({
  name,
  dishRole,
}: {
  name: string;
  dishRole: string;
}) {
  const v = resolveDishVisual(name, dishRole);
  if (!v.imageUrl || !v.credit) return null;
  return <p className="mt-1 text-[10px] leading-tight text-zinc-400">Ảnh: {v.credit}</p>;
}
```

- [ ] **Step 2: Kiểm tra biên dịch**

Run: `npx tsc --noEmit`
Expected: không lỗi

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/dashboard/DishPhoto.tsx"
git commit -m "feat(ui): component DishPhoto với fallback gradient và dòng ghi công"
```

---

## Task 6: Bố cục mâm ở dashboard

**Files:**
- Modify: `src/app/(app)/dashboard/MealCard.tsx`
- Modify: `src/app/(app)/dashboard/page.tsx` (thêm `dishRole` thô vào `DishView`)

- [ ] **Step 1: Thêm `dishRole` vào dữ liệu truyền xuống**

`DishView` hiện chỉ có `roleLabel` (nhãn tiếng Việt). `pickHeroDish` và
`DishPhoto` cần mã vai trò thô. Trong `src/app/(app)/dashboard/MealCard.tsx`,
sửa type:

```ts
export type DishView = {
  id: string;
  roleLabel: string;
  /** mã vai trò thô (MON_MAN, CANH_SUP…) — cần cho việc khớp ảnh, khác roleLabel. */
  dishRole: string;
  name: string;
  cookMinutes: number;
  nutritionLabels: string[];
  ingredients: string[];
  steps: string[];
  chatHistory: ChatTurn[];
};
```

Trong `src/app/(app)/dashboard/page.tsx`, thêm một dòng vào chỗ map món (ngay
dưới `roleLabel:`, khoảng dòng 260):

```ts
                      dishRole: d.dishRole,
```

- [ ] **Step 2: Viết lại phần thân `MealCard`**

Thay toàn bộ khối từ `<div className="space-y-3">` chứa `meal.dishes.map(...)`
tới hết vòng lặp đó (dòng 174-263 của bản hiện tại) bằng bố cục mới. Thêm import
ở đầu file:

```ts
import { DishPhoto, DishPhotoCredit } from "./DishPhoto";
import { pickHeroDish } from "@/lib/dish-image";
```

Thêm state và các giá trị dẫn xuất, ngay sau `const busySet = ...`:

```tsx
  const hero = pickHeroDish(meal.dishes);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Món đang chọn; mặc định là hero. Nếu món đang chọn vừa bị xoá thì rơi về hero.
  const selected =
    meal.dishes.find((d) => d.id === selectedId) ?? hero ?? meal.dishes[0] ?? null;
  const others = meal.dishes.filter((d) => d.id !== hero?.id);
```

Thân mới (đặt thay cho khối cũ):

```tsx
      {hero && (
        <div className="space-y-3">
          {/* Ảnh bìa mâm: món chính, bấm được để mở panel chi tiết. */}
          <button
            type="button"
            onClick={() => setSelectedId(hero.id)}
            className={`block w-full text-left transition-opacity ${
              busySet.has(hero.id) ? "opacity-60" : ""
            } ${selected?.id === hero.id ? "ring-2 ring-emerald-400 rounded-xl" : ""}`}
          >
            <div className="relative">
              <DishPhoto name={hero.name} dishRole={hero.dishRole} size="hero" />
              <div className="absolute inset-x-0 bottom-0 rounded-b-xl bg-gradient-to-t from-black/70 to-transparent p-3">
                <span className="rounded bg-white/90 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600">
                  {hero.roleLabel}
                </span>
                <h4 className="mt-1 font-semibold text-white drop-shadow">
                  {hero.name}
                </h4>
              </div>
              {busySet.has(hero.id) && (
                <span className="absolute right-3 top-3 h-5 w-5 animate-spin rounded-full border-2 border-white/50 border-t-white" />
              )}
            </div>
          </button>

          {/* Các món còn lại */}
          {others.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {others.map((dish) => (
                <button
                  key={dish.id}
                  type="button"
                  onClick={() => setSelectedId(dish.id)}
                  className={`text-left transition-opacity ${
                    busySet.has(dish.id) ? "opacity-60" : ""
                  }`}
                >
                  <div className="relative">
                    <DishPhoto
                      name={dish.name}
                      dishRole={dish.dishRole}
                      size="thumb"
                      className={
                        selected?.id === dish.id ? "ring-2 ring-emerald-400" : ""
                      }
                    />
                    {busySet.has(dish.id) && (
                      <span className="absolute right-1.5 top-1.5 h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white" />
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs font-medium text-zinc-700">
                    {dish.name}
                  </p>
                  <p className="truncate text-[11px] text-zinc-400">
                    {dish.roleLabel}
                  </p>
                </button>
              ))}
            </div>
          )}

          {/* Panel chi tiết của món đang chọn */}
          {selected && (
            <div className="rounded-lg border border-zinc-200 bg-white p-3">
              <DishInfo
                dish={{
                  roleLabel: selected.roleLabel,
                  name: selected.name,
                  cookMinutes: selected.cookMinutes,
                  nutritionLabels: selected.nutritionLabels,
                  ingredients: selected.ingredients,
                  steps: selected.steps,
                }}
              />
              <DishPhotoCredit name={selected.name} dishRole={selected.dishRole} />
              {busySet.has(selected.id) && (
                <p className="mt-1 flex items-center gap-1 text-xs text-amber-600">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600" />
                  đang cập nhật…
                </p>
              )}

              {/* Nút thao tác nhanh */}
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {QUICK.map((q) => (
                  <button
                    key={q.kind}
                    type="button"
                    disabled={busySet.has(selected.id) || pending}
                    onClick={() => run(() => quickEditAction(selected.id, q.kind))}
                    className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:border-emerald-400 disabled:opacity-50"
                  >
                    {q.label}
                  </button>
                ))}
                <details className="relative">
                  <summary className="cursor-pointer list-none rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:border-emerald-400">
                    Điều chỉnh nhanh ▾
                  </summary>
                  <div className="absolute z-10 mt-1 flex flex-col rounded-lg border border-zinc-200 bg-white p-1 shadow">
                    {TUNE.map((t) => (
                      <button
                        key={t.kind}
                        type="button"
                        disabled={busySet.has(selected.id) || pending}
                        onClick={() => run(() => quickEditAction(selected.id, t.kind))}
                        className="whitespace-nowrap rounded px-2 py-1 text-left text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </details>
                <button
                  type="button"
                  disabled={busySet.has(selected.id) || pending}
                  onClick={() =>
                    setOpenChat(openChat === selected.id ? null : selected.id)
                  }
                  className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:border-emerald-400 disabled:opacity-50"
                >
                  Chat
                </button>
                <button
                  type="button"
                  disabled={
                    busySet.has(selected.id) || pending || meal.dishes.length <= 1
                  }
                  onClick={() => {
                    if (confirm(`Xóa món "${selected.name}"?`))
                      run(() => deleteDishAction(selected.id));
                  }}
                  className="rounded border border-red-200 px-2 py-1 text-xs text-red-500 hover:bg-red-50 disabled:opacity-40"
                >
                  Xóa
                </button>
              </div>

              {openChat === selected.id && (
                <ChatBox
                  history={selected.chatHistory}
                  busy={busySet.has(selected.id) || pending}
                  onSend={(m) => run(() => chatDishAction(selected.id, m))}
                />
              )}
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 3: Kiểm tra biên dịch và lint**

Run: `npx tsc --noEmit`
Expected: không lỗi

Run: `yarn lint`
Expected: không lỗi

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/dashboard/MealCard.tsx" "src/app/(app)/dashboard/page.tsx"
git commit -m "feat(dashboard): mâm cơm dạng ảnh bìa + lưới món + panel chi tiết"
```

---

## Task 7: Trang Lịch sử

**Files:**
- Modify: `src/app/(app)/history/page.tsx`

Trang này là server component, không có state → **không** dùng panel bấm-để-chọn.
Chèn hero + lưới làm phần đầu thị giác, giữ nguyên danh sách `DishInfo` bên dưới.

- [ ] **Step 1: Thêm hero + lưới**

Thêm import ở đầu file:

```ts
import { DishPhoto, DishPhotoCredit } from "../dashboard/DishPhoto";
import { pickHeroDish } from "@/lib/dish-image";
```

Ngay trước khối `<div className="space-y-3">` chứa `meal.dishes.map(...)`
(khoảng dòng 144), thêm:

```tsx
                      {(() => {
                        const cands = meal.dishes.map((d) => ({
                          id: d.id,
                          name: d.recipe.name,
                          dishRole: d.dishRole as string,
                        }));
                        const hero = pickHeroDish(cands);
                        if (!hero) return null;
                        const others = cands.filter((c) => c.id !== hero.id);
                        return (
                          <div className="mb-3 space-y-2">
                            <div className="relative">
                              <DishPhoto
                                name={hero.name}
                                dishRole={hero.dishRole}
                                size="hero"
                              />
                              <div className="absolute inset-x-0 bottom-0 rounded-b-xl bg-gradient-to-t from-black/70 to-transparent p-3">
                                <h4 className="font-semibold text-white drop-shadow">
                                  {hero.name}
                                </h4>
                              </div>
                            </div>
                            {others.length > 0 && (
                              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                {others.map((c) => (
                                  <div key={c.id}>
                                    <DishPhoto
                                      name={c.name}
                                      dishRole={c.dishRole}
                                      size="thumb"
                                    />
                                    <p className="mt-1 truncate text-xs font-medium text-zinc-700">
                                      {c.name}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
```

- [ ] **Step 2: Thêm ghi công vào thẻ món tĩnh**

Trong khối `meal.dishes.map(...)` sẵn có, thêm ngay sau thẻ `<DishInfo ... />`
đóng lại (khoảng dòng 163):

```tsx
                            <DishPhotoCredit
                              name={dish.recipe.name}
                              dishRole={dish.dishRole}
                            />
```

- [ ] **Step 3: Kiểm tra biên dịch**

Run: `npx tsc --noEmit`
Expected: không lỗi

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/history/page.tsx"
git commit -m "feat(history): mâm cũ có ảnh bìa, lưới món và ghi công nguồn ảnh"
```

---

## Task 8: Trang Kho món

**Files:**
- Modify: `src/app/(app)/catalog/CatalogBrowser.tsx`
- Modify: `src/app/(app)/catalog/page.tsx`

- [ ] **Step 1: Bỏ `ROLE_META` cục bộ, dùng bảng dùng chung**

Trong `CatalogBrowser.tsx`, xoá hằng `ROLE_META` (dòng 34-44) và thay bằng các
import dùng chung (gộp sẵn cả những thứ Step 3 sẽ cần, khỏi sửa import hai lần):

```ts
import { DishPhoto } from "../dashboard/DishPhoto";
import { ROLE_VISUAL, pickHeroDish } from "@/lib/dish-image";
import { DISH_ROLE_LABEL } from "@/lib/enums";
```

Mọi chỗ dùng `ROLE_META[x].emoji` đổi thành `ROLE_VISUAL[x]?.emoji ?? "🍽️"`, mọi
chỗ dùng `ROLE_META[x].label` đổi thành `DISH_ROLE_LABEL[x] ?? x`. Có 4 chỗ:
`DishCard` (dòng 104, 122), và hai chỗ trong danh sách tab lọc (dòng 238, 250).

Lưu ý nhãn có khác chút: `ROLE_META` cũ ghi "Canh & súp", "Rau & gỏi",
"Cơm, bún, phở"; `DISH_ROLE_LABEL` ghi "Canh/Súp", "Rau luộc/Nộm",
"Cơm/Bún/Phở". Dùng bản `DISH_ROLE_LABEL` cho nhất quán toàn app.

- [ ] **Step 2: Thêm ghi công vào `DishCard`**

`BrowseDish` cần thêm trường. Trong `CatalogBrowser.tsx`:

```ts
export interface BrowseDish {
  // …các trường sẵn có…
  imageUrl: string | null;
  imageCredit: string | null;
}
```

Trong `catalog/page.tsx`, thêm vào chỗ map món (cạnh dòng 25):

```ts
    imageCredit: d.imageCredit ?? null,
```

Trong `DishCard`, thêm ngay trước thẻ `</div>` đóng phần nội dung (sau khối
`<details>` xem công thức):

```tsx
        {dish.imageUrl && dish.imageCredit && (
          <p className="mt-2 text-[10px] leading-tight text-zinc-400">
            Ảnh: {dish.imageCredit}
          </p>
        )}
```

- [ ] **Step 3: Mâm cơm gợi ý có ảnh**

Đổi type trong `CatalogBrowser.tsx`:

```ts
export interface BrowseSetMenu {
  slug: string;
  name: string;
  occasion: string;
  region: string;
  servings: number;
  note: string | null;
  dishes: { slug: string; name: string; dishRole: string }[];
}
```

Trong `catalog/page.tsx`, đổi chỗ dựng set menu để dùng `getSetMenuDishes`:

```ts
import { allSetMenus, getSetMenuDishes } from "@/data/catalog";

// …trong hàm page:
  const setMenus = allSetMenus.map((m) => ({
    slug: m.slug,
    name: m.name,
    occasion: m.occasion,
    region: m.region,
    servings: m.servings,
    note: m.note ?? null,
    dishes: getSetMenuDishes(m).map((d) => ({
      slug: d.slug,
      name: d.name,
      dishRole: d.dishRole,
    })),
  }));
```

Trong `CatalogBrowser.tsx`, thay phần render set menu (dòng 304-322) bằng:

```tsx
          {setMenus.map((m) => {
            const hero = pickHeroDish(
              m.dishes.map((d) => ({ id: d.slug, name: d.name, dishRole: d.dishRole })),
            );
            const others = m.dishes.filter((d) => d.slug !== hero?.id);
            return (
              <div
                key={m.slug}
                className="overflow-hidden rounded-2xl border border-zinc-200 bg-white"
              >
                {hero && (
                  <div className="relative">
                    <DishPhoto name={hero.name} dishRole={hero.dishRole} size="hero" />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3">
                      <h3 className="font-semibold text-white drop-shadow">{m.name}</h3>
                      <p className="text-xs text-white/80">{m.servings} người</p>
                    </div>
                  </div>
                )}
                <div className="p-4">
                  {others.length > 0 && (
                    <div className="grid grid-cols-4 gap-2">
                      {others.map((d) => (
                        <div key={d.slug}>
                          <DishPhoto name={d.name} dishRole={d.dishRole} size="thumb" />
                          <p className="mt-1 truncate text-[11px] text-zinc-600">
                            {d.name}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                  {m.note && <p className="mt-2 text-xs text-zinc-400">{m.note}</p>}
                </div>
              </div>
            );
          })}
```

Import đã thêm ở Step 1, không cần sửa lại.

- [ ] **Step 4: Kiểm tra biên dịch và lint**

Run: `npx tsc --noEmit`
Expected: không lỗi

Run: `yarn lint`
Expected: không lỗi

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/catalog/CatalogBrowser.tsx" "src/app/(app)/catalog/page.tsx"
git commit -m "feat(catalog): mâm gợi ý có ảnh, hiện ghi công, dùng chung bảng vai trò"
```

---

## Task 9: Kiểm tra bằng mắt trên app thật

**Files:** không sửa file nào — đây là bước xác minh.

- [ ] **Step 1: Chạy app**

Run: `yarn dev`

- [ ] **Step 2: Đối chiếu từng mục**

Mở lần lượt và xác nhận:

| Trang | Cần thấy |
|---|---|
| `/dashboard` | Mâm có ảnh bìa; món không ảnh ra gradient + emoji đúng vai trò, **không** có ô xám trống |
| `/dashboard` | Bấm ô thumbnail → panel đổi đúng món; viền xanh đánh dấu món đang chọn |
| `/dashboard` | Đủ 6 thao tác chạy: Đổi món, Đổi đạm, Điều chỉnh nhanh, Chat, Xóa, + Thêm món |
| `/dashboard` | Mâm 1 món: chỉ hero + panel, không có lưới |
| `/history` | Có hero + lưới; danh sách chi tiết bên dưới còn nguyên |
| `/catalog` | Mâm cơm gợi ý có ảnh; thẻ món hiện dòng "Ảnh: …" |
| Mobile (thu hẹp cửa sổ) | Lưới 2 cột, không tràn ngang |

- [ ] **Step 3: Ghi lại vấn đề nếu có, sửa, rồi commit**

```bash
git add -A
git commit -m "fix(ui): chỉnh bố cục mâm sau khi kiểm tra bằng mắt"
```

---

## Task 10: Mở rộng phủ ảnh

**Files:**
- Modify: `scripts/probe_images.py`
- Modify: `scripts/fetch_dish_images.py`
- Modify: `scripts/pin_images.py`
- Generated: `src/data/catalog/image-credits.json`, `public/dishes/*.jpg`

Cần mạng. Hiện phủ 27/69 món.

- [ ] **Step 1: Liệt kê món còn thiếu ảnh**

Run:
```bash
npx tsx -e "import { allDishes } from './src/data/catalog/index.ts'; for (const d of allDishes.filter(x=>!x.imageUrl)) console.log(d.slug + ' | ' + d.name);"
```
Expected: in ra 42 dòng

- [ ] **Step 2: Dò ứng viên trước khi tải**

`probe_images.py` nhận **slug** ở argv rồi tra từ khoá trong dict `TERMS` ngay
trong file — truyền slug chưa có trong `TERMS` sẽ `KeyError`. Nên phải thêm từ
khoá vào `TERMS` trước, ví dụ:

```python
TERMS = {
    # …các mục sẵn có…
    "suon-xao-chua-ngot": ["Sườn xào chua ngọt", "Vietnamese sweet sour pork ribs"],
    "ga-kho-gung": ["Gà kho gừng", "Vietnamese ginger braised chicken"],
}
```

Rồi chạy. Script này **chỉ liệt kê, không tải** — đúng mục đích soi trước.

Run: `python scripts/probe_images.py suon-xao-chua-ngot ga-kho-gung`
Expected: với mỗi slug in ra tối đa 6 ứng viên kèm giấy phép; slug nào không ra
dòng nào thì Commons không có ảnh giấy phép mở → bỏ qua món đó

- [ ] **Step 3: Bổ sung từ khoá vào `SEARCH`**

Thêm vào dict `SEARCH` trong `scripts/fetch_dish_images.py` các slug mà bước 2
cho thấy có ảnh đúng món, dạng:

```python
    "suon-xao-chua-ngot": ["Sườn xào chua ngọt", "Vietnamese sweet sour pork ribs"],
    "ga-kho-gung": ["Gà kho gừng", "Vietnamese ginger braised chicken"],
```

- [ ] **Step 4: Tải ảnh**

Run: `python scripts/fetch_dish_images.py`
Expected: script bỏ qua slug đã có ảnh, chỉ tải slug mới; in ra từng file lưu được

- [ ] **Step 5: Soi bằng mắt từng ảnh mới**

Mở `public/dishes/` xem từng ảnh vừa tải **có đúng món không**. Ảnh sai món tệ
hơn nhiều so với gradient sạch sẽ — sai thì xoá file, xoá mục tương ứng trong
`src/data/catalog/image-credits.json`, và nếu cần thì ghim tên File chính xác
vào dict `PINS` của `scripts/pin_images.py` rồi chạy `python scripts/pin_images.py`.

- [ ] **Step 6: Xác nhận bất biến ghi công**

Run: `yarn test`
Expected: PASS — ca "mọi món có ảnh đều có ghi công" trong `dish-image.test.ts`
bắt được nếu manifest thiếu trường

- [ ] **Step 7: Đếm lại độ phủ**

Run:
```bash
npx tsx -e "import { allDishes } from './src/data/catalog/index.ts'; console.log(allDishes.filter(d=>d.imageUrl).length + '/' + allDishes.length);"
```
Expected: ít nhất `45/69`

- [ ] **Step 8: Commit**

```bash
git add scripts/ src/data/catalog/image-credits.json public/dishes/
git commit -m "feat(catalog): mở rộng phủ ảnh món từ Wikimedia Commons"
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

- [ ] **Step 4: Commit nếu còn sót**

```bash
git status
```
Expected: sạch

---

## Tiêu chí hoàn thành (đối chiếu spec)

1. Mâm ở dashboard hiện ảnh hero + lưới thumbnail; món không khớp ảnh ra
   gradient + emoji, không ô xám → Task 5, 6, 9
2. Bấm ô → panel đổi đúng món; đủ 6 thao tác cũ → Task 6, 9
3. Lịch sử có hero + lưới, danh sách chi tiết giữ nguyên → Task 7
4. Mâm cơm gợi ý ở Kho món có ảnh → Task 8
5. Mọi ảnh CC BY / CC BY-SA hiển thị ghi công → Task 5, 7, 8
6. `yarn test`, `yarn lint`, `yarn build` sạch → Task 11
7. Phủ ảnh ≥ 45/69, không ảnh sai món → Task 10
