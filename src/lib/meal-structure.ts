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

/**
 * Vai trò cho bữa chính (trưa/tối) khi cần `count` món.
 *
 * Thứ tự `extras` bám đúng cơ cấu mâm người dùng muốn: đạm + rau + canh, món thứ
 * tư là TRÁNG MIỆNG chứ không phải rau luộc. Để rau luộc ở vị trí thứ tư thì mâm
 * 4 món có tới hai món rau (xào + luộc) mà không có gì tráng miệng.
 */
function mainMealRoles(count: number): DishRoleStr[] {
  const n = Math.max(1, Math.min(5, count));
  if (n <= 1) return ["MON_MAN"];
  const roles: DishRoleStr[] = ["MON_MAN", "CANH_SUP"];
  const extras: DishRoleStr[] = ["MON_XAO", "TRANG_MIENG", "RAU_LUOC", "MON_MAN"];
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

/**
 * Ép danh sách món AI trả về khớp KHUNG đã yêu cầu. Trả về tối đa `roles.length`
 * món, xếp theo đúng thứ tự vai trò của khung.
 *
 * Vì sao cần: prompt đã ghi rõ số món và vai trò, nhưng không tầng nào kiểm lại
 * kết quả — schema chỉ đòi `dishes.min(1)`, verifyWeekPlan chỉ soi KHUNG của
 * nhánh nhiều ngày và còn chấp nhận vi phạm sau một lần sinh lại, còn saveMenu
 * thì ghi hết. Nhà chọn 3 món mà AI trả 4 là mâm lưu đủ 4. Cùng một lập luận đã
 * dùng cho verifyWeekPlan và verifyMenuAgainstPantry: model hay phớt lờ luật,
 * nên code phải chốt lại.
 *
 * Khớp theo VAI TRÒ trước rồi mới lấp chỗ trống bằng món còn thừa, chứ không cắt
 * thẳng `slice(0, n)`: AI trả hai món mặn và thiếu món xào thì cắt thẳng sẽ giữ
 * cả hai món mặn rồi vứt mất món canh. Lấp bù để mâm thừa món không bị biến
 * thành mâm HỤT món — trả về ít hơn khung chỉ khi AI thật sự đưa thiếu, và ca đó
 * đã có cảnh báo "x/y món so với kế hoạch" ở bảng chính lo.
 *
 * `roles` rỗng = bữa nằm ngoài danh sách đã yêu cầu, không có căn cứ để siết nên
 * giữ nguyên — cùng lập luận với `dishCount = null` trong saveMenu.
 */
export function fitDishesToPlan<T extends { dishRole: DishRoleStr }>(
  dishes: T[],
  roles: DishRoleStr[],
): T[] {
  if (roles.length === 0) return dishes;

  const used = new Set<number>();
  const out: T[] = [];

  for (const role of roles) {
    const i = dishes.findIndex(
      (d, idx) => !used.has(idx) && d.dishRole === role,
    );
    if (i === -1) continue;
    used.add(i);
    out.push(dishes[i]);
  }

  for (let i = 0; i < dishes.length && out.length < roles.length; i++) {
    if (used.has(i)) continue;
    out.push(dishes[i]);
  }

  return out;
}
