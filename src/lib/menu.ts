import { prisma } from "./db";
import { buildCatalogReference } from "./catalog";
import { createRecipeFromDish } from "./edit";
import { planMealStructure } from "./meal-structure";
import { toPantrySet, kindLookupFrom, staticKind, isExpiringSoon, matchKey } from "./pantry";
import type { AiMenu } from "./ai/schema";
import type {
  MealTypeStr,
  MenuContext,
  MenuMember,
  MenuProfile,
  MenuSlot,
} from "./ai/types";

// Dựng ngữ cảnh cho AI từ dữ liệu gia đình, và lưu thực đơn AI trả về xuống DB
// (Ingredient chuẩn hoá + Recipe + RecipeIngredient + PlannedMeal).

export async function buildMenuContext(
  familyId: string,
  rawSlots: { date: string; mealType: MealTypeStr }[],
  dishCount?: number | null,
  pantryMode: "AVAILABLE_ONLY" | "FLEXIBLE" = "FLEXIBLE",
  retryNote?: string,
): Promise<MenuContext> {
  const [members, profile, pantry, recentRecipes, allRecipes] =
    await Promise.all([
      prisma.familyMember.findMany({ where: { familyId } }),
      prisma.eatingProfile.findUnique({ where: { familyId } }),
      prisma.pantryItem.findMany({
        where: { familyId },
        include: { ingredient: true },
      }),
      prisma.recipe.findMany({
        where: { familyId },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: { name: true },
      }),
      prisma.recipe.findMany({
        where: { familyId },
        take: 50,
        select: { name: true },
      }),
    ]);

  const menuMembers: MenuMember[] = members.map((m) => ({
    name: m.name,
    ageGroup: m.ageGroup,
    allergies: m.allergies,
    dietaryRestrictions: m.dietaryRestrictions,
    likes: m.likes,
    dislikes: m.dislikes,
  }));

  const menuProfile: MenuProfile = {
    cuisineRegion: profile?.cuisineRegion ?? "KHONG_CO_KHAU_VI",
    spiceLevel: profile?.spiceLevel ?? "MEDIUM",
    budgetLevel: profile?.budgetLevel ?? "MEDIUM",
    maxCookMinutes: profile?.maxCookMinutes ?? 60,
    healthGoals: profile?.healthGoals ?? [],
    notes: profile?.notes ?? null,
  };

  return {
    familySize: members.length,
    members: menuMembers,
    profile: menuProfile,
    pantry: pantry.map((p) => ({
      name: p.ingredient.name,
      // Ngưỡng "sắp hết hạn" theo spec: còn <= 2 ngày thì nhắc AI ưu tiên dùng.
      expiringSoon: isExpiringSoon(p.expiresAt, Date.now()),
      // Mang theo cờ phân loại của gia đình để phía verify khỏi truy vấn lại DB.
      // p.ingredient.kind là NULL khi gia đình chưa từng bấm "đổi nhóm" (cột
      // không có @default) -> rơi về bảng tĩnh, KHÔNG được coi NULL là "MAIN".
      kind: p.ingredient.kind ?? staticKind(matchKey(p.ingredient.name)),
    })),
    recentRecipeNames: recentRecipes.map((r) => r.name),
    availableRecipeNames: allRecipes.map((r) => r.name),
    slots: rawSlots.map((s) => ({
      ...s,
      dishRoles: planMealStructure(s.mealType, members.length, dishCount),
    })),
    // Tham chiếu món Việt từ kho dùng chung, đã lọc theo dị ứng/kiêng khem và
    // đẩy món hợp kho nhà lên trước. Ở AVAILABLE_ONLY, tham chiếu bị siết còn
    // đúng các món nấu trọn vẹn được bằng kho — xem buildCatalogReference.
    catalogReference: buildCatalogReference(menuMembers, menuProfile, {
      pantry: toPantrySet(pantry.map((p) => p.ingredient.name)),
      kindOf: kindLookupFrom(
        pantry.map((p) => ({ name: p.ingredient.name, kind: p.ingredient.kind })),
      ),
      onlyFullyCookable: pantryMode === "AVAILABLE_ONLY",
    }),
    pantryMode,
    retryNote,
  };
}

/**
 * Lưu thực đơn AI xuống DB. Trả về danh sách id PlannedMeal vừa tạo.
 *
 * `slots` là cơ cấu mâm ĐÃ YÊU CẦU (chính `ctx.slots` đã gửi cho AI). Truyền vào
 * để mỗi PlannedMeal ghi lại số món đáng lẽ có cho ĐÚNG bữa đó — không suy lại
 * được ở lúc đọc, vì số món người dùng chọn nằm trên GenerationJob và tính lại
 * theo số người hiện tại sẽ báo nhầm mâm 2 món do chính họ chọn là "thiếu món".
 * Bữa AI trả về ngoài danh sách đã yêu cầu thì `dishCount` để null — thà không
 * cảnh báo còn hơn cảnh báo theo một con số bịa.
 */
export async function saveMenu(
  familyId: string,
  menu: AiMenu,
  slots: MenuSlot[] = [],
): Promise<string[]> {
  const plannedCountOf = new Map(
    slots.map((s) => [`${s.date}|${s.mealType}`, s.dishRoles.length]),
  );

  // Transaction ghi nhiều lượt tuần tự (upsert nguyên liệu + tạo recipe/plannedMeal)
  // với DB ở xa dễ vượt mốc mặc định 5s của Prisma -> "Transaction not found".
  // Nới maxWait/timeout để đủ thời gian cho thực đơn nhiều món.
  return prisma.$transaction(async (tx) => {
    const plannedIds: string[] = [];

    for (const meal of menu.meals) {
      const mealDate = new Date(`${meal.date}T00:00:00`);

      // latest-wins: xoá mâm cũ của đúng (ngày, bữa) trước khi tạo mới.
      await tx.plannedMeal.deleteMany({
        where: { familyId, date: mealDate, mealType: meal.mealType },
      });

      const planned = await tx.plannedMeal.create({
        data: {
          familyId,
          date: mealDate,
          mealType: meal.mealType,
          servings: meal.dishes[0]?.servings ?? 4,
          // Tra bằng chuỗi ngày THÔ của AI (`meal.date`) chứ không qua mealDate:
          // slot cũng mang chuỗi yyyy-mm-dd, so trực tiếp thì không phải lo lệch
          // múi giờ khi Date quay ngược lại thành chuỗi.
          dishCount: plannedCountOf.get(`${meal.date}|${meal.mealType}`) ?? null,
        },
      });

      let position = 0;
      for (const dish of meal.dishes) {
        const recipeId = await createRecipeFromDish(tx, familyId, dish);

        await tx.mealDish.create({
          data: {
            plannedMealId: planned.id,
            recipeId,
            dishRole: dish.dishRole,
            position: position++,
          },
        });
      }

      plannedIds.push(planned.id);
    }

    return plannedIds;
  }, { maxWait: 10_000, timeout: 30_000 });
}
