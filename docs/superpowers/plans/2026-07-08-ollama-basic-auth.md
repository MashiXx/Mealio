# Ollama Provider + Basic Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm Ollama thành provider AI riêng và cho phép request tới endpoint tự host (Ollama + OpenAI-compatible) đính kèm HTTP Basic auth.

**Architecture:** Ollama nói được API OpenAI-compatible ở `/v1`, nên `OllamaProvider` kế thừa `OpenAICompatibleProvider`, chỉ thay default baseURL + không cần API key. Basic auth được cấu hình dạng `user:pass` mã hoá AES-256-GCM (tái dùng `src/lib/crypto.ts`), và khi gọi thì gửi qua `defaultHeaders` của OpenAI SDK để **thay** header `Bearer` (HTTP chỉ cho một header `Authorization`).

**Tech Stack:** Next.js 16.2.9 (App Router, Turbopack, server actions), Prisma 6 + Postgres, `openai` v6.45, Zod 4, TypeScript 5.

## Global Constraints

- **Next.js 16 breaking changes:** `params`/`searchParams`/`cookies()`/`headers()` là async; `useActionState` import từ `react`; middleware tên `proxy.ts`. Trước khi viết code động tới API Next, đọc doc liên quan trong `node_modules/next/dist/docs/`.
- **BYOK bảo mật:** mọi secret (API key, basic auth) mã hoá bằng `encrypt()` (`src/lib/crypto.ts`) TRƯỚC khi ghi DB; chỉ `decrypt()` ở server. Không log giá trị giải mã, không truyền secret về client (chỉ truyền cờ boolean `hasKey`/`hasBasicAuth`).
- **Không có test runner** trong repo (scripts: dev/build/start/lint). Cổng kiểm thử tự động cho mỗi task: `npx tsc --noEmit`. Cổng cuối: `npm run build` phải pass. Logic thuần (basic auth header) verify bằng `node -e` inline.
- **Encrypt format:** `encrypt(plain: string): string` và `decrypt(payload: string): string` đã có, dạng `"<iv>:<tag>:<cipher>"` (mỗi phần hex, phân tách bằng `:`). Vì ciphertext có chứa `:`, khi lưu cặp basic auth phải mã hoá cả chuỗi `"user:pass"` thành MỘT giá trị `encrypt()` — không tự split payload đã mã hoá.
- **Provider enum values:** `ANTHROPIC` | `OPENAI_COMPATIBLE` | `OLLAMA` (thêm mới). Giữ đồng bộ giữa Prisma enum, Zod schema, và `AI_PROVIDERS` ở `src/lib/enums.ts`.

---

### Task 1: Prisma — thêm enum OLLAMA + cột basicAuthEncrypted

**Files:**
- Modify: `prisma/schema.prisma` (model `AISettings` ~152-162, `enum AIProvider` ~164-167)
- Create: migration mới dưới `prisma/migrations/` (do `prisma migrate dev` sinh ra)

**Interfaces:**
- Produces: cột DB `AISettings.basicAuthEncrypted: String?`; giá trị enum `AIProvider.OLLAMA`. Prisma Client được regenerate để `prisma.aISettings` biết field mới.

- [ ] **Step 1: Sửa enum AIProvider**

Trong `prisma/schema.prisma`, đổi:

```prisma
enum AIProvider {
  ANTHROPIC
  OPENAI_COMPATIBLE
  OLLAMA
}
```

- [ ] **Step 2: Thêm cột basicAuthEncrypted vào model AISettings**

Trong `model AISettings`, thêm dòng ngay dưới `apiKeyEncrypted String?`:

```prisma
  apiKeyEncrypted   String?
  basicAuthEncrypted String?
```

(Chỉ thêm dòng `basicAuthEncrypted`; các dòng khác giữ nguyên.)

- [ ] **Step 3: Tạo migration + regenerate client**

Run:
```bash
npx prisma migrate dev --name add_ollama_and_basic_auth
```
Expected: Prisma tạo thư mục migration mới, áp lên Postgres remote (host trong `.env`), in "Your database is now in sync with your schema" và "Generated Prisma Client".

Nếu migrate dev bị chặn vì môi trường (shadow DB), fallback:
```bash
npx prisma migrate deploy && npx prisma generate
```
(nhưng ưu tiên `migrate dev` để sinh file migration).

- [ ] **Step 4: Verify schema compile**

