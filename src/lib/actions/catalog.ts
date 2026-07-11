"use server";

import { requireFamily } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { normalizeIngredient } from "@/lib/normalize";
import { getDishBySlug } from "@/data/catalog";

// Chép một món trong kho dùng chung thành Recipe của gia đình để người dùng đưa
// vào kế hoạch/kho công thức riêng. Đọc từ dữ liệu tĩnh (không phụ thuộc DB đã
// seed hay chưa); nguyên liệu được chuẩn hoá + upsert vào Ingredient của gia đình.

export type AdoptState = { error?: string; recipeId?: string };

export async function adoptCatalogDishAction(slug: string): Promise<AdoptState> {
  const { familyId } = await requireFamily();

  const dish = getDishBySlug(slug);
  if (!dish) return { error: "Không tìm thấy món trong kho." };

  const recipeId = await prisma.$transaction(
    async (tx) => {
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
          source: "MANUAL", // lấy từ kho có sẵn, không phải AI sinh
          servings: dish.servings,
          cookMinutes: dish.cookMinutes,
          steps: dish.steps,
          nutritionLabels: dish.nutritionLabels,
          ingredients: { create: recipeIngredients },
        },
      });

      return recipe.id;
    },
    { maxWait: 10_000, timeout: 30_000 },
  );

  return { recipeId };
}
