import { prisma } from "./db";
import {
  missingFor,
  mergeNeeds,
  toPantrySet,
  kindLookupFrom,
  type Need,
} from "./pantry";
import { normalizeIngredient } from "./normalize";
import type { Prisma } from "@prisma/client";

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
 * Khoá ghi theo GIA ĐÌNH, tự nhả khi transaction kết thúc.
 *
 * Cần thật, không phải phòng xa: `$transaction` chạy ở READ COMMITTED nên nguyên
 * tử KHÔNG có nghĩa là tuần tự. Hai lượt đồng bộ chồng nhau — vd bấm "Đã nấu"
 * đúng lúc job sinh thực đơn vừa xong, hai đường gọi độc lập, markCookedAction
 * không đi qua pump nên MENU_GEN_CONCURRENCY không ràng được — sẽ diễn ra thế
 * này: T1 xoá rồi chèn rồi commit; T2 đang chờ khoá dòng tỉnh dậy, thấy các dòng
 * mình định xoá đã biến mất nên xoá 0 dòng, và KHÔNG quét lại những dòng T1 vừa
 * chèn (câu DELETE của nó đã chốt ảnh chụp từ trước); T2 chèn tiếp bộ của mình ->
 * mọi dòng máy sinh nhân đôi.
 *
 * Khoá cả gia đình chứ không khoá riêng ShoppingList vì lúc lấy khoá có thể chưa
 * có danh sách nào — đây cũng là thứ chặn hai lượt cùng tạo hai danh sách "đang
 * mở". hashtext trả int4 nên hai familyId khác nhau có thể trùng khoá; hậu quả
 * chỉ là thi thoảng hai gia đình chờ nhau một nhịp, không sai dữ liệu.
 */