Run: `npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid 🚀"

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): thêm provider OLLAMA và cột basicAuthEncrypted cho AISettings"
```

---

### Task 2: AI adapter — helper client dùng chung + basic auth + OllamaProvider

**Files:**
- Create: `src/lib/ai/openai-client.ts`
- Modify: `src/lib/ai/openai-compatible.ts` (thêm tham số `basicAuth`, dùng helper)
- Create: `src/lib/ai/ollama.ts`

**Interfaces:**
- Produces:
  - `type BasicAuth = { user: string; pass: string }`
  - `basicAuthHeader(auth: BasicAuth): string` → `"Basic <base64(user:pass)>"`
  - `parseBasicAuth(raw: string): BasicAuth` (split ở dấu `:` ĐẦU TIÊN)
  - `buildOpenAIClient(opts: { apiKey?: string; baseUrl?: string; basicAuth?: BasicAuth }): OpenAI`
  - `class OpenAICompatibleProvider` constructor `(apiKey: string, model: string, baseUrl?: string, basicAuth?: BasicAuth)`
  - `class OllamaProvider extends OpenAICompatibleProvider` constructor `(model: string, baseUrl?: string, basicAuth?: BasicAuth)`
- Consumes: `OpenAI` từ `openai`; interface `AIProvider` từ `./types`.

- [ ] **Step 1: Tạo helper `src/lib/ai/openai-client.ts`**

```ts
import OpenAI from "openai";

// Basic auth cho endpoint tự host nằm sau reverse proxy (Ollama, OpenAI-compatible…).
export type BasicAuth = { user: string; pass: string };

/** Header "Basic base64(user:pass)". */
export function basicAuthHeader(auth: BasicAuth): string {
  const token = Buffer.from(`${auth.user}:${auth.pass}`).toString("base64");
  return `Basic ${token}`;
}

/** Tách chuỗi "user:pass" đã giải mã. Split ở dấu ':' đầu tiên (pass có thể chứa ':'). */
export function parseBasicAuth(raw: string): BasicAuth {
  const idx = raw.indexOf(":");
  if (idx === -1) return { user: raw, pass: "" };
  return { user: raw.slice(0, idx), pass: raw.slice(idx + 1) };
}

export type OpenAIClientOpts = {
  apiKey?: string;
  baseUrl?: string;
  basicAuth?: BasicAuth;
};

/**
 * Dựng OpenAI client dùng chung cho OpenAI-compatible & Ollama.
 * Khi có basicAuth: gửi Authorization: Basic ... qua defaultHeaders — SDK áp
 * defaultHeaders SAU authHeaders (openai/client.js) nên header này THAY cho
 * Bearer mặc định. HTTP chỉ cho một header Authorization.
 * apiKey rỗng vẫn truyền giá trị giả để SDK không ném lỗi khởi tạo.
 */
export function buildOpenAIClient(opts: OpenAIClientOpts): OpenAI {
  return new OpenAI({
    apiKey: opts.apiKey && opts.apiKey.length > 0 ? opts.apiKey : "unused",
    ...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
    ...(opts.basicAuth
      ? { defaultHeaders: { Authorization: basicAuthHeader(opts.basicAuth) } }
      : {}),
  });
}
```

- [ ] **Step 2: Verify logic basicAuthHeader**

Run:
```bash
node -e 'const t=Buffer.from("alice:secret").toString("base64"); console.log("Basic "+t); if(("Basic "+t)!=="Basic YWxpY2U6c2VjcmV0") process.exit(1); console.log("OK")'
```
Expected: in `Basic YWxpY2U6c2VjcmV0` rồi `OK` (đây là base64 chuẩn của `alice:secret`).

- [ ] **Step 3: Refactor `src/lib/ai/openai-compatible.ts` dùng helper + basicAuth**

Thay toàn bộ nội dung file bằng:

```ts
import type { AIProvider, MenuContext, MemberImage } from "./types";
import { buildMenuPrompt, buildRecognitionPrompt } from "./prompt";
import {
  parseMenuJson,
  parseRecognitionJson,
  type AiMenu,
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
```

(Thay đổi so với bản cũ: import `buildOpenAIClient`/`BasicAuth`; constructor thêm `basicAuth`, các field đổi `private`→`protected` để subclass dùng được; `client()` gọi helper.)

- [ ] **Step 4: Tạo `src/lib/ai/ollama.ts`**

