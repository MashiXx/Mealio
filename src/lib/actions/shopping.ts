"use server";

import { revalidatePath } from "next/cache";
import { requireFamily } from "@/lib/tenant";
import { prisma } from "@/lib/db";

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
