"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { requireFamily } from "@/lib/tenant";

// Lưu cấu hình AI (BYOK). API key được mã hoá trước khi ghi DB. Nếu để trống
// ô key khi cập nhật, giữ nguyên key cũ (không ghi đè bằng rỗng).

const schema = z.object({
  provider: z.enum(["ANTHROPIC", "OPENAI_COMPATIBLE"]),
  model: z.string().trim().min(1, "Nhập tên model"),
  baseUrl: z
    .string()
    .trim()
    .url("Base URL không hợp lệ")
    .optional()
    .or(z.literal("")),
  apiKey: z.string().trim(),
});

export type SettingsState = { error?: string; ok?: boolean };

export async function saveAISettingsAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { familyId } = await requireFamily();

  const parsed = schema.safeParse({
    provider: formData.get("provider"),
    model: formData.get("model"),
    baseUrl: formData.get("baseUrl") ?? "",
    apiKey: formData.get("apiKey") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu chưa hợp lệ." };
  }

  const { provider, model, baseUrl, apiKey } = parsed.data;
  const baseUrlValue = baseUrl ? baseUrl : null;

  const existing = await prisma.aISettings.findUnique({ where: { familyId } });

  if (!apiKey && !existing?.apiKeyEncrypted) {
    return { error: "Lần đầu cấu hình cần nhập API key." };
  }

  const apiKeyEncrypted = apiKey
    ? encrypt(apiKey)
    : existing!.apiKeyEncrypted;

  await prisma.aISettings.upsert({
    where: { familyId },
    create: { familyId, provider, model, baseUrl: baseUrlValue, apiKeyEncrypted },
    update: { provider, model, baseUrl: baseUrlValue, apiKeyEncrypted },
  });

  return { ok: true };
}
