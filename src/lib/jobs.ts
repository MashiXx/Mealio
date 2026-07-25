import { prisma } from "./db";
import { getAIProvider } from "./ai";
import { buildMenuContext, saveMenu } from "./menu";
import { buildEditContext, applyEdit } from "./edit";
import {
  toPantrySet,
  kindLookupFrom,
  verifyMenuAgainstPantry,
  violationNote,
} from "./pantry";
import { syncShopping } from "./shopping";
import type { MealTypeStr } from "./ai/types";
import type { GenerationJob, EditJob } from "@prisma/client";

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
  const data = {
    status: "FAILED" as const,
    error:
      "Quá thời gian xử lý (server có thể đã khởi động lại). Vui lòng thử lại.",
    finishedAt: new Date(),
  };
  await prisma.generationJob.updateMany({
    where: { status: "RUNNING", startedAt: { lt: cutoff } },
    data,
  });
  await prisma.editJob.updateMany({
    where: { status: "RUNNING", startedAt: { lt: cutoff } },
    data,
  });
}

/** Số job đang RUNNING trên toàn hệ thống (cả tạo menu lẫn sửa) — cùng trần 1 GPU. */
async function countRunning(): Promise<number> {
  const [g, e] = await Promise.all([
    prisma.generationJob.count({ where: { status: "RUNNING" } }),
    prisma.editJob.count({ where: { status: "RUNNING" } }),
  ]);
  return g + e;
}

// ------------------------------------------------------------------
// Bộ điều phối (pump): giữ số job RUNNING không vượt CONCURRENCY, kéo job
// PENDING cũ nhất lên chạy khi còn chỗ. Khoá trong-process để không có hai pump
// chạy song song (tránh vượt trần). Coalesce: xin pump khi đang bận -> chạy lại.
// ------------------------------------------------------------------

let pumpRunning = false;
let pumpQueued = false;

/**
 * Một lượt lấp đầy chỗ trống: đếm RUNNING (chung 2 loại job), claim PENDING cũ
 * nhất — chọn liền mạch giữa hàng GenerationJob và EditJob theo createdAt — tới
 * khi đầy trần đồng thời.
 */
