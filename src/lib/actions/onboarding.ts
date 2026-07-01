"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/tenant";

// Tạo Family + hồ sơ ăn uống + thành viên trong một lần onboarding.
// familyId được gán vào User; JWT callback sẽ tự làm mới ở request kế tiếp.

const memberSchema = z.object({
  name: z.string().trim().min(1),
  ageGroup: z.enum(["BABY", "CHILD", "TEEN", "ADULT", "SENIOR"]),
  allergies: z.array(z.string()).default([]),
  dietaryRestrictions: z.array(z.string()).default([]),
  likes: z.array(z.string()).default([]),
  dislikes: z.array(z.string()).default([]),
});

const onboardingSchema = z.object({
  familyName: z.string().trim().min(1, "Nhập tên gia đình"),
  cuisineRegion: z.enum([
    "MIEN_BAC",
    "MIEN_TRUNG",
    "MIEN_NAM",
    "KHONG_CO_KHAU_VI",
  ]),
  spiceLevel: z.enum(["NONE", "MILD", "MEDIUM", "HOT"]),
  budgetLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
  maxCookMinutes: z.coerce.number().int().min(5).max(240),
  healthGoals: z.array(z.string()).default([]),
  notes: z.string().trim().optional(),
  members: z.array(memberSchema).min(1, "Cần ít nhất một thành viên"),
});

export type OnboardingState = { error?: string };

export async function createFamilyAction(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const user = await requireUser();

  let membersRaw: unknown = [];
  try {
    membersRaw = JSON.parse(String(formData.get("members") ?? "[]"));
  } catch {
    return { error: "Danh sách thành viên không hợp lệ." };
  }

  const parsed = onboardingSchema.safeParse({
    familyName: formData.get("familyName"),
    cuisineRegion: formData.get("cuisineRegion"),
    spiceLevel: formData.get("spiceLevel"),
    budgetLevel: formData.get("budgetLevel"),
    maxCookMinutes: formData.get("maxCookMinutes"),
    healthGoals: splitList(formData.get("healthGoals")),
    notes: formData.get("notes") || undefined,
    members: membersRaw,
  });

  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ?? "Thông tin chưa hợp lệ, kiểm tra lại.",
    };
  }

  const d = parsed.data;

  await prisma.$transaction(async (tx) => {
    const family = await tx.family.create({ data: { name: d.familyName } });

    await tx.user.update({
      where: { id: user.id },
      data: { familyId: family.id },
    });

    await tx.eatingProfile.create({
      data: {
        familyId: family.id,
        cuisineRegion: d.cuisineRegion,
        spiceLevel: d.spiceLevel,
        budgetLevel: d.budgetLevel,
        maxCookMinutes: d.maxCookMinutes,
        healthGoals: d.healthGoals,
        notes: d.notes,
      },
    });

    await tx.familyMember.createMany({
      data: d.members.map((m) => ({ ...m, familyId: family.id })),
    });
  });

  redirect("/dashboard");
}

function splitList(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
