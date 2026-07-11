import {
  catalogDishSchema,
  setMenuSchema,
  type CatalogDishData,
  type SetMenuData,
  type DishRole,
  type CuisineRegion,
} from "./types";
import { monMan } from "./dishes/mon-man";
import { monXao } from "./dishes/mon-xao";
import { canh } from "./dishes/canh";
import { rau } from "./dishes/rau";
import { comBunPho } from "./dishes/com-bun-pho";
import { lau } from "./dishes/lau";
import { cuon } from "./dishes/cuon";
import { trangMieng } from "./dishes/trang-mieng";
import { doChua } from "./dishes/do-chua";
import { setMenus as rawSetMenus } from "./set-menus";
import imageCreditsRaw from "./image-credits.json";

// Manifest ảnh do scripts/fetch_dish_images.py + pin_images.py sinh ra (chỉ ảnh
// giấy phép mở, tải về public/dishes/). Overlay vào món theo slug lúc load —
// nhờ vậy ảnh nằm 1 chỗ, không phải sửa từng entry .ts.
type ImageCredit = {
  file: string;
  license: string;
  artist: string;
  source: string;
  title: string;
};
const imageCredits = imageCreditsRaw as Record<string, ImageCredit>;

// Re-export kiểu dữ liệu để nơi khác import gọn từ "@/data/catalog".
export type {
  CatalogDishData,
  SetMenuData,
  CatalogIngredient,
  DishRole,
  CuisineRegion,
} from "./types";

// Điểm gộp toàn bộ kho món. Validate bằng zod NGAY khi import: dữ liệu sai cấu
// trúc, slug trùng, hay set-menu trỏ tới món không tồn tại đều ném lỗi lúc build/
// khởi động — không để dữ liệu hỏng lọt vào DB hay prompt.

const rawDishes = [
  ...monMan,
  ...monXao,
  ...canh,
  ...rau,
  ...comBunPho,
  ...lau,
  ...cuon,
  ...trangMieng,
  ...doChua,
];

/** Parse + kiểm tra bất biến. Ném lỗi mô tả rõ nếu dữ liệu sai. */
function loadCatalog(): {
  dishes: CatalogDishData[];
  setMenus: SetMenuData[];
} {
  const dishes: CatalogDishData[] = [];
  const seen = new Set<string>();

  for (const raw of rawDishes) {
    const parsed = catalogDishSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `Món "${(raw as { slug?: string }).slug ?? "?"}" sai cấu trúc: ${parsed.error.message}`,
      );
    }
    const dish = parsed.data;
    if (seen.has(dish.slug)) {
      throw new Error(`Slug món bị trùng: "${dish.slug}"`);
    }
    // Overlay ảnh từ manifest (nếu món này đã có ảnh giấy phép mở).
    const credit = imageCredits[dish.slug];
    if (credit) {
      dish.imageUrl = credit.file;
      dish.imageCredit = `${credit.artist} — ${credit.license} — Wikimedia Commons (${credit.source})`;
    }
    // Nếu có ảnh thì phải kèm ghi công nguồn (tuân thủ giấy phép).
    if (dish.imageUrl && !dish.imageCredit) {
      throw new Error(`Món "${dish.slug}" có imageUrl nhưng thiếu imageCredit.`);
    }
    seen.add(dish.slug);
    dishes.push(dish);
  }

  const setMenus: SetMenuData[] = [];
  const seenMenu = new Set<string>();

  for (const raw of rawSetMenus) {
    const parsed = setMenuSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `Set menu "${(raw as { slug?: string }).slug ?? "?"}" sai cấu trúc: ${parsed.error.message}`,
      );
    }
    const menu = parsed.data;
    if (seenMenu.has(menu.slug)) {
      throw new Error(`Slug set menu bị trùng: "${menu.slug}"`);
    }
    for (const slug of menu.dishSlugs) {
      if (!seen.has(slug)) {
        throw new Error(
          `Set menu "${menu.slug}" trỏ tới món không tồn tại: "${slug}"`,
        );
      }
    }
    seenMenu.add(menu.slug);
    setMenus.push(menu);
  }

  return { dishes, setMenus };
}

const catalog = loadCatalog();

/** Toàn bộ món trong kho (đã validate). */
export const allDishes: readonly CatalogDishData[] = catalog.dishes;
/** Toàn bộ set menu (đã validate, dishSlugs đảm bảo tồn tại). */
export const allSetMenus: readonly SetMenuData[] = catalog.setMenus;

// ------------------------------------------------------------------
// Chỉ mục tra cứu O(1)
// ------------------------------------------------------------------

const bySlugIndex = new Map(allDishes.map((d) => [d.slug, d]));

/** Lấy món theo slug. */
export function getDishBySlug(slug: string): CatalogDishData | undefined {
  return bySlugIndex.get(slug);
}

/** Lấy danh sách món của một set menu theo thứ tự khai báo. */
export function getSetMenuDishes(menu: SetMenuData): CatalogDishData[] {
  return menu.dishSlugs
    .map((s) => bySlugIndex.get(s))
    .filter((d): d is CatalogDishData => d !== undefined);
}

function groupBy<K extends string>(
  key: (d: CatalogDishData) => K,
): Map<K, CatalogDishData[]> {
  const m = new Map<K, CatalogDishData[]>();
  for (const d of allDishes) {
    const k = key(d);
    const arr = m.get(k);
    if (arr) arr.push(d);
    else m.set(k, [d]);
  }
  return m;
}

/** Chỉ mục theo vai trò món (món mặn, canh, xào...). */
export const dishesByRole = groupBy<DishRole>((d) => d.dishRole);
/** Chỉ mục theo vùng khẩu vị. */
export const dishesByRegion = groupBy<CuisineRegion>((d) => d.region);

/** Món KHÔNG mang bất kỳ tag nào trong danh sách loại trừ (lọc dị ứng/kiêng). */
export function dishesExcludingTags(
  excludeTags: readonly string[],
): CatalogDishData[] {
  if (excludeTags.length === 0) return [...allDishes];
  const ex = new Set(excludeTags);
  return allDishes.filter((d) => !d.tags.some((t) => ex.has(t)));
}

/** Món thuần chay (mang tag "chay"). */
export function vegetarianDishes(): CatalogDishData[] {
  return allDishes.filter((d) => d.tags.includes("chay"));
}
