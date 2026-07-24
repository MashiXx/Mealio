"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireFamily } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { pumpJobs } from "@/lib/jobs";
import type { ChatTurn } from "@/lib/ai/types";

// Lệnh dựng sẵn cho các nút thao tác nhanh (một-shot, không dùng lịch sử chat).
const QUICK_EDIT: Record<string, string> = {
  "doi-mon":
    "Đổi sang một món KHÁC cùng loại (cùng vai trò), khác hẳn món hiện tại.",
  "doi-dam":
    "Giữ nguyên kiểu món nhưng đổi nguyên liệu chính/nguồn đạm sang loại khác.",
  "it-cay": "Điều chỉnh món ít cay hơn.",
  "it-dau": "Điều chỉnh món ít dầu mỡ hơn, thanh đạm hơn.",
  "nhanh-hon": "Điều chỉnh để nấu nhanh hơn, ít bước hơn.",
  "re-hon": "Điều chỉnh dùng nguyên liệu tiết kiệm hơn.",
};

/** Nạp MealDish thuộc gia đình hiện tại + id mâm; null nếu không thuộc. */
async function ownDish(familyId: string, mealDishId: string) {
  return prisma.mealDish.findFirst({
    where: { id: mealDishId, plannedMeal: { familyId } },
    select: { id: true, plannedMealId: true, chatHistory: true },
  });
}

/** Đã có EditJob active cho đúng đích (món hoặc mâm) chưa? Chống spam. */
async function hasActiveFor(
  familyId: string,
  where: { mealDishId?: string; plannedMealId?: string },
): Promise<boolean> {
  const n = await prisma.editJob.count({
    where: { familyId, status: { in: ["PENDING", "RUNNING"] }, ...where },
  });
  return n > 0;
}

function asHistory(json: unknown): ChatTurn[] {
  return Array.isArray(json) ? (json as ChatTurn[]) : [];
}

export async function quickEditAction(
  mealDishId: string,
  kind: string,
): Promise<void> {
  const { familyId } = await requireFamily();
  const instruction = QUICK_EDIT[kind];
  if (!instruction) return;
  const dish = await ownDish(familyId, mealDishId);
  if (!dish) return;
  if (await hasActiveFor(familyId, { mealDishId })) return;

  await prisma.editJob.create({
    data: {
      familyId,
      plannedMealId: dish.plannedMealId,
      scope: "DISH",
      mealDishId,
      instruction,
      useHistory: false,
    },
  });
  after(() => pumpJobs());
  revalidatePath("/dashboard");
}

export async function chatDishAction(
  mealDishId: string,
  message: string,
): Promise<void> {
  const { familyId } = await requireFamily();
  const text = message.trim();
  if (!text) return;
  const dish = await ownDish(familyId, mealDishId);
  if (!dish) return;
  if (await hasActiveFor(familyId, { mealDishId })) return;

  const history: ChatTurn[] = [
    ...asHistory(dish.chatHistory),
    { role: "user", content: text },
  ];
  await prisma.mealDish.update({
    where: { id: mealDishId },
    data: { chatHistory: history },
  });
  await prisma.editJob.create({
    data: {
      familyId,
      plannedMealId: dish.plannedMealId,
      scope: "DISH",
      mealDishId,
      instruction: text,
      useHistory: true,
    },
  });
  after(() => pumpJobs());
  revalidatePath("/dashboard");
}

export async function chatMealAction(
  plannedMealId: string,
  message: string,
): Promise<void> {
  const { familyId } = await requireFamily();
  const text = message.trim();
  if (!text) return;
  const meal = await prisma.plannedMeal.findFirst({
    where: { id: plannedMealId, familyId },
    select: { id: true, chatHistory: true },
  });
  if (!meal) return;
  if (await hasActiveFor(familyId, { plannedMealId })) return;

  const history: ChatTurn[] = [
    ...asHistory(meal.chatHistory),
    { role: "user", content: text },
  ];
  await prisma.plannedMeal.update({
    where: { id: plannedMealId },
    data: { chatHistory: history },
  });
  await prisma.editJob.create({
    data: {
      familyId,
      plannedMealId,
      scope: "MEAL",
      instruction: text,
      useHistory: true,
    },
  });
  after(() => pumpJobs());
  revalidatePath("/dashboard");
}

export async function addDishAction(plannedMealId: string): Promise<void> {
  const { familyId } = await requireFamily();
  const meal = await prisma.plannedMeal.findFirst({
    where: { id: plannedMealId, familyId },
    select: { id: true },
  });
  if (!meal) return;
  if (await hasActiveFor(familyId, { plannedMealId })) return;

  await prisma.editJob.create({
    data: {
      familyId,
      plannedMealId,
      scope: "ADD",
      instruction: "Thêm một món phù hợp để mâm cân bằng và đa dạng hơn.",
      useHistory: false,
    },
  });
  after(() => pumpJobs());
  revalidatePath("/dashboard");
}

export async function deleteDishAction(mealDishId: string): Promise<void> {
  const { familyId } = await requireFamily();
  const dish = await ownDish(familyId, mealDishId);
  if (!dish) return;
  // Không cho xóa món cuối cùng của mâm.
  const count = await prisma.mealDish.count({
    where: { plannedMealId: dish.plannedMealId },
  });
  if (count <= 1) return;
  await prisma.mealDish.delete({ where: { id: mealDishId } });
  revalidatePath("/dashboard");
}

export async function ackEditJobAction(formData: FormData): Promise<void> {
  const { familyId } = await requireFamily();
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) return;
  await prisma.editJob.deleteMany({
    where: { id: jobId, familyId, status: "FAILED" },
  });
  revalidatePath("/dashboard");
}
