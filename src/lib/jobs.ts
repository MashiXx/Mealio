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
import { verifyWeekPlan, weekPlanRetryNote } from "./week-plan";
import { expandDay } from "./expand-plan";
import { staleJobMs } from "./ai/timeout";
import { aiWeekPlanSchema, type AiWeekPlan } from "./ai/schema";
import type { MealTypeStr, MenuContext, AIProvider } from "./ai/types";
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
//
// SUY RA từ ngưỡng timeout của một lời gọi AI, KHÔNG đặt rời. Bản trước đóng
// cứng 5 phút trong khi một vòng Ollama trên CPU mất hàng phút — reaper giết
// sạch job đang chạy đàng hoàng, và đó chính là "timeout" khi sinh nhiều ngày.
// Buộc hai con số vào nhau thì chúng không thể trôi lệch nữa.
const STALE_MS = staleJobMs();
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
    // Khoảng ngày: job.date là ngày ĐẦU, job.days là số ngày. days=1 -> y hệt cũ.
    const days = Math.max(1, Math.min(7, job.days));
    const dateList: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(job.date);
      d.setDate(d.getDate() + i);
      dateList.push(ymd(d));
    }
    const rawSlots = dateList.flatMap((date) =>
      job.mealTypes.map((mealType) => ({
        date,
        mealType: mealType as MealTypeStr,
      })),
    );

    const mode = job.pantryMode as "AVAILABLE_ONLY" | "FLEXIBLE";
    const ctx = await buildMenuContext(
      job.familyId,
      rawSlots,
      job.dishCount,
      mode,
    );

    // Job xếp hàng lúc kho còn đồ, tới lượt chạy thì kho đã bị dọn. Prompt sẽ
    // thành "nhà chỉ có bấy nhiêu: (nước mắm, muối, tỏi)" kèm LUẬT CỨNG — vô
    // nghĩa, mà một vòng Ollama trên CPU mất hàng phút (chưa kể vòng sinh lại chắc
    // chắn thất bại sau đó). Dừng tại đây, nói thật lý do.
    //
    // Điều kiện phải TRÙNG với chốt ở form (startGenerationAction): "không còn
    // nguyên liệu chính nào", không phải "kho sạch trơn". Kho chỉ còn mắm muối thì
    // form đã chặn, nên nếu ở đây chỉ đếm số dòng thì hai chốt trôi lệch nhau và
    // đúng ca kho nghèo lọt qua. ctx.pantry.kind đã là kind HIỆU LỰC (menu.ts giải
    // NULL bằng bảng tĩnh) nên không cần truy vấn thêm.
    if (mode === "AVAILABLE_ONLY" && ctx.pantry.every((p) => p.kind !== "MAIN")) {
      await prisma.generationJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          error:
            "Kho nhà không còn nguyên liệu chính nào nên không nấu được bằng đồ có sẵn. Thêm đồ tươi ở trang Kho nhà rồi tạo lại, hoặc chọn chế độ Thoải mái.",
          finishedAt: new Date(),
        },
      });
      return;
    }

    const provider = await getAIProvider(job.familyId);

    // Mỗi nhánh gọi AI ĐÚNG MỘT LẦN (trừ SINGLE có thể retry kho), nhờ vậy không
    // job nào chạm ngưỡng treo dù đợt dài bao nhiêu ngày.
    if (job.kind === "PLAN") {
      await runPlanJob(job, jobId, ctx, dateList, provider);
      // Job PLAN chỉ dựng khung, chưa có mâm nào -> chưa cần đồng bộ đi chợ.
      await markDone(jobId);
      return;
    }

    if (job.kind === "EXPAND_DAY") {
      await runExpandDayJob(job, jobId, ctx, provider);
    } else {
      // SINGLE: ĐƯỜNG CŨ, GIỮ NGUYÊN — sinh một lượt kèm công thức, nhánh
      // AVAILABLE_ONLY vẫn verify kho như trước.
      await runSingleDay(job, jobId, ctx, mode, provider);
    }

    // Danh sách đi chợ là sản phẩm PHÁI SINH: hỏng nó không có nghĩa là hỏng thực
    // đơn. Tới đây mâm đã lưu xong và đã hiện trên bảng chính, nên để lỗi ném ra
    // ngoài sẽ đánh job thành FAILED kèm câu "kiểm tra API key/model" — sai lý do,
    // và người dùng có thể bấm sinh lại một vòng Ollama vô ích. syncShopping
    // idempotent nên lượt đồng bộ kế tiếp (sửa mâm, đổi kho, bấm "Đã nấu") tự chữa.
    //
    // Chạy sau MỖI ngày chứ không chỉ ngày cuối: các job-ngày độc lập nhau, ngày
    // giữa có thể hỏng, nên chờ tới ngày cuối là danh sách đi chợ có thể không
    // bao giờ được dựng. Nó idempotent nên chạy thừa chỉ tốn một transaction.
    try {
      await syncShopping(job.familyId);
    } catch (err) {
      console.error("[jobs] syncShopping lỗi sau khi đã lưu thực đơn:", err);
    }

    await markDone(jobId);
  } catch (err) {
    await failJob(jobId, err);
  }
}

