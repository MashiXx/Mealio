"use client";

import { useActionState, useState } from "react";
import {
  saveAISettingsAction,
  type SettingsState,
} from "@/lib/actions/settings";
import { AI_PROVIDERS } from "@/lib/enums";

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

  return (
    <form action={formAction} className="space-y-5">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-zinc-700">
          Nhà cung cấp
        </span>
        <select
          name="provider"
          value={prov}
          onChange={(e) => setProv(e.target.value)}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        >
          {AI_PROVIDERS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-zinc-700">
          Model
        </span>
        <input
          name="model"
          defaultValue={model}
          placeholder={
            prov === "ANTHROPIC" ? "claude-opus-4-8" : "gpt-4o-mini"
          }
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-zinc-700">
          Base URL{" "}
          <span className="font-normal text-zinc-400">
            (tuỳ chọn — proxy / tự host)
          </span>
        </span>
        <input
          name="baseUrl"
          defaultValue={baseUrl}
          placeholder="https://api.openai.com/v1"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
        />
      </label>

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
          placeholder={hasKey ? "••••••••••••" : "sk-… / anthropic key"}
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
