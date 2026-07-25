import type { MealTypeStr, DishRoleStr } from "./ai/types";

// Cơ cấu mâm tính THUẦN ở server để prompt ghi rõ số món + vai trò, không nhờ
// model AI tự đếm. Cơm trắng ngầm định, KHÔNG tính là "món".

// Thứ tự hiển thị chuẩn của một mâm cơm Việt.
const ROLE_RANK: Record<DishRoleStr, number> = {
  MON_MAN: 0,
  MON_XAO: 1,
  RAU_LUOC: 2,
  CANH_SUP: 3,
  TRANG_MIENG: 4,
  DO_CHUA: 5,
  MON_CUON: 6,
  COM_BUN_PHO: 7,
  LAU: 8,
};

/** Số món tự động cho bữa chính theo số người. */
function autoCount(familySize: number): number {
  if (!Number.isFinite(familySize) || familySize < 1) return 2;
  if (familySize <= 2) return 2;
  if (familySize <= 4) return 3;
  return 4;
}

/** Vai trò cho bữa chính (trưa/tối) khi cần `count` món. */
function mainMealRoles(count: number): DishRoleStr[] {
  const n = Math.max(1, Math.min(5, count));
  if (n <= 1) return ["MON_MAN"];
  const roles: DishRoleStr[] = ["MON_MAN", "CANH_SUP"];
  const extras: DishRoleStr[] = ["MON_XAO", "RAU_LUOC", "TRANG_MIENG", "MON_MAN"];
  let i = 0;
  while (roles.length < n && i < extras.length) roles.push(extras[i++]);
  return roles.slice(0, n).sort((a, b) => ROLE_RANK[a] - ROLE_RANK[b]);
}

/**
 * Cơ cấu mâm cho một bữa.
 * - BREAKFAST: luôn 1 món COM_BUN_PHO (bỏ qua override).
 * - LUNCH/DINNER: số món = override (1..5) nếu hợp lệ, ngược lại tự động theo số người.
 */
export function planMealStructure(
  mealType: MealTypeStr,
  familySize: number,
  override?: number | null,
): DishRoleStr[] {
  if (mealType === "BREAKFAST") return ["COM_BUN_PHO"];
  const valid =
    typeof override === "number" &&
    Number.isInteger(override) &&
    override >= 1 &&
    override <= 5;
  const count = valid ? (override as number) : autoCount(familySize);
  return mainMealRoles(count);
}