/** Đánh DONE, nhưng chỉ khi job vẫn còn RUNNING (reaper có thể đã đụng vào). */
async function markDone(jobId: string): Promise<void> {
  await prisma.generationJob.updateMany({
    where: { id: jobId, status: "RUNNING" },
    data: { status: "DONE", finishedAt: new Date() },
  });
}

/**
 * Job PLAN: dựng khung cho cả đợt, verify, lưu khung, rồi ĐẺ RA các job-ngày.
 *
 * Đây là chỗ duy nhất AI nhìn trọn khoảng ngày. Khung được lưu xuống
 * MealPlan.planJson nên các job-ngày chạy rời nhau vẫn không trùng món và vẫn
 * xoay vòng đạm — thứ mà "chỉ đưa lịch sử ngày trước" không làm được, vì lịch sử
 * chỉ nhìn về sau.
 */
async function runPlanJob(
  job: GenerationJob,
  jobId: string,
  ctx: MenuContext,
  dateList: string[],
  provider: AIProvider,
): Promise<void> {
  let plan = await provider.generateWeekPlan(ctx);

  // Model hay phớt lờ luật cứng -> code kiểm lại. Chỉ sinh lại MỘT lần: vi phạm
  // hai lần thì nhận khung đó còn hơn bắt người dùng chờ thêm một vòng Ollama.
  const violations = verifyWeekPlan(plan, ctx.slots);
  if (violations.length > 0) {
    plan = await provider.generateWeekPlan({
      ...ctx,
      retryNote: weekPlanRetryNote(violations),
    });
  }

  // MealPlan + toàn bộ job-ngày tạo TRONG MỘT transaction: nửa vời ở đây nghĩa là
  // có khung mà không ai nở, hoặc job-ngày trỏ vào MealPlan không tồn tại.
  await prisma.$transaction(async (tx) => {
    const mealPlan = await tx.mealPlan.create({
      data: {
        familyId: job.familyId,
        startDate: new Date(`${dateList[0]}T00:00:00`),
        endDate: new Date(`${dateList[dateList.length - 1]}T00:00:00`),
        planJson: plan,
      },
      select: { id: true },
    });

    await tx.generationJob.update({
      where: { id: jobId },
      data: { mealPlanId: mealPlan.id },
    });

    await tx.generationJob.createMany({
      data: dateList.map((_, i) => ({
        familyId: job.familyId,
        kind: "EXPAND_DAY" as const,
        parentJobId: jobId,
        dayOffset: i,
        mealPlanId: mealPlan.id,
        // Ngày đích của job này; runGenerationJob dựng slot từ đây.
        date: new Date(`${dateList[i]}T00:00:00`),
        days: 1,
        mealTypes: job.mealTypes,
        dishCount: job.dishCount,
        pantryMode: job.pantryMode,
        status: "PENDING" as const,
      })),
    });
  });
}

/** Job EXPAND_DAY: nở đúng một ngày từ khung đã lưu, rồi lưu mâm. */
async function runExpandDayJob(
  job: GenerationJob,
  jobId: string,
  ctx: MenuContext,
  provider: AIProvider,
): Promise<void> {
  if (!job.mealPlanId) {
    throw new Error("Job nở ngày thiếu MealPlan — không có khung để nở.");
  }
  const mealPlan = await prisma.mealPlan.findUnique({
    where: { id: job.mealPlanId },
    select: { planJson: true },
  });
  const parsed = aiWeekPlanSchema.safeParse(mealPlan?.planJson);
  if (!parsed.success) {
    throw new Error(
      "Khung thực đơn của đợt này không đọc được. Hãy tạo lại thực đơn.",
    );
  }
  const plan: AiWeekPlan = parsed.data;

  const date = ymd(job.date);

  // Khung không có bữa nào cho ngày này thì DỪNG và nói thật. Nếu cứ chạy tiếp,
  // expandDay trả mảng rỗng, ta bỏ qua saveMenu rồi vẫn tăng doneDays — người
  // dùng thấy "7/7 ngày" trong khi chỉ có 6 ngày có cơm. Thà báo hỏng một ngày
  // còn hơn báo xong một thứ chưa xong.
  if (!plan.meals.some((m) => m.date === date)) {
    throw new Error(
      `Khung thực đơn không có bữa nào cho ngày ${date} — AI đã bỏ sót ngày này lúc dựng khung.`,
    );
  }

  const meals = await expandDay(plan, date, {
    provider,
    baseCtx: ctx,
    slots: ctx.slots,
    servings: Math.max(1, ctx.familySize),
  });

  if (meals.length === 0) {
    throw new Error(`Không nở được món nào cho ngày ${date}.`);
  }
  await saveMenu(job.familyId, { meals }, ctx.slots, job.mealPlanId);

  // Tiến độ nằm trên job PLAN để thẻ dashboard đọc một chỗ.
  if (job.parentJobId) {
    await prisma.generationJob.update({
      where: { id: job.parentJobId },
      data: { doneDays: { increment: 1 } },
    });
  }
}