```ts
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
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: không lỗi (exit 0). Nếu báo lỗi ở `index.ts` vì constructor signature đổi — sẽ sửa ở Task 3; tạm thời chấp nhận CHỈ lỗi liên quan `OpenAICompatibleProvider` ở `index.ts`. Nếu có lỗi khác trong 3 file vừa sửa, fix trước khi tiếp.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/openai-client.ts src/lib/ai/openai-compatible.ts src/lib/ai/ollama.ts
git commit -m "feat(ai): helper client dùng chung + basic auth + OllamaProvider"
```

---

### Task 3: Factory `getAIProvider` — route OLLAMA + giải mã basic auth

**Files:**
- Modify: `src/lib/ai/index.ts`

**Interfaces:**
- Consumes: `OpenAICompatibleProvider(apiKey, model, baseUrl?, basicAuth?)`, `OllamaProvider(model, baseUrl?, basicAuth?)`, `parseBasicAuth`, `BasicAuth` (Task 2); `decrypt` (`../crypto`); `prisma.aISettings` với field `basicAuthEncrypted` (Task 1).
- Produces: `getAIProvider(familyId: string): Promise<AIProvider>` (chữ ký không đổi).

- [ ] **Step 1: Thay nội dung `src/lib/ai/index.ts`**

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0, không còn lỗi liên quan constructor `OpenAICompatibleProvider`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/index.ts
git commit -m "feat(ai): factory route OLLAMA và truyền basic auth cho endpoint tự host"
```

---

### Task 4: Server action `settings.ts` — enum OLLAMA, key optional, lưu basic auth

**Files:**
- Modify: `src/lib/actions/settings.ts`

**Interfaces:**
- Consumes: `encrypt` (`@/lib/crypto`), `prisma.aISettings` (field `basicAuthEncrypted`, enum `OLLAMA`), `requireFamily`.
- Produces: `saveAISettingsAction(_prev, formData): Promise<SettingsState>` đọc thêm form field `basicAuthUser`, `basicAuthPass`; chữ ký không đổi.

- [ ] **Step 1: Thay nội dung `src/lib/actions/settings.ts`**

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions/settings.ts
git commit -m "feat(settings): provider OLLAMA (key optional) + lưu basic auth mã hoá"
```

---

### Task 5: UI — enums, model gợi ý, form 3 provider + ô basic auth

**Files:**
- Modify: `src/lib/enums.ts` (`AI_PROVIDERS`)
- Modify: `src/lib/ai-models.ts` (thêm gợi ý model Ollama)
- Modify: `src/app/(app)/settings/ai/page.tsx` (truyền `hasBasicAuth`)
- Modify: `src/app/(app)/settings/ai/SettingsForm.tsx` (provider thứ 3 + khối basic auth)

**Interfaces:**
- Consumes: `saveAISettingsAction`, `SettingsState`; `AI_PROVIDERS`; `OLLAMA_MODEL_SUGGESTIONS`, `OPENAI_MODEL_SUGGESTIONS`, `ANTHROPIC_MODELS`, `CUSTOM_MODEL`.
- Produces: `SettingsForm` nhận thêm prop `hasBasicAuth: boolean`.

- [ ] **Step 1: Thêm OLLAMA vào `AI_PROVIDERS` (`src/lib/enums.ts`)**

Thay khối `AI_PROVIDERS` bằng:

```ts
export const AI_PROVIDERS = [
  { value: "ANTHROPIC", label: "Anthropic (Claude)" },
  { value: "OPENAI_COMPATIBLE", label: "OpenAI-compatible (OpenAI, tự host…)" },
  { value: "OLLAMA", label: "Ollama (tự host)" },
] as const;
```

- [ ] **Step 2: Thêm gợi ý model Ollama (`src/lib/ai-models.ts`)**

Thêm vào cuối file (trước hoặc sau `CUSTOM_MODEL`):

```ts
// Model Ollama phổ biến. llava / llama3.2-vision có thị giác (cho nhận dạng ảnh).
export const OLLAMA_MODEL_SUGGESTIONS = [
  "llama3.1",
  "llama3.2",
  "qwen2.5",
  "mistral",
  "llava",
  "llama3.2-vision",
];
```

- [ ] **Step 3: Truyền `hasBasicAuth` từ page (`src/app/(app)/settings/ai/page.tsx`)**

