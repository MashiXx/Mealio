"use client";

import { useActionState, useState } from "react";
import {
  createFamilyAction,
  type OnboardingState,
} from "@/lib/actions/onboarding";
import {
  AGE_GROUPS,
  BUDGET_LEVELS,
  CUISINE_REGIONS,
  SPICE_LEVELS,
} from "@/lib/enums";

type MemberForm = {
  name: string;
  ageGroup: string;
  allergies: string;
  dietaryRestrictions: string;
  likes: string;
  dislikes: string;
};

const emptyMember: MemberForm = {
  name: "",
  ageGroup: "ADULT",
  allergies: "",
  dietaryRestrictions: "",
  likes: "",
  dislikes: "",
};

const toList = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const initial: OnboardingState = {};

export default function OnboardingPage() {
  const [state, formAction, pending] = useActionState(
    createFamilyAction,
    initial,
  );
  const [members, setMembers] = useState<MemberForm[]>([{ ...emptyMember }]);

  const update = (i: number, patch: Partial<MemberForm>) =>
    setMembers((prev) =>
      prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)),
    );

  const membersPayload = JSON.stringify(
    members.map((m) => ({
      name: m.name.trim(),
      ageGroup: m.ageGroup,
      allergies: toList(m.allergies),
      dietaryRestrictions: toList(m.dietaryRestrictions),
      likes: toList(m.likes),
      dislikes: toList(m.dislikes),
    })),
  );

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight">Thiết lập gia đình</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Cho Mealio biết vài thông tin để lên thực đơn phù hợp. Bạn có thể sửa
        lại sau.
      </p>

      <form action={formAction} className="mt-8 space-y-8">
        <input type="hidden" name="members" value={membersPayload} />

        {/* Thông tin chung */}
        <section className="rounded-2xl border border-zinc-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Gia đình
          </h2>
          <Text label="Tên gia đình" name="familyName" placeholder="Gia đình An" />

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select label="Khẩu vị vùng miền" name="cuisineRegion" options={CUISINE_REGIONS} />
            <Select label="Độ cay" name="spiceLevel" options={SPICE_LEVELS} defaultValue="MEDIUM" />
            <Select label="Ngân sách" name="budgetLevel" options={BUDGET_LEVELS} defaultValue="MEDIUM" />
            <Text
              label="Thời gian nấu tối đa (phút/món)"
              name="maxCookMinutes"
              type="number"
              defaultValue="60"
            />
          </div>

          <div className="mt-4">
            <Text
              label="Mục tiêu healthy (phân cách bằng dấu phẩy)"
              name="healthGoals"
              placeholder="nhiều rau, ít dầu mỡ"
            />
          </div>
          <div className="mt-4">
            <Text label="Ghi chú (tuỳ chọn)" name="notes" placeholder="Tránh đồ chiên rán vào buổi tối…" />
          </div>
        </section>

        {/* Thành viên */}
        <section className="rounded-2xl border border-zinc-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Thành viên
            </h2>
            <button
              type="button"
              onClick={() => setMembers((p) => [...p, { ...emptyMember }])}
              className="rounded-lg border border-emerald-300 px-3 py-1 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
            >
              + Thêm người
            </button>
          </div>

          <div className="space-y-5">
            {members.map((m, i) => (
              <div
                key={i}
                className="rounded-xl border border-zinc-200 p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-600">
                    Người {i + 1}
                  </span>
                  {members.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setMembers((p) => p.filter((_, idx) => idx !== i))
                      }
                      className="text-xs text-red-500 hover:underline"
                    >
                      Xoá
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Inline
                    label="Tên"
                    value={m.name}
                    onChange={(v) => update(i, { name: v })}
                    placeholder="Bé Na"
                  />
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-zinc-700">
                      Nhóm tuổi
                    </span>
                    <select
                      value={m.ageGroup}
                      onChange={(e) => update(i, { ageGroup: e.target.value })}
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    >
                      {AGE_GROUPS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Inline
                    label="Dị ứng (cách nhau dấu phẩy)"
                    value={m.allergies}
                    onChange={(v) => update(i, { allergies: v })}
                    placeholder="tôm, đậu phộng"
                  />
                  <Inline
                    label="Kiêng khem"
                    value={m.dietaryRestrictions}
                    onChange={(v) => update(i, { dietaryRestrictions: v })}
                    placeholder="ăn chay, không thịt bò"
                  />
                  <Inline
                    label="Thích"
                    value={m.likes}
                    onChange={(v) => update(i, { likes: v })}
                    placeholder="cá, rau xanh"
                  />
                  <Inline
                    label="Ghét"
                    value={m.dislikes}
                    onChange={(v) => update(i, { dislikes: v })}
                    placeholder="mướp đắng"
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {state.error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {pending ? "Đang lưu…" : "Hoàn tất & vào Mealio"}
        </button>
      </form>
    </div>
  );
}

function Text({
  label,
  name,
  type = "text",
  placeholder,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-zinc-700">
        {label}
      </span>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
      />
    </label>
  );
}

function Inline({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-zinc-700">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
      />
    </label>
  );
}

function Select({
  label,
  name,
  options,
  defaultValue,
}: {
  label: string;
  name: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-zinc-700">
        {label}
      </span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