/** Đường một ngày: y hệt hành vi trước khi có tính năng nhiều ngày. */
async function runSingleDay(
  job: { familyId: string },
  jobId: string,
  ctx: MenuContext,
  mode: "AVAILABLE_ONLY" | "FLEXIBLE",
  provider: AIProvider,
): Promise<void> {
  let menu = await provider.generateMenu(ctx);

  // Model có thể phớt lờ luật cứng trong prompt -> code kiểm lại. Chỉ sinh lại
  // MỘT lần: vi phạm hai lần thì giữ mâm còn hơn bắt người dùng chờ thêm một
  // vòng Ollama trên CPU. Phần thiếu còn lại không làm hỏng mâm — nó chảy tiếp
  // vào danh sách đi chợ ở syncShopping.
  if (mode === "AVAILABLE_ONLY") {
    const pantryNames = ctx.pantry.map((p) => p.name);
    const pantry = toPantrySet(pantryNames);
    // Cờ "đổi nhóm" phải nạp từ TOÀN BỘ Ingredient của gia đình. Dựng lookup từ
    // ctx.pantry là NO-OP: map khi đó chỉ chứa khoá của thứ ĐANG CÓ trong kho,
    // mà missingFor đã loại sạch những khoá đó ở vế "kho có rồi" nên chẳng bao
    // giờ hỏi tới kind của chúng; còn đúng tập cần xét — thứ KHÔNG có trong kho —
    // lại vắng mặt trong map nên rơi hết về bảng tĩnh. Kết quả y hệt truyền
    // staticKind, tức verify phớt lờ cờ người dùng trong khi syncShopping vẫn
    // tôn trọng nó: "mắm tôm" bị đổi thành SEASONING vẫn tốn một vòng sinh lại,
    // còn "hành lá" đổi thành MAIN thì lọt verify rồi hiện ở danh sách đi chợ.
    // Cũng KHÔNG tái dùng được ctx.pantry.kind: menu.ts đã ép `?? staticKind()`
    // nên ở đó không còn phân biệt cờ của gia đình với mặc định tĩnh.
    const familyIngredients = await prisma.ingredient.findMany({
      where: { familyId: job.familyId },
      select: { name: true, kind: true },
    });
    const kindOf = kindLookupFrom(familyIngredients);
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
}

/** Đánh job FAILED kèm lý do. Không ném lỗi ra ngoài. */
async function failJob(jobId: string, e: unknown): Promise<void> {
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
    // createdAt tăng dần theo thứ tự tạo, mà job-ngày được tạo SAU job PLAN nên
    // "mới nhất" luôn là job đang thật sự chạy trong đợt.
    orderBy: { createdAt: "desc" },
  });
}

/** Tiến độ của cả ĐỢT nhiều ngày, đọc từ job PLAN. null = không phải đợt nhiều ngày. */
export type JobProgress = { days: number; doneDays: number };

/**
 * Tiến độ hiển thị cho một job đang chạy.
 *
 * Đợt nhiều ngày bị tách thành job PLAN + N job-ngày, nên bản thân job đang chạy
 * (một job-ngày) chỉ biết phần của nó. Con số "3/7" nằm trên job PLAN.
 */
export async function getJobProgress(
  job: GenerationJob,
): Promise<JobProgress | null> {
  if (job.kind === "PLAN") {
    return { days: job.days, doneDays: job.doneDays };
  }
  if (job.kind === "EXPAND_DAY" && job.parentJobId) {
    const parent = await prisma.generationJob.findUnique({
      where: { id: job.parentJobId },
      select: { days: true, doneDays: true },
    });
    return parent ? { days: parent.days, doneDays: parent.doneDays } : null;
  }
  return null;
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
