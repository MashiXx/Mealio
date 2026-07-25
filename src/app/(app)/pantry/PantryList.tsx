import {
  removePantryItemAction,
  toggleKindAction,
} from "@/lib/actions/pantry";

// Hiển thị một nhóm nguyên liệu trong kho. Server component thuần: mọi thao tác
// đi qua form + server action, không cần state phía client.
//
// `expiringSoon` được tính sẵn ở page.tsx chứ không gọi Date.now() ngay trong
// component này: rule react-hooks/purity coi Date.now() là hàm bất định, cấm
// gọi trong thân component dù chạy trên server. Xem comment ở page.tsx.

export type PantryRow = {
  id: string;
  ingredientId: string;
  name: string;
  expiresAt: Date | null;
  expiringSoon: boolean;
};

export function PantryList({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: PantryRow[];
  empty: string;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold text-zinc-500">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-400">{empty}</p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2">
              <span className="flex-1 text-sm text-zinc-800">{r.name}</span>
              {r.expiresAt && (
                <span
                  className={`text-xs ${r.expiringSoon ? "text-amber-600" : "text-zinc-400"}`}
                >
                  {r.expiringSoon ? "⚠ " : ""}
                  {r.expiresAt.toLocaleDateString("vi-VN")}
                </span>
              )}
              <form action={toggleKindAction}>
                <input type="hidden" name="ingredientId" value={r.ingredientId} />
                <button className="text-xs text-zinc-400 hover:text-zinc-700">
                  đổi nhóm
                </button>
              </form>
              <form action={removePantryItemAction}>
                <input type="hidden" name="id" value={r.id} />
                <button className="text-xs text-zinc-400 hover:text-red-600">
                  đã hết
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
