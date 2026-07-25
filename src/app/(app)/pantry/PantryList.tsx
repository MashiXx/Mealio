import {
  removePantryItemAction,
  toggleKindAction,
  updatePantryItemAction,
} from "@/lib/actions/pantry";

// Hiển thị một nhóm nguyên liệu trong kho. Server component thuần: mọi thao tác
// đi qua form + server action, không cần state phía client.
//
// `expiringSoon`/`expired` được tính sẵn ở page.tsx bằng new Date().getTime()
// rồi truyền xuống đây dạng dữ liệu thuần — component này KHÔNG tự gọi
// Date.now()/new Date(). Lý do: rule react-hooks/purity của eslint-plugin-
// react-hooks cấm gọi `Date.now()` trong thân component (component có thể
// re-render, kết quả sẽ đổi giữa các lần gọi dù component này trên thực tế
// luôn chạy trên server) — và rule đó bắt CẢ ở async server component, nên tự
// thân việc hoist lên page.tsx không "chữa" được lỗi lint. Thứ thật sự chữa là
// dùng `new Date().getTime()` thay vì `Date.now()`: bảng hàm bất định của
// plugin chỉ khai `canonicalName: 'Date.now'`, không mô hình hoá constructor
// `Date`. Việc hoist vẫn đáng làm dù vậy, vì hai lý do thật: mọi dòng được
// chấm theo ĐÚNG MỘT mốc thời gian, và PantryList trở thành hàm thuần của props.

export type PantryRow = {
  id: string;
  ingredientId: string;
  name: string;
  expiresAt: Date | null;
  expiringSoon: boolean;
  expired: boolean;
};

/** yyyy-mm-dd theo giờ địa phương cho defaultValue của <input type="date">.
 * Dùng getFullYear/Month/Date (không toISOString) để tránh lệch ngày do UTC —
 * cùng cách NewMenuForm.tsx đang làm. */
function toDateInputValue(d: Date | null): string {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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
            <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="flex-1 text-sm text-zinc-800">{r.name}</span>

              {r.expired ? (
                <span className="text-xs font-medium text-red-600">
                  ✗ đã hết hạn
                </span>
              ) : r.expiringSoon ? (
                <span className="text-xs font-medium text-amber-600">
                  ⚠ sắp hết hạn
                </span>
              ) : null}

              {/* Sửa hạn dùng: luôn hiện, kể cả khi chưa có hạn nào. Rỗng rồi
                  lưu = xoá hạn (khác ô thêm nhanh, nơi rỗng = giữ nguyên). */}
              <form action={updatePantryItemAction} className="flex items-center gap-1">
                <input type="hidden" name="id" value={r.id} />
                <input
                  type="date"
                  name="expiresAt"
                  defaultValue={toDateInputValue(r.expiresAt)}
                  aria-label={`Hạn dùng của ${r.name}`}
                  className="rounded border border-zinc-200 px-1.5 py-0.5 text-xs text-zinc-500 outline-none focus:border-emerald-500"
                />
                <button className="text-xs text-zinc-400 hover:text-zinc-700">
                  lưu
                </button>
              </form>

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
