import { normalizeIngredient } from "./normalize";
import { canonicalIngredient } from "@/data/ingredient-aliases";
import { isSeasoning } from "@/data/seasonings";

// Logic thuần cho kho thực phẩm: khớp tên, tìm phần thiếu, gộp nhu cầu đi chợ,
// gợi ý món theo nguyên liệu đang có, verify mâm AI sinh theo kho, và cơ chế
// kindOf/kindLookupFrom để cờ Ingredient.kind của gia đình ghi đè bảng gia vị
// tĩnh. KHÔNG chạm DB để test được bằng vitest.

export type Need = { name: string; quantity: number; unit: string };

/** Khoá so khớp thống nhất: chuẩn hoá rồi quy về tên chuẩn. */
export function matchKey(name: string): string {
  return canonicalIngredient(normalizeIngredient(name));
}

/** Bỏ tên rỗng sau chuẩn hoá (vd "!!!") — không để nó âm thầm "khớp" mọi thứ. */
export function toPantrySet(names: string[]): Set<string> {
  const set = new Set<string>();
  for (const name of names) {
    const key = matchKey(name);
    if (key) set.add(key);
  }
  return set;
}

// Ngưỡng "sắp hết hạn" dùng CHUNG cho khối kho gửi AI (src/lib/menu.ts) và trang
// /pantry (src/app/(app)/pantry) — tách một chỗ để hai nơi không trôi lệch nhau.
export const EXPIRING_SOON_MS = 2 * 24 * 60 * 60 * 1000;

/** Còn trong ngưỡng sắp hết hạn — kể cả khi ĐÃ quá hạn (hiệu số âm vẫn true). */
export function isExpiringSoon(expiresAt: Date | null, now: number): boolean {
  return expiresAt !== null && expiresAt.getTime() - now < EXPIRING_SOON_MS;
}

/** Đã quá hạn dùng. Dùng cùng với isExpiringSoon để tách hai trạng thái UI. */
export function isExpired(expiresAt: Date | null, now: number): boolean {
  return expiresAt !== null && expiresAt.getTime() - now < 0;
}

export type IngredientKindStr = "MAIN" | "SEASONING";
export type KindLookup = (matchedKey: string) => IngredientKindStr;

/** Mặc định khi chưa biết cờ của gia đình: tra bảng tĩnh. */
export const staticKind: KindLookup = (key) =>
  isSeasoning(key) ? "SEASONING" : "MAIN";

/**
 * Dựng lookup từ cờ Ingredient.kind của gia đình. Người dùng đã tự phân loại thì
 * ý họ thắng bảng tĩnh; nguyên liệu chưa có trong kho, hoặc có nhưng `kind` còn
 * NULL (chưa từng bấm "đổi nhóm"), thì rơi về bảng tĩnh.
 *
 * `kind: null` PHẢI bị loại khỏi map chứ không được nạp thẳng: cột này không có
 * @default trong schema đúng vì lý do này — Ingredient tạo từ AI (createRecipeFromDish,
 * adoptCatalogDishAction) không gán kind, nên "nước mắm" tạo trước khi trang kho
 * tồn tại sẽ có kind=NULL. Nếu map coi NULL là một giá trị hợp lệ (khác MAIN/SEASONING)
 * và không lọc, TypeScript đã ép kiểu record thành IngredientKindStr rồi nên lỗi sẽ
 * không hiện ở đây mà hiện ở nơi gọi — lọc tại nguồn cho chắc.
 */
export function kindLookupFrom(
  rows: { name: string; kind: IngredientKindStr | null }[],
): KindLookup {
  const byKey = new Map<string, IngredientKindStr>();
  for (const r of rows) {
    if (r.kind !== null) byKey.set(matchKey(r.name), r.kind);
  }
  return (key) => byKey.get(key) ?? staticKind(key);
}

/**
 * Nguyên liệu CHÍNH mà kho không có. Gia vị luôn bỏ qua — chấp nhận đánh đổi:
 * hết chai tương đen thì app không nhắc, đổi lại không bị hỏi mua muối mỗi tuần.
 * Tên rỗng sau chuẩn hoá luôn coi là thiếu — không bao giờ được xem là "đang có",
 * kể cả khi (do lỗi dữ liệu ở đâu đó) tập kho lại chứa khoá rỗng.
 * `kindOf` mặc định tra bảng tĩnh (`staticKind`), nhưng cờ `Ingredient.kind` mà
 * gia đình tự đặt (truyền qua `kindLookupFrom`) ghi đè được theo cả hai chiều —
 * đó là điều làm nút "đổi nhóm" trên trang kho có tác dụng thật.
 */
export function missingFor(
  needs: Need[],
  pantry: Set<string>,
  kindOf: KindLookup = staticKind,
): Need[] {
  return needs.filter((n) => {
    const key = matchKey(n.name);
    if (!key) return true;
    if (kindOf(key) === "SEASONING") return false;
    return !pantry.has(key);
  });
}

/**
 * Gộp nhu cầu nhiều món: cùng nguyên liệu + cùng đơn vị (so theo dạng đã chuẩn
 * hoá, bỏ dấu) thì cộng, khác đơn vị thì tách. Tên/đơn vị hiển thị chọn tất
 * định thay vì "gặp đầu tiên thắng":
 * - Đơn vị lấy nguyên văn (giữ dấu) của bản ghi đầu tiên trong nhóm.
 * - Tên ưu tiên biến thể đã LÀ tên chuẩn (không phải đồng nghĩa); không có thì
 *   giữ bản ghi đầu tiên.
 */
