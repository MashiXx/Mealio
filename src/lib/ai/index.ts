import { prisma } from "../db";
import { decrypt } from "../crypto";
import type { AIProvider } from "./types";
import { AnthropicProvider } from "./anthropic";
import { OpenAICompatibleProvider } from "./openai-compatible";
import { OllamaProvider } from "./ollama";
import { parseBasicAuth, type BasicAuth } from "./openai-client";

export * from "./types";
export * from "./schema";

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

  // Ollama chạy được không cần API key.
  if (settings.provider === "OLLAMA") {
    return new OllamaProvider(settings.model, baseUrl, basicAuth);
  }

  if (!settings.apiKeyEncrypted) {
    throw new Error(
      "Chưa cấu hình AI. Vào trang Cài đặt để nhập API key trước khi tạo thực đơn.",
    );
  }
  const apiKey = decrypt(settings.apiKeyEncrypted);

  if (settings.provider === "ANTHROPIC") {
    return new AnthropicProvider(apiKey, settings.model, baseUrl);
  }
  return new OpenAICompatibleProvider(apiKey, settings.model, baseUrl, basicAuth);
}
