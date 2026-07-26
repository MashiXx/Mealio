import type {
  AIProvider,
  MenuContext,
  EditContext,
  MemberImage,
  TestConnectionResult,
} from "./types";
import {
  buildMenuPrompt,
  buildWeekPlanPrompt,
  buildEditPrompt,
  buildRecognitionPrompt,
} from "./prompt";
import {
  parseMenuJson,
  parseWeekPlanJson,
  parseEditJson,
  parseRecognitionJson,
  type AiMenu,
  type AiWeekPlan,
  type AiEditResult,
  type MemberRecognition,
} from "./schema";
import { basicAuthHeader, type BasicAuth } from "./openai-client";

// Adapter Ollama dùng API NATIVE (/api/chat, /api/tags) thay vì lớp OpenAI (/v1).
// Lý do: chỉ API native cho set `options.num_ctx` — quan trọng để prompt (hồ sơ
// gia đình + kho + đoạn "Món Việt tham khảo") KHÔNG bị cắt ngầm khi vượt context
// mặc định của model. Đồng thời ép `format: "json"` và chỉnh `temperature`.

export const OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434/v1";

// Tinh chỉnh qua env (không cần đổi Modelfile / khởi động lại Ollama):
//  - MEALIO_OLLAMA_NUM_CTX: cửa sổ ngữ cảnh mỗi request (mặc định 8192).
//  - MEALIO_OLLAMA_TEMPERATURE: độ ngẫu nhiên (mặc định 0.7).
function envInt(name: string, fallback: number): number {
  const n = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function envFloat(name: string, fallback: number): number {
  const n = parseFloat(process.env[name] ?? "");
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Bỏ hậu tố /v1 để ra gốc native (http://host:11434). */
function nativeBase(baseUrl?: string): string {
  const b = (baseUrl ?? OLLAMA_DEFAULT_BASE_URL).replace(/\/+$/, "");
  return b.replace(/\/v1$/, "");
}

interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[]; // base64 thô (không tiền tố data:)
}

export class OllamaProvider implements AIProvider {
  private base: string;
  private numCtx: number;
  private temperature: number;

  constructor(
    private model: string,
    baseUrl?: string,
    private basicAuth?: BasicAuth,
  ) {
    this.base = nativeBase(baseUrl);
    this.numCtx = envInt("MEALIO_OLLAMA_NUM_CTX", 8192);
    this.temperature = envFloat("MEALIO_OLLAMA_TEMPERATURE", 0.7);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.basicAuth) h.Authorization = basicAuthHeader(this.basicAuth);
    return h;
  }

  /** Gọi /api/chat (non-stream), trả về nội dung text của message. */
  private async chat(messages: OllamaChatMessage[]): Promise<string> {
    const res = await fetch(`${this.base}/api/chat`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        format: "json", // ép JSON hợp lệ
        options: { num_ctx: this.numCtx, temperature: this.temperature },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Ollama lỗi ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
      );
    }
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content ?? "";
  }

  async testConnection(): Promise<TestConnectionResult> {
    const res = await fetch(`${this.base}/api/tags`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(`Ollama không phản hồi (${res.status}).`);
    }
    const data = (await res.json()) as { models?: { name?: string }[] };
    return {
      models: (data.models ?? [])
        .map((m) => m.name)
        .filter((n): n is string => Boolean(n)),
    };
  }

  async generateWeekPlan(ctx: MenuContext): Promise<AiWeekPlan> {
    const { system, user } = buildWeekPlanPrompt(ctx);
    const content = await this.chat([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    return parseWeekPlanJson(content);
  }

  async generateMenu(ctx: MenuContext): Promise<AiMenu> {
    const { system, user } = buildMenuPrompt(ctx);
    const content = await this.chat([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    return parseMenuJson(content);
  }

  async editMeal(ctx: EditContext): Promise<AiEditResult> {
    const { system, user } = buildEditPrompt(ctx);
    const content = await this.chat([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    return parseEditJson(content);
  }

  async recognizeMember(image: MemberImage): Promise<MemberRecognition> {
    const { system, user } = buildRecognitionPrompt();
    const content = await this.chat([
      { role: "system", content: system },
      { role: "user", content: user, images: [image.base64] },
    ]);
    return parseRecognitionJson(content);
  }
}
