"use client";

import { deleteDayAction } from "@/lib/actions/meal";

// Tách riêng thành client component vì cần confirm() trước khi gửi, mà
// dashboard/page.tsx là server component. Vẫn dùng <form action> chứ không
// onClick, để bấm được cả khi JS chưa hydrate xong (giống nút "Đã nấu").

export function DeleteDayButton({
  date,
  label,
  mealCount,
}: {
  /** yyyy-mm-dd */
  date: string;
  /** nhãn hiển thị trong câu hỏi, vd "27/07/2026" */
  label: string;
  mealCount: number;
}) {
  return (
    <form
      action={deleteDayAction}
      onSubmit={(e) => {
        if (
          !confirm(
            `Xoá toàn bộ ${mealCount} mâm của ngày ${label}?\n\nMâm nào đã bấm Đã nấu thì kho đã bị trừ và sẽ KHÔNG được hoàn lại.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="date" value={date} />
      <button
        type="submit"
        className="shrink-0 rounded border border-red-200 px-2 py-1 text-xs text-red-500 hover:bg-red-50"
      >
        Xoá cả ngày
      </button>
    </form>
  );
}
