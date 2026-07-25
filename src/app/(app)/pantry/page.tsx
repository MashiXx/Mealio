import { prisma } from "@/lib/db";
import { requireFamily } from "@/lib/tenant";
import { addPantryItemAction } from "@/lib/actions/pantry";
import { matchKey, staticKind, isExpiringSoon, isExpired } from "@/lib/pantry";
import { PantryList, type PantryRow } from "./PantryList";

export default async function PantryPage() {
  const { familyId } = await requireFamily();

  const items = await prisma.pantryItem.findMany({
    where: { familyId },
    include: { ingredient: true },
    orderBy: { updatedAt: "desc" },
  });

  // Tính "sắp hết hạn"/"quá hạn" ở đây bằng new Date().getTime() rồi truyền
  // xuống PantryList như dữ liệu thuần — không gọi Date.now()/new Date() bên
  // trong PantryList. Rule react-hooks/purity cấm gọi Date.now() (không phải
  // constructor Date) trong thân component vì component có thể re-render và
  // đổi kết quả giữa các lần render; hoist lên đây còn có lợi thật: mọi dòng
  // được chấm theo ĐÚNG MỘT mốc thời gian (không lệch nhau vài mili-giây giữa
  // các lần gọi), và PantryList trở thành hàm thuần của props, dễ test/đọc hơn.
  const now = new Date().getTime();

  // kind trên Ingredient là nullable: NULL nghĩa là gia đình chưa từng bấm "đổi
  // nhóm", hiệu lực thật phải tra bảng gia vị tĩnh (staticKind), không phải mặc
  // định coi NULL là MAIN — nếu coi vậy, mọi nguyên liệu AI tạo trước khi trang
  // kho tồn tại (nước mắm, tỏi...) sẽ rơi nhầm vào nhóm "Đồ tươi".
  const effectiveKind = (i: (typeof items)[number]) =>
    i.ingredient.kind ?? staticKind(matchKey(i.ingredient.name));

  const toRow = (i: (typeof items)[number]): PantryRow => ({
    id: i.id,
    ingredientId: i.ingredientId,
    name: i.ingredient.name,
    expiresAt: i.expiresAt,
    expiringSoon: isExpiringSoon(i.expiresAt, now),
    expired: isExpired(i.expiresAt, now),
  });

  const main = items.filter((i) => effectiveKind(i) === "MAIN").map(toRow);
  const seasoning = items
    .filter((i) => effectiveKind(i) === "SEASONING")
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
