import { prisma } from "../db";
import { decrypt } from "../crypto";
import type { AIProvider } from "./types";
import { AnthropicProvider } from "./anthropic";
import { OpenAICompatibleProvider } from "./openai-compatible";

export * from "./types";
export * from "./schema";

/**
 * Factory: đọc AISettings của gia đình, giải mã API key ở server,
 * trả về provider phù hợp. Ném lỗi rõ ràng nếu chưa cấu hình.
 */
export async function getAIProvider(familyId: string): Promise<AIProvider> {
  const settings = await prisma.aISettings.findUnique({ where: { familyId } });
  if (!settings?.apiKeyEncrypted) {
    throw new Error(
      "Chưa cấu hình AI. Vào trang Cài đặt để nhập API key trước khi tạo thực đơn.",
    );
  }

  const apiKey = decrypt(settings.apiKeyEncrypted);
  const baseUrl = settings.baseUrl ?? undefined;

  if (settings.provider === "ANTHROPIC") {
    return new AnthropicProvider(apiKey, settings.model, baseUrl);
  }
  return new OpenAICompatibleProvider(apiKey, settings.model, baseUrl);
}
