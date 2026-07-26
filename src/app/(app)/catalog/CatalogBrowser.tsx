"use client";

import { useMemo, useState, useTransition } from "react";
import Image from "next/image";
import { adoptCatalogDishAction } from "@/lib/actions/catalog";
import { DishPhoto } from "../dashboard/DishPhoto";
import { ROLE_VISUAL, pickHeroDish } from "@/lib/dish-image";
import { DISH_ROLE_LABEL } from "@/lib/enums";

// Dữ liệu món dạng phẳng truyền từ server (đã tuần tự hoá được).
export interface BrowseDish {
  slug: string;
  name: string;
  dishRole: string;
  region: string;
  cookMinutes: number;
  servings: number;
  difficulty: string;
  nutritionLabels: string[];
  tags: string[];
  notes: string | null;
  imageUrl: string | null;
  imageCredit: string | null;
  steps: string[];
  ingredients: { name: string; quantity: number; unit: string }[];
}

export interface BrowseSetMenu {
  slug: string;
  name: string;
  occasion: string;
  region: string;
  servings: number;
  note: string | null;
  dishes: { slug: string; name: string; dishRole: string }[];
}

// Emoji lấy từ ROLE_VISUAL, nhãn lấy từ DISH_ROLE_LABEL — cả hai đều là nguồn
// dùng chung toàn app, không giữ bản sao cục bộ ở đây nữa.
function roleEmoji(role: string): string {
  return ROLE_VISUAL[role]?.emoji ?? "🍽️";
}
function roleLabel(role: string): string {
  return DISH_ROLE_LABEL[role] ?? role;
}

const REGION_LABEL: Record<string, string> = {
  MIEN_BAC: "Miền Bắc",
  MIEN_TRUNG: "Miền Trung",
  MIEN_NAM: "Miền Nam",
  KHONG_CO_KHAU_VI: "Linh hoạt",
};

const ROLE_ORDER = [
  "MON_MAN",
  "MON_XAO",
  "CANH_SUP",
  "RAU_LUOC",
  "COM_BUN_PHO",
  "MON_CUON",
  "LAU",
  "TRANG_MIENG",
  "DO_CHUA",
];

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .toLowerCase();
}

