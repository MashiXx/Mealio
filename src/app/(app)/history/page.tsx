import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireFamily } from "@/lib/tenant";
import { MEAL_TYPE_LABEL, DISH_ROLE_LABEL } from "@/lib/enums";
import { recookAction } from "@/lib/actions/recook";
import { DishInfo } from "../dashboard/DishInfo";

const MEAL_RANK: Record<string, number> = { BREAKFAST: 0, LUNCH: 1, DINNER: 2 };
const PAGE_SIZE = 60;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function formatDay(key: string): string {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}
function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string }>;
}) {
  const { familyId } = await requireFamily();
  const { before } = await searchParams;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const dateFilter: { lt: Date } = { lt: startOfToday };
  if (before && /^\d{4}-\d{2}-\d{2}$/.test(before)) {
    dateFilter.lt = new Date(`${before}T00:00:00`);
  }

  const meals = await prisma.plannedMeal.findMany({
    where: { familyId, date: dateFilter },
    orderBy: { date: "desc" },
    include: {
      dishes: {
        orderBy: { position: "asc" },
        include: {
          recipe: { include: { ingredients: { include: { ingredient: true } } } },
        },
      },
    },
    take: PAGE_SIZE,
  });

  // Nhóm theo ngày (giữ thứ tự mới -> cũ), sắp bữa sáng/trưa/tối trong ngày.
  const byDay = new Map<string, typeof meals>();
  for (const meal of meals) {
    const key = dayKey(meal.date);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(meal);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => MEAL_RANK[a.mealType] - MEAL_RANK[b.mealType]);
  }
  const days = [...byDay.keys()]; // đã desc theo thứ tự query
  const oldestKey = days.length ? days[days.length - 1] : null;
  const hasMore = meals.length === PAGE_SIZE;
  const today = todayStr();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Lịch sử thực đơn</h1>
          <p className="text-sm text-zinc-500">Các bữa đã qua — chỉ xem lại</p>
        </div>
        <Link
          href="/dashboard"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:border-zinc-400"
        >
          ← Bảng chính
        </Link>
      </div>

      {days.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center">
          <p className="text-zinc-500">Chưa có thực đơn nào đã qua.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {days.map((key) => (
            <section
              key={key}
              className="rounded-2xl border border-zinc-200 bg-white p-5"
            >
              <h2 className="mb-3 text-sm font-semibold text-zinc-500">
                {formatDay(key)}
              </h2>
              <div className="space-y-3">
                {byDay.get(key)!.map((meal) => {
                  const totalMinutes = meal.dishes.reduce(
                    (max, d) => Math.max(max, d.recipe.cookMinutes),
                    0,
                  );
                  return (
                    <article
                      key={meal.id}
                      className="rounded-xl border border-zinc-100 bg-zinc-50 p-4"
                    >
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            {MEAL_TYPE_LABEL[meal.mealType] ?? meal.mealType}
                          </span>
                          <span className="text-xs text-zinc-500">
                            {meal.servings} người · {meal.dishes.length} món
                            {totalMinutes > 0 && ` · ~${totalMinutes} phút`}
                          </span>
                        </div>
                        <form
                          action={recookAction}
                          className="flex items-center gap-1.5"
                        >
                          <input
                            type="hidden"
                            name="plannedMealId"
                            value={meal.id}
                          />
                          <input
                            type="date"
                            name="date"
                            defaultValue={today}
                            className="rounded border border-zinc-300 px-2 py-1 text-xs outline-none focus:border-emerald-500"
                          />
                          <button
                            type="submit"
                            className="rounded border border-emerald-300 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                          >
                            Nấu lại
                          </button>
                        </form>
                      </div>
                      <div className="space-y-3">
                        {meal.dishes.map((dish) => (
                          <div
                            key={dish.id}
                            className="rounded-lg border border-zinc-200 bg-white p-3"
                          >
                            <DishInfo
                              dish={{
                                roleLabel:
                                  DISH_ROLE_LABEL[dish.dishRole] ?? dish.dishRole,
                                name: dish.recipe.name,
                                cookMinutes: dish.recipe.cookMinutes,
                                nutritionLabels: dish.recipe.nutritionLabels,
                                ingredients: dish.recipe.ingredients.map(
                                  (ri) =>
                                    `${ri.ingredient.name} (${ri.quantity} ${ri.unit})`,
                                ),
                                steps: dish.recipe.steps,
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}

          {hasMore && oldestKey && (
            <div className="text-center">
              <Link
                href={`/history?before=${oldestKey}`}
                className="inline-block rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:border-zinc-400"
              >
                Xem thêm ngày cũ hơn
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