Trong `<SettingsForm .../>`, thêm prop (ngay dưới `hasKey=...`):

```tsx
        <SettingsForm
          provider={settings?.provider ?? "ANTHROPIC"}
          model={settings?.model ?? "claude-opus-4-8"}
          baseUrl={settings?.baseUrl ?? ""}
          hasKey={Boolean(settings?.apiKeyEncrypted)}
          hasBasicAuth={Boolean(settings?.basicAuthEncrypted)}
        />
```

- [ ] **Step 4: Cập nhật `SettingsForm.tsx`**

Thay toàn bộ nội dung file bằng:

```tsx
"use client";

import { useActionState, useState } from "react";
import {
  saveAISettingsAction,
  type SettingsState,
} from "@/lib/actions/settings";
import { AI_PROVIDERS } from "@/lib/enums";
import {
  ANTHROPIC_MODELS,
  CUSTOM_MODEL,
  OPENAI_MODEL_SUGGESTIONS,
  OLLAMA_MODEL_SUGGESTIONS,
} from "@/lib/ai-models";

type Props = {
  provider: string;
  model: string;
  baseUrl: string;
  hasKey: boolean;
  hasBasicAuth: boolean;
};

const initial: SettingsState = {};

const PROVIDER_BLURB: Record<string, string> = {
  ANTHROPIC: "Dùng trực tiếp API Claude",
  OPENAI_COMPATIBLE: "OpenAI, tự host, LM Studio…",
  OLLAMA: "Ollama local hoặc sau reverse proxy",
};

const PROVIDER_TITLE: Record<string, string> = {
  ANTHROPIC: "Anthropic (Claude)",
  OPENAI_COMPATIBLE: "OpenAI-compatible",
  OLLAMA: "Ollama (tự host)",
};

export function SettingsForm({
  provider,
  model,
  baseUrl,
  hasKey,
  hasBasicAuth,
}: Props) {
  const [state, formAction, pending] = useActionState(
    saveAISettingsAction,
    initial,
  );

  const [prov, setProv] = useState(provider);
  const [baseUrlVal, setBaseUrlVal] = useState(baseUrl);

  // Anthropic: model đã lưu nằm trong danh sách -> chọn sẵn, ngược lại là tuỳ chỉnh.
  const knownIds = ANTHROPIC_MODELS.map((m) => m.id);
  const [anthChoice, setAnthChoice] = useState(
    provider === "ANTHROPIC" && !knownIds.includes(model)
      ? CUSTOM_MODEL
      : knownIds.includes(model)
        ? model
        : ANTHROPIC_MODELS[0].id,
  );
  const [anthCustom, setAnthCustom] = useState(
    provider === "ANTHROPIC" && !knownIds.includes(model) ? model : "",
  );
  const [openaiModel, setOpenaiModel] = useState(
    provider === "OPENAI_COMPATIBLE" ? model : "gpt-4o",
  );
  const [ollamaModel, setOllamaModel] = useState(
    provider === "OLLAMA" ? model : "llama3.1",
  );

  // Model thực tế gửi lên server tuỳ provider.
  const effectiveModel =
    prov === "ANTHROPIC"
      ? anthChoice === CUSTOM_MODEL
        ? anthCustom
        : anthChoice
      : prov === "OLLAMA"
        ? ollamaModel
        : openaiModel;

  const activeHint =
    prov === "ANTHROPIC"
      ? ANTHROPIC_MODELS.find((m) => m.id === anthChoice)?.hint
      : undefined;

  const showBasicAuth = prov === "OPENAI_COMPATIBLE" || prov === "OLLAMA";

  return (
    <form action={formAction} className="space-y-6">
      {/* Model thực tế đi kèm dạng hidden để server đọc một giá trị duy nhất */}
      <input type="hidden" name="model" value={effectiveModel} />

      {/* Chọn nhà cung cấp bằng thẻ */}
      <div>
        <span className="mb-2 block text-sm font-medium text-zinc-700">
          Nhà cung cấp AI
        </span>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {AI_PROVIDERS.map((p) => {
            const selected = prov === p.value;
            return (
              <button
                type="button"
                key={p.value}
                onClick={() => setProv(p.value)}
                className={`rounded-xl border p-3 text-left text-sm transition-colors ${
                  selected
                    ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-100"
                    : "border-zinc-300 hover:border-zinc-400"
                }`}
              >
                <span className="block font-medium text-zinc-800">
                  {PROVIDER_TITLE[p.value]}
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  {PROVIDER_BLURB[p.value]}
                </span>
              </button>
            );
          })}
        </div>
        <input type="hidden" name="provider" value={prov} />
      </div>

      {/* Chọn model — tuỳ theo nhà cung cấp */}
      {prov === "ANTHROPIC" ? (
        <div>
          <span className="mb-1 block text-sm font-medium text-zinc-700">
            Model Claude
          </span>
          <select
            value={anthChoice}
            onChange={(e) => setAnthChoice(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          >
            {ANTHROPIC_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} — {m.hint}
              </option>
            ))}
            <option value={CUSTOM_MODEL}>Khác (nhập model ID tay)…</option>
          </select>
          {anthChoice === CUSTOM_MODEL ? (
            <input
              value={anthCustom}
              onChange={(e) => setAnthCustom(e.target.value)}
              placeholder="vd: claude-opus-4-7"
              className="mt-2 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            />
          ) : (
            activeHint && (
              <p className="mt-1 text-xs text-zinc-500">{activeHint}</p>
            )
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-zinc-700">
              Base URL{" "}
              <span className="font-normal text-zinc-400">(địa chỉ API)</span>
            </span>
            <input
              name="baseUrl"
              value={baseUrlVal}
              onChange={(e) => setBaseUrlVal(e.target.value)}
              placeholder={
                prov === "OLLAMA"
                  ? "http://localhost:11434/v1"
                  : "https://api.openai.com/v1"
              }
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            />
            {prov === "OLLAMA" && (
              <p className="mt-1 text-xs text-zinc-500">
                Để trống sẽ dùng mặc định http://localhost:11434/v1
              </p>
            )}
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-zinc-700">
              Model
            </span>
            {prov === "OLLAMA" ? (
              <>
                <input
                  value={ollamaModel}
                  onChange={(e) => setOllamaModel(e.target.value)}
                  list="ollama-models"
                  placeholder="llama3.1"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                />
                <datalist id="ollama-models">
                  {OLLAMA_MODEL_SUGGESTIONS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                <p className="mt-1 text-xs text-zinc-500">
                  Nhận dạng ảnh cần model có thị giác (vd llava, llama3.2-vision).
                </p>
              </>
            ) : (
              <>
                <input
                  value={openaiModel}
                  onChange={(e) => setOpenaiModel(e.target.value)}
                  list="openai-models"
                  placeholder="gpt-4o"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                />
                <datalist id="openai-models">
                  {OPENAI_MODEL_SUGGESTIONS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                <p className="mt-1 text-xs text-zinc-500">
                  Nhận dạng ảnh cần model có thị giác (vd gpt-4o).
                </p>
              </>
            )}
          </label>
        </div>
      )}

      {/* Tuỳ chọn nâng cao cho Anthropic: baseUrl proxy/self-host */}
      {prov === "ANTHROPIC" && (
        <details className="rounded-lg border border-zinc-200 px-3 py-2">
          <summary className="cursor-pointer text-sm text-zinc-600">
            Tuỳ chọn nâng cao (proxy / self-host)
          </summary>
          <label className="mt-3 block">
            <span className="mb-1 block text-sm font-medium text-zinc-700">
              Base URL tuỳ chỉnh
            </span>
            <input
              name="baseUrl"
              value={baseUrlVal}
              onChange={(e) => setBaseUrlVal(e.target.value)}
              placeholder="Để trống nếu dùng API Anthropic mặc định"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            />
          </label>
        </details>
      )}

      {/* Basic auth — cho endpoint tự host (Ollama / OpenAI-compatible) sau proxy */}
      {showBasicAuth && (
        <details
          className="rounded-lg border border-zinc-200 px-3 py-2"
          open={hasBasicAuth}
        >
          <summary className="cursor-pointer text-sm text-zinc-600">
            Basic auth (tuỳ chọn){" "}
            {hasBasicAuth && (
              <span className="text-emerald-600">— đã lưu</span>
            )}
          </summary>
          <p className="mt-2 text-xs text-zinc-500">
            Dùng khi endpoint nằm sau reverse proxy chặn bằng HTTP Basic auth.
            Để trống nếu không cần (hoặc giữ nguyên giá trị đã lưu).
          </p>
          <label className="mt-3 block">
            <span className="mb-1 block text-sm font-medium text-zinc-700">
              Username
            </span>
            <input
              name="basicAuthUser"
              autoComplete="off"
              placeholder={hasBasicAuth ? "(đã lưu)" : "vd: admin"}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            />
          </label>
          <label className="mt-3 block">
            <span className="mb-1 block text-sm font-medium text-zinc-700">
              Password
            </span>
            <input
              name="basicAuthPass"
              type="password"
              autoComplete="off"
              placeholder={hasBasicAuth ? "••••••••" : ""}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            />
          </label>
        </details>
      )}

      {/* API key */}
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-zinc-700">
          API Key{" "}
          {prov === "OLLAMA" ? (
            <span className="font-normal text-zinc-400">
              (Ollama thường không cần)
            </span>
          ) : (
            hasKey && (
              <span className="font-normal text-emerald-600">
                (đã lưu — để trống nếu giữ nguyên)
              </span>
            )
          )}
        </span>
        <input
          name="apiKey"
          type="password"
          autoComplete="off"
          placeholder={
            prov === "OLLAMA"
              ? "Bỏ trống nếu Ollama không yêu cầu"
              : hasKey
                ? "••••••••••••"
                : prov === "ANTHROPIC"
                  ? "sk-ant-…"
                  : "sk-…"
          }
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
        />
        <span className="mt-1 block text-xs text-zinc-400">
          Key được mã hoá AES-256-GCM trước khi lưu, chỉ giải mã ở máy chủ.
        </span>
      </label>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Đã lưu cấu hình AI.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {pending ? "Đang lưu…" : "Lưu cấu hình"}
      </button>
    </form>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/enums.ts src/lib/ai-models.ts src/app/(app)/settings/ai/page.tsx src/app/(app)/settings/ai/SettingsForm.tsx
git commit -m "feat(ui): provider Ollama + ô basic auth trong cài đặt AI"
```

