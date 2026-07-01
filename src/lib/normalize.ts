// Chuẩn hoá tên nguyên liệu để so khớp: lowercase, bỏ dấu tiếng Việt, gộp
// khoảng trắng. Dùng cho Ingredient.normalized (@@unique[familyId, normalized])
// nhằm gộp "Thịt Bò", "thit bo", "thịt  bò" về cùng một nguyên liệu.

export function normalizeIngredient(name: string): string {
  return name
    .normalize("NFD") // tách ký tự + dấu
    .replace(/[̀-ͯ]/g, "") // bỏ dấu thanh/nguyên âm (combining marks)
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ") // bỏ ký tự lạ
    .replace(/\s+/g, " ")
    .trim();
}
