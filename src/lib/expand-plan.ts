import { findCatalogDish } from "./catalog-match";
import { isDishAllowed, deriveDietConstraints } from "./catalog";
import { MEAL_TYPE_LABEL } from "./enums";
import type { CatalogDishData } from "@/data/catalog";
import type { AiDish, AiMeal, AiWeekPlan } from "./ai/schema";
import type {
  AIProvider,
  MenuContext,
  MenuSlot,
  MealTypeStr,
} from "./ai/types";

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
    // Sao chép mảng: dữ liệu catalog là hằng dùng chung cả tiến trình, để lọt
    // tham chiếu ra ngoài là một chỗ sửa nhầm nguồn tĩnh rất khó lần ra.
    steps: [...dish.steps],
    // Catalog chưa có dữ liệu "chuẩn bị trước" nên để rỗng; createRecipeFromDish
    // đổi thành null và giao diện ẩn hẳn dòng đó.
    prepAheadNote: "",
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
    .sort((a, b) =>
      `${a.date}|${a.mealType}`.localeCompare(`${b.date}|${b.mealType}`),
    )
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
      ([mealType, dishRoles]) => ({
        date,
        mealType,
        dishRoles: dishRoles as MenuSlot["dishRoles"],
      }),
    );
    const menu = await provider.generateMenu({
      ...baseCtx,
      slots: narrowSlots,
      planContext: renderPlanContext(plan),
    });
    for (const m of menu.meals) {
      const key = m.mealType as MealTypeStr;
      const arr = resolved.get(key) ?? [];
      arr.push(...m.dishes);
      resolved.set(key, arr);
    }
  }

  const out: AiMeal[] = [];
  for (const s of slots.filter((x) => x.date === date)) {
    const dishes = resolved.get(s.mealType) ?? [];
    // Bữa không nở ra món nào thì BỎ HẲN thay vì đẩy mâm rỗng xuống saveMenu:
    // aiMealSchema đòi dishes tối thiểu 1 phần tử.
    if (dishes.length === 0) continue;
    out.push({ date, mealType: s.mealType, dishes });
  }

  return out;
}
