import { requireFamily } from "@/lib/tenant";
import { allDishes, allSetMenus, getSetMenuDishes } from "@/data/catalog";
import {
  CatalogBrowser,
  type BrowseDish,
  type BrowseSetMenu,
} from "./CatalogBrowser";

// Trang duyệt kho món dùng chung. Đọc thẳng dữ liệu tĩnh (không phụ thuộc DB đã
// seed hay chưa). requireFamily để giữ trang trong khu vực đã đăng nhập.
export default async function CatalogPage() {
  await requireFamily();

  const dishes: BrowseDish[] = allDishes.map((d) => ({
    slug: d.slug,
    name: d.name,
    dishRole: d.dishRole,
    region: d.region,
    cookMinutes: d.cookMinutes,
    servings: d.servings,
    difficulty: d.difficulty,
    nutritionLabels: d.nutritionLabels,
    tags: d.tags,
    notes: d.notes ?? null,
    imageUrl: d.imageUrl ?? null,
    imageCredit: d.imageCredit ?? null,
    steps: d.steps,
    ingredients: d.ingredients,
  }));

  const setMenus: BrowseSetMenu[] = allSetMenus.map((m) => ({
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

  return <CatalogBrowser dishes={dishes} setMenus={setMenus} />;
}
