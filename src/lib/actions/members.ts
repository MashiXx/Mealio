"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireFamily } from "@/lib/tenant";

// Lưu toàn bộ danh sách thành viên trong một lần: thành viên có id -> cập nhật,
// không có id -> tạo mới, id cũ không còn trong danh sách -> xoá.
// Mọi thao tác đều scope theo familyId để không đụng dữ liệu gia đình khác.

const memberSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Thành viên cần có tên"),
  image: z.string().nullable().optional(),
  ageGroup: z.enum(["BABY", "CHILD", "TEEN", "ADULT", "SENIOR"]),
  allergies: z.array(z.string()).default([]),
  dietaryRestrictions: z.array(z.string()).default([]),
  likes: z.array(z.string()).default([]),
  dislikes: z.array(z.string()).default([]),
});

const schema = z.array(memberSchema).min(1, "Gia đình cần ít nhất một thành viên");

export type MembersState = { error?: string; ok?: boolean };

export async function saveMembersAction(
  _prev: MembersState,
  formData: FormData,
): Promise<MembersState> {
  const { familyId } = await requireFamily();

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("members") ?? "[]"));
  } catch {
    return { error: "Dữ liệu thành viên không hợp lệ." };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Thông tin chưa hợp lệ." };
  }
  const members = parsed.data;

  // Chỉ chấp nhận id thực sự thuộc gia đình hiện tại.
  const existing = await prisma.familyMember.findMany({
    where: { familyId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));

  const keptIds = new Set(
    members
      .map((m) => m.id)
      .filter((id): id is string => Boolean(id) && existingIds.has(id!)),
  );
  const toDelete = [...existingIds].filter((id) => !keptIds.has(id));

  await prisma.$transaction(async (tx) => {
    if (toDelete.length) {
      await tx.familyMember.deleteMany({
        where: { familyId, id: { in: toDelete } },
      });
    }

    for (const m of members) {
      const data = {
        name: m.name,
        image: m.image ?? null,
        ageGroup: m.ageGroup,
        allergies: m.allergies,
        dietaryRestrictions: m.dietaryRestrictions,
        likes: m.likes,
        dislikes: m.dislikes,
      };

      if (m.id && existingIds.has(m.id)) {
        await tx.familyMember.update({ where: { id: m.id }, data });
      } else {
        await tx.familyMember.create({ data: { ...data, familyId } });
      }
    }
  });

  revalidatePath("/dashboard");
  revalidatePath("/settings/members");
  return { ok: true };
}
