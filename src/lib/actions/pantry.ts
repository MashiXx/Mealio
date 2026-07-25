"use server";

import { revalidatePath } from "next/cache";
import { requireFamily } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { normalizeIngredient } from "@/lib/normalize";
import { matchKey, staticKind } from "@/lib/pantry";

// Kho là danh sách "đang có gì": không số lượng, không đơn vị. Thêm nhanh bằng
// một ô gõ; hạn dùng là tuỳ chọn.

/** "yyyy-mm-dd" hợp cú pháp NHƯNG có thể vô nghĩa (vd "2026-13-45") -> Invalid
 * Date lọt qua regex rồi làm Prisma ném RangeError không ai bắt. Trả null cho
 * cả chuỗi rỗng lẫn ngày vô nghĩa — gọi nơi tự quyết rỗng nghĩa là gì. */
function parseDateInput(raw: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function addPantryItemAction(formData: FormData): Promise<void> {
  const { familyId } = await requireFamily();

  const raw = String(formData.get("name") ?? "").trim();
  if (!raw) return;
  const normalized = normalizeIngredient(raw);
  if (!normalized) return;

  const expiresAt = parseDateInput(String(formData.get("expiresAt") ?? ""));

  const ingredient = await prisma.ingredient.upsert({
    where: { familyId_normalized: { familyId, normalized } },
    // KHÔNG gán `kind`: để NULL, staticKind lo lúc đọc. Nguyên liệu này có thể
    // đã tồn tại từ trước (AI tạo qua công thức) với kind=NULL sẵn — upsert
    // trúng dòng cũ, `update: {}` không đụng vào field đó là đúng ý.
    create: { familyId, name: raw, normalized },
    update: {},
  });

  await prisma.pantryItem.upsert({
    where: {
      familyId_ingredientId: { familyId, ingredientId: ingredient.id },
    },
    create: { familyId, ingredientId: ingredient.id, expiresAt },
    // Ô hạn dùng luôn trống ở mỗi lần submit (React reset form sau server
    // action) -> gõ lại tên một nguyên liệu đã có hạn dùng để "báo còn hàng"
    // sẽ vô tình xoá sạch hạn dùng cũ nếu ghi đè vô điều kiện. Chỉ cập nhật khi
    // người dùng thực sự gõ một ngày lần này; muốn XOÁ hạn dùng thì dùng
    // updatePantryItemAction (sửa hạn dùng) chứ không phải ô thêm nhanh.
    update: expiresAt ? { expiresAt } : {},
  });

  revalidatePath("/pantry");
}

/** Sửa/xoá hạn dùng một dòng kho đã có — rỗng nghĩa là XOÁ hạn (khác với ô
 * thêm nhanh, nơi rỗng nghĩa là "giữ nguyên"). Đây là control riêng người dùng
 * chủ động bấm vào, nên rỗng phải có tác dụng thật. */
export async function updatePantryItemAction(formData: FormData): Promise<void> {
  const { familyId } = await requireFamily();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const rawExpires = String(formData.get("expiresAt") ?? "");
  const expiresAt = rawExpires ? parseDateInput(rawExpires) : null;
  // Ngày hợp cú pháp nhưng vô nghĩa (parseDateInput trả null) mà người dùng có
  // gõ gì đó -> không lưu, coi như submit lỗi, đừng âm thầm xoá hạn dùng cũ.
  if (rawExpires && expiresAt === null) return;

  await prisma.pantryItem.updateMany({
    where: { id, familyId },
    data: { expiresAt },
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
    select: { kind: true, name: true },
  });
  if (!ing) return;

  // Đổi từ giá trị ĐANG HIỆU LỰC, không phải cột thô: `kind` NULL (chưa từng
  // đổi nhóm) hiệu lực là bảng tĩnh, không phải MAIN — nếu toggle thẳng trên
  // cột thô, một nguyên liệu SEASONING theo bảng tĩnh nhưng kind=NULL sẽ bị
  // "đổi nhóm" từ null -> MAIN thay vì từ SEASONING (hiệu lực) -> MAIN, tình cờ
  // ra cùng kết quả ở đây nhưng sai concept và sai ngay khi bảng tĩnh nói MAIN.
  const current = ing.kind ?? staticKind(matchKey(ing.name));
  await prisma.ingredient.update({
    where: { id: ingredientId },
    data: { kind: current === "MAIN" ? "SEASONING" : "MAIN" },
  });
  revalidatePath("/pantry");
}
