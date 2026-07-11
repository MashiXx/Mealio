import { prisma } from "./db";
import { normalizeIngredient } from "./normalize";
import { buildCatalogReference } from "./catalog";
import type { AiMenu } from "./ai/schema";
import type { MenuContext, MenuSlot, MenuMember, MenuProfile } from "./ai/types";

// Dựng ngữ cảnh cho AI từ dữ liệu gia đình, và lưu thực đơn AI trả về xuống DB
// (Ingredient chuẩn hoá + Recipe + RecipeIngredient + PlannedMeal).

export async function buildMenuContext(
  familyId: string,
  slots: MenuSlot[],
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
      quantity: p.quantity,
      unit: p.unit,
    })),
    recentRecipeNames: recentRecipes.map((r) => r.name),
    availableRecipeNames: allRecipes.map((r) => r.name),
    slots,
    // Tham chiếu món Việt từ kho dùng chung, đã lọc theo dị ứng/kiêng khem.
    catalogReference: buildCatalogReference(menuMembers, menuProfile),
  };
}

/** Lưu thực đơn AI xuống DB. Trả về danh sách id PlannedMeal vừa tạo. */
export async function saveMenu(
  familyId: string,
  menu: AiMenu,
): Promise<string[]> {
  // Transaction ghi nhiều lượt tuần tự (upsert nguyên liệu + tạo recipe/plannedMeal)
  // với DB ở xa dễ vượt mốc mặc định 5s của Prisma -> "Transaction not found".
  // Nới maxWait/timeout để đủ thời gian cho thực đơn nhiều món.
  return prisma.$transaction(async (tx) => {
    const plannedIds: string[] = [];

    for (const meal of menu.meals) {
      const r = meal.recipe;

      const recipeIngredients: {
        ingredientId: string;
        quantity: number;
        unit: string;
      }[] = [];

      for (const ing of r.ingredients) {
        const normalized = normalizeIngredient(ing.name);
        if (!normalized) continue;

        const ingredient = await tx.ingredient.upsert({
          where: { familyId_normalized: { familyId, normalized } },
          create: {
            familyId,
            name: ing.name.trim(),
            normalized,
            defaultUnit: ing.unit,
          },
          update: {},
        });

        recipeIngredients.push({
          ingredientId: ingredient.id,
          quantity: ing.quantity,
          unit: ing.unit,
        });
      }

      const recipe = await tx.recipe.create({
        data: {
          familyId,
          name: r.name,
          source: "AI",
          servings: r.servings,
          cookMinutes: r.cookMinutes,
          steps: r.steps,
          nutritionLabels: r.nutritionLabels,
          ingredients: { create: recipeIngredients },
        },
      });

      const planned = await tx.plannedMeal.create({
        data: {
          familyId,
          date: new Date(`${meal.date}T00:00:00`),
          mealType: meal.mealType,
          recipeId: recipe.id,
          servings: r.servings,
        },
      });

      plannedIds.push(planned.id);
    }

    return plannedIds;
  }, { maxWait: 10_000, timeout: 30_000 });
}
