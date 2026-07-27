"use server";

import { revalidatePath } from "next/cache";
import { requireFamily } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { getAIProvider } from "@/lib/ai";
import { topIngredients } from "@/lib/week-summary";

// Mẹo meal prep cho một đợt thực đơn. Gọi AI THEO YÊU CẦU, không nhét vào
// runPlanJob: repo giữ mỗi job đúng MỘT lời gọi AI để không job nào chạm ngưỡng
// treo, thêm một lời gọi nữa vào đó là phá chính bất biến ấy.
//
// Phần "nguyên liệu dùng nhiều" KHÔNG ở đây — nó tính thuần từ mâm ngay lúc đọc
// trang, không cần AI và không cần lưu.

export async function generateMealPrepTipsAction(
  formData: FormData,
): Promise<void> {
  const { familyId } = await requireFamily();
  const mealPlanId = String(formData.get("mealPlanId") ?? "");
  if (!mealPlanId) return;

  // Kèm familyId để đợt của nhà khác không đụng tới được.
  const plan = await prisma.mealPlan.findFirst({
    where: { id: mealPlanId, familyId },
    select: {
      id: true,
      meals: {
        select: {
          date: true,
          dishes: {
            select: {
              recipe: {
                select: {
                  name: true,
                  ingredients: {
                    select: { ingredient: { select: { name: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!plan || plan.meals.length === 0) return;

  const [family, profile] = await Promise.all([
    prisma.family.findUnique({
      where: { id: familyId },
      select: { _count: { select: { members: true } } },
    }),
    prisma.eatingProfile.findUnique({
      where: { familyId },
      select: { maxCookMinutes: true },
    }),
  ]);

  const dishNames = plan.meals.flatMap((m) => m.dishes.map((d) => d.recipe.name));
  const days = new Set(plan.meals.map((m) => m.date.getTime())).size;

  const provider = await getAIProvider(familyId);
  const result = await provider.mealPrepTips({
    familySize: Math.max(1, family?._count.members ?? 1),
    days,
    dishNames,
    topIngredients: topIngredients(plan.meals, 6).map((x) => x.name),
    maxCookMinutes: profile?.maxCookMinutes ?? 60,
  });

  await prisma.mealPlan.update({
    where: { id: plan.id },
    data: { summaryJson: { tips: result.tips } },
  });

  revalidatePath("/dashboard");
}
