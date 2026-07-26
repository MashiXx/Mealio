"use client";

import { deleteMealAction } from "@/lib/actions/meal";

// Nút xoá một mâm dùng ở trang Lịch sử (server component nên cần client
// component cho confirm). Dashboard không dùng cái này: MealCard vốn đã là
// client component và nút xoá ở đó còn phải theo trạng thái bận của mâm.

export function DeleteMealButton({
  plannedMealId,
  label,
  cooked,
}: {
  plannedMealId: string;
  /** Mô tả mâm để hỏi cho rõ, vd "Bữa tối ngày 27/07/2026". */
  label: string;
  cooked: boolean;
}) {
  return (
    <form
      action={deleteMealAction}
      onSubmit={(e) => {
        const warn = cooked
          ? "\n\nMâm này đã bấm Đã nấu — kho đã bị trừ và sẽ KHÔNG được hoàn lại."
          : "";
        if (!confirm(`Xoá ${label}?${warn}`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="plannedMealId" value={plannedMealId} />
      <button
        type="submit"
        className="rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-50"
      >
        Xoá
      </button>
    </form>
  );
}
