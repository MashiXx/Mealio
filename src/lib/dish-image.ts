import type { CatalogDishData } from "@/data/catalog";
import { findCatalogDish } from "./catalog-match";

// Nối món trên mâm (Recipe do AI sinh) với ảnh trong kho món catalog. Recipe
// KHÔNG có khoá ngoại nào trỏ về CatalogDish, nên phải khớp theo TÊN lúc đọc.
// Chọn khớp lúc đọc thay vì lưu vào DB: không cần migration, và mâm cũ trong
// Lịch sử cũng đẹp lên ngay mà không phải backfill.

/** Emoji + nền gradient cho từng vai trò món, dùng khi không có ảnh thật. */
export type RoleVisual = { emoji: string; gradientClass: string };

export const ROLE_VISUAL: Record<string, RoleVisual> = {
  MON_MAN: {
    emoji: "🍖",
    gradientClass: "bg-gradient-to-br from-amber-100 to-orange-200",
  },
  MON_XAO: {
    emoji: "🥘",
    gradientClass: "bg-gradient-to-br from-orange-100 to-amber-200",
  },
  CANH_SUP: {
    emoji: "🍲",
    gradientClass: "bg-gradient-to-br from-sky-100 to-cyan-200",
  },
  RAU_LUOC: {
    emoji: "🥗",
    gradientClass: "bg-gradient-to-br from-lime-100 to-green-200",
  },
  LAU: {
    emoji: "🍲",
    gradientClass: "bg-gradient-to-br from-red-100 to-rose-200",
  },
  COM_BUN_PHO: {
    emoji: "🍜",
    gradientClass: "bg-gradient-to-br from-yellow-100 to-amber-200",
  },
  MON_CUON: {
    emoji: "🌯",
    gradientClass: "bg-gradient-to-br from-emerald-100 to-teal-200",
  },
  TRANG_MIENG: {
    emoji: "🍧",
    gradientClass: "bg-gradient-to-br from-pink-100 to-fuchsia-200",
  },
  DO_CHUA: {
    emoji: "🥬",
    gradientClass: "bg-gradient-to-br from-teal-100 to-emerald-200",
  },
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

/** Dựng kết quả từ một món catalog đã khớp. Món chưa có ảnh thì vẫn trả slug —
 *  gọi bên ngoài biết là khớp được, chỉ là chưa có ảnh để dùng. */
function hit(dish: CatalogDishData, dishRole: string): DishVisual {
  if (!dish.imageUrl) return { ...fallback(dishRole), slug: dish.slug };
  const rv = ROLE_VISUAL[dish.dishRole] ?? NEUTRAL_VISUAL;
  return {
    imageUrl: dish.imageUrl,
    credit: dish.imageCredit ?? null,
    emoji: rv.emoji,
    gradientClass: rv.gradientClass,
    slug: dish.slug,
  };
}

export function resolveDishVisual(name: string, dishRole: string): DishVisual {
  const dish = findCatalogDish(name, dishRole);
  if (!dish) return fallback(dishRole);
  return hit(dish, dishRole);
}

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
