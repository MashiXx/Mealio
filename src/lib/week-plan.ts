import { normalizeIngredient } from "./normalize";
import { MEAL_TYPE_LABEL, DISH_ROLE_LABEL } from "./enums";
import type { AiWeekPlan } from "./ai/schema";
import type { MenuSlot } from "./ai/types";

// Kiểm khung thực đơn nhiều ngày do AI trả về. Thuần, không chạm DB.
//
// Vì sao cần: prompt có nêu luật, nhưng model (nhất là model nhỏ tự host) hay
// phớt lờ. Đây là cùng một lập luận đã dùng cho verifyMenuAgainstPantry.

/** Số thứ tự ngày từ chuỗi yyyy-mm-dd. Dùng Date.UTC để không lệch múi giờ. */
function dayNumber(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return NaN;
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

const keyOf = (date: string, mealType: string) => `${date}|${mealType}`;

const roleText = (roles: string[]) =>
  roles.map((r) => DISH_ROLE_LABEL[r] ?? r).join(", ");

const mealText = (date: string, mealType: string) =>
  `${MEAL_TYPE_LABEL[mealType] ?? mealType} ngày ${date}`;

/**
 * Trả về danh sách vi phạm bằng tiếng Việt (rỗng = đạt). Bốn luật:
 *
 * - R1: mỗi slot đã yêu cầu phải có mặt, đúng multiset vai trò.
 * - R2: không có (ngày, bữa) nào ngoài danh sách slot.
 * - R3: không hai món trùng tên trong cả khoảng — TRỪ vai trò DO_CHUA, vì dưa
 *   cà là thứ ăn kèm quanh năm, bắt mỗi ngày một loại là luật vô lý và chỉ tổ
 *   đốt một vòng sinh lại cho thứ người dùng còn chẳng coi là lỗi.
 * - R4: món mặn hai ngày LIỀN NHAU không cùng đạm chính. Không cấm trùng toàn
 *   khoảng: 7 ngày mà cấm tuyệt đối thì cần 7 loại đạm trong khi enum có 8, và
 *   nhà ăn chay sẽ không có lời giải nào.
 */
export function verifyWeekPlan(plan: AiWeekPlan, slots: MenuSlot[]): string[] {
  const violations: string[] = [];

  const bySlot = new Map(slots.map((s) => [keyOf(s.date, s.mealType), s]));
  const byPlan = new Map(plan.meals.map((m) => [keyOf(m.date, m.mealType), m]));

  // R1
  for (const s of slots) {
    const m = byPlan.get(keyOf(s.date, s.mealType));
    if (!m) {
      violations.push(`Thiếu ${mealText(s.date, s.mealType)}.`);
      continue;
    }
    const want = [...s.dishRoles].sort();
    const got = m.dishes.map((d) => d.dishRole).sort();
    if (want.join(",") !== got.join(",")) {
      violations.push(
        `${mealText(s.date, s.mealType)}: cần ${want.length} món (${roleText(want)}) nhưng nhận ${got.length} món (${roleText(got)}).`,
      );
    }
  }

  // R2
  for (const m of plan.meals) {
    if (!bySlot.has(keyOf(m.date, m.mealType))) {
      violations.push(
        `${mealText(m.date, m.mealType)} không nằm trong các bữa được yêu cầu.`,
      );
    }
  }

  // R3 — duyệt theo thứ tự ngày/bữa để thông báo tất định.
  const sortedMeals = [...plan.meals].sort((a, b) =>
    keyOf(a.date, a.mealType).localeCompare(keyOf(b.date, b.mealType)),
  );
  const seenName = new Map<string, string>();
  for (const m of sortedMeals) {
    for (const d of m.dishes) {
      if (d.dishRole === "DO_CHUA") continue;
      const n = normalizeIngredient(d.name);
      if (!n) continue;
      const prev = seenName.get(n);
      if (prev) {
        violations.push(`Món "${d.name}" lặp lại (đã có ở ${prev}).`);
      } else {
        seenName.set(n, mealText(m.date, m.mealType));
      }
    }
  }

  // R4
  const proteinsByDate = new Map<string, Set<string>>();
  for (const m of plan.meals) {
    for (const d of m.dishes) {
      if (d.dishRole !== "MON_MAN") continue;
      const set = proteinsByDate.get(m.date) ?? new Set<string>();
      set.add(d.mainProtein);
      proteinsByDate.set(m.date, set);
    }
  }
  const dates = [...proteinsByDate.keys()].sort();
  for (let i = 1; i < dates.length; i++) {
    const prev = dates[i - 1];
    const cur = dates[i];
    // Chỉ xét hai ngày SÁT NHAU thật; khung có lỗ ngày thì bỏ qua.
    if (dayNumber(cur) - dayNumber(prev) !== 1) continue;
    const dup = [...proteinsByDate.get(cur)!].filter((p) =>
      proteinsByDate.get(prev)!.has(p),
    );
    if (dup.length > 0) {
      violations.push(
        `Đạm chính (${dup.join(", ")}) lặp ở hai ngày liền ${prev} và ${cur}.`,
      );
    }
  }

  return violations;
}

/** Câu nhắc gửi lại cho AI khi khung phạm luật. */
export function weekPlanRetryNote(violations: string[]): string {
  return [
    "LẦN TRƯỚC BẠN TRẢ VỀ KHUNG SAI. Các lỗi cần sửa:",
    ...violations.map((v) => `  - ${v}`),
    "Hãy trả lại khung ĐẦY ĐỦ cho mọi bữa được yêu cầu, sửa hết các lỗi trên.",
  ].join("\n");
}
