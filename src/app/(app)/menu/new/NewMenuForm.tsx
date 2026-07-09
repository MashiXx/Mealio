"use client";

import { useActionState, useState } from "react";
import { startGenerationAction, type GenerateState } from "@/lib/actions/menu";
import { MEAL_TYPES } from "@/lib/enums";

const initial: GenerateState = {};

// Ngày (today + offset) theo giờ địa phương, dạng yyyy-mm-dd cho <input type="date">.
// Dùng getFullYear/Month/Date (không toISOString) để tránh lệch ngày do UTC.
function dateStr(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Nút chọn nhanh: nhãn + số ngày cộng thêm so với hôm nay.
const QUICK_DAYS = [
  { label: "Hôm nay", offset: 0 },
  { label: "Ngày mai", offset: 1 },
];

export function NewMenuForm() {
  const [state, formAction, pending] = useActionState(
    startGenerationAction,
    initial,
  );
  // Mặc định trỏ vào ngày mai; nút nhanh và ô date cùng điều khiển giá trị này.
  const [date, setDate] = useState(() => dateStr(1));

  return (
    <form
      action={formAction}
      className="space-y-6 rounded-2xl border border-zinc-200 bg-white p-6"
    >
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-zinc-700">
          Ngày
        </span>
        <div className="mb-2 flex gap-2">
          {QUICK_DAYS.map((q) => {
            const val = dateStr(q.offset);
            const active = date === val;
            return (
              <button
                key={q.label}
                type="button"
                onClick={() => setDate(val)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "border-emerald-500 bg-emerald-50 font-medium text-emerald-700"
                    : "border-zinc-300 text-zinc-600 hover:border-zinc-400"
                }`}
              >
                {q.label}
              </button>
            );
          })}
        </div>
        <input
          type="date"
          name="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
      </label>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-zinc-700">
          Bữa ăn
        </legend>
        <div className="flex flex-wrap gap-3">
          {MEAL_TYPES.map((m, idx) => (
            <label
              key={m.value}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50"
            >
              <input
                type="checkbox"
                name="mealTypes"
                value={m.value}
                defaultChecked={idx > 0 && idx < 3} // trưa + tối
                className="accent-emerald-600"
              />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {pending ? "Đang gửi yêu cầu…" : "Tạo thực đơn bằng AI"}
      </button>
      <p className="text-center text-xs text-zinc-400">
        Thực đơn được tạo ngầm — bạn có thể rời trang, kết quả sẽ hiện ở trang chủ.
      </p>
    </form>
  );
}
