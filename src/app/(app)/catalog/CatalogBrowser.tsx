"use client";

import { useMemo, useState, useTransition } from "react";
import Image from "next/image";
import { adoptCatalogDishAction } from "@/lib/actions/catalog";

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
  dishNames: string[];
}

const ROLE_META: Record<string, { label: string; emoji: string }> = {
  MON_MAN: { label: "Món mặn", emoji: "🍖" },
  MON_XAO: { label: "Món xào", emoji: "🥘" },
  CANH_SUP: { label: "Canh & súp", emoji: "🍲" },
  RAU_LUOC: { label: "Rau & gỏi", emoji: "🥗" },
  LAU: { label: "Lẩu", emoji: "🍲" },
  COM_BUN_PHO: { label: "Cơm, bún, phở", emoji: "🍜" },
  MON_CUON: { label: "Món cuốn", emoji: "🌯" },
  TRANG_MIENG: { label: "Tráng miệng", emoji: "🍧" },
  DO_CHUA: { label: "Đồ chua", emoji: "🥬" },
};

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
  const meta = ROLE_META[dish.dishRole] ?? { label: dish.dishRole, emoji: "🍽️" };
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
            {meta.emoji}
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
          {meta.emoji} {meta.label}
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
            const label = r === "ALL" ? "Tất cả" : ROLE_META[r]?.label ?? r;
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
                {r === "ALL" ? "" : ROLE_META[r]?.emoji + " "}
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
          {setMenus.map((m) => (
            <div
              key={m.slug}
              className="rounded-2xl border border-zinc-200 bg-white p-4"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-semibold text-zinc-900">{m.name}</h3>
                <span className="shrink-0 text-xs text-zinc-400">
                  {m.servings} người
                </span>
              </div>
              <p className="mt-1 text-sm text-zinc-600">
                {m.dishNames.join(" · ")}
              </p>
              {m.note && (
                <p className="mt-1.5 text-xs text-zinc-400">{m.note}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
