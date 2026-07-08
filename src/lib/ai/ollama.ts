import { OpenAICompatibleProvider } from "./openai-compatible";
import type { BasicAuth } from "./openai-client";

// Ollama expose API OpenAI-compatible ở /v1. Không cần API key; baseURL mặc
// định trỏ vào instance local. Basic auth dùng khi Ollama nằm sau reverse proxy.
export const OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434/v1";

export class OllamaProvider extends OpenAICompatibleProvider {
  constructor(model: string, baseUrl?: string, basicAuth?: BasicAuth) {
    super("ollama", model, baseUrl ?? OLLAMA_DEFAULT_BASE_URL, basicAuth);
  }
}
