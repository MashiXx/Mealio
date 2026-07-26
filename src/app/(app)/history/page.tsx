import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireFamily } from "@/lib/tenant";
import { MEAL_TYPE_LABEL, DISH_ROLE_LABEL } from "@/lib/enums";
import { recookAction } from "@/lib/actions/recook";
import { DishInfo } from "../dashboard/DishInfo";
import { DishPhoto, DishPhotoCredit } from "../dashboard/DishPhoto";
import { DeleteMealButton } from "../dashboard/DeleteMealButton";
import { pickHeroDish } from "@/lib/dish-image";
import { ymd } from "@/lib/date";

const MEAL_RANK: Record<string, number> = { BREAKFAST: 0, LUNCH: 1, DINNER: 2 };
const PAGE_SIZE = 60;

function formatDay(key: string): string {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
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
    const key = ymd(meal.date);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(meal);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => MEAL_RANK[a.mealType] - MEAL_RANK[b.mealType]);
  }
  const days = [...byDay.keys()]; // đã desc theo thứ tự query
  const oldestKey = days.length ? days[days.length - 1] : null;
  const hasMore = meals.length === PAGE_SIZE;
  const today = ymd(new Date());

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
                        <DeleteMealButton
                          plannedMealId={meal.id}
                          label={`${MEAL_TYPE_LABEL[meal.mealType] ?? meal.mealType} ngày ${formatDay(ymd(meal.date))}`}
                          cooked={meal.cookedAt !== null}
                        />
                      </div>
                      {/* Phần đầu thị giác: ảnh bìa + lưới món. Trang này là
                          server component nên KHÔNG có panel bấm-để-chọn như
                          dashboard — danh sách chi tiết bên dưới giữ nguyên. */}
                      {(() => {
                        const cands = meal.dishes.map((d) => ({
                          id: d.id,
                          name: d.recipe.name,
                          dishRole: d.dishRole as string,
                        }));
                        const hero = pickHeroDish(cands);
                        if (!hero) return null;
                        const others = cands.filter((c) => c.id !== hero.id);
                        return (
                          <div className="mb-3 space-y-2">
                            <div className="relative">
                              <DishPhoto
                                name={hero.name}
                                dishRole={hero.dishRole}
                                size="hero"
                              />
                              <div className="absolute inset-x-0 bottom-0 rounded-b-xl bg-gradient-to-t from-black/70 to-transparent p-3">
                                <h4 className="font-semibold text-white drop-shadow">
                                  {hero.name}
                                </h4>
                              </div>
                            </div>
                            {others.length > 0 && (
                              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                {others.map((c) => (
                                  <div key={c.id}>
                                    <DishPhoto
                                      name={c.name}
                                      dishRole={c.dishRole}
                                      size="thumb"
                                    />
                                    <p className="mt-1 truncate text-xs font-medium text-zinc-700">
                                      {c.name}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
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
                            <DishPhotoCredit
                              name={dish.recipe.name}
                              dishRole={dish.dishRole}
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
