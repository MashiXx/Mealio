"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireFamily } from "@/lib/tenant";
import { prisma } from "@/lib/db";

/** Copy một mâm cũ sang ngày mình chọn (cùng loại bữa), ghi đè latest-wins. */
export async function recookAction(formData: FormData): Promise<void> {
  const { familyId } = await requireFamily();
  const plannedMealId = String(formData.get("plannedMealId") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!plannedMealId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

  const source = await prisma.plannedMeal.findFirst({
    where: { id: plannedMealId, familyId },
    include: { dishes: { orderBy: { position: "asc" } } },
  });
  if (!source) return;

  const targetDate = new Date(`${date}T00:00:00`);

  await prisma.$transaction(async (tx) => {
    // latest-wins: xóa mâm cũ của (ngày đích, cùng loại bữa).
    await tx.plannedMeal.deleteMany({
      where: { familyId, date: targetDate, mealType: source.mealType },
    });
    const planned = await tx.plannedMeal.create({
      data: {
        familyId,
        date: targetDate,
        mealType: source.mealType,
        servings: source.servings,
      },
    });
    // Copy MealDish: dùng lại recipeId cũ (an toàn — sửa sau này sinh Recipe mới).
    for (const d of source.dishes) {
      await tx.mealDish.create({
        data: {
          plannedMealId: planned.id,
          recipeId: d.recipeId,
          dishRole: d.dishRole,
          position: d.position,
        },
      });
    }
  });

  revalidatePath("/dashboard");
  redirect(`/dashboard?date=${date}`);
}
