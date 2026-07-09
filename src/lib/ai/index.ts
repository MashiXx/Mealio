import { prisma } from "../db";
import { decrypt } from "../crypto";
import type { AIProvider } from "./types";
import { AnthropicProvider } from "./anthropic";
import { OpenAICompatibleProvider } from "./openai-compatible";
import { OllamaProvider } from "./ollama";
import { parseBasicAuth, type BasicAuth } from "./openai-client";

export * from "./types";
export * from "./schema";

/** Cấu hình đã giải mã để dựng một provider. */
export type ProviderConfig = {
  provider: "ANTHROPIC" | "OPENAI_COMPATIBLE" | "OLLAMA";
  model: string;
  baseUrl?: string;
  apiKey?: string; // đã giải mã; Ollama có thể không cần
  basicAuth?: BasicAuth; // đã giải mã
};

/**
 * Dựng provider từ cấu hình raw (đã giải mã). Dùng chung cho factory đọc DB và
 * cho nút Test trên form (giá trị chưa lưu). Ollama không cần API key.
 */
export function buildProvider(cfg: ProviderConfig): AIProvider {
  if (cfg.provider === "OLLAMA") {
    return new OllamaProvider(cfg.model, cfg.baseUrl, cfg.basicAuth);
  }
  if (!cfg.apiKey) {
    throw new Error("Chưa có API key.");
  }
  if (cfg.provider === "ANTHROPIC") {
    return new AnthropicProvider(cfg.apiKey, cfg.model, cfg.baseUrl);
  }
  return new OpenAICompatibleProvider(
    cfg.apiKey,
    cfg.model,
    cfg.baseUrl,
    cfg.basicAuth,
  );
}

/**
 * Factory: đọc AISettings của gia đình, giải mã secret ở server, trả provider
 * phù hợp. Ollama không cần API key; Anthropic không dùng basic auth.
 */
export async function getAIProvider(familyId: string): Promise<AIProvider> {
  const settings = await prisma.aISettings.findUnique({ where: { familyId } });
  if (!settings) {
    throw new Error(
      "Chưa cấu hình AI. Vào trang Cài đặt để cấu hình trước khi tạo thực đơn.",
    );
  }

  const baseUrl = settings.baseUrl ?? undefined;
  const basicAuth: BasicAuth | undefined = settings.basicAuthEncrypted
    ? parseBasicAuth(decrypt(settings.basicAuthEncrypted))
    : undefined;

  if (settings.provider !== "OLLAMA" && !settings.apiKeyEncrypted) {
    throw new Error(
      "Chưa cấu hình AI. Vào trang Cài đặt để nhập API key trước khi tạo thực đơn.",
    );
  }

  return buildProvider({
    provider: settings.provider,
    model: settings.model,
    baseUrl,
    apiKey: settings.apiKeyEncrypted
      ? decrypt(settings.apiKeyEncrypted)
      : undefined,
    basicAuth,
  });
}