/** Nút chép món vào kho gia đình (gọi server action). */
function AdoptButton({ slug }: { slug: string }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <button
      type="button"
      disabled={pending || done}
      onClick={() =>
        startTransition(async () => {
          setError(null);
          const res = await adoptCatalogDishAction(slug);
          if (res.error) setError(res.error);
          else setDone(true);
        })
      }
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
        done
          ? "bg-emerald-100 text-emerald-700"
          : "bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
      }`}
      title={error ?? undefined}
    >
      {done ? "Đã thêm ✓" : pending ? "Đang thêm…" : "＋ Vào kho"}
    </button>
  );
}

function DishCard({ dish }: { dish: BrowseDish }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white">
      <div className="relative aspect-[4/3] w-full bg-zinc-100">
        {dish.imageUrl ? (
          <Image
            src={dish.imageUrl}
            alt={dish.name}
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-5xl opacity-40">
            {roleEmoji(dish.dishRole)}
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
          {roleEmoji(dish.dishRole)} {roleLabel(dish.dishRole)}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="font-semibold text-zinc-900">{dish.name}</h3>
        <p className="mt-0.5 text-xs text-zinc-500">
          {REGION_LABEL[dish.region] ?? dish.region} · {dish.cookMinutes}′ ·{" "}
          {dish.servings} người
        </p>

        {dish.nutritionLabels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {dish.nutritionLabels.map((n) => (
              <span
                key={n}
                className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700"
              >
                {n}
              </span>
            ))}
          </div>
        )}

        {dish.notes && (
          <p className="mt-2 text-xs text-zinc-500">{dish.notes}</p>
        )}

        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-xs font-medium text-emerald-700 hover:underline">
            Xem công thức
          </summary>
          <div className="mt-2 space-y-2 text-xs text-zinc-600">
            <div>
              <p className="font-medium text-zinc-700">Nguyên liệu</p>
              <ul className="mt-1 list-inside list-disc">
                {dish.ingredients.map((ing, i) => (
                  <li key={i}>
                    {ing.name} — {ing.quantity} {ing.unit}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-medium text-zinc-700">Cách làm</p>
              <ol className="mt-1 list-inside list-decimal space-y-0.5">
                {dish.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
          </div>
        </details>

        {/* Ghi công nguồn ảnh: bắt buộc với giấy phép CC BY / CC BY-SA. */}
        {dish.imageUrl && dish.imageCredit && (
          <p className="mt-2 text-[10px] leading-tight text-zinc-400">
            Ảnh: {dish.imageCredit}
          </p>
        )}

        <div className="mt-3 flex items-center justify-between">
          {dish.tags.includes("chay") && (
            <span className="rounded-full bg-lime-50 px-2 py-0.5 text-[11px] text-lime-700">
              chay
            </span>
          )}
          <div className="ml-auto">
            <AdoptButton slug={dish.slug} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function CatalogBrowser({
  dishes,
  setMenus,
}: {
  dishes: BrowseDish[];
  setMenus: BrowseSetMenu[];
}) {
  const [role, setRole] = useState<string>("ALL");
  const [region, setRegion] = useState<string>("ALL");
  const [query, setQuery] = useState("");
  const [vegOnly, setVegOnly] = useState(false);

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    return dishes.filter((d) => {
      if (role !== "ALL" && d.dishRole !== role) return false;
      if (region !== "ALL" && d.region !== region) return false;
      if (vegOnly && !d.tags.includes("chay")) return false;
      if (q && !norm(d.name).includes(q)) return false;
      return true;
    });
  }, [dishes, role, region, query, vegOnly]);

  const roleTabs = ["ALL", ...ROLE_ORDER];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Kho món ăn</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {dishes.length} món gia đình Việt & {setMenus.length} mâm cơm gợi ý.
          Thêm món vào kho để đưa vào kế hoạch bữa ăn.
        </p>
      </div>

      {/* Bộ lọc */}
      <div className="mb-5 space-y-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm món… (vd: cá kho, canh chua)"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <div className="flex flex-wrap gap-2">
          {roleTabs.map((r) => {
            const active = role === r;
            const label = r === "ALL" ? "Tất cả" : roleLabel(r);
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  active
                    ? "border-emerald-500 bg-emerald-50 font-medium text-emerald-700"
                    : "border-zinc-300 text-zinc-600 hover:border-zinc-400"
                }`}
              >
                {r === "ALL" ? "" : roleEmoji(r) + " "}
                {label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="rounded-lg border border-zinc-300 px-2 py-1.5 text-xs text-zinc-600 outline-none focus:border-emerald-500"
          >
            <option value="ALL">Mọi vùng</option>
            {Object.entries(REGION_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 has-[:checked]:border-lime-500 has-[:checked]:bg-lime-50">
            <input
              type="checkbox"
              checked={vegOnly}
              onChange={(e) => setVegOnly(e.target.checked)}
              className="accent-lime-600"
            />
            Chỉ món chay
          </label>
          <span className="ml-auto text-xs text-zinc-400">
            {filtered.length} món
          </span>
        </div>
      </div>

      {/* Lưới món */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((d) => (
            <DishCard key={d.slug} dish={d} />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-400">
          Không có món khớp bộ lọc.
        </p>
      )}

      {/* Set menu / mâm cơm gợi ý */}
      <div className="mt-10">
        <h2 className="text-lg font-bold tracking-tight">Mâm cơm gợi ý</h2>
        <p className="mt-1 mb-4 text-sm text-zinc-500">
          Combo món cho một bữa hoàn chỉnh (cơm trắng đi kèm).
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {setMenus.map((m) => {
            const hero = pickHeroDish(
              m.dishes.map((d) => ({
                id: d.slug,
                name: d.name,
                dishRole: d.dishRole,
              })),
            );
            const others = m.dishes.filter((d) => d.slug !== hero?.id);
            return (
              <div
                key={m.slug}
                className="overflow-hidden rounded-2xl border border-zinc-200 bg-white"
              >
                {hero && (
                  <div className="relative">
                    <DishPhoto
                      name={hero.name}
                      dishRole={hero.dishRole}
                      size="hero"
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3">
                      <h3 className="font-semibold text-white drop-shadow">
                        {m.name}
                      </h3>
                      <p className="text-xs text-white/80">{m.servings} người</p>
                    </div>
                  </div>
                )}
                <div className="p-4">
                  {others.length > 0 && (
                    <div className="grid grid-cols-4 gap-2">
                      {others.map((d) => (
                        <div key={d.slug}>
                          <DishPhoto
                            name={d.name}
                            dishRole={d.dishRole}
                            size="thumb"
                          />
                          <p className="mt-1 truncate text-[11px] text-zinc-600">
                            {d.name}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                  {m.note && (
                    <p className="mt-2 text-xs text-zinc-400">{m.note}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
