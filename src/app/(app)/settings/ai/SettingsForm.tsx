"use client";

import { useActionState, useState } from "react";
import {
  saveAISettingsAction,
  testAISettingsAction,
  type SettingsState,
  type TestState,
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
const initialTest: TestState = {};

// Màu sắc bảng thông báo test theo trạng thái.
const TEST_STYLE: Record<string, string> = {
  ok: "bg-emerald-50 text-emerald-700",
  warn: "bg-amber-50 text-amber-700",
  error: "bg-red-50 text-red-700",
};

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
  const [testState, testAction, testPending] = useActionState(
    testAISettingsAction,
    initialTest,
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

      {/* Kết quả test kết nối (trên giá trị đang nhập, không cần lưu trước) */}
      {testState.message && (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${
            TEST_STYLE[testState.status ?? "error"]
          }`}
          aria-live="polite"
        >
          {testState.message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {pending ? "Đang lưu…" : "Lưu cấu hình"}
        </button>
        {/* Nút Test: formAction riêng -> gọi testAISettingsAction với cùng form data */}
        <button
          type="submit"
          formAction={testAction}
          disabled={testPending}
          className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
        >
          {testPending ? "Đang test…" : "Test kết nối"}
        </button>
      </div>
    </form>
  );
}
