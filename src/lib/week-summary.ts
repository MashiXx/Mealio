import { matchKey, staticKind } from "./pantry";

// Tổng hợp cả đợt: nguyên liệu dùng nhiều nhất. Thuần, không chạm DB, không gọi
// AI — con số đếm được thì đếm, đừng hỏi model rồi phải tin.

export type IngredientUse = {
  /** Tên hiển thị, lấy theo lần gặp ĐẦU TIÊN theo thứ tự duyệt. */
  name: string;
  /** Số MÓN có dùng nguyên liệu này (không phải số dòng nguyên liệu). */
  dishCount: number;
};

type MealLike = {
  dishes: { recipe: { ingredients: { ingredient: { name: string } }[] } }[];
};

/**
 * Nguyên liệu xuất hiện ở nhiều món nhất trong cả đợt.
 *
 * BỎ QUA GIA VỊ: muối, nước mắm, tỏi có mặt ở gần như mọi món nên đứng đầu bảng
 * là chuyện hiển nhiên, xếp hạng chúng không nói lên điều gì về đợt này. Thứ
 * người dùng cần thấy là "tuần này ăn thịt heo hơi nhiều".
 *
 * Đếm theo SỐ MÓN chứ không theo số dòng: một món lỡ khai "cà chua" hai lần
 * không được đẩy nó lên hạng nhất.
 *
 * Gộp theo matchKey nên "hành hoa" và "hành lá" về cùng một mục.
 */
export function topIngredients(meals: MealLike[], limit = 8): IngredientUse[] {
  const countByKey = new Map<string, number>();
  const nameByKey = new Map<string, string>();

  for (const meal of meals) {
    for (const dish of meal.dishes) {
      // Set theo từng MÓN: hai dòng cùng nguyên liệu trong một món chỉ tính một.
      const seenInDish = new Set<string>();
      for (const ri of dish.recipe.ingredients) {
        const key = matchKey(ri.ingredient.name);
        if (!key) continue;
        if (staticKind(key) === "SEASONING") continue;
        if (seenInDish.has(key)) continue;
        seenInDish.add(key);
        countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
        if (!nameByKey.has(key)) nameByKey.set(key, ri.ingredient.name);
      }
    }
  }

  return [...countByKey.entries()]
    .map(([key, dishCount]) => ({ name: nameByKey.get(key)!, dishCount }))
    // Nhiều nhất lên trước; hoà thì theo tên để thứ tự tất định giữa các lần đọc.
    .sort((a, b) => b.dishCount - a.dishCount || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Nội dung lưu trong MealPlan.summaryJson. */
export type WeekSummary = { tips: string[] };

/** Đọc summaryJson về dạng dùng được; hỏng hoặc chưa có thì trả null. */
export function parseWeekSummary(raw: unknown): WeekSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const tips = (raw as { tips?: unknown }).tips;
  if (!Array.isArray(tips)) return null;
  const clean = tips.filter((t): t is string => typeof t === "string" && !!t);
  return clean.length > 0 ? { tips: clean } : null;
}
