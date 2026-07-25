"use server";

import { revalidatePath } from "next/cache";
import { requireFamily } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { normalizeIngredient } from "@/lib/normalize";
import { openShoppingListId } from "@/lib/shopping";

// Tick "đã mua" thì nguyên liệu vào kho ngay — đây là chỗ khép vòng kho ↔ đi chợ,
// và là cách kho được nuôi mà không phải nhập tay.

export async function togglePurchasedAction(formData: FormData): Promise<void> {
  const { familyId } = await requireFamily();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Lọc qua shoppingList.familyId: dòng đi chợ không mang familyId trực tiếp nên
  // phải đi vòng qua danh sách để không cho sửa dòng của gia đình khác.
  const item = await prisma.shoppingItem.findFirst({
    where: { id, shoppingList: { familyId } },
    select: { id: true, purchased: true, ingredientId: true },
  });
  if (!item) return;

  const purchased = !item.purchased;
  await prisma.shoppingItem.update({ where: { id }, data: { purchased } });

  if (purchased) {
    // Kho là danh sách "có/không": mua rồi thì có, không cộng dồn số lượng. Đã
    // nằm sẵn trong kho thì giữ nguyên hạn dùng cũ (`update: {}`) — người dùng
    // sửa hạn ở trang kho, không phải ở đây.
    await prisma.pantryItem.upsert({
      where: {
        familyId_ingredientId: { familyId, ingredientId: item.ingredientId },
      },
      create: { familyId, ingredientId: item.ingredientId },
      update: {},
    });
  }

  // Bỏ tick KHÔNG lấy lại nguyên liệu khỏi kho: có thể người dùng đã mua thật rồi
  // chỉ tick nhầm dòng, xoá kho theo là mất dữ liệu của họ. Muốn bỏ thì bấm "đã
  // hết" ở trang kho.

  // Một thao tác đổi cả hai trang -> revalidate cả hai.
  revalidatePath("/shopping");
  revalidatePath("/pantry");
}

/**
 * Thêm tay một dòng bất kỳ — hết chai nước mắm thì tự ghi vào. Không có lối này
 * thì gia vị vĩnh viễn không vào được danh sách: syncShopping cố ý bỏ qua chúng.
 * Dòng tự thêm mang `manual: true` nên các lượt đồng bộ sau không xoá cũng không
 * cộng dồn vào nó.
 */
export async function addShoppingItemAction(formData: FormData): Promise<void> {
  const { familyId } = await requireFamily();

  const raw = String(formData.get("name") ?? "").trim();
  if (!raw) return;
  const normalized = normalizeIngredient(raw);
  if (!normalized) return; // tên chỉ toàn ký tự lạ, vd "!!!"

  // Người Việt gõ "0,5" nhiều như "0.5". Số vô nghĩa/âm/0 -> quay về 1 thay vì
  // chặn: đây là ô ghi vội giữa chợ, đừng bắt người dùng sửa cho đúng cú pháp.
  const rawQty = String(formData.get("quantity") ?? "").trim().replace(",", ".");
  const parsedQty = rawQty ? Number(rawQty) : 1;
  const quantity = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : 1;

  const unit = String(formData.get("unit") ?? "").trim() || "phần";

  const ingredient = await prisma.ingredient.upsert({
    where: { familyId_normalized: { familyId, normalized } },
    // KHÔNG gán `kind`: để NULL cho staticKind lo lúc đọc. Gán MAIN ở đây sẽ ghi
    // đè bảng tĩnh sai chiều đúng như trên trang kho đã tránh.
    create: { familyId, name: raw, normalized },
    update: {},
  });

  const listId = await openShoppingListId(familyId, true);
  if (!listId) return;

  await prisma.shoppingItem.create({
    data: {
      shoppingListId: listId,
      ingredientId: ingredient.id,
      quantity,
      unit,
      manual: true,
    },
  });

  revalidatePath("/shopping");
}

/** Xong buổi chợ: đóng danh sách, lần sau sinh thực đơn sẽ mở danh sách mới. */
export async function closeShoppingListAction(
  formData: FormData,
): Promise<void> {
  const { familyId } = await requireFamily();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.shoppingList.updateMany({
    where: { id, familyId, closedAt: null },
    data: { closedAt: new Date() },
  });
  revalidatePath("/shopping");
}
