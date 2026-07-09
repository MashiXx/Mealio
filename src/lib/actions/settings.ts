"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";
import { requireFamily } from "@/lib/tenant";
import { buildProvider } from "@/lib/ai";
import { parseBasicAuth, type BasicAuth } from "@/lib/ai/openai-client";

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

// ------------------------------------------------------------------
// Test kết nối: gọi thử endpoint bằng lệnh liệt kê model (tốn ~0 token)
// trên GIÁ TRỊ ĐANG NHẬP ở form. Ô secret để trống mà DB đã có -> dùng lại
// secret đã lưu (giống logic Lưu) nên không phải gõ lại key chỉ để test.
// ------------------------------------------------------------------

export type TestState = {
  status?: "ok" | "warn" | "error";
  message?: string;
};

/** Gom message của lỗi và toàn bộ chuỗi `cause` (SDK bọc lỗi mạng nhiều lớp). */
function errorChain(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 6 && cur; i++) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      cur = (cur as { cause?: unknown }).cause;
    } else {
      parts.push(String(cur));
      break;
    }
  }
  return parts.join(" | ");
}

/** Diễn giải lỗi SDK/mạng thành thông báo tiếng Việt dễ hiểu. */
function friendlyTestError(e: unknown): string {
  const raw = errorChain(e);
  const status = (e as { status?: number })?.status;
  if (status === 401 || status === 403 || /401|403|unauthor|forbidden/i.test(raw)) {
    return "Xác thực thất bại — kiểm tra API key hoặc Basic auth.";
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(raw)) {
    return "Không phân giải được địa chỉ — kiểm tra Base URL.";
  }
  // Node (undici) chặn một số cổng "không an toàn" (vd 6000, 6666)  — fetch ném
  // "bad port". Endpoint có thể vẫn chạy (curl gọi được) nhưng app dùng fetch nên
  // hỏng: phải đổi sang cổng khác ở reverse proxy.
  if (/bad port|ERR_UNSAFE_PORT/i.test(raw)) {
    return "Cổng bị Node chặn (danh sách cổng không an toàn, vd 6000). Đổi reverse proxy sang cổng khác (vd 6001, 8080).";
  }
  if (
    /ECONNREFUSED|ECONNRESET|fetch failed|network|timeout|ETIMEDOUT|connection error/i.test(
      raw,
    )
  ) {
    return "Không kết nối được endpoint — kiểm tra Base URL và endpoint có đang chạy.";
  }
  if (status === 404 || /\b404\b/.test(raw)) {
    return "Endpoint trả 404 — Base URL có thể sai đường dẫn (vd thiếu /v1).";
  }
  return `Lỗi khi test: ${raw}`;
}

export async function testAISettingsAction(
  _prev: TestState,
  formData: FormData,
): Promise<TestState> {
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
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Dữ liệu chưa hợp lệ.",
    };
  }

  const { provider, model, baseUrl, apiKey, basicAuthUser, basicAuthPass } =
    parsed.data;

  const existing = await prisma.aISettings.findUnique({ where: { familyId } });

  // Secret hiệu lực: ưu tiên giá trị vừa nhập, nếu trống thì dùng lại cái đã lưu.
  const effectiveKey = apiKey
    ? apiKey
    : existing?.apiKeyEncrypted
      ? decrypt(existing.apiKeyEncrypted)
      : undefined;
  const effectiveBasicAuth: BasicAuth | undefined = basicAuthUser
    ? { user: basicAuthUser, pass: basicAuthPass ?? "" }
    : existing?.basicAuthEncrypted
      ? parseBasicAuth(decrypt(existing.basicAuthEncrypted))
      : undefined;

  if (provider !== "OLLAMA" && !effectiveKey) {
    return { status: "error", message: "Cần API key để test." };
  }

  try {
    const p = buildProvider({
      provider,
      model,
      baseUrl: baseUrl || undefined,
      apiKey: effectiveKey,
      basicAuth: effectiveBasicAuth,
    });
    const { models } = await p.testConnection();

    if (models.includes(model)) {
      return { status: "ok", message: `Kết nối OK — model "${model}" khả dụng.` };
    }
    if (models.length === 0) {
      return {
        status: "ok",
        message: "Kết nối OK (endpoint không liệt kê model để đối chiếu).",
      };
    }
    return {
      status: "warn",
      message: `Kết nối OK nhưng không thấy model "${model}" trong danh sách. Kiểm tra tên model (Ollama cần \`ollama pull ${model}\`).`,
    };
  } catch (e) {
    return { status: "error", message: friendlyTestError(e) };
  }
}