---

### Task 6: Verify toàn cục — build + smoke test thủ công

**Files:** (không sửa; chỉ kiểm chứng)

- [ ] **Step 1: Build production**

Run: `npm run build`
Expected: build pass, không lỗi type/lint chặn build.

- [ ] **Step 2: Smoke test Ollama (nếu có Ollama local)**

Chạy `npm run dev`, vào `/settings/ai`:
- Chọn "Ollama (tự host)", model `llama3.1`, để trống API key, lưu → thấy "Đã lưu cấu hình AI".
- Tạo thực đơn → xác nhận app gọi được `http://localhost:11434/v1` (nếu Ollama đang chạy). Nếu không có Ollama, xác nhận lỗi trả về là lỗi kết nối tới localhost:11434 (chứng tỏ đã route đúng provider), KHÔNG phải lỗi "chưa cấu hình API key".

- [ ] **Step 3: Smoke test Basic auth (header)**

Xác nhận header Basic được gửi. Cách nhanh không cần proxy — chạy node script kiểm client dựng đúng header:
```bash
node -e '
const OpenAI = require("openai").default ?? require("openai");
const token = Buffer.from("admin:pw").toString("base64");
const c = new OpenAI({ apiKey: "unused", baseURL: "http://localhost:11434/v1", defaultHeaders: { Authorization: "Basic " + token } });
console.log("client ok, expect header Basic " + token);
'
```
Expected: in "client ok…" không ném lỗi khởi tạo (chứng tỏ apiKey giả + defaultHeaders hợp lệ). Việc override Bearer đã xác nhận qua `openai/client.js` (defaultHeaders áp sau authHeaders).

Nếu có endpoint test thật sau Basic-auth proxy: bật user/pass trong UI, tạo thực đơn, kiểm access log của proxy thấy request kèm `Authorization: Basic …` và không bị 401.

- [ ] **Step 4: Không commit (task xác minh).** Nếu phát hiện lỗi, quay lại task tương ứng sửa.

---

## Ghi chú thực thi

- Thứ tự task là thứ tự phụ thuộc: 1 (DB) → 2 (adapter) → 3 (factory) → 4 (action) → 5 (UI) → 6 (verify). Task 2 typecheck có thể còn lỗi tạm ở `index.ts` cho tới khi Task 3 xong — điều này được nêu rõ trong Task 2 Step 5.
- Không refactor ngoài phạm vi. `AnthropicProvider` không đổi.
- Secret không bao giờ truyền về client: `page.tsx` chỉ truyền `hasKey`/`hasBasicAuth` (boolean).