async function lockFamily(
  tx: Prisma.TransactionClient,
  familyId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${familyId}::text)::bigint)`;
}

/**
 * id danh sách đang mở (closedAt = null). `create` quyết định có tạo mới khi chưa
 * có hay không — đồng bộ mà không có gì để mua thì đừng đẻ ra một danh sách rỗng.
 * Chỉ gọi khi ĐÃ giữ lockFamily: findFirst-rồi-create không nguyên tử.
 */
async function openListId(
  tx: Prisma.TransactionClient,
  familyId: string,
  create: boolean,
): Promise<string | null> {
  const existing = await tx.shoppingList.findFirst({
    where: { familyId, closedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (existing) return existing.id;
  if (!create) return null;
  const created = await tx.shoppingList.create({
    data: { familyId },
    select: { id: true },
  });
  return created.id;
}

/**
 * Chèn một dòng người dùng TỰ GÕ vào danh sách đang mở (tạo danh sách nếu chưa
 * có). Nằm ở đây chứ không ở server action để dùng chung đúng một lockFamily với
 * syncShopping — nếu không, thêm dòng tay đúng lúc một lượt đồng bộ đang chạy có
 * thể đẻ ra danh sách "đang mở" thứ hai và dòng vừa gõ biến mất khỏi giao diện
 * (trang chỉ đọc danh sách mới nhất).
 */
export async function addManualShoppingItem(
  familyId: string,
  item: { ingredientId: string; quantity: number; unit: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockFamily(tx, familyId);
    const listId = await openListId(tx, familyId, true);
    if (!listId) return;
    await tx.shoppingItem.create({
      data: { ...item, shoppingListId: listId, manual: true },
    });
  });
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
  // Đọc - tính - ghi TRỌN trong một transaction đang giữ khoá gia đình. Đọc bên
  // ngoài rồi chỉ khoá lúc ghi vẫn tránh được nhân đôi, nhưng lượt chạy chậm chân
  // sẽ ghi đè kết quả tính từ dữ liệu cũ lên kết quả mới hơn; gói cả vào trong thì
  // không phải nghĩ tới ca đó nữa. Phần tính toán là JS thuần nên khoá giữ rất
  // ngắn. Nới maxWait/timeout theo đúng lệ của repo cho DB ở xa.
  await prisma.$transaction(
    async (tx) => {
      await lockFamily(tx, familyId);

      // Chỉ các mâm CÒN PHẢI NẤU: từ đầu hôm nay trở đi và chưa bấm "đã nấu". Mâm
      // quá khứ hoặc đã nấu thì mua thêm không còn ý nghĩa.
      //
      // orderBy ở CẢ BA tầng để thứ tự phẳng hoá là tất định: mergeNeeds phá hoà
      // bằng "gặp trước thắng" khi chọn tên/đơn vị hiển thị, mà Postgres không hứa
      // thứ tự nào nếu không sắp — thiếu nó thì cùng một dữ liệu có thể ra "hành
      // hoa" lượt này, "hành lá" lượt sau.
      const meals = await tx.plannedMeal.findMany({
        where: { familyId, date: { gte: startOfToday() }, cookedAt: null },
        orderBy: [{ date: "asc" }, { mealType: "asc" }],
        select: {
          dishes: {
            orderBy: { position: "asc" },
            select: {
              recipe: {
                select: {
                  ingredients: {
                    orderBy: { id: "asc" },
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

      // Gom TẤT CẢ nguyên liệu, không tự lọc gia vị ở đây. Việc phân loại giao
      // trọn cho `missingFor(..., kindOf)` bên dưới — một nguồn sự thật duy nhất.
      // Lọc thêm ở đây bằng `ri.ingredient.kind` sẽ sai vì cột đó nullable (NULL =
      // chưa phân loại, phải tra bảng tĩnh) và sẽ lệch với lúc verify.
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

      // Không còn mâm nào sắp tới thì vẫn phải chạy tiếp chứ KHÔNG return sớm:
      // phần máy sinh cũ đã hết căn cứ, phải dọn. Chỉ bỏ qua mấy truy vấn tính.
      let toBuy: Need[] = [];
      if (needs.length > 0) {
        const [pantryItems, allIngredients] = await Promise.all([
          tx.pantryItem.findMany({
            where: { familyId },
            select: { ingredient: { select: { name: true } } },
          }),
          // Nạp cờ kind của MỌI Ingredient trong gia đình, không chỉ những thứ
          // đang có trong kho: người dùng có thể đã đổi nhóm cho một nguyên liệu
          // rồi dùng hết, ý họ vẫn phải còn hiệu lực khi tính đồ đi chợ.
          tx.ingredient.findMany({
            where: { familyId },
            select: { name: true, kind: true },
          }),
        ]);
        // Phải qua toPantrySet chứ KHÔNG dùng thẳng ingredient.normalized:
        // missingFor cho vế nhu cầu đi qua bảng đồng nghĩa, nên vế kho cũng phải
        // đi qua, nếu không "hành hoa" trong kho sẽ không khớp "hành lá" trong
        // công thức.
        const pantry = toPantrySet(pantryItems.map((p) => p.ingredient.name));
        // Cùng một nguồn phân loại với lúc verify ở jobs.ts: cờ kind của gia đình,
        // thiếu thì rơi về bảng gia vị tĩnh.
        const kindOf = kindLookupFrom(allIngredients);
        toBuy = mergeNeeds(missingFor(needs, pantry, kindOf));
      }

      // Tra Ingredient theo `normalized` (có @@unique[familyId, normalized]) chứ
      // KHÔNG theo `name`: cột name không unique và mergeNeeds có thể trả về biến
      // thể tên khác với bản ghi trong DB. Một truy vấn cho cả danh sách thay vì
      // mỗi dòng một lượt. Hai dòng toBuy khác nhau không bao giờ trỏ cùng một
      // Ingredient VỚI CÙNG đơn vị: mergeNeeds đã gộp theo (matchKey | đơn vị
      // chuẩn hoá), mà matchKey khác nhau thì normalized cũng khác nhau.
      const normalizedOf = toBuy.map((n) => normalizeIngredient(n.name));
      const found =
        normalizedOf.length > 0
          ? await tx.ingredient.findMany({
              where: { familyId, normalized: { in: [...new Set(normalizedOf)] } },
              select: { id: true, normalized: true },
            })
          : [];
      const idByNormalized = new Map(found.map((i) => [i.normalized, i.id]));

      const items = toBuy.flatMap((need, i) => {
        const ingredientId = idByNormalized.get(normalizedOf[i]);
        // Không bao giờ xảy ra trên thực tế: mọi need.name đều lấy từ
        // Ingredient.name của chính gia đình này, nên tra ngược theo normalized
        // luôn thấy. Giữ nhánh này chỉ để TypeScript có kiểu chắc chắn, không phải
        // vì có ca nghiệp vụ nào rơi vào đây.
        if (!ingredientId) return [];
        return [{ ingredientId, quantity: need.quantity, unit: need.unit }];
      });

      const listId = await openListId(tx, familyId, items.length > 0);
      if (!listId) return; // chưa có danh sách nào mà cũng chẳng có gì để mua

      await tx.shoppingItem.deleteMany({
        where: { shoppingListId: listId, purchased: false, manual: false },
      });
      // Danh sách rỗng là ca THƯỜNG GẶP NHẤT ở chế độ "nấu bằng đồ có sẵn" — bỏ
      // hẳn lượt ghi thay vì gửi createMany với data rỗng.
      if (items.length > 0) {
        await tx.shoppingItem.createMany({
          data: items.map((it) => ({ ...it, shoppingListId: listId })),
        });
      }
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}
