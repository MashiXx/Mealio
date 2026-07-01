"use client";

import { useActionState, useState } from "react";
import { saveMembersAction, type MembersState } from "@/lib/actions/members";
import { processMemberImage } from "@/lib/actions/member-image";
import { AGE_GROUPS } from "@/lib/enums";
import {
  AVATAR_CATEGORIES,
  EMOJI_PREFIX,
  avatarEmoji,
  isEmojiAvatar,
} from "@/lib/avatars";

export type InitialMember = {
  id: string;
  name: string;
  image: string | null;
  ageGroup: string;
  allergies: string[];
  dietaryRestrictions: string[];
  likes: string[];
  dislikes: string[];
};

type MemberForm = {
  id?: string;
  name: string;
  image: string | null;
  ageGroup: string;
  allergies: string;
  dietaryRestrictions: string;
  likes: string;
  dislikes: string;
  // trạng thái tạm (không lưu xuống DB)
  uploading?: boolean;
  suggestLikes?: string[];
  recNote?: string;
  recError?: string;
};

const emptyMember: MemberForm = {
  name: "",
  image: null,
  ageGroup: "ADULT",
  allergies: "",
  dietaryRestrictions: "",
  likes: "",
  dislikes: "",
};

const toStr = (a: string[]) => a.join(", ");
const toList = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

// Resize ảnh ở trình duyệt về tối đa 512px, xuất JPEG để giảm dung lượng.
function fileToDataUrl(file: File, maxSize = 512): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Không đọc được ảnh."));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error("Ảnh lỗi."));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxSize) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else if (height > maxSize) {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Không xử lý được ảnh."));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

const initial: MembersState = {};

