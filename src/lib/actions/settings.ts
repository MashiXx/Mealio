"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { requireFamily } from "@/lib/tenant";

// Lưu cấu hình AI (BYOK). API key & basic auth được mã hoá trước khi ghi DB.
// Ollama không bắt buộc API key. Ô secret để trống khi cập nhật -> giữ nguyên.

const schema = z.object({
  provider: z.enum(["ANTHROPIC", "OPENAI_COMPATIBLE", "OLLAMA"]),
  model: z.string().trim().min(1, "Nhập tên model"),
  baseUrl: z
    .string()
    .trim()
    .url("Base URL không hợp lệ")
    .optional()
    .or(z.literal("")),
  apiKey: z.string().trim(),
  basicAuthUser: z.string().trim().optional().or(z.literal("")),
  basicAuthPass: z.string().optional().or(z.literal("")),
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
    basicAuthUser: formData.get("basicAuthUser") ?? "",
    basicAuthPass: formData.get("basicAuthPass") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu chưa hợp lệ." };
  }

  const { provider, model, baseUrl, apiKey, basicAuthUser, basicAuthPass } =
    parsed.data;
  const baseUrlValue = baseUrl ? baseUrl : null;

  const existing = await prisma.aISettings.findUnique({ where: { familyId } });

  // Ollama không cần key; các provider khác lần đầu cấu hình phải có key.
  if (provider !== "OLLAMA" && !apiKey && !existing?.apiKeyEncrypted) {
    return { error: "Lần đầu cấu hình cần nhập API key." };
  }

  const apiKeyEncrypted = apiKey
    ? encrypt(apiKey)
    : (existing?.apiKeyEncrypted ?? null);

  // Basic auth: nhập user (non-empty) -> mã hoá cặp "user:pass"; để trống -> giữ nguyên.
  const basicAuthEncrypted = basicAuthUser
    ? encrypt(`${basicAuthUser}:${basicAuthPass ?? ""}`)
    : (existing?.basicAuthEncrypted ?? null);

  await prisma.aISettings.upsert({
    where: { familyId },
    create: {
      familyId,
      provider,
      model,
      baseUrl: baseUrlValue,
      apiKeyEncrypted,
      basicAuthEncrypted,
    },
    update: {
      provider,
      model,
      baseUrl: baseUrlValue,
      apiKeyEncrypted,
      basicAuthEncrypted,
    },
  });

  return { ok: true };
}
