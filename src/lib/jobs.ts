import { prisma } from "./db";
import { getAIProvider } from "./ai";
import { buildMenuContext, saveMenu } from "./menu";
import type { MealTypeStr } from "./ai/types";
import type { GenerationJob } from "@prisma/client";

// Quản lý job tạo thực đơn chạy ngầm với HÀNG ĐỢI + GIỚI HẠN ĐỒNG THỜI.
// Module server thường (KHÔNG "use server") nên export được cả hàm không phải
// Server Action. Chạy trong 1 process Next (next start).

// Số job được phép chạy cùng lúc TRÊN TOÀN HỆ THỐNG (mọi gia đình). Đặt qua env
// MENU_GEN_CONCURRENCY; mặc định 1 = mỗi lúc chỉ 1 job, số còn lại xếp hàng.
// Endpoint 30B/1 GPU nên để 1; nếu server khoẻ có thể tăng.
function readConcurrency(): number {
  const n = parseInt(process.env.MENU_GEN_CONCURRENCY ?? "1", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}
const CONCURRENCY = readConcurrency();

// RUNNING quá lâu coi như treo (server có thể đã restart giữa chừng) -> FAILED.
const STALE_MS = 5 * 60 * 1000; // 5 phút
// Job FAILED chỉ hiện trên dashboard trong khoảng này.
const FAILED_VISIBLE_MS = 60 * 60 * 1000; // 1 giờ

const ACTIVE_STATUSES = ["PENDING", "RUNNING"] as const;

/** yyyy-mm-dd theo giờ địa phương (khớp cách lưu ở startGenerationAction). */
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Đánh dấu FAILED các job RUNNING đã treo quá lâu. CHỈ nhắm RUNNING (dựa startedAt);
 * PENDING đang xếp hàng chờ tới lượt là hợp lệ, không phải treo.
 */
async function failStaleRunning(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_MS);
  await prisma.generationJob.updateMany({
    where: { status: "RUNNING", startedAt: { lt: cutoff } },
    data: {
      status: "FAILED",
      error: "Quá thời gian tạo (server có thể đã khởi động lại). Vui lòng thử lại.",
      finishedAt: new Date(),
    },
  });
}

// ------------------------------------------------------------------
// Bộ điều phối (pump): giữ số job RUNNING không vượt CONCURRENCY, kéo job
// PENDING cũ nhất lên chạy khi còn chỗ. Khoá trong-process để không có hai pump
// chạy song song (tránh vượt trần). Coalesce: xin pump khi đang bận -> chạy lại.
// ------------------------------------------------------------------

let pumpRunning = false;
let pumpQueued = false;

/** Một lượt lấp đầy chỗ trống: đếm RUNNING, claim PENDING cũ nhất tới khi đầy. */
async function pumpOnce(): Promise<void> {
  await failStaleRunning();

  for (;;) {
    const running = await prisma.generationJob.count({
      where: { status: "RUNNING" },
    });
    if (running >= CONCURRENCY) return;

    const next = await prisma.generationJob.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });
    if (!next) return;

    // Claim nguyên tử: chỉ chuyển RUNNING nếu vẫn còn PENDING (chống double-claim).
    const claimed = await prisma.generationJob.updateMany({
      where: { id: next.id, status: "PENDING" },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    if (claimed.count === 0) continue; // job đã bị lượt khác lấy

    // Chạy nền, không await để lấp tiếp các chỗ khác; xong thì pump lại.
    void runJob(next.id).finally(() => {
      void pumpJobs();
    });
  }
}

/** Điều phối hàng đợi. An toàn khi gọi nhiều lần (idempotent, có khoá). */
export async function pumpJobs(): Promise<void> {
  if (pumpRunning) {
    pumpQueued = true;
    return;
  }
  pumpRunning = true;
  try {
    do {
      pumpQueued = false;
      await pumpOnce();
    } while (pumpQueued);
  } finally {
    pumpRunning = false;
  }
}

/**
 * Worker: thực thi một job ĐÃ được claim (đang RUNNING). Gọi AI, lưu thực đơn,
 * cập nhật DONE/FAILED. Không ném lỗi ra ngoài.
 */
async function runJob(jobId: string): Promise<void> {
  const job = await prisma.generationJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  try {
    const rawSlots = job.mealTypes.map((mealType) => ({
      date: ymd(job.date),
      mealType: mealType as MealTypeStr,
    }));

    const provider = await getAIProvider(job.familyId);
    const ctx = await buildMenuContext(job.familyId, rawSlots, job.dishCount);
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

// ------------------------------------------------------------------
// Đọc trạng thái (kèm tự chữa lành: mỗi lần đọc cũng kích pump để kéo các job
// PENDING mồ côi khi có chỗ trống).
// ------------------------------------------------------------------

/** Job active của gia đình (PENDING/RUNNING). null nếu không có. */
export async function getActiveJob(
  familyId: string,
): Promise<GenerationJob | null> {
  void pumpJobs(); // tự chữa: đảm bảo hàng đợi luôn được kéo
  return prisma.generationJob.findFirst({
    where: { familyId, status: { in: [...ACTIVE_STATUSES] } },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Vị trí của một job PENDING trong hàng đợi toàn hệ thống (1 = kế tiếp được chạy).
 * Đếm số job PENDING tạo trước nó + 1. Không có ý nghĩa với job RUNNING.
 */
export async function getQueuePosition(job: GenerationJob): Promise<number> {
  const ahead = await prisma.generationJob.count({
    where: { status: "PENDING", createdAt: { lt: job.createdAt } },
  });
  return ahead + 1;
}

/** Job FAILED gần đây nhất còn trong thời hạn hiển thị (chưa được ack/xoá). */
export async function getRecentFailedJob(
  familyId: string,
): Promise<GenerationJob | null> {
  return prisma.generationJob.findFirst({
    where: {
      familyId,
      status: "FAILED",
      finishedAt: { gte: new Date(Date.now() - FAILED_VISIBLE_MS) },
    },
    orderBy: { finishedAt: "desc" },
  });
}
