import {
  allDishes,
  allSetMenus,
  getDishBySlug,
  type CatalogDishData,
} from "@/data/catalog";
import { normalizeIngredient } from "./normalize";
import type { MenuMember, MenuProfile, CatalogReference } from "./ai/types";

// Chọn lọc kho món để làm THAM CHIẾU few-shot cho AI: loại món phạm dị ứng/kiêng
// khem của các thành viên, ưu tiên vùng khẩu vị, rồi lấy một tập đa dạng theo
// vai trò món. Cũng chọn vài set menu "sạch" (mọi món đều hợp lệ) để gợi ý mâm.

/** Từ khoá (đã chuẩn hoá) trong dị ứng/kiêng -> tag catalog cần LOẠI. */
const KEYWORD_TO_TAG: { keys: string[]; tag: string }[] = [
  { keys: ["hai san", "do bien", "tom", "cua", "muc", "ngheu", "ngao", "so"], tag: "chua-hai-san" },
  { keys: ["ca"], tag: "chua-ca" },
  { keys: ["dau phong", "lac", "dau phong rang"], tag: "chua-dau-phong" },
  { keys: ["trung"], tag: "chua-trung" },
  { keys: ["sua", "pho mai", "bo sua"], tag: "chua-sua" },
  { keys: ["thit bo", "bo"], tag: "chua-bo" },
  { keys: ["thit heo", "thit lon", "heo", "lon"], tag: "chua-heo" },
  { keys: ["thit ga", "ga", "gia cam"], tag: "chua-ga" },
  { keys: ["dau nanh", "dau phu", "dau hu", "tuong"], tag: "chua-dau-nanh" },
  { keys: ["gluten", "bot mi", "lua mi"], tag: "chua-gluten" },
];

/** Tập tag cần loại + có ăn chay không, suy từ hồ sơ thành viên. */
export function deriveDietConstraints(members: MenuMember[]): {
  excludeTags: Set<string>;
  vegetarianOnly: boolean;
} {
  const excludeTags = new Set<string>();
  let vegetarianOnly = false;

  for (const m of members) {
    for (const raw of [...m.allergies, ...m.dietaryRestrictions]) {
      const n = normalizeIngredient(raw);
      if (!n) continue;
      if (n.includes("chay")) vegetarianOnly = true;
      for (const { keys, tag } of KEYWORD_TO_TAG) {
        if (keys.some((k) => n.includes(k))) excludeTags.add(tag);
      }
    }
  }
  return { excludeTags, vegetarianOnly };
}

/** Món có hợp lệ với ràng buộc ăn uống không. */
function dishAllowed(
  d: CatalogDishData,
  excludeTags: Set<string>,
  vegetarianOnly: boolean,
): boolean {
  if (vegetarianOnly && !d.tags.includes("chay")) return false;
  return !d.tags.some((t) => excludeTags.has(t));
}

// Thứ tự vai trò ưu tiên khi lấy mẫu đa dạng cho prompt.
const ROLE_ORDER = [
  "MON_MAN",
  "CANH_SUP",
  "MON_XAO",
  "RAU_LUOC",
  "COM_BUN_PHO",
  "MON_CUON",
  "LAU",
  "DO_CHUA",
  "TRANG_MIENG",
] as const;

/**
 * Dựng tham chiếu catalog cho một ngữ cảnh gia đình. Không phụ thuộc DB (đọc
 * dữ liệu tĩnh), nên gọi được ở bất kỳ đâu.
 * @param maxDishes số món tối đa đưa vào prompt (mặc định 18) để prompt gọn.
 */
export function buildCatalogReference(
  members: MenuMember[],
  profile: MenuProfile,
  maxDishes = 18,
): CatalogReference {
  const { excludeTags, vegetarianOnly } = deriveDietConstraints(members);

  const allowed = allDishes.filter((d) =>
    dishAllowed(d, excludeTags, vegetarianOnly),
  );

  // Ưu tiên món đúng vùng khẩu vị, rồi tới món linh hoạt (không cố định vùng).
  const region = profile.cuisineRegion;
  const scoreRegion = (d: CatalogDishData): number => {
    if (region === "KHONG_CO_KHAU_VI") return 0;
    if (d.region === region) return 2;
    if (d.region === "KHONG_CO_KHAU_VI") return 1;
    return 0;
  };

  // Lấy mẫu đa dạng: xoay vòng theo vai trò món, trong mỗi vai trò ưu tiên điểm vùng.
  const byRole = new Map<string, CatalogDishData[]>();
  for (const d of allowed) {
    const arr = byRole.get(d.dishRole) ?? [];
    arr.push(d);
    byRole.set(d.dishRole, arr);
  }
  for (const arr of byRole.values()) {
    arr.sort((a, b) => scoreRegion(b) - scoreRegion(a));
  }

  const picked: CatalogDishData[] = [];
  const cursors = new Map<string, number>();
  let progressed = true;
  while (picked.length < maxDishes && progressed) {
    progressed = false;
    for (const role of ROLE_ORDER) {
      if (picked.length >= maxDishes) break;
      const arr = byRole.get(role);
      if (!arr) continue;
      const i = cursors.get(role) ?? 0;
      if (i < arr.length) {
        picked.push(arr[i]);
        cursors.set(role, i + 1);
        progressed = true;
      }
    }
  }

  // Chọn tối đa 4 set menu mà MỌI món trong mâm đều hợp lệ.
  const setMenus = allSetMenus
    .filter((m) =>
      m.dishSlugs.every((slug) => {
        const d = getDishBySlug(slug);
        return d && dishAllowed(d, excludeTags, vegetarianOnly);
      }),
    )
    .filter(
      (m) =>
        region === "KHONG_CO_KHAU_VI" ||
        m.region === region ||
        m.region === "KHONG_CO_KHAU_VI",
    )
    .slice(0, 4)
    .map((m) => ({
      name: m.name,
      dishNames: m.dishSlugs
        .map((s) => getDishBySlug(s)?.name)
        .filter((n): n is string => Boolean(n)),
    }));

  return { dishNames: picked.map((d) => d.name), setMenus };
}
