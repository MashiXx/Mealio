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

// Số ngày sinh liên tiếp.
const DAY_COUNTS = [1, 3, 5, 7];

/** Ngày thứ `n` của khoảng (n=1 là ngày bắt đầu), dạng dd/mm. */
function dayOfRange(startYmd: string, n: number): string {
  const [y, m, d] = startYmd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n - 1);
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

export function NewMenuForm() {
  const [state, formAction, pending] = useActionState(
    startGenerationAction,
    initial,
  );
  // Mặc định trỏ vào ngày mai; nút nhanh và ô date cùng điều khiển giá trị này.
  const [date, setDate] = useState(() => dateStr(1));
  const [days, setDays] = useState(1);
  // Theo dõi chế độ kho để khoá các mốc nhiều ngày — server đã chặn, nhưng để
  // người dùng bấm rồi mới báo lỗi là thiết kế tồi.
  const [pantryMode, setPantryMode] = useState("FLEXIBLE");

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
          Số ngày
        </legend>
        <input type="hidden" name="days" value={days} />
        <div className="flex flex-wrap gap-2">
          {DAY_COUNTS.map((n) => {
            // Khoá mốc nhiều ngày ở chế độ "đồ có sẵn": kho cạn sau một hai bữa.
            const locked = pantryMode === "AVAILABLE_ONLY" && n > 1;
            return (
              <button
                key={n}
                type="button"
                disabled={locked}
                title={
                  locked
                    ? 'Chế độ "Nấu bằng đồ có sẵn" chỉ tạo được cho 1 ngày'
                    : undefined
                }
                onClick={() => setDays(n)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  days === n
                    ? "border-emerald-500 bg-emerald-50 font-medium text-emerald-700"
                    : "border-zinc-300 text-zinc-600 hover:border-zinc-400"
                }`}
              >
                {n} ngày
              </button>
            );
          })}
        </div>
        {days > 1 && (
          <p className="mt-2 text-xs text-zinc-500">
            Sẽ tạo thực đơn từ {dayOfRange(date, 1)} đến {dayOfRange(date, days)}.
            AI xem cả đợt cùng lúc để không lặp món và xoay vòng đạm.
          </p>
        )}
        {days >= 5 && (
          <p className="mt-1 text-xs text-amber-600">
            Đợt dài có thể mất 10–20 phút nếu bạn dùng Ollama tự host. Thực đơn
            chạy ngầm, bạn cứ rời trang.
          </p>
        )}
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-zinc-700">
          Nguyên liệu
        </legend>
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="pantryMode"
              value="FLEXIBLE"
              defaultChecked
              onChange={(e) => setPantryMode(e.target.value)}
              className="mt-1"
            />
            <span>
              <span className="font-medium text-zinc-800">Thoải mái</span>
              <span className="block text-xs text-zinc-500">
                Ưu tiên đồ sẵn có, thiếu gì đưa vào danh sách đi chợ
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="pantryMode"
              value="AVAILABLE_ONLY"
              onChange={(e) => {
                setPantryMode(e.target.value);
                // Phải kéo days về 1: đang chọn 7 ngày rồi mới bấm sang chế độ
                // này thì nút đã bị khoá nhưng state vẫn là 7, bấm Tạo là ăn lỗi
                // từ server mà không hiểu vì sao.
                setDays(1);
              }}
              className="mt-1"
            />
            <span>
              <span className="font-medium text-zinc-800">
                Nấu bằng đồ có sẵn
              </span>
              <span className="block text-xs text-zinc-500">
                Chỉ dùng nguyên liệu trong kho nhà, không phải đi chợ
              </span>
            </span>
          </label>
        </div>
      </fieldset>

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

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-zinc-700">
          Số món mỗi bữa chính (trưa/tối)
        </span>
        <select
          name="dishCount"
          defaultValue="auto"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        >
          <option value="auto">Tự động (theo số người)</option>
          <option value="1">1 món</option>
          <option value="2">2 món</option>
          <option value="3">3 món</option>
          <option value="4">4 món</option>
          <option value="5">5 món</option>
        </select>
        <span className="mt-1 block text-xs text-zinc-400">
          Bữa sáng luôn 1 món. Cơm trắng không tính là món.
        </span>
      </label>

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
