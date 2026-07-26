"use server";

import { revalidatePath } from "next/cache";
import { requireFamily } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { syncShopping } from "@/lib/shopping";

// Xoá mâm cơm. Tách khỏi actions/edit.ts vì file đó lo việc SỬA bằng AI, còn
// đây là thao tác thủ công không đụng tới AI.
//
// Xoá PlannedMeal là cascade sạch: MealDish và EditJob đều onDelete: Cascade.
// Recipe thành mồ côi — vốn đã vậy từ Giai đoạn 1, không mở rộng ở đây.

/** Nửa đêm giờ ĐỊA PHƯƠNG, khớp cách PlannedMeal.date được lưu (xem saveMenu). */
function localMidnight(ymd: string): Date {
  return new Date(`${ymd}T00:00:00`);
}

/** Còn job SỬA đang hoạt động cho mâm này không. */
async function hasActiveEditJob(
  familyId: string,
  plannedMealIds: string[],
): Promise<boolean> {
  if (plannedMealIds.length === 0) return false;
  const n = await prisma.editJob.count({
    where: {
      familyId,
      plannedMealId: { in: plannedMealIds },
      status: { in: ["PENDING", "RUNNING"] },
    },
  });
  return n > 0;
}

/**
 * Còn job SINH đang hoạt động cho NGÀY này không.
 *
 * Chặn mâm zombie: job EXPAND_DAY của ngày đó đang chạy nhưng chưa kịp gọi
 * saveMenu, ta xoá mâm xong thì lát sau nó tạo lại — người dùng tưởng nút xoá
 * hỏng. Chặn còn hơn huỷ job: huỷ một job PENDING của ĐỢT MỚI chính là huỷ thứ
 * người dùng vừa yêu cầu sinh, mà lại im lặng.
 */
async function hasActiveGenerationForDate(
  familyId: string,
  dates: Date[],
): Promise<boolean> {
  if (dates.length === 0) return false;
  const n = await prisma.generationJob.count({
    where: {
      familyId,
      date: { in: dates },
      status: { in: ["PENDING", "RUNNING"] },
    },
  });
  return n > 0;
}

/** Sau khi xoá: danh sách đi chợ phải tính lại, và cả hai trang phải làm mới. */
async function afterDelete(familyId: string): Promise<void> {
  await syncShopping(familyId);
  revalidatePath("/dashboard");
  revalidatePath("/history");
}

/** Xoá một mâm. Bỏ qua im lặng nếu mâm không thuộc gia đình này. */
export async function deleteMealAction(formData: FormData): Promise<void> {
  const { familyId } = await requireFamily();
  const plannedMealId = String(formData.get("plannedMealId") ?? "");
  if (!plannedMealId) return;

  // Xác minh quyền sở hữu TRƯỚC mọi thứ khác — mọi truy vấn sau đều kèm familyId
  // nhưng kiểm ở đây cho ý đồ rõ ràng và để thoát sớm.
  const meal = await prisma.plannedMeal.findFirst({
    where: { id: plannedMealId, familyId },
    select: { id: true, date: true },
  });
  if (!meal) return;

  // Xoá trong khi AI đang sửa mâm thì worker sẽ nổ lúc áp kết quả (EditJob bị
  // cascade xoá mất). Chặn trước, để người dùng thử lại sau vài giây.
  if (await hasActiveEditJob(familyId, [plannedMealId])) return;
  if (await hasActiveGenerationForDate(familyId, [meal.date])) return;

  await prisma.plannedMeal.deleteMany({ where: { id: plannedMealId, familyId } });
  await afterDelete(familyId);
}

/** Xoá mọi bữa của MỘT ngày. `date` dạng yyyy-mm-dd. */
export async function deleteDayAction(formData: FormData): Promise<void> {
  const { familyId } = await requireFamily();
  const date = String(formData.get("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

  const day = localMidnight(date);
  const meals = await prisma.plannedMeal.findMany({
    where: { familyId, date: day },
    select: { id: true },
  });
  if (meals.length === 0) return;

  if (await hasActiveEditJob(familyId, meals.map((m) => m.id))) return;
  if (await hasActiveGenerationForDate(familyId, [day])) return;

  await prisma.plannedMeal.deleteMany({ where: { familyId, date: day } });
  await afterDelete(familyId);
}
