import type {
  AIProvider,
  MenuContext,
  EditContext,
  MemberImage,
  TestConnectionResult,
} from "./types";
import { buildMenuPrompt, buildEditPrompt, buildRecognitionPrompt } from "./prompt";
import {
  parseMenuJson,
  parseEditJson,
  parseRecognitionJson,
  type AiMenu,
  type AiEditResult,
  type MemberRecognition,
} from "./schema";
import { buildOpenAIClient, type BasicAuth } from "./openai-client";

// Adapter cho endpoint kiểu OpenAI (OpenAI, model tự host, LM Studio, Ollama...).
// baseUrl trỏ tới API tuỳ chỉnh; basicAuth cho endpoint sau reverse proxy.
export class OpenAICompatibleProvider implements AIProvider {
  constructor(
    protected apiKey: string,
    protected model: string,
    protected baseUrl?: string,
    protected basicAuth?: BasicAuth,
  ) {}

  protected client() {
    return buildOpenAIClient({
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      basicAuth: this.basicAuth,
    });
  }

  async testConnection(): Promise<TestConnectionResult> {
    const res = await this.client().models.list();
    return { models: res.data.map((m) => m.id) };
  }

  async generateMenu(ctx: MenuContext): Promise<AiMenu> {
    const { system, user } = buildMenuPrompt(ctx);
    const res = await this.client().chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    });
    return parseMenuJson(res.choices[0]?.message?.content ?? "");
  }

  async editMeal(ctx: EditContext): Promise<AiEditResult> {
    const { system, user } = buildEditPrompt(ctx);
    const res = await this.client().chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    });
    return parseEditJson(res.choices[0]?.message?.content ?? "");
  }

  async recognizeMember(image: MemberImage): Promise<MemberRecognition> {
    const { system, user } = buildRecognitionPrompt();
    const res = await this.client().chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: user },
            {
              type: "image_url",
              image_url: {
                url: `data:${image.mediaType};base64,${image.base64}`,
              },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
    });
    return parseRecognitionJson(res.choices[0]?.message?.content ?? "");
  }
}
