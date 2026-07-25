import { prisma } from "./db";
import {
  missingFor,
  mergeNeeds,
  toPantrySet,
  kindLookupFrom,
  type Need,
} from "./pantry";
import { normalizeIngredient } from "./normalize";

// Đồng bộ danh sách đi chợ với các mâm SẮP TỚI: gom nguyên liệu, trừ những gì kho
// đang có, gộp trùng rồi DỰNG LẠI phần máy sinh của danh sách đang mở.
// Chạm DB nên KHÔNG test bằng vitest — phần logic thuần đã nằm ở ./pantry.

/**
 * Nửa đêm hôm nay theo giờ ĐỊA PHƯƠNG — khớp cách PlannedMeal.date được lưu
 * (`new Date("yyyy-mm-ddT00:00:00")`, tức midnight local, xem saveMenu). Dùng
 * setHours chứ không cắt chuỗi ISO/UTC, nếu không máy chủ lệch múi giờ sẽ bỏ sót
 * hoặc thừa nguyên một ngày.
 */
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * id danh sách đang mở (closedAt = null). `create` quyết định có tạo mới khi chưa
 * có hay không — đồng bộ mà không có gì để mua thì đừng đẻ ra một danh sách rỗng.
 */
export async function openShoppingListId(
  familyId: string,
  create: boolean,
): Promise<string | null> {
  const existing = await prisma.shoppingList.findFirst({
    where: { familyId, closedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (existing) return existing.id;
  if (!create) return null;
  const created = await prisma.shoppingList.create({
    data: { familyId },
    select: { id: true },
  });
  return created.id;
}

/**
 * Tính lại danh sách đi chợ cho cả gia đình. IDEMPOTENT: chạy bao nhiêu lần cũng
 * ra cùng kết quả, nên gọi được ở mọi chỗ làm mâm thay đổi.
 *
 * Vì sao DỰNG LẠI chứ không cộng thêm: sinh lại thực đơn cho cùng một ngày là
 * thao tác thường ngày (không ưng mâm đầu thì bấm lại). saveMenu xoá mâm cũ rồi
 * tạo mâm mới, nên nếu ở đây cộng dồn vào dòng chưa mua thì "cà chua 3 quả" thành
 * 6 rồi 9 sau mỗi lần bấm, trong khi nhu cầu thật vẫn là 3.
 *
 * Giữ nguyên hai thứ, chỉ dựng lại phần còn lại:
 * - `purchased: true` — đã mua rồi, xoá đi là mất dấu buổi chợ. Vòng tính mới cũng
 *   không đòi mua lại vì tick "đã mua" đã đẩy nguyên liệu vào kho.
 * - `manual: true` — người dùng tự gõ, máy không có quyền đụng.
 */
export async function syncShopping(familyId: string): Promise<void> {
  // Chỉ các mâm CÒN PHẢI NẤU: từ đầu hôm nay trở đi và chưa bấm "đã nấu". Mâm quá
  // khứ hoặc đã nấu thì mua thêm không còn ý nghĩa.
  const meals = await prisma.plannedMeal.findMany({
    where: { familyId, date: { gte: startOfToday() }, cookedAt: null },
    select: {
      dishes: {
        select: {
          recipe: {
            select: {
              ingredients: {
                select: {
                  quantity: true,
                  unit: true,
                  ingredient: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  // Gom TẤT CẢ nguyên liệu, không tự lọc gia vị ở đây. Việc phân loại giao trọn
  // cho `missingFor(..., kindOf)` bên dưới — một nguồn sự thật duy nhất. Lọc thêm
  // ở đây bằng `ri.ingredient.kind` sẽ sai vì cột đó nullable (NULL = chưa phân
  // loại, phải tra bảng tĩnh) và sẽ lệch với lúc verify.
  const needs: Need[] = [];
  for (const meal of meals) {
    for (const d of meal.dishes) {
      for (const ri of d.recipe.ingredients) {
        needs.push({
          name: ri.ingredient.name,
          quantity: ri.quantity,
          unit: ri.unit,
        });
      }
    }
  }

  // Không còn mâm nào sắp tới thì vẫn phải chạy tiếp chứ KHÔNG return sớm: phần
  // máy sinh cũ đã hết căn cứ, phải dọn. Chỉ bỏ qua mấy truy vấn tính toán.
  let toBuy: Need[] = [];
  if (needs.length > 0) {
    const [pantryItems, allIngredients] = await Promise.all([
      prisma.pantryItem.findMany({
        where: { familyId },
        select: { ingredient: { select: { name: true } } },
      }),
      // Nạp cờ kind của MỌI Ingredient trong gia đình, không chỉ những thứ đang có
      // trong kho: người dùng có thể đã đổi nhóm cho một nguyên liệu rồi dùng hết,
      // ý họ vẫn phải còn hiệu lực khi tính đồ đi chợ.
      prisma.ingredient.findMany({
        where: { familyId },
        select: { name: true, kind: true },
      }),
    ]);
    // Phải qua toPantrySet chứ KHÔNG dùng thẳng ingredient.normalized: missingFor
    // cho vế nhu cầu đi qua bảng đồng nghĩa, nên vế kho cũng phải đi qua, nếu không
    // "hành hoa" trong kho sẽ không khớp "hành lá" trong công thức.
    const pantry = toPantrySet(pantryItems.map((p) => p.ingredient.name));
    // Cùng một nguồn phân loại với lúc verify: cờ kind của gia đình, thiếu thì rơi
    // về bảng gia vị tĩnh.
    const kindOf = kindLookupFrom(allIngredients);
    toBuy = mergeNeeds(missingFor(needs, pantry, kindOf));
  }

  // Tra Ingredient theo `normalized` (có @@unique[familyId, normalized]) chứ KHÔNG
  // theo `name`: cột name không unique và mergeNeeds có thể trả về biến thể tên
  // khác với bản ghi trong DB. Một truy vấn cho cả danh sách thay vì mỗi dòng một
  // lượt. Hai dòng toBuy khác nhau không bao giờ trỏ cùng một Ingredient VỚI CÙNG
  // đơn vị: mergeNeeds đã gộp theo (matchKey | đơn vị chuẩn hoá), mà matchKey khác
  // nhau thì normalized cũng khác nhau.
  const normalizedOf = toBuy.map((n) => normalizeIngredient(n.name));
  const found =
    normalizedOf.length > 0
      ? await prisma.ingredient.findMany({
          where: { familyId, normalized: { in: [...new Set(normalizedOf)] } },
          select: { id: true, normalized: true },
        })
      : [];
  const idByNormalized = new Map(found.map((i) => [i.normalized, i.id]));

  const items = toBuy.flatMap((need, i) => {
    const ingredientId = idByNormalized.get(normalizedOf[i]);
    if (!ingredientId) return [];
    return [{ ingredientId, quantity: need.quantity, unit: need.unit }];
  });

  const listId = await openShoppingListId(familyId, items.length > 0);
  if (!listId) return; // chưa có danh sách nào mà cũng chẳng có gì để mua

  // Xoá + chèn trong MỘT transaction: người mở /shopping đúng lúc này không bao
  // giờ thấy danh sách rỗng tạm thời, và hai lượt đồng bộ chạy sát nhau (job sinh
  // thực đơn xong cùng lúc với job sửa mâm) không lồng vào nhau thành hai bộ.
  await prisma.$transaction([
    prisma.shoppingItem.deleteMany({
      where: { shoppingListId: listId, purchased: false, manual: false },
    }),
    prisma.shoppingItem.createMany({
      data: items.map((it) => ({ ...it, shoppingListId: listId })),
    }),
  ]);
}
