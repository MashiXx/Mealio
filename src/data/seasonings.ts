// Nguyên liệu coi như LUÔN CÓ trong bếp: gia vị, đồ khô, rau thơm ăn kèm.
// Không bị verify, không vào danh sách đi chợ tự động, không rời kho sau khi nấu.
// Viết ở dạng đã chuẩn hoá (không dấu) để so khớp trực tiếp.

export const SEASONINGS: readonly string[] = [
  "muoi", "duong", "nuoc mam", "nuoc tuong", "xi dau", "dau an", "dau me",
  "tieu", "hat tieu", "bot ngot", "hat nem", "bot canh", "giam", "mi chinh",
  "toi", "hanh kho", "gung", "sa", "ot", "chanh",
  "hanh la", "ngo", "thi la", "rau ram", "tia to", "la chanh",
  "bot nghe", "bot ca ri", "ngu vi huong", "mat ong", "tuong ot", "tuong ca",
  "ruou nau", "bot nang", "bot bap", "dau hao", "me", "dau phong rang",
];

const SEASONING_SET = new Set(SEASONINGS);

/** name phải là chuỗi ĐÃ chuẩn hoá + đã qua canonicalIngredient. */
export function isSeasoning(canonicalName: string): boolean {
  return SEASONING_SET.has(canonicalName);
}
