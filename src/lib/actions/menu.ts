"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { requireFamily } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { getActiveJob, processGenerationJob } from "@/lib/jobs";
import type { MealTypeStr } from "@/lib/ai/types";

export type GenerateState = { error?: string };

const MEAL_TYPES: MealTypeStr[] = ["BREAKFAST", "LUNCH", "DINNER"];

/**
 * Tạo job tạo thực đơn rồi CHẠY NGẦM: trả về/redirect ngay, việc gọi AI diễn ra
 * sau response qua after() nên user rời trang cũng không mất. Mỗi gia đình chỉ
 * 1 job active tại một thời điểm (chống trùng).
 */
export async function startGenerationAction(
  _prev: GenerateState,
  formData: FormData,
): Promise<GenerateState> {
  const { familyId } = await requireFamily();

  const date = String(formData.get("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: "Vui lòng chọn ngày hợp lệ." };
  }

  const selected = formData
    .getAll("mealTypes")
    .map(String)
    .filter((m): m is MealTypeStr => (MEAL_TYPES as string[]).includes(m));

  if (selected.length === 0) {
    return { error: "Chọn ít nhất một bữa (sáng/trưa/tối)." };
  }

  // Chống trùng: đã có job đang chạy thì không tạo thêm.
  const active = await getActiveJob(familyId);
  if (active) {
    return { error: "Đang có thực đơn được tạo, vui lòng đợi hoàn tất." };
  }

  const job = await prisma.generationJob.create({
    data: {
      familyId,
      date: new Date(`${date}T00:00:00`), // midnight local
      mealTypes: selected,
      status: "PENDING",
    },
  });

  // Đăng ký chạy nền TRƯỚC redirect (redirect ném lỗi để ngắt; after vẫn chạy).
  after(() => processGenerationJob(job.id));

  redirect(`/dashboard?date=${date}`);
}

/** Bỏ qua (xoá) một job FAILED để không hiện thẻ lỗi nữa. */
export async function ackJobAction(formData: FormData): Promise<void> {
  const { familyId } = await requireFamily();
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) return;
  // deleteMany + điều kiện familyId: đảm bảo chỉ xoá job của chính gia đình mình.
  await prisma.generationJob.deleteMany({
    where: { id: jobId, familyId, status: "FAILED" },
  });
}
