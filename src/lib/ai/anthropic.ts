import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, MenuContext, MemberImage } from "./types";
import { buildMenuPrompt, buildRecognitionPrompt } from "./prompt";
import {
  parseMenuJson,
  parseRecognitionJson,
  type AiMenu,
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
      ...(this.baseUrl ? { baseURL: this.baseUrl } : {}),
    });
  }

  private textOf(msg: Anthropic.Message): string {
    return msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
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
