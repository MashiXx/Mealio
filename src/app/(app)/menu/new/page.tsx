"use client";

import { useActionState } from "react";
import { generateMenuAction, type GenerateState } from "@/lib/actions/menu";
import { MEAL_TYPES } from "@/lib/enums";

const initial: GenerateState = {};

export default function NewMenuPage() {
  const [state, formAction, pending] = useActionState(
    generateMenuAction,
    initial,
  );

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-bold tracking-tight">Tạo thực đơn</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-500">
        Chọn ngày và các bữa cần gợi ý. Mealio sẽ đề xuất món phù hợp khẩu vị,
        tránh dị ứng, ưu tiên đồ có sẵn trong kho.
      </p>

      <form
        action={formAction}
        className="space-y-6 rounded-2xl border border-zinc-200 bg-white p-6"
      >
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-zinc-700">
            Ngày
          </span>
          <input
            type="date"
            name="date"
            required
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
          {pending ? "Đang nhờ AI lên thực đơn…" : "Tạo thực đơn bằng AI"}
        </button>
        {pending && (
          <p className="text-center text-xs text-zinc-400">
            Có thể mất 10–30 giây tuỳ model.
          </p>
        )}
      </form>
    </div>
  );
}
