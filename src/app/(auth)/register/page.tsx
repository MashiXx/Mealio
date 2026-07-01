"use client";

import Link from "next/link";
import { useActionState } from "react";
import { registerAction, type AuthState } from "@/lib/actions/auth";

const initial: AuthState = {};

export default function RegisterPage() {
  const [state, formAction, pending] = useActionState(registerAction, initial);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h1 className="mb-1 text-xl font-semibold">Tạo tài khoản</h1>
      <p className="mb-5 text-sm text-zinc-500">
        Bắt đầu lên thực đơn cho gia đình bạn.
      </p>

      <form action={formAction} className="space-y-4">
        <Field
          label="Tên của bạn"
          name="name"
          type="text"
          autoComplete="name"
          errors={state.fieldErrors?.name}
        />
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          errors={state.fieldErrors?.email}
        />
        <Field
          label="Mật khẩu"
          name="password"
          type="password"
          autoComplete="new-password"
          errors={state.fieldErrors?.password}
        />

        {state.error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
        >
          {pending ? "Đang tạo…" : "Đăng ký"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-zinc-500">
        Đã có tài khoản?{" "}
        <Link href="/login" className="font-medium text-emerald-700">
          Đăng nhập
        </Link>
      </p>
    </div>
  );
}

function Field({
  label,
  name,
  type,
  autoComplete,
  errors,
}: {
  label: string;
  name: string;
  type: string;
  autoComplete?: string;
  errors?: string[];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-zinc-700">
        {label}
      </span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
      />
      {errors?.[0] && (
        <span className="mt-1 block text-xs text-red-600">{errors[0]}</span>
      )}
    </label>
  );
}
