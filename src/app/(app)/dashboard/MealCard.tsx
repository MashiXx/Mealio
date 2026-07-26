"use client";

import { useState, useTransition } from "react";
import {
  quickEditAction,
  chatDishAction,
  chatMealAction,
  addDishAction,
  deleteDishAction,
} from "@/lib/actions/edit";
// Server action gọi từ client component: hợp lệ vì actions/cook.ts có "use server"
// ở đầu FILE, nên import vào đây chỉ là một tham chiếu, không kéo code server sang
// bundle client. Đi qua <form action={...}> thay vì onClick để bấm được cả khi JS
// chưa hydrate xong.
import { markCookedAction } from "@/lib/actions/cook";
import { DishInfo } from "./DishInfo";
import { DishPhoto, DishPhotoCredit } from "./DishPhoto";
import { pickHeroDish } from "@/lib/dish-image";

type ChatTurn = { role: "user" | "assistant"; content: string };

export type DishView = {
  id: string;
  roleLabel: string;
  /** mã vai trò thô (MON_MAN, CANH_SUP…) — cần cho việc khớp ảnh, khác roleLabel. */
  dishRole: string;
  name: string;
  cookMinutes: number;
  nutritionLabels: string[];
  ingredients: string[];
  steps: string[];
  chatHistory: ChatTurn[];
};

export type MealView = {
  id: string;
  mealTypeLabel: string;
  servings: number;
  totalMinutes: number;
  cooked: boolean;
  // Số món đã hoạch định lúc sinh mâm (PlannedMeal.dishCount). null = mâm cũ
  // trước Giai đoạn 4, không có căn cứ nên không cảnh báo gì.
  plannedDishes: number | null;
  chatHistory: ChatTurn[];
  dishes: DishView[];
};

const QUICK: { kind: string; label: string }[] = [
  { kind: "doi-mon", label: "Đổi món" },
  { kind: "doi-dam", label: "Đổi đạm" },
];
const TUNE: { kind: string; label: string }[] = [
  { kind: "it-cay", label: "Ít cay hơn" },
  { kind: "it-dau", label: "Ít dầu hơn" },
  { kind: "nhanh-hon", label: "Nhanh hơn" },
  { kind: "re-hon", label: "Rẻ hơn" },
];