async function pumpOnce(): Promise<void> {
  await failStaleRunning();

  for (;;) {
    if ((await countRunning()) >= CONCURRENCY) return;

    const [nextGen, nextEdit] = await Promise.all([
      prisma.generationJob.findFirst({
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
      }),
      prisma.editJob.findFirst({
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    if (!nextGen && !nextEdit) return;

    // Ưu tiên job có createdAt nhỏ hơn (FIFO liền mạch giữa 2 hàng).
    const pickEdit =
      nextEdit && (!nextGen || nextEdit.createdAt < nextGen.createdAt);

    if (pickEdit) {
      const claimed = await prisma.editJob.updateMany({
        where: { id: nextEdit!.id, status: "PENDING" },
        data: { status: "RUNNING", startedAt: new Date() },
      });
      if (claimed.count === 0) continue;
      void runEditJob(nextEdit!.id).finally(() => void pumpJobs());
    } else {
      const claimed = await prisma.generationJob.updateMany({
        where: { id: nextGen!.id, status: "PENDING" },
        data: { status: "RUNNING", startedAt: new Date() },
      });
      if (claimed.count === 0) continue;
      void runGenerationJob(nextGen!.id).finally(() => void pumpJobs());
    }
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
async function runGenerationJob(jobId: string): Promise<void> {
  const job = await prisma.generationJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  try {
    const rawSlots = job.mealTypes.map((mealType) => ({
      date: ymd(job.date),
      mealType: mealType as MealTypeStr,
    }));

    const mode = job.pantryMode as "AVAILABLE_ONLY" | "FLEXIBLE";
    const ctx = await buildMenuContext(
      job.familyId,
      rawSlots,
      job.dishCount,
      mode,
    );

    // Job xếp hàng lúc kho còn đồ, tới lượt chạy thì người dùng đã dọn sạch kho.
    // Prompt sẽ thành "nhà chỉ có bấy nhiêu: (kho trống)" kèm LUẬT CỨNG — vô
    // nghĩa, mà một vòng Ollama trên CPU mất hàng phút. Dừng tại đây, nói thật lý
    // do thay vì đốt thời gian rồi trả về mâm bịa. (Form đã chặn ca kho rỗng lúc
    // tạo job; đây là ca kho bị dọn SAU đó, form không với tới được.)
    if (mode === "AVAILABLE_ONLY" && ctx.pantry.length === 0) {
      await prisma.generationJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          error:
            "Kho nhà đã trống nên không nấu được bằng đồ có sẵn. Thêm nguyên liệu ở trang Kho nhà rồi tạo lại, hoặc chọn chế độ Thoải mái.",
          finishedAt: new Date(),
        },
      });
      return;
    }

    const provider = await getAIProvider(job.familyId);
    let menu = await provider.generateMenu(ctx);

    // Model có thể phớt lờ luật cứng trong prompt -> code kiểm lại. Chỉ sinh lại
    // MỘT lần: vi phạm hai lần thì giữ mâm còn hơn bắt người dùng chờ thêm một
    // vòng Ollama trên CPU. Phần thiếu còn lại không làm hỏng mâm — nó chảy tiếp
    // vào danh sách đi chợ ở syncShopping bên dưới.
    if (mode === "AVAILABLE_ONLY") {
      const pantryNames = ctx.pantry.map((p) => p.name);
      const pantry = toPantrySet(pantryNames);
      // Cờ kind của gia đình thắng bảng gia vị tĩnh: người dùng đã bấm "đổi nhóm"
      // cho nguyên liệu nào thì ý họ phải có hiệu lực ở cả verify lẫn đi chợ.
      const kindOf = kindLookupFrom(ctx.pantry);
      const violations = verifyMenuAgainstPantry(menu, pantry, kindOf);
      if (violations.length > 0) {
        // Chỉ gắn thêm câu nhắc vào ctx CŨ, không dựng lại từ DB: rẻ hơn, và
        // miễn nhiễm với việc kho đổi giữa hai vòng AI — nếu dựng lại mà lúc đó
        // kho vừa bị dọn sạch thì prompt lần hai lại thành "(kho trống)" trong
        // khi câu nhắc vẫn kể tên nguyên liệu cũ, tự mâu thuẫn.
        menu = await provider.generateMenu({
          ...ctx,
          retryNote: violationNote(violations, pantryNames),
        });
      }
    }

    // ctx.slots mang cơ cấu mâm đã yêu cầu cho từng bữa -> mỗi PlannedMeal ghi
    // lại số món đáng lẽ có, để bảng chính biết mâm nào thật sự bị hụt.
    await saveMenu(job.familyId, menu, ctx.slots);
    await syncShopping(job.familyId);

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

/** Worker cho EditJob: dựng ngữ cảnh, gọi AI sửa mâm, áp kết quả. */
async function runEditJob(jobId: string): Promise<void> {
  const job = await prisma.editJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  try {
    const provider = await getAIProvider(job.familyId);
    const ctx = await buildEditContext(job);
    const result = await provider.editMeal(ctx);
    await applyEdit(job, result);

    await prisma.editJob.update({
      where: { id: jobId },
      data: { status: "DONE", finishedAt: new Date() },
    });
  } catch (e) {
    await prisma.editJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        error:
          (e instanceof Error ? e.message : "Không sửa được mâm.") +
          " — thử lại hoặc kiểm tra AI.",
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

/** EditJob active (PENDING/RUNNING) của gia đình — để UI hiện spinner đúng chỗ. */
export async function getActiveEditJobs(
  familyId: string,
): Promise<
  Pick<EditJob, "id" | "plannedMealId" | "mealDishId" | "scope" | "status">[]
> {
  void pumpJobs();
  return prisma.editJob.findMany({
    where: { familyId, status: { in: [...ACTIVE_STATUSES] } },
    select: {
      id: true,
      plannedMealId: true,
      mealDishId: true,
      scope: true,
      status: true,
    },
  });
}

/** EditJob FAILED gần đây còn trong hạn hiển thị. */
export async function getRecentFailedEditJobs(
  familyId: string,
): Promise<Pick<EditJob, "id" | "plannedMealId" | "error">[]> {
  return prisma.editJob.findMany({
    where: {
      familyId,
      status: "FAILED",
      finishedAt: { gte: new Date(Date.now() - FAILED_VISIBLE_MS) },
    },
    orderBy: { finishedAt: "desc" },
    select: { id: true, plannedMealId: true, error: true },
  });
}
