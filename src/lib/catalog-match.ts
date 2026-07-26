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
