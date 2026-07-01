import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireFamily } from "@/lib/tenant";
import { MEAL_TYPE_LABEL } from "@/lib/enums";

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

  const [family, aiSettings, meals] = await Promise.all([
    prisma.family.findUnique({
      where: { id: familyId },
      include: { members: true, profile: true },
    }),
    prisma.aISettings.findUnique({ where: { familyId } }),
    prisma.plannedMeal.findMany({
      where: { familyId, date: { gte: startOfToday } },
      orderBy: { date: "asc" },
      include: { recipe: { include: { ingredients: { include: { ingredient: true } } } } },
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

  const hasKey = Boolean(aiSettings?.apiKeyEncrypted);
  const allergies = [
    ...new Set(family?.members.flatMap((m) => m.allergies) ?? []),
  ];

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

      {!hasKey && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Bạn chưa cấu hình AI.{" "}
          <Link href="/settings/ai" className="font-medium underline">
            Nhập API key
          </Link>{" "}
          để bắt đầu tạo thực đơn.
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
                {byDay.get(key)!.map((meal) => (
                  <article
                    key={meal.id}
                    className="rounded-xl border border-zinc-100 bg-zinc-50 p-4"
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        {MEAL_TYPE_LABEL[meal.mealType] ?? meal.mealType}
                      </span>
                      <h3 className="font-semibold">{meal.recipe.name}</h3>
                    </div>
                    <p className="text-xs text-zinc-500">
                      {meal.servings} phần · {meal.recipe.cookMinutes} phút
                      {meal.recipe.nutritionLabels.length > 0 &&
                        " · " + meal.recipe.nutritionLabels.join(", ")}
                    </p>
                    {meal.recipe.ingredients.length > 0 && (
                      <p className="mt-2 text-sm text-zinc-600">
                        <span className="font-medium">Nguyên liệu: </span>
                        {meal.recipe.ingredients
                          .map(
                            (ri) =>
                              `${ri.ingredient.name} (${ri.quantity} ${ri.unit})`,
                          )
                          .join(", ")}
                      </p>
                    )}
                    {meal.recipe.steps.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-sm font-medium text-emerald-700">
                          Cách làm ({meal.recipe.steps.length} bước)
                        </summary>
                        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zinc-700">
                          {meal.recipe.steps.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ol>
                      </details>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
