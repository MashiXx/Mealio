"use server";

import { revalidatePath } from "next/cache";
import { requireFamily } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { matchKey, staticKind } from "@/lib/pantry";
import { syncShopping } from "@/lib/shopping";

// Mắt xích cuối của vòng "kho → thực đơn → đi chợ → nấu → trừ kho": đánh dấu mâm
// đã nấu rồi xoá khỏi kho những nguyên liệu VỪA có kind hiệu lực là MAIN VỪA xuất
// hiện trong công thức của một món thuộc mâm này. Nguyên liệu không liên quan tới
// mâm thì không đụng; gia vị ở lại kể cả khi món có dùng.
//
// Không có số lượng nên không trừ một phần được — đã nấu nghĩa là hết. Còn thừa
// thì người dùng thêm lại tay. Đây là đánh đổi đã chấp nhận khi chọn kho không
// định lượng.

export async function markCookedAction(formData: FormData): Promise<void> {
  const { familyId } = await requireFamily();
  const plannedMealId = String(formData.get("plannedMealId") ?? "");
  if (!plannedMealId) return;

  const meal = await prisma.plannedMeal.findFirst({
    where: { id: plannedMealId, familyId },
    select: {
      dishes: {
        select: {
          recipe: {
            select: {
              ingredients: {
                select: { ingredient: { select: { name: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!meal) return;

  // So khớp bằng matchKey chứ KHÔNG bằng ingredientId: cùng một thứ đồ có thể tồn
  // tại thành hai dòng Ingredient khác nhau trong cùng gia đình ("đậu hũ" người
  // dùng gõ ở trang kho vs "đậu phụ" AI sinh trong công thức). Cả verify lẫn
  // syncShopping đều coi hai tên đó là một (missingFor đi qua bảng đồng nghĩa),
  // nên nếu ở đây so theo id thì "đậu hũ" sẽ nằm lại kho vĩnh viễn dù đã nấu, và
  // lượt sinh thực đơn sau vẫn tưởng nhà còn đậu.
  const usedKeys = new Set<string>();
  for (const d of meal.dishes) {
    for (const ri of d.recipe.ingredients) {
      const key = matchKey(ri.ingredient.name);
      // Tên rỗng sau chuẩn hoá (vd "!!!") bị loại: để lọt vào tập thì mọi dòng kho
      // cũng có khoá rỗng sẽ bị xoá lây.
      if (key) usedKeys.add(key);
    }
  }

  const pantryItems = await prisma.pantryItem.findMany({
    where: { familyId },
    select: { id: true, ingredient: { select: { name: true, kind: true } } },
  });

  // Kind hiệu lực tính TRONG JS chứ không lọc bằng `where: { ingredient: { kind:
  // "MAIN" } }`: Ingredient.kind là nullable và cố ý để NULL (chỉ nút "đổi nhóm"
  // ở trang kho mới ghi giá trị cụ thể), mà SQL `kind = 'MAIN'` không khớp NULL.
  // Lọc bằng SQL thì deleteMany không xoá gì cả — nút "Đã nấu" thành nút giả, kho
  // không bao giờ vơi đi. NULL nghĩa là "chưa tự phân loại" -> tra bảng gia vị
  // tĩnh, cùng cách tính với /pantry, actions/menu.ts và shopping.ts.
  const toRemove = pantryItems
    .filter((p) => {
      const key = matchKey(p.ingredient.name);
      if (!key || !usedKeys.has(key)) return false;
      return (p.ingredient.kind ?? staticKind(key)) === "MAIN";
    })
    .map((p) => p.id);

  // `cookedAt: null` nằm trong where để bấm hai lần (hoặc POST thẳng vào action)
  // không xoá kho lần thứ hai: giữa hai lần bấm người dùng có thể đã mua lại đúng
  // nguyên liệu đó, xoá lần nữa là ăn mất hàng mới.
  const cooked = await prisma.$transaction(async (tx) => {
    const res = await tx.plannedMeal.updateMany({
      where: { id: plannedMealId, familyId, cookedAt: null },
      data: { cookedAt: new Date() },
    });
    if (res.count === 0) return false;
    if (toRemove.length > 0) {
      await tx.pantryItem.deleteMany({ where: { id: { in: toRemove }, familyId } });
    }
    return true;
  });
  if (!cooked) return;

  // Mâm đã nấu rụng khỏi căn cứ tính đồ đi chợ (syncShopping chỉ nhìn mâm sắp tới
  // CHƯA nấu), và kho vừa vơi đi nên phần thiếu của các mâm còn lại cũng đổi.
  await syncShopping(familyId);

  revalidatePath("/dashboard");
  revalidatePath("/pantry");
  revalidatePath("/shopping");
}
