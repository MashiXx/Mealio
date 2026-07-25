"use server";

import { revalidatePath } from "next/cache";
import { requireFamily } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { normalizeIngredient } from "@/lib/normalize";
import { matchKey } from "@/lib/pantry";
import { isSeasoning } from "@/data/seasonings";

// Kho là danh sách "đang có gì": không số lượng, không đơn vị. Thêm nhanh bằng
// một ô gõ; hạn dùng là tuỳ chọn.

export async function addPantryItemAction(formData: FormData): Promise<void> {
  const { familyId } = await requireFamily();

  const raw = String(formData.get("name") ?? "").trim();
  if (!raw) return;
  const normalized = normalizeIngredient(raw);
  if (!normalized) return;

  const rawExpires = String(formData.get("expiresAt") ?? "");
  const expiresAt = /^\d{4}-\d{2}-\d{2}$/.test(rawExpires)
    ? new Date(`${rawExpires}T00:00:00`)
    : null;

  const ingredient = await prisma.ingredient.upsert({
    where: { familyId_normalized: { familyId, normalized } },
    create: {
      familyId,
      name: raw,
      normalized,
      kind: isSeasoning(matchKey(raw)) ? "SEASONING" : "MAIN",
    },
    update: {},
  });

  await prisma.pantryItem.upsert({
    where: {
      familyId_ingredientId: { familyId, ingredientId: ingredient.id },
    },
    create: { familyId, ingredientId: ingredient.id, expiresAt },
    update: { expiresAt },
  });

  revalidatePath("/pantry");
}

export async function removePantryItemAction(formData: FormData): Promise<void> {
  const { familyId } = await requireFamily();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.pantryItem.deleteMany({ where: { id, familyId } });
  revalidatePath("/pantry");
}

/** Đổi MAIN <-> SEASONING khi bảng tĩnh đoán sai. */
export async function toggleKindAction(formData: FormData): Promise<void> {
  const { familyId } = await requireFamily();
  const ingredientId = String(formData.get("ingredientId") ?? "");
  if (!ingredientId) return;

  const ing = await prisma.ingredient.findFirst({
    where: { id: ingredientId, familyId },
    select: { kind: true },
  });
  if (!ing) return;

  await prisma.ingredient.update({
    where: { id: ingredientId },
    data: { kind: ing.kind === "MAIN" ? "SEASONING" : "MAIN" },
  });
  revalidatePath("/pantry");
}
