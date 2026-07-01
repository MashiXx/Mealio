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
} from "@/lib/ai-models";

type Props = {
  provider: string;
  model: string;
  baseUrl: string;
  hasKey: boolean;
};

const initial: SettingsState = {};

export function SettingsForm({ provider, model, baseUrl, hasKey }: Props) {
  const [state, formAction, pending] = useActionState(
    saveAISettingsAction,
    initial,
  );

  const [prov, setProv] = useState(provider);
  const [baseUrlVal, setBaseUrlVal] = useState(baseUrl);

  // Anthropic: nếu model đã lưu nằm trong danh sách -> chọn sẵn, ngược lại là tuỳ chỉnh.
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

  // Model thực tế sẽ gửi lên server.
  const effectiveModel =
    prov === "ANTHROPIC"
      ? anthChoice === CUSTOM_MODEL
        ? anthCustom
        : anthChoice
      : openaiModel;

  const activeHint =
    prov === "ANTHROPIC"
      ? ANTHROPIC_MODELS.find((m) => m.id === anthChoice)?.hint
      : undefined;

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
                  {p.value === "ANTHROPIC"
                    ? "Anthropic (Claude)"
                    : "OpenAI-compatible"}
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  {p.value === "ANTHROPIC"
                    ? "Dùng trực tiếp API Claude"
                    : "OpenAI, tự host, Ollama, LM Studio…"}
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
              placeholder="https://api.openai.com/v1"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-zinc-700">
              Model
            </span>
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

      {/* API key */}
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-zinc-700">
          API Key{" "}
          {hasKey && (
            <span className="font-normal text-emerald-600">
              (đã lưu — để trống nếu giữ nguyên)
            </span>
          )}
        </span>
        <input
          name="apiKey"
          type="password"
          autoComplete="off"
          placeholder={
            hasKey
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