export function MembersForm({
  initialMembers,
}: {
  initialMembers: InitialMember[];
}) {
  const [state, formAction, pending] = useActionState(
    saveMembersAction,
    initial,
  );
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [members, setMembers] = useState<MemberForm[]>(
    initialMembers.length
      ? initialMembers.map((m) => ({
          id: m.id,
          name: m.name,
          image: m.image,
          ageGroup: m.ageGroup,
          allergies: toStr(m.allergies),
          dietaryRestrictions: toStr(m.dietaryRestrictions),
          likes: toStr(m.likes),
          dislikes: toStr(m.dislikes),
        }))
      : [{ ...emptyMember }],
  );

  const update = (i: number, patch: Partial<MemberForm>) =>
    setMembers((prev) =>
      prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)),
    );

  const onPickImage = async (i: number, file: File | undefined) => {
    if (!file) return;
    update(i, { uploading: true, recError: undefined });
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await processMemberImage(dataUrl);
      if (!res.ok) {
        update(i, { uploading: false, recError: res.error });
        return;
      }
      const patch: Partial<MemberForm> = { uploading: false, image: res.image };
      if (res.recognition) {
        patch.ageGroup = res.recognition.ageGroup;
        patch.suggestLikes = res.recognition.suggestedLikes;
        patch.recNote = res.recognition.notes;
      }
      if (res.recognitionError) patch.recError = res.recognitionError;
      update(i, patch);
    } catch (e) {
      update(i, {
        uploading: false,
        recError: e instanceof Error ? e.message : "Không xử lý được ảnh.",
      });
    }
  };

  const chooseAvatar = (i: number, emoji: string) => {
    update(i, { image: EMOJI_PREFIX + emoji });
    setPickerFor(null);
  };

  const applySuggestedLikes = (i: number) =>
    setMembers((prev) =>
      prev.map((m, idx) => {
        if (idx !== i || !m.suggestLikes?.length) return m;
        const merged = [...new Set([...toList(m.likes), ...m.suggestLikes])];
        return { ...m, likes: merged.join(", "), suggestLikes: undefined };
      }),
    );

  const payload = JSON.stringify(
    members.map((m) => ({
      ...(m.id ? { id: m.id } : {}),
      name: m.name.trim(),
      image: m.image,
      ageGroup: m.ageGroup,
      allergies: toList(m.allergies),
      dietaryRestrictions: toList(m.dietaryRestrictions),
      likes: toList(m.likes),
      dislikes: toList(m.dislikes),
    })),
  );

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="members" value={payload} />

      <div className="space-y-5">
        {members.map((m, i) => (
          <div
            key={m.id ?? `new-${i}`}
            className="rounded-xl border border-zinc-200 bg-white p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-600">
                {m.name.trim() || `Người ${i + 1}`}
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

            <div className="flex gap-4">
              {/* Avatar + tải ảnh */}
              <div className="flex flex-col items-center gap-2">
                <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-zinc-100 text-2xl">
                  {m.uploading ? (
                    <span className="animate-pulse text-xs text-zinc-400">
                      …
                    </span>
                  ) : isEmojiAvatar(m.image) ? (
                    <span>{avatarEmoji(m.image)}</span>
                  ) : m.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.image}
                      alt={m.name || "avatar"}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span>🙂</span>
                  )}
                </div>
                <label className="cursor-pointer text-xs font-medium text-emerald-700 hover:underline">
                  {isEmojiAvatar(m.image) || !m.image ? "Tải ảnh" : "Đổi ảnh"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => onPickImage(i, e.target.files?.[0])}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setPickerFor(pickerFor === i ? null : i)}
                  className="text-xs text-zinc-500 hover:underline"
                >
                  Chọn avatar
                </button>
              </div>

              <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
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
                <Field
                  label="Dị ứng (cách nhau dấu phẩy)"
                  value={m.allergies}
                  onChange={(v) => update(i, { allergies: v })}
                  placeholder="tôm, đậu phộng"
                />
                <Field
                  label="Kiêng khem"
                  value={m.dietaryRestrictions}
                  onChange={(v) => update(i, { dietaryRestrictions: v })}
                  placeholder="ăn chay"
                />
                <Field
                  label="Thích"
                  value={m.likes}
                  onChange={(v) => update(i, { likes: v })}
                  placeholder="cá, rau xanh"
                />
                <Field
                  label="Ghét"
                  value={m.dislikes}
                  onChange={(v) => update(i, { dislikes: v })}
                  placeholder="mướp đắng"
                />
              </div>
            </div>

            {/* Bộ chọn avatar mặc định */}
            {pickerFor === i && (
              <div className="mt-3 rounded-lg border border-zinc-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-600">
                    Avatar có sẵn
                  </span>
                  <button
                    type="button"
                    onClick={() => setPickerFor(null)}
                    className="text-xs text-zinc-400 hover:underline"
                  >
                    Đóng
                  </button>
                </div>
                <div className="space-y-2">
                  {AVATAR_CATEGORIES.map((cat) => (
                    <div key={cat.label} className="flex items-center gap-2">
                      <span className="w-32 shrink-0 text-xs text-zinc-500">
                        {cat.label}
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {cat.emojis.map((emo) => (
                          <button
                            key={emo}
                            type="button"
                            onClick={() => chooseAvatar(i, emo)}
                            className={`flex h-9 w-9 items-center justify-center rounded-full border text-xl hover:bg-emerald-50 ${
                              m.image === EMOJI_PREFIX + emo
                                ? "border-emerald-500 bg-emerald-50"
                                : "border-zinc-200"
                            }`}
                          >
                            {emo}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Gợi ý từ nhận dạng ảnh */}
            {(m.recNote || m.suggestLikes?.length) && (
              <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                <span className="font-medium">Gợi ý từ ảnh: </span>
                {m.recNote}
                {m.suggestLikes?.length ? (
                  <>
                    {" "}
                    Món phù hợp: {m.suggestLikes.join(", ")}.{" "}
                    <button
                      type="button"
                      onClick={() => applySuggestedLikes(i)}
                      className="font-medium underline"
                    >
                      Điền vào “Thích”
                    </button>
                  </>
                ) : null}
              </div>
            )}
            {m.recError && (
              <p className="mt-2 text-xs text-amber-600">
                Đã lưu ảnh nhưng chưa nhận dạng được: {m.recError}
              </p>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setMembers((p) => [...p, { ...emptyMember }])}
        className="rounded-lg border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
      >
        + Thêm thành viên
      </button>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Đã lưu danh sách thành viên.
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {pending ? "Đang lưu…" : "Lưu thay đổi"}
        </button>
      </div>
    </form>
  );
}

function Field({
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
