import { prisma } from "./db";
import { getAIProvider } from "./ai";
import { buildMenuContext, saveMenu } from "./menu";
import type { MealTypeStr, MenuSlot } from "./ai/types";
import type { GenerationJob } from "@prisma/client";

// Quản lý job tạo thực đơn chạy ngầm: đọc trạng thái (kèm xử lý job treo) và
// hàm xử lý chạy nền. Đây là module server thường (KHÔNG "use server") nên được
// export cả các hàm không phải Server Action.

// Job RUNNING/PENDING cũ hơn mốc này coi như treo (server có thể đã restart giữa
// chừng) và bị đánh dấu FAILED để không kẹt mãi.
const STALE_MS = 5 * 60 * 1000; // 5 phút
// Job FAILED chỉ hiện trên dashboard trong khoảng này (tránh lỗi cũ hiện mãi).
const FAILED_VISIBLE_MS = 60 * 60 * 1000; // 1 giờ

const ACTIVE_STATUSES = ["PENDING", "RUNNING"] as const;

/** yyyy-mm-dd theo giờ địa phương (khớp cách lưu ở startGenerationAction). */
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Đánh dấu FAILED những job active đã treo quá lâu. Trả về số job bị đánh dấu. */
async function failStaleJobs(familyId: string): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_MS);
  await prisma.generationJob.updateMany({
    where: {
      familyId,
      status: { in: [...ACTIVE_STATUSES] },
      createdAt: { lt: cutoff },
    },
    data: {
      status: "FAILED",
      error: "Quá thời gian tạo (server có thể đã khởi động lại). Vui lòng thử lại.",
      finishedAt: new Date(),
    },
  });
}

/**
 * Job đang chạy của gia đình (PENDING/RUNNING), sau khi đã dọn job treo.
 * null nếu không có job active thực sự.
 */
export async function getActiveJob(
  familyId: string,
): Promise<GenerationJob | null> {
  await failStaleJobs(familyId);
  return prisma.generationJob.findFirst({
    where: { familyId, status: { in: [...ACTIVE_STATUSES] } },
    orderBy: { createdAt: "desc" },
  });
}

/** Job FAILED gần đây nhất còn trong thời hạn hiển thị (chưa được ack/xoá). */
export async function getRecentFailedJob(
  familyId: string,
): Promise<GenerationJob | null> {
  await failStaleJobs(familyId);
  return prisma.generationJob.findFirst({
    where: {
      familyId,
      status: "FAILED",
      finishedAt: { gte: new Date(Date.now() - FAILED_VISIBLE_MS) },
    },
    orderBy: { finishedAt: "desc" },
  });
}

/**
 * Chạy nền một job: gọi AI, lưu thực đơn, cập nhật trạng thái. Không ném lỗi ra
 * ngoài (mọi lỗi được ghi vào job.error) vì được gọi qua after() sau response.
 */
export async function processGenerationJob(jobId: string): Promise<void> {
  const job = await prisma.generationJob.update({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  try {
    const slots: MenuSlot[] = job.mealTypes.map((mealType) => ({
      date: ymd(job.date),
      mealType: mealType as MealTypeStr,
    }));

    const provider = await getAIProvider(job.familyId);
    const ctx = await buildMenuContext(job.familyId, slots);
    const menu = await provider.generateMenu(ctx);
    await saveMenu(job.familyId, menu);

    await prisma.generationJob.update({
      where: { id: jobId },
      data: { status: "DONE", finishedAt: new Date() },
    });
  } catch (e) {
    await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        error:
          (e instanceof Error ? e.message : "Không tạo được thực đơn.") +
          " — kiểm tra API key/model hoặc thử lại.",
        finishedAt: new Date(),
      },
    });
  }
}
