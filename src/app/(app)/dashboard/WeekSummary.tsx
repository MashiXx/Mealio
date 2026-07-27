import { generateMealPrepTipsAction } from "@/lib/actions/summary";
import type { IngredientUse } from "@/lib/week-summary";

// Bản tóm tắt cả đợt. Hai nửa có độ tin cậy KHÁC HẲN nhau nên trình bày tách bạch:
// nguyên liệu dùng nhiều là con số đếm được từ mâm (luôn đúng, luôn có), còn mẹo
// chuẩn bị là văn AI sinh theo yêu cầu (phải bấm, có thể chưa có).

export function WeekSummary({
  mealPlanId,
  days,
  ingredients,
  tips,
}: {
  mealPlanId: string;
  days: number;
  ingredients: IngredientUse[];
  /** null = chưa bấm tạo lần nào. */
  tips: string[] | null;
}) {
  if (ingredients.length === 0) return null;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-zinc-700">
        Tóm tắt đợt {days} ngày
      </h2>

      <p className="mt-3 text-xs font-medium text-zinc-500">
        Nguyên liệu dùng nhiều
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {ingredients.map((x) => (
          <span
            key={x.name}
            className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-800"
          >
            {x.name}
            <span className="ml-1 text-emerald-600">×{x.dishCount}</span>
          </span>
        ))}
      </div>

      <p className="mt-4 text-xs font-medium text-zinc-500">Mẹo chuẩn bị trước</p>
      {tips ? (
        <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-sm text-zinc-700">
          {tips.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ol>
      ) : (
        <div className="mt-1.5">
          <p className="text-sm text-zinc-500">
            Chưa có. Bấm để AI gợi ý cách sơ chế trước cho đợt này.
          </p>
          <form action={generateMealPrepTipsAction} className="mt-2">
            <input type="hidden" name="mealPlanId" value={mealPlanId} />
            <button
              type="submit"
              className="rounded-lg border border-emerald-300 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
            >
              Tạo mẹo chuẩn bị
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
