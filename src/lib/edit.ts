import { prisma } from "./db";
import { normalizeIngredient } from "./normalize";
import { buildCatalogReference } from "./catalog";
import { syncShopping } from "./shopping";
import type { AiDish, AiEditResult } from "./ai/schema";
import type {
  ChatTurn,
  EditContext,
  EditDishView,
  MealTypeStr,
  MenuMember,
  MenuProfile,
} from "./ai/types";
import type { EditJob, Prisma } from "@prisma/client";

const HISTORY_TURNS = 10; // ~5 lượt hỏi-đáp

/**
 * Tạo Recipe (+ upsert Ingredient) từ 1 món AI trả về. Trả recipeId. Dùng chung
 * cho saveMenu (tạo mới) và applyEdit (sửa) để không lặp logic.
 */
export async function createRecipeFromDish(
  tx: Prisma.TransactionClient,
  familyId: string,
  dish: AiDish,
): Promise<string> {
  const recipeIngredients: {
    ingredientId: string;
    quantity: number;
    unit: string;
  }[] = [];

  for (const ing of dish.ingredients) {
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
      name: dish.name,
      source: "AI",
      servings: dish.servings,
      cookMinutes: dish.cookMinutes,
      steps: dish.steps,
      nutritionLabels: dish.nutritionLabels,
      ingredients: { create: recipeIngredients },
    },
  });
  return recipe.id;
}

/** Ép Json chatHistory về ChatTurn[] an toàn. */
function asHistory(json: unknown): ChatTurn[] {
  return Array.isArray(json) ? (json as ChatTurn[]) : [];
}

/** Dựng EditContext từ một EditJob (nạp mâm, dishes, hồ sơ, lịch sử chat). */
export async function buildEditContext(job: EditJob): Promise<EditContext> {
  const [meal, members, profile, recentRecipes] = await Promise.all([
    prisma.plannedMeal.findUnique({
      where: { id: job.plannedMealId },
      include: {
        dishes: {
          orderBy: { position: "asc" },
          include: {
            recipe: {
              include: { ingredients: { include: { ingredient: true } } },
            },
          },
        },
      },
    }),
    prisma.familyMember.findMany({ where: { familyId: job.familyId } }),
    prisma.eatingProfile.findUnique({ where: { familyId: job.familyId } }),
    prisma.recipe.findMany({
      where: { familyId: job.familyId },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { name: true },
    }),
  ]);
  if (!meal) throw new Error("Không tìm thấy mâm cần sửa.");

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

  const currentDishes: EditDishView[] = meal.dishes.map((d) => ({
    name: d.recipe.name,
    dishRole: d.dishRole,
    nutritionLabels: d.recipe.nutritionLabels,
    ingredientNames: d.recipe.ingredients.map((ri) => ri.ingredient.name),
  }));

  const targetDish =
    job.scope === "DISH" && job.mealDishId
      ? meal.dishes.find((d) => d.id === job.mealDishId)
      : undefined;

  // Lịch sử chat: DISH lấy từ MealDish đích, MEAL lấy từ PlannedMeal.
  let history: ChatTurn[] = [];
  if (job.useHistory) {
    if (job.scope === "DISH" && targetDish) {
      history = asHistory(targetDish.chatHistory);
    } else if (job.scope === "MEAL") {
      history = asHistory(meal.chatHistory);
    }
    history = history.slice(-HISTORY_TURNS);
  }

  return {
    scope: job.scope,
    mealType: meal.mealType as MealTypeStr,
    servings: meal.servings,
    members: menuMembers,
    profile: menuProfile,
    currentDishes,
    targetRole: targetDish?.dishRole,
    history,
    instruction: job.instruction,
    recentRecipeNames: recentRecipes.map((r) => r.name),
    catalogReference: buildCatalogReference(menuMembers, menuProfile),
  };
}

/** Ghi thêm lượt trợ lý vào chatHistory của MealDish hoặc PlannedMeal. */
async function appendAssistant(
  tx: Prisma.TransactionClient,
  target: "mealDish" | "plannedMeal",
  id: string,
  content: string,
): Promise<void> {
  if (target === "mealDish") {
    const row = await tx.mealDish.findUnique({
      where: { id },
      select: { chatHistory: true },
    });
    if (!row) return;
    const next = [...asHistory(row.chatHistory), { role: "assistant", content }];
    await tx.mealDish.update({ where: { id }, data: { chatHistory: next } });
  } else {
    const row = await tx.plannedMeal.findUnique({
      where: { id },
      select: { chatHistory: true },
    });
    if (!row) return;
    const next = [...asHistory(row.chatHistory), { role: "assistant", content }];
    await tx.plannedMeal.update({ where: { id }, data: { chatHistory: next } });
  }
}

/** Áp kết quả sửa vào DB theo scope. */
export async function applyEdit(
  job: EditJob,
  result: AiEditResult,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      if (job.scope === "DISH") {
        if (!job.mealDishId) return;
        const exists = await tx.mealDish.findUnique({
          where: { id: job.mealDishId },
        });
        if (!exists) return; // món đã bị xóa trong lúc chờ
        const dish = result.dishes[0];
        const recipeId = await createRecipeFromDish(tx, job.familyId, dish);
        await tx.mealDish.update({
          where: { id: job.mealDishId },
          data: { recipeId },
        });
        if (job.useHistory)
          await appendAssistant(
            tx,
            "mealDish",
            job.mealDishId,
            `Đã đổi thành: ${dish.name}`,
          );
      } else if (job.scope === "MEAL") {
        await tx.mealDish.deleteMany({
          where: { plannedMealId: job.plannedMealId },
        });
        let position = 0;
        for (const dish of result.dishes) {
          const recipeId = await createRecipeFromDish(tx, job.familyId, dish);
          await tx.mealDish.create({
            data: {
              plannedMealId: job.plannedMealId,
              recipeId,
              dishRole: dish.dishRole,
              position: position++,
            },
          });
        }
        if (job.useHistory)
          await appendAssistant(
            tx,
            "plannedMeal",
            job.plannedMealId,
            `Mâm mới: ${result.dishes.map((d) => d.name).join(", ")}`,
          );
      } else {
        // ADD
        const agg = await tx.mealDish.aggregate({
          where: { plannedMealId: job.plannedMealId },
          _max: { position: true },
        });
        const dish = result.dishes[0];
        const recipeId = await createRecipeFromDish(tx, job.familyId, dish);
        await tx.mealDish.create({
          data: {
            plannedMealId: job.plannedMealId,
            recipeId,
            dishRole: dish.dishRole,
            position: (agg._max.position ?? -1) + 1,
          },
        });
      }
    },
    { maxWait: 10_000, timeout: 30_000 },
  );

  // Đổi món thì nhu cầu đi chợ đổi theo. Gọi NGOÀI transaction (sync tự mở
  // transaction riêng) và sau khi mâm đã commit, để nó đọc được trạng thái mới.
  // syncShopping tính lại từ toàn bộ mâm sắp tới nên gọi ở đây không sợ cộng dồn.
  await syncShopping(job.familyId);
}
