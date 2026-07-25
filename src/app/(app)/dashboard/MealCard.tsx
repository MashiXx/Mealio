"use client";

import { useState, useTransition } from "react";
import {
  quickEditAction,
  chatDishAction,
  chatMealAction,
  addDishAction,
  deleteDishAction,
} from "@/lib/actions/edit";
import { DishInfo } from "./DishInfo";

type ChatTurn = { role: "user" | "assistant"; content: string };

export type DishView = {
  id: string;
  roleLabel: string;
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
        {mealBusy && (
          <span className="flex items-center gap-1 text-xs text-amber-600">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600" />
            đang cập nhật…
          </span>
        )}
      </div>

      <div className="space-y-3">
        {meal.dishes.map((dish) => {
          const dishBusy = busySet.has(dish.id) || pending;
          return (
            <div
              key={dish.id}
              className={`rounded-lg border border-zinc-200 bg-white p-3 ${busySet.has(dish.id) ? "opacity-60" : ""}`}
            >
              <DishInfo
                dish={{
                  roleLabel: dish.roleLabel,
                  name: dish.name,
                  cookMinutes: dish.cookMinutes,
                  nutritionLabels: dish.nutritionLabels,
                  ingredients: dish.ingredients,
                  steps: dish.steps,
                }}
              />
              {busySet.has(dish.id) && (
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
                    disabled={dishBusy}
                    onClick={() => run(() => quickEditAction(dish.id, q.kind))}
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
                        disabled={dishBusy}
                        onClick={() => run(() => quickEditAction(dish.id, t.kind))}
                        className="whitespace-nowrap rounded px-2 py-1 text-left text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </details>
                <button
                  type="button"
                  disabled={dishBusy}
                  onClick={() =>
                    setOpenChat(openChat === dish.id ? null : dish.id)
                  }
                  className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:border-emerald-400 disabled:opacity-50"
                >
                  Chat
                </button>
                <button
                  type="button"
                  disabled={dishBusy || meal.dishes.length <= 1}
                  onClick={() => {
                    if (confirm(`Xóa món "${dish.name}"?`))
                      run(() => deleteDishAction(dish.id));
                  }}
                  className="rounded border border-red-200 px-2 py-1 text-xs text-red-500 hover:bg-red-50 disabled:opacity-40"
                >
                  Xóa
                </button>
              </div>

              {openChat === dish.id && (
                <ChatBox
                  history={dish.chatHistory}
                  busy={dishBusy}
                  onSend={(m) => run(() => chatDishAction(dish.id, m))}
                />
              )}
            </div>
          );
        })}
      </div>

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
