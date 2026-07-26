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

export function resolveDishVisual(name: string, dishRole: string): DishVisual {
  return fallback(dishRole);
}
