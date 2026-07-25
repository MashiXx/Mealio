import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireFamily } from "@/lib/tenant";
import { MEAL_TYPE_LABEL, DISH_ROLE_LABEL } from "@/lib/enums";
import { planMealStructure } from "@/lib/meal-structure";
import {
  getActiveJob,
  getRecentFailedJob,
  getQueuePosition,
  getActiveEditJobs,
  getRecentFailedEditJobs,
} from "@/lib/jobs";
import { ackJobAction } from "@/lib/actions/menu";
import { ackEditJobAction } from "@/lib/actions/edit";
import { JobPoller } from "./JobPoller";
import { MealCard, type MealView } from "./MealCard";

const MEAL_RANK: Record<string, number> = {
  BREAKFAST: 0,
  LUNCH: 1,
  DINNER: 2,
};

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDay(key: string): string {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { familyId } = await requireFamily();
  const { date: focusDate } = await searchParams;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  // Job trạng thái tách khỏi Promise.all: getActiveJob/getRecentFailedJob có
  // dọn job treo (ghi DB) nên chạy tuần tự cho tất định.
  const activeJob = await getActiveJob(familyId);
  const failedJob = activeJob ? null : await getRecentFailedJob(familyId);
  // Vị trí hàng đợi chỉ có nghĩa khi job đang chờ (PENDING).
  const queuePos =
    activeJob?.status === "PENDING" ? await getQueuePosition(activeJob) : null;

  const activeEditJobs = await getActiveEditJobs(familyId);
  const failedEditJobs = await getRecentFailedEditJobs(familyId);

  const [family, aiSettings, meals] = await Promise.all([
    prisma.family.findUnique({
      where: { id: familyId },
      include: { members: true, profile: true },
    }),
    prisma.aISettings.findUnique({ where: { familyId } }),
    prisma.plannedMeal.findMany({
      where: { familyId, date: { gte: startOfToday } },
      orderBy: { date: "asc" },
      include: {
        dishes: {
          orderBy: { position: "asc" },
          include: {
            recipe: { include: { ingredients: { include: { ingredient: true } } } },
          },
        },
      },
      take: 60,
    }),
  ]);

  // Gom nhóm theo ngày, sắp bữa theo thứ tự sáng/trưa/tối.
  const byDay = new Map<string, typeof meals>();
  for (const meal of meals) {
    const key = dayKey(meal.date);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(meal);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => MEAL_RANK[a.mealType] - MEAL_RANK[b.mealType]);
  }
  const days = [...byDay.keys()].sort();

  // Đã cấu hình AI khi có settings và: Ollama (không cần key) hoặc đã có API key.
  // Khớp quy tắc trong getAIProvider — nếu chỉ nhìn apiKeyEncrypted thì Ollama
  // (hợp lệ, không key) sẽ bị báo nhầm là "chưa cấu hình".
  const aiConfigured = Boolean(
    aiSettings &&
      (aiSettings.provider === "OLLAMA" || aiSettings.apiKeyEncrypted),
  );
  const allergies = [
    ...new Set(family?.members.flatMap((m) => m.allergies) ?? []),
  ];
  // Số người trong nhà — dùng để biết một mâm ĐÁNG LẼ có mấy món. Lấy từ `family`
  // đã nạp sẵn ở trên chứ không thêm một truy vấn count riêng.
  const familySize = family?.members.length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {family?.name ?? "Gia đình"}
          </h1>
          <p className="text-sm text-zinc-500">
            {family?.members.length ?? 0} thành viên
            {allergies.length > 0 && (
              <>
                {" · "}
                <span className="text-red-600">
                  Dị ứng: {allergies.join(", ")}
                </span>
              </>
            )}
          </p>
        </div>
        <Link
          href="/menu/new"
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          + Tạo thực đơn
        </Link>
      </div>

      {!aiConfigured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Bạn chưa cấu hình AI.{" "}
          <Link href="/settings/ai" className="font-medium underline">
            Cấu hình ngay
          </Link>{" "}
          để bắt đầu tạo thực đơn.
        </div>
      )}

      {/* Job đang chạy: thẻ tự cập nhật (JobPoller refresh tới khi xong). */}
      {activeJob && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600" />
          <span>
            {queuePos !== null ? (
              <>
                Đang xếp hàng — <strong>thứ {queuePos}</strong> trong hàng đợi tạo
                thực đơn cho ngày{" "}
                <strong>{formatDay(dayKey(activeJob.date))}</strong>. Sẽ tự chạy
                khi tới lượt.
              </>
            ) : (
              <>
                Đang tạo thực đơn cho ngày{" "}
                <strong>{formatDay(dayKey(activeJob.date))}</strong>… Bạn có thể
                rời trang, kết quả sẽ tự hiện ở đây.
              </>
            )}
          </span>
          <JobPoller />
        </div>
      )}

      {/* Job vừa lỗi: hiện lý do + cho thử lại / bỏ qua. */}
      {failedJob && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-medium">
            Tạo thực đơn cho ngày {formatDay(dayKey(failedJob.date))} thất bại.
          </p>
          {failedJob.error && (
            <p className="mt-1 text-red-600">{failedJob.error}</p>
          )}
          <div className="mt-3 flex gap-3">
            <Link
              href="/menu/new"
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
            >
              Thử lại
            </Link>
            <form action={ackJobAction}>
              <input type="hidden" name="jobId" value={failedJob.id} />
              <button
                type="submit"
                className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100"
              >
                Bỏ qua
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Còn edit job đang chạy: refresh định kỳ tới khi xong. */}
      {activeEditJobs.length > 0 && <JobPoller intervalMs={2500} />}

      {failedEditJobs.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-medium">Một số chỉnh sửa mâm thất bại.</p>
          {failedEditJobs.map((j) => (
            <div
              key={j.id}
              className="mt-2 flex items-center justify-between gap-3"
            >
              <span className="text-red-600">{j.error}</span>
              <form action={ackEditJobAction}>
                <input type="hidden" name="jobId" value={j.id} />
                <button
                  type="submit"
                  className="rounded-lg border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-100"
                >
                  Bỏ qua
                </button>
              </form>
            </div>
          ))}
        </div>
      )}

      {days.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center">
          <p className="text-zinc-500">Chưa có thực đơn nào sắp tới.</p>
          <Link
            href="/menu/new"
            className="mt-3 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Lên thực đơn đầu tiên
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {days.map((key) => (
            <section
              key={key}
              className={`rounded-2xl border bg-white p-5 ${
                key === focusDate
                  ? "border-emerald-400 ring-2 ring-emerald-100"
                  : "border-zinc-200"
              }`}
            >
              <h2 className="mb-3 text-sm font-semibold text-zinc-500">
                {formatDay(key)}
              </h2>
              <div className="space-y-3">
                {byDay.get(key)!.map((meal) => {
                  const view: MealView = {
                    id: meal.id,
                    mealTypeLabel: MEAL_TYPE_LABEL[meal.mealType] ?? meal.mealType,
                    servings: meal.servings,
                    totalMinutes: meal.dishes.reduce(
                      (max, d) => Math.max(max, d.recipe.cookMinutes),
                      0,
                    ),
                    cooked: meal.cookedAt !== null,
                    // Truyền `null` cho dishCount là CỐ Ý: số món người dùng chọn
                    // nằm trên GenerationJob đã xong việc (mâm có thể sinh từ job
                    // khác, hoặc copy qua recook), ở đây chỉ cần con số mặc định
                    // theo số người để biết mâm có bị hụt hay không.
                    expectedDishes: planMealStructure(
                      meal.mealType,
                      familySize,
                      null,
                    ).length,
                    chatHistory: Array.isArray(meal.chatHistory)
                      ? (meal.chatHistory as MealView["chatHistory"])
                      : [],
                    dishes: meal.dishes.map((d) => ({
                      id: d.id,
                      roleLabel: DISH_ROLE_LABEL[d.dishRole] ?? d.dishRole,
                      name: d.recipe.name,
                      cookMinutes: d.recipe.cookMinutes,
                      nutritionLabels: d.recipe.nutritionLabels,
                      ingredients: d.recipe.ingredients.map(
                        (ri) => `${ri.ingredient.name} (${ri.quantity} ${ri.unit})`,
                      ),
                      steps: d.recipe.steps,
                      chatHistory: Array.isArray(d.chatHistory)
                        ? (d.chatHistory as MealView["chatHistory"])
                        : [],
                    })),
                  };
                  const jobsForMeal = activeEditJobs.filter(
                    (j) => j.plannedMealId === meal.id,
                  );
                  const busyDishIds = jobsForMeal
                    .filter((j) => j.mealDishId)
                    .map((j) => j.mealDishId as string);
                  const mealBusy = jobsForMeal.some(
                    (j) => j.scope === "MEAL" || j.scope === "ADD",
                  );
                  return (
                    <MealCard
                      key={meal.id}
                      meal={view}
                      busyDishIds={busyDishIds}
                      mealBusy={mealBusy}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