export function mergeNeeds(needs: Need[]): Need[] {
  type Acc = { name: string; quantity: number; unit: string; nameIsCanonical: boolean };
  const acc = new Map<string, Acc>();
  for (const n of needs) {
    const key = matchKey(n.name);
    const groupKey = `${key}|${normalizeIngredient(n.unit)}`;
    const nameIsCanonical = normalizeIngredient(n.name) === key;
    const cur = acc.get(groupKey);
    if (cur) {
      cur.quantity += n.quantity;
      if (nameIsCanonical && !cur.nameIsCanonical) {
        cur.name = n.name;
        cur.nameIsCanonical = true;
      }
    } else {
      acc.set(groupKey, {
        name: n.name,
        quantity: n.quantity,
        unit: n.unit.trim(),
        nameIsCanonical,
      });
    }
  }
  return [...acc.values()].map(({ name, quantity, unit }) => ({ name, quantity, unit }));
}

/**
 * Món trong kho có nguyên liệu chính trùng kho nhà — dùng làm GỢI Ý MỀM cho
 * prompt, không phải bộ lọc cứng. Chấm theo TỈ LỆ PHỦ nguyên liệu chính PHÂN
 * BIỆT (số nguyên liệu trùng kho / tổng nguyên liệu chính của món) để món nấu
 * được trọn vẹn đứng trước món chỉ trùng vài thứ trong một danh sách dài; khai
 * lặp một nguyên liệu nhiều dòng không được thổi điểm. Hoà tỉ lệ phủ thì món
 * nhiều lượt trùng phân biệt hơn đứng trước.
 * `kindOf` mặc định tra bảng tĩnh (`staticKind`), nhưng cờ `Ingredient.kind` mà
 * gia đình tự đặt (truyền qua `kindLookupFrom`) ghi đè được: nguyên liệu bị đánh
 * SEASONING loại khỏi cả tử số lẫn mẫu số của tỉ lệ phủ.
 */
export function suggestFromPantry<T extends { ingredients: { name: string }[] }>(
  dishes: T[],
  pantry: Set<string>,
  kindOf: KindLookup = staticKind,
  limit = 12,
): T[] {
  return dishes
    .map((d) => {
      const mainKeys = new Set(
        d.ingredients
          .map((i) => matchKey(i.name))
          .filter((key) => key && kindOf(key) !== "SEASONING"),
      );
      const hits = [...mainKeys].filter((key) => pantry.has(key)).length;
      const coverage = mainKeys.size > 0 ? hits / mainKeys.size : 0;
      return { d, hits, coverage };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.coverage - a.coverage || b.hits - a.hits)
    .slice(0, limit)
    .map((x) => x.d);
}

export type Violation = { dishName: string; missing: Need[] };

type MenuLike = {
  meals: { dishes: { name: string; ingredients: Need[] }[] }[];
};

/** Khử trùng theo matchKey, giữ bản ghi gặp trước — dọn ca "thịt bò" lẫn "Thịt bò". */
function dedupeByMatchKey(needs: Need[]): Need[] {
  const seen = new Set<string>();
  const out: Need[] = [];
  for (const n of needs) {
    const key = matchKey(n.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

/**
 * Kiểm mâm AI trả về ở chế độ AVAILABLE_ONLY. Model có thể phớt lờ luật trong
 * prompt nên không tin lời hứa — code kiểm lại. Chỉ soi nguyên liệu chính. Món
 * trùng tên qua nhiều bữa (thực đơn 3 bữa lặp món) gộp thành MỘT Violation duy
 * nhất — nếu không, hai câu buộc tội mâu thuẫn nhau về cùng một món sẽ khiến
 * model rối khi chỉ còn một lượt sinh lại.
 * `kindOf` mặc định tra bảng tĩnh (`staticKind`), nhưng cờ `Ingredient.kind` mà
 * gia đình tự đặt (truyền qua `kindLookupFrom`) ghi đè được — truyền tiếp xuống
 * `missingFor` nên nút "đổi nhóm" trên trang kho cũng tác động được tới verify.
 */
export function verifyMenuAgainstPantry(
  menu: MenuLike,
  pantry: Set<string>,
  kindOf: KindLookup = staticKind,
): Violation[] {
  const byDish = new Map<string, Violation>();
  for (const meal of menu.meals) {
    for (const dish of meal.dishes) {
      const missing = missingFor(dish.ingredients, pantry, kindOf);
      if (missing.length === 0) continue;
      const existing = byDish.get(dish.name);
      if (existing) {
        existing.missing = dedupeByMatchKey([...existing.missing, ...missing]);
      } else {
        byDish.set(dish.name, { dishName: dish.name, missing: dedupeByMatchKey(missing) });
      }
    }
  }
  return [...byDish.values()];
}

/** Câu nhắc gửi lại cho AI khi mâm vi phạm. Không có vi phạm thì không có gì để nói. */
export function violationNote(
  violations: Violation[],
  pantryNames: string[],
): string {
  if (violations.length === 0) return "";
  const lines = violations.map(
    (v) =>
      `Món "${v.dishName}" dùng ${v.missing
        .map((m) => m.name)
        .join(", ")} không có trong kho.`,
  );
  return [
    "LẦN TRƯỚC BẠN ĐÃ SAI:",
    ...lines,
    `Chỉ được dùng: ${pantryNames.join(", ")} (cộng gia vị cơ bản).`,
    "Hãy làm lại cho đúng.",
  ].join("\n");
}
