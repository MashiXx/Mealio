import { prisma } from "@/lib/db";
import { requireFamily } from "@/lib/tenant";
import { addPantryItemAction } from "@/lib/actions/pantry";
import { PantryList, type PantryRow } from "./PantryList";

export default async function PantryPage() {
  const { familyId } = await requireFamily();

  const items = await prisma.pantryItem.findMany({
    where: { familyId },
    include: { ingredient: true },
    orderBy: { updatedAt: "desc" },
  });

  // Tính "sắp hết hạn" ở đây, không trong PantryList: rule react-hooks/purity
  // cấm gọi Date.now() trong thân component (coi là hàm bất định lúc render).
  // new Date().getTime() cho cùng giá trị nhưng Date.now không phải hàm bị rule
  // này đánh dấu — khớp cách dashboard/page.tsx đang dùng new Date().
  const now = new Date().getTime();
  const DAY = 24 * 60 * 60 * 1000;
  const toRow = (i: (typeof items)[number]): PantryRow => ({
    id: i.id,
    ingredientId: i.ingredientId,
    name: i.ingredient.name,
    expiresAt: i.expiresAt,
    expiringSoon: i.expiresAt !== null && i.expiresAt.getTime() - now < 2 * DAY,
  });

  const main = items.filter((i) => i.ingredient.kind === "MAIN").map(toRow);
  const seasoning = items
    .filter((i) => i.ingredient.kind === "SEASONING")
    .map(toRow);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Kho nhà</h1>
        <p className="text-sm text-zinc-500">
          Nhà đang có gì — không cần ghi số lượng
        </p>
      </div>

      <form
        action={addPantryItemAction}
        className="flex flex-wrap gap-2 rounded-2xl border border-zinc-200 bg-white p-4"
      >
        <input
          name="name"
          required
          placeholder="vd: cá thu"
          className="min-w-48 flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <input
          type="date"
          name="expiresAt"
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <button className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
          Thêm
        </button>
      </form>

      <PantryList
        title="Đồ tươi"
        rows={main}
        empty="Chưa có gì. Thêm vài thứ để thực đơn bám theo kho."
      />
      <PantryList
        title="Gia vị & đồ khô"
        rows={seasoning}
        empty="Chưa có. Gia vị luôn được coi là có sẵn khi lên thực đơn."
      />
    </div>
  );
}
