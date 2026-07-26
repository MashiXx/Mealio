import Anthropic from "@anthropic-ai/sdk";
import { aiTimeoutMs } from "./timeout";
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

// Adapter cho Claude (Anthropic). Hỗ trợ baseUrl tuỳ chỉnh (proxy/self-host).
export class AnthropicProvider implements AIProvider {
  constructor(
    private apiKey: string,
    private model: string,
    private baseUrl?: string,
  ) {}

  private client() {
    return new Anthropic({
      apiKey: this.apiKey,
      // Timeout lấy chung từ aiTimeoutMs() để luôn thấp hơn ngưỡng job treo —
      // ngược lại thì reaper giết job trước khi lời gọi kịp hỏng.
      timeout: aiTimeoutMs(),
      ...(this.baseUrl ? { baseURL: this.baseUrl } : {}),
    });
  }

  private textOf(msg: Anthropic.Message): string {
    return msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  }

  async testConnection(): Promise<TestConnectionResult> {
    const res = await this.client().models.list();
    return { models: res.data.map((m) => m.id) };
  }

  async generateWeekPlan(ctx: MenuContext): Promise<AiWeekPlan> {
    const { system, user } = buildWeekPlanPrompt(ctx);
    const msg = await this.client().messages.create({
      model: this.model,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
    });
    return parseWeekPlanJson(this.textOf(msg));
  }

  async generateMenu(ctx: MenuContext): Promise<AiMenu> {
    const { system, user } = buildMenuPrompt(ctx);
    const msg = await this.client().messages.create({
      model: this.model,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
    });
    return parseMenuJson(this.textOf(msg));
  }

  async editMeal(ctx: EditContext): Promise<AiEditResult> {
    const { system, user } = buildEditPrompt(ctx);
    const msg = await this.client().messages.create({
      model: this.model,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
    });
    return parseEditJson(this.textOf(msg));
  }

  async recognizeMember(image: MemberImage): Promise<MemberRecognition> {
    const { system, user } = buildRecognitionPrompt();
    const msg = await this.client().messages.create({
      model: this.model,
      max_tokens: 1024,
      system,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: image.mediaType,
                data: image.base64,
              },
            },
            { type: "text", text: user },
          ],
        },
      ],
    });
    return parseRecognitionJson(this.textOf(msg));
  }
}
