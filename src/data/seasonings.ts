// Nguyên liệu coi như LUÔN CÓ trong bếp: gia vị, đồ khô, rau thơm ăn kèm.
// Không bị verify, không vào danh sách đi chợ tự động, không rời kho sau khi nấu.
// Viết ở dạng đã chuẩn hoá (không dấu) để so khớp trực tiếp.
//
// CẢNH BÁO BẪY TRÙNG DẤU: normalizeIngredient() bỏ hết dấu tiếng Việt, nên hai
// từ khác nghĩa có thể trùng khoá sau chuẩn hoá — vd "ngô" (bắp, nguyên liệu
// chính) và "ngò" (rau mùi, gia vị) cùng ra "ngo"; "mè", "me" (quả me nấu canh
// chua), "mẻ" cùng ra "me". Trước khi thêm một mục mới, kiểm tra xem bản không
// dấu của nó có trùng với một nguyên liệu CHÍNH phổ biến khác không — nếu có,
// ĐỪNG thêm vào đây. Bỏ sót thì cùng lắm dư một dòng trong danh sách đi chợ
// (thấy được, sửa được bằng nút "đổi nhóm"); thêm nhầm thì nguyên liệu chính
// biến mất khỏi danh sách đi chợ một cách âm thầm và người dùng không có cách
// nào biết.
export const SEASONINGS: readonly string[] = [
  "muoi", "duong", "nuoc mam", "nuoc tuong", "xi dau", "dau an", "dau me",
  "tieu", "hat tieu", "bot ngot", "hat nem", "bot canh", "giam", "mi chinh",
  "toi", "hanh kho", "gung", "sa", "ot", "chanh",
  "hanh la", "thi la", "rau ram", "tia to", "la chanh",
  "bot nghe", "bot ca ri", "ngu vi huong", "mat ong", "tuong ot", "tuong ca",
  "ruou nau", "bot nang", "bot bap", "dau hao", "dau phong rang",
];

const SEASONING_SET = new Set(SEASONINGS);

/** name phải là chuỗi ĐÃ chuẩn hoá + đã qua canonicalIngredient. */
export function isSeasoning(canonicalName: string): boolean {
  return SEASONING_SET.has(canonicalName);
}
