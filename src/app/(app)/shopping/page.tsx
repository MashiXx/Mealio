import { prisma } from "@/lib/db";
import { requireFamily } from "@/lib/tenant";
import {
  togglePurchasedAction,
  addShoppingItemAction,
  removeShoppingItemAction,
  closeShoppingListAction,
} from "@/lib/actions/shopping";

// Trang đi chợ: danh sách phẳng của DUY NHẤT danh sách đang mở (closedAt = null).
// Server component thuần — mọi thao tác đi qua form + server action.

export default async function ShoppingPage() {
  const { familyId } = await requireFamily();

  const list = await prisma.shoppingList.findFirst({
    where: { familyId, closedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      items: {
        include: { ingredient: true },
        // Chưa mua nổi lên trên; đã mua trôi xuống nhưng vẫn hiện để bỏ tick được.
        orderBy: { purchased: "asc" },
      },
    },
  });

  const items = list?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Đi chợ</h1>
          <p className="text-sm text-zinc-500">
            Tick khi mua xong — nguyên liệu vào kho ngay
          </p>
        </div>
        {list && items.length > 0 && (
          <form action={closeShoppingListAction}>
            <input type="hidden" name="id" value={list.id} />
            <button className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:border-zinc-400">
              Xong buổi chợ
            </button>
          </form>
        )}
      </div>

      {/* Ô thêm tay luôn hiện, kể cả khi danh sách rỗng: gia vị không bao giờ tự
          vào danh sách nên đây là đường duy nhất để ghi "hết chai nước mắm". */}
      <form
        action={addShoppingItemAction}
        className="flex flex-wrap gap-2 rounded-2xl border border-zinc-200 bg-white p-4"
      >
        <input
          name="name"
          required
          placeholder="vd: nước mắm"
          className="min-w-48 flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <input
          name="quantity"
          inputMode="decimal"
          placeholder="1"
          className="w-20 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <input
          name="unit"
          placeholder="chai"
          className="w-28 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <button className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
          Thêm
        </button>
      </form>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center">
          {/* Rỗng là chuyện BÌNH THƯỜNG ở chế độ "nấu bằng đồ có sẵn" — nói rõ để
              người dùng không tưởng app hỏng. */}
          <p className="text-zinc-500">
            Chưa cần mua gì. Tạo thực đơn ở chế độ Thoải mái thì phần thiếu sẽ
            hiện ở đây.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-3 px-5 py-3">
              <form action={togglePurchasedAction}>
                <input type="hidden" name="id" value={it.id} />
                <button
                  aria-label={it.purchased ? "Bỏ đánh dấu đã mua" : "Đánh dấu đã mua"}
                  className={`flex h-5 w-5 items-center justify-center rounded border text-xs ${
                    it.purchased
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-zinc-300"
                  }`}
                >
                  {it.purchased ? "✓" : ""}
                </button>
              </form>
              <span
                className={`flex-1 text-sm ${
                  it.purchased ? "text-zinc-400 line-through" : "text-zinc-800"
                }`}
              >
                {it.ingredient.name}
                {/* Nói rõ dòng nào do người dùng tự gõ: đó là dòng KHÔNG bị cuốn
                    đi khi sinh lại thực đơn, thấy được thì đỡ tưởng app lỗi. */}
                {it.manual && (
                  <span className="ml-2 text-xs text-zinc-400">tự thêm</span>
                )}
              </span>
              <span className="text-xs text-zinc-500">
                {it.quantity} {it.unit}
              </span>
              {/* Nút xoá CHỈ cho dòng tự thêm: gõ nhầm thì bỏ đi, không phải tick
                  "đã mua" cho nó chui vào kho. Dòng máy sinh cố ý không có nút —
                  syncShopping dựng lại phần đó nên xoá tay sẽ mọc lại ngay. */}
              {it.manual && (
                <form action={removeShoppingItemAction}>
                  <input type="hidden" name="id" value={it.id} />
                  <button
                    aria-label={`Xoá "${it.ingredient.name}" khỏi danh sách`}
                    className="text-xs text-zinc-400 hover:text-red-600"
                  >
                    xoá
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