function ChatBox({
  history,
  busy,
  onSend,
}: {
  history: ChatTurn[];
  busy: boolean;
  onSend: (msg: string) => void;
}) {
  const [msg, setMsg] = useState("");
  return (
    <div className="mt-2 rounded-lg bg-zinc-50 p-2">
      {history.length > 0 && (
        <div className="mb-2 space-y-1">
          {history.map((t, i) => (
            <p
              key={i}
              className={`text-xs ${t.role === "user" ? "text-zinc-700" : "text-emerald-700"}`}
            >
              <span className="font-medium">
                {t.role === "user" ? "Bạn: " : "Trợ lý: "}
              </span>
              {t.content}
            </p>
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const v = msg.trim();
          if (!v || busy) return;
          onSend(v);
          setMsg("");
        }}
        className="flex gap-2"
      >
        <input
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          disabled={busy}
          placeholder="Nhập yêu cầu chỉnh sửa…"
          className="flex-1 rounded border border-zinc-300 px-2 py-1 text-sm outline-none focus:border-emerald-500 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          Gửi
        </button>
      </form>
    </div>
  );
}

export function MealCard({
  meal,
  busyDishIds,
  mealBusy,
}: {
  meal: MealView;
  busyDishIds: string[];
  mealBusy: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [openChat, setOpenChat] = useState<string | null>(null);
  const [openMealChat, setOpenMealChat] = useState(false);
  const busySet = new Set(busyDishIds);
  const anyBusy = pending || mealBusy;

  const hero = pickHeroDish(meal.dishes);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Món đang chọn; mặc định là hero. Nếu món đang chọn vừa bị xoá thì rơi về hero.
  const selected =
    meal.dishes.find((d) => d.id === selectedId) ??
    hero ??
    meal.dishes[0] ??
    null;
  const others = meal.dishes.filter((d) => d.id !== hero?.id);

  const run = (fn: () => Promise<void>) => startTransition(() => void fn());

  return (
    <article className="rounded-xl border border-zinc-100 bg-zinc-50 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
          {meal.mealTypeLabel}
        </span>
        <span className="text-xs text-zinc-500">
          {meal.servings} người · {meal.dishes.length} món
          {meal.totalMinutes > 0 && ` · ~${meal.totalMinutes} phút`}
        </span>
        {meal.cooked ? (
          <span className="text-xs font-medium text-emerald-600">✓ đã nấu</span>
        ) : (
          <form action={markCookedAction}>
            <input type="hidden" name="plannedMealId" value={meal.id} />
            <button
              type="submit"
              disabled={anyBusy}
              className="rounded border border-emerald-300 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            >
              Đã nấu
            </button>
          </form>
        )}
        {/* Mâm hụt món là chuyện BÌNH THƯỜNG ở chế độ "nấu bằng đồ có sẵn" (kho
            chỉ còn trứng thì không nặn ra đủ mặn + canh + rau) — nói thật thay vì
            lấp bừa. Chỉ NÊU SỰ THẬT rồi mới gợi ý nguyên nhân có điều kiện: mâm
            còn hụt vì người dùng tự xoá món, và ta không lưu chế độ đã sinh nên
            KHÔNG được khẳng định là tại kho. Cảnh báo sai chỗ tệ hơn không có
            cảnh báo, vì người dùng học cách phớt lờ nó. */}
        {meal.plannedDishes !== null &&
          meal.dishes.length < meal.plannedDishes && (
            <span className="text-xs text-amber-600">
              Mâm này có {meal.dishes.length}/{meal.plannedDishes} món so với kế
              hoạch. Nếu tạo ở chế độ “Nấu bằng đồ có sẵn” thì thường là do kho
              chưa đủ nguyên liệu cho các vai trò còn lại.
            </span>
          )}
        {mealBusy && (
          <span className="flex items-center gap-1 text-xs text-amber-600">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600" />
            đang cập nhật…
          </span>
        )}
      </div>

      {hero && (
        <div className="space-y-3">
          {/* Ảnh bìa mâm: món chính, bấm được để mở panel chi tiết. */}
          <button
            type="button"
            onClick={() => setSelectedId(hero.id)}
            className={`block w-full text-left transition-opacity ${
              busySet.has(hero.id) ? "opacity-60" : ""
            } ${selected?.id === hero.id ? "rounded-xl ring-2 ring-emerald-400" : ""}`}
          >
            <div className="relative">
              <DishPhoto name={hero.name} dishRole={hero.dishRole} size="hero" />
              <div className="absolute inset-x-0 bottom-0 rounded-b-xl bg-gradient-to-t from-black/70 to-transparent p-3">
                <span className="rounded bg-white/90 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600">
                  {hero.roleLabel}
                </span>
                <h4 className="mt-1 font-semibold text-white drop-shadow">
                  {hero.name}
                </h4>
              </div>
              {busySet.has(hero.id) && (
                <span className="absolute right-3 top-3 h-5 w-5 animate-spin rounded-full border-2 border-white/50 border-t-white" />
              )}
            </div>
          </button>

          {/* Các món còn lại */}
          {others.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {others.map((dish) => (
                <button
                  key={dish.id}
                  type="button"
                  onClick={() => setSelectedId(dish.id)}
                  className={`text-left transition-opacity ${
                    busySet.has(dish.id) ? "opacity-60" : ""
                  }`}
                >
                  <div className="relative">
                    <DishPhoto
                      name={dish.name}
                      dishRole={dish.dishRole}
                      size="thumb"
                      className={
                        selected?.id === dish.id ? "ring-2 ring-emerald-400" : ""
                      }
                    />
                    {busySet.has(dish.id) && (
                      <span className="absolute right-1.5 top-1.5 h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white" />
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs font-medium text-zinc-700">
                    {dish.name}
                  </p>
                  <p className="truncate text-[11px] text-zinc-400">
                    {dish.roleLabel}
                  </p>
                </button>
              ))}
            </div>
          )}

          {/* Panel chi tiết của món đang chọn */}
          {selected && (
            <div className="rounded-lg border border-zinc-200 bg-white p-3">
              <DishInfo
                dish={{
                  roleLabel: selected.roleLabel,
                  name: selected.name,
                  cookMinutes: selected.cookMinutes,
                  nutritionLabels: selected.nutritionLabels,
                  ingredients: selected.ingredients,
                  steps: selected.steps,
                }}
              />
              <DishPhotoCredit
                name={selected.name}
                dishRole={selected.dishRole}
              />
              {busySet.has(selected.id) && (
                <p className="mt-1 flex items-center gap-1 text-xs text-amber-600">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600" />
                  đang cập nhật…
                </p>
              )}

              {/* Nút thao tác nhanh */}
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {QUICK.map((q) => (
                  <button
                    key={q.kind}
                    type="button"
                    disabled={busySet.has(selected.id) || pending}
                    onClick={() => run(() => quickEditAction(selected.id, q.kind))}
                    className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:border-emerald-400 disabled:opacity-50"
                  >
                    {q.label}
                  </button>
                ))}
                <details className="relative">
                  <summary className="cursor-pointer list-none rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:border-emerald-400">
                    Điều chỉnh nhanh ▾
                  </summary>
                  <div className="absolute z-10 mt-1 flex flex-col rounded-lg border border-zinc-200 bg-white p-1 shadow">
                    {TUNE.map((t) => (
                      <button
                        key={t.kind}
                        type="button"
                        disabled={busySet.has(selected.id) || pending}
                        onClick={() =>
                          run(() => quickEditAction(selected.id, t.kind))
                        }
                        className="whitespace-nowrap rounded px-2 py-1 text-left text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </details>
                <button
                  type="button"
                  disabled={busySet.has(selected.id) || pending}
                  onClick={() =>
                    setOpenChat(openChat === selected.id ? null : selected.id)
                  }
                  className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:border-emerald-400 disabled:opacity-50"
                >
                  Chat
                </button>
                <button
                  type="button"
                  disabled={
                    busySet.has(selected.id) || pending || meal.dishes.length <= 1
                  }
                  onClick={() => {
                    if (confirm(`Xóa món "${selected.name}"?`))
                      run(() => deleteDishAction(selected.id));
                  }}
                  className="rounded border border-red-200 px-2 py-1 text-xs text-red-500 hover:bg-red-50 disabled:opacity-40"
                >
                  Xóa
                </button>
              </div>

              {openChat === selected.id && (
                <ChatBox
                  history={selected.chatHistory}
                  busy={busySet.has(selected.id) || pending}
                  onSend={(m) => run(() => chatDishAction(selected.id, m))}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Cấp mâm: thêm món + chat mâm */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={anyBusy}
          onClick={() => run(() => addDishAction(meal.id))}
          className="rounded border border-emerald-300 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
        >
          + Thêm món
        </button>
        <button
          type="button"
          disabled={anyBusy}
          onClick={() => setOpenMealChat((v) => !v)}
          className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:border-emerald-400 disabled:opacity-50"
        >
          Chat cả mâm
        </button>
      </div>
      {openMealChat && (
        <ChatBox
          history={meal.chatHistory}
          busy={anyBusy}
          onSend={(m) => run(() => chatMealAction(meal.id, m))}
        />
      )}
    </article>
  );
}
