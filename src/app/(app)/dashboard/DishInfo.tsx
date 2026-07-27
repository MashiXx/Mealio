export type DishInfoData = {
  roleLabel: string;
  name: string;
  cookMinutes: number;
  nutritionLabels: string[];
  ingredients: string[];
  steps: string[];
  /** Việc làm trước cho đỡ mất thời gian lúc nấu. null = không có gì để làm trước. */
  prepAheadNote: string | null;
};

/**
 * Hiển thị nội dung một món (read-only). Dùng chung cho dashboard (client) và
 * history (server) — KHÔNG đặt "use client" để tương thích cả hai ngữ cảnh.
 */
export function DishInfo({ dish }: { dish: DishInfoData }) {
  return (
    <>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500">
          {dish.roleLabel}
        </span>
        <h4 className="font-semibold">{dish.name}</h4>
      </div>
      <p className="text-xs text-zinc-500">
        {dish.cookMinutes} phút
        {dish.nutritionLabels.length > 0 &&
          " · " + dish.nutritionLabels.join(", ")}
      </p>
      {dish.prepAheadNote && (
        <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-sm text-amber-800">
          <span className="font-medium">Chuẩn bị trước: </span>
          {dish.prepAheadNote}
        </p>
      )}
      {dish.ingredients.length > 0 && (
        <p className="mt-2 text-sm text-zinc-600">
          <span className="font-medium">Nguyên liệu: </span>
          {dish.ingredients.join(", ")}
        </p>
      )}
      {dish.steps.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-medium text-emerald-700">
            Cách làm ({dish.steps.length} bước)
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zinc-700">
            {dish.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </details>
      )}
    </>
  );
}
