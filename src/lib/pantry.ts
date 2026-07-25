import { normalizeIngredient } from "./normalize";
import { canonicalIngredient } from "../data/ingredient-aliases";
import { isSeasoning } from "../data/seasonings";

// Logic thuần cho kho thực phẩm: khớp tên, tìm phần thiếu, gộp nhu cầu đi chợ,
// gợi ý món theo nguyên liệu đang có. KHÔNG chạm DB để test được bằng vitest.

export type Need = { name: string; quantity: number; unit: string };

/** Khoá so khớp thống nhất: chuẩn hoá rồi quy về tên chuẩn. */
export function matchKey(name: string): string {
  return canonicalIngredient(normalizeIngredient(name));
}

export function toPantrySet(names: string[]): Set<string> {
  return new Set(names.map(matchKey));
}

/**
 * Nguyên liệu CHÍNH mà kho không có. Gia vị luôn bỏ qua — chấp nhận đánh đổi:
 * hết chai tương đen thì app không nhắc, đổi lại không bị hỏi mua muối mỗi tuần.
 */
export function missingFor(needs: Need[], pantry: Set<string>): Need[] {
  return needs.filter((n) => {
    const key = matchKey(n.name);
    if (isSeasoning(key)) return false;
    return !pantry.has(key);
  });
}

/** Gộp nhu cầu nhiều món: cùng nguyên liệu + cùng đơn vị thì cộng, khác đơn vị thì tách. */
export function mergeNeeds(needs: Need[]): Need[] {
  const acc = new Map<string, Need>();
  for (const n of needs) {
    const k = `${matchKey(n.name)}|${n.unit.trim().toLowerCase()}`;
    const cur = acc.get(k);
    if (cur) {
      cur.quantity += n.quantity;
    } else {
      acc.set(k, { ...n });
    }
  }
  return [...acc.values()];
}

/**
 * Món trong kho món có nguyên liệu chính trùng kho nhà — dùng làm GỢI Ý MỀM cho
 * prompt, không phải bộ lọc cứng. Nhiều nguyên liệu trùng thì xếp trước.
 */
export function suggestFromPantry<T extends { ingredients: { name: string }[] }>(
  dishes: T[],
  pantry: Set<string>,
  limit = 12,
): T[] {
  return dishes
    .map((d) => {
      const hits = d.ingredients.filter((i) => {
        const key = matchKey(i.name);
        return !isSeasoning(key) && pantry.has(key);
      }).length;
      return { d, hits };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit)
    .map((x) => x.d);
}
