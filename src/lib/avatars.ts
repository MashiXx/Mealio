// Avatar mặc định theo loại thành viên (dùng emoji để không phụ thuộc asset
// ngoài, chạy offline). Lưu trong trường FamilyMember.image dạng "emoji:👴".
// Ảnh upload thật vẫn lưu dạng đường dẫn "/uploads/...".

export const EMOJI_PREFIX = "emoji:";

export type AvatarCategory = {
  label: string;
  ageGroup: string; // gợi ý nhóm tuổi khi chọn
  emojis: string[];
};

export const AVATAR_CATEGORIES: AvatarCategory[] = [
  { label: "Ông", ageGroup: "SENIOR", emojis: ["👴", "👴🏻", "👴🏽", "🧓"] },
  { label: "Bà", ageGroup: "SENIOR", emojis: ["👵", "👵🏻", "👵🏽", "🧓🏽"] },
  { label: "Bố", ageGroup: "ADULT", emojis: ["👨", "👨🏽", "🧔", "👨‍🦱"] },
  { label: "Mẹ", ageGroup: "ADULT", emojis: ["👩", "👩🏻", "👩🏽", "👩‍🦱"] },
  { label: "Con trai", ageGroup: "CHILD", emojis: ["👦", "👦🏻", "👦🏽", "🧒"] },
  { label: "Con gái", ageGroup: "CHILD", emojis: ["👧", "👧🏻", "👧🏽", "👧🏿"] },
  { label: "Em bé", ageGroup: "BABY", emojis: ["👶", "👶🏻", "👶🏽", "👶🏿"] },
  {
    label: "Thanh thiếu niên",
    ageGroup: "TEEN",
    emojis: ["🧑", "🧑🏽", "🧑‍🎓", "👱"],
  },
];

export function isEmojiAvatar(image?: string | null): boolean {
  return Boolean(image?.startsWith(EMOJI_PREFIX));
}

export function avatarEmoji(image?: string | null): string {
  return image?.slice(EMOJI_PREFIX.length) ?? "";
}
