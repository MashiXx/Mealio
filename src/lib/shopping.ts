import { prisma } from "./db";
import {
  missingFor,
  mergeNeeds,
  toPantrySet,
  kindLookupFrom,
  type Need,
} from "./pantry";
import { normalizeIngredient } from "./normalize";

// Sinh danh sách đi chợ từ các mâm vừa lưu: gom nguyên liệu của mọi món, trừ
// những gì kho đang có, gộp trùng rồi dồn vào danh sách đang mở của gia đình.
// Chạm DB nên KHÔNG test bằng vitest — phần logic thuần đã nằm ở ./pantry.

/** Danh sách đang mở (closedAt = null); chưa có thì tạo. */
async function openList(familyId: string): Promise<string> {
  const existing = await prisma.shoppingList.findFirst({
    where: { familyId, closedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.shoppingList.create({
    data: { familyId },
    select: { id: true },
  });
  return created.id;
}

export async function syncShoppingFromMeals(
  familyId: string,
  plannedMealIds: string[],
): Promise<void> {
  if (plannedMealIds.length === 0) return;

  // Scope theo familyId ngay cả khi id đã do phía gọi cấp: mọi truy vấn nghiệp vụ
  // trong repo này đều đi qua gia đình, không tin id truyền vào.
  const dishes = await prisma.mealDish.findMany({
    where: { plannedMealId: { in: plannedMealIds }, plannedMeal: { familyId } },
    include: {
      recipe: {
        include: { ingredients: { include: { ingredient: true } } },
      },
    },
  });

  // Gom TẤT CẢ nguyên liệu, không tự lọc gia vị ở đây. Việc phân loại giao trọn
  // cho `missingFor(..., kindOf)` bên dưới — một nguồn sự thật duy nhất. Lọc thêm
  // ở đây bằng `ri.ingredient.kind` sẽ sai vì cột đó nullable (NULL = chưa phân
  // loại, phải tra bảng tĩnh) và sẽ lệch với lúc verify.
  const needs: Need[] = [];
  for (const d of dishes) {
    for (const ri of d.recipe.ingredients) {
      needs.push({
        name: ri.ingredient.name,
        quantity: ri.quantity,
        unit: ri.unit,
      });
    }
  }
  if (needs.length === 0) return;

  const pantryItems = await prisma.pantryItem.findMany({
    where: { familyId },
    include: { ingredient: true },
  });
  // Phải qua toPantrySet chứ KHÔNG dùng thẳng ingredient.normalized: missingFor
  // cho vế nhu cầu đi qua bảng đồng nghĩa, nên vế kho cũng phải đi qua, nếu không
  // "hành hoa" trong kho sẽ không khớp "hành lá" trong công thức.
  const pantry = toPantrySet(pantryItems.map((p) => p.ingredient.name));
  // Dùng cùng một nguồn phân loại với lúc verify: cờ kind của gia đình, thiếu thì
  // rơi về bảng gia vị tĩnh. Nạp cờ của MỌI Ingredient trong gia đình, không chỉ
  // những thứ đang có trong kho: người dùng có thể đã đổi nhóm cho một nguyên
  // liệu rồi dùng hết, ý họ vẫn phải còn hiệu lực khi tính đồ đi chợ.
  const allIngredients = await prisma.ingredient.findMany({
    where: { familyId },
    select: { name: true, kind: true },
  });
  const kindOf = kindLookupFrom(allIngredients);

  const toBuy = mergeNeeds(missingFor(needs, pantry, kindOf));
  if (toBuy.length === 0) return;

  const listId = await openList(familyId);

  for (const need of toBuy) {
    // Tra theo `normalized` (có @@unique[familyId, normalized]) chứ KHÔNG theo
    // `name`: cột name không unique và mergeNeeds có thể trả về một biến thể tên
    // khác với bản ghi trong DB.
    const ingredient = await prisma.ingredient.findUnique({
      where: {
        familyId_normalized: {
          familyId,
          normalized: normalizeIngredient(need.name),
        },
      },
      select: { id: true },
    });
    if (!ingredient) continue;

    // Đã có dòng chưa mua cho cùng nguyên liệu + cùng đơn vị thì cộng dồn. So đơn
    // vị theo dạng đã chuẩn hoá trong JS chứ không so chuỗi thô trong truy vấn:
    // đơn vị do AI sinh nên lần này "quả" lần sau "Quả" là chuyện thường, so thô
    // sẽ đẻ hai dòng cùng một nguyên liệu.
    const openItems = await prisma.shoppingItem.findMany({
      where: {
        shoppingListId: listId,
        ingredientId: ingredient.id,
        purchased: false,
      },
      select: { id: true, quantity: true, unit: true },
    });
    const wantUnit = normalizeIngredient(need.unit);
    const existing = openItems.find(
      (it) => normalizeIngredient(it.unit) === wantUnit,
    );

    if (existing) {
      await prisma.shoppingItem.update({
        where: { id: existing.id },
        data: { quantity: existing.quantity + need.quantity },
      });
    } else {
      await prisma.shoppingItem.create({
        data: {
          shoppingListId: listId,
          ingredientId: ingredient.id,
          quantity: need.quantity,
          unit: need.unit,
        },
      });
    }
  }
}
