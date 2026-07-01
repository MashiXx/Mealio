"use server";

import { redirect } from "next/navigation";
import { requireFamily } from "@/lib/tenant";
import { getAIProvider } from "@/lib/ai";
import { buildMenuContext, saveMenu } from "@/lib/menu";
import type { MealTypeStr, MenuSlot } from "@/lib/ai/types";

export type GenerateState = { error?: string };

const MEAL_TYPES: MealTypeStr[] = ["BREAKFAST", "LUNCH", "DINNER"];

export async function generateMenuAction(
  _prev: GenerateState,
  formData: FormData,
): Promise<GenerateState> {
  const { familyId } = await requireFamily();

  const date = String(formData.get("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: "Vui lòng chọn ngày hợp lệ." };
  }

  const selected = formData
    .getAll("mealTypes")
    .map(String)
    .filter((m): m is MealTypeStr => (MEAL_TYPES as string[]).includes(m));

  if (selected.length === 0) {
    return { error: "Chọn ít nhất một bữa (sáng/trưa/tối)." };
  }

  const slots: MenuSlot[] = selected.map((mealType) => ({ date, mealType }));

  // getAIProvider ném lỗi rõ ràng nếu chưa cấu hình API key.
  let provider;
  try {
    provider = await getAIProvider(familyId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Chưa cấu hình AI." };
  }

  try {
    const ctx = await buildMenuContext(familyId, slots);
    const menu = await provider.generateMenu(ctx);
    await saveMenu(familyId, menu);
  } catch (e) {
    return {
      error:
        (e instanceof Error ? e.message : "Không tạo được thực đơn.") +
        " — thử lại hoặc kiểm tra API key/model.",
    };
  }

  redirect(`/dashboard?date=${date}`);
}
