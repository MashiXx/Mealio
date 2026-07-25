// Các tên chỉ cùng một nguyên liệu. Khoá VÀ giá trị đều ở dạng đã chuẩn hoá
// (normalizeIngredient: lowercase, bỏ dấu). Cố ý giữ nhỏ và thủ công — không
// nhằm giải bài toán khớp ngữ nghĩa, chỉ gom vài cặp hay gặp.

export const INGREDIENT_ALIASES: Record<string, string> = {
  "hanh hoa": "hanh la",
  "rau mui": "ngo",
  "dau hu": "dau phu",
  "dau hu non": "dau phu",
  "thit heo": "thit lon",
  "ca chua bi": "ca chua",
  "bap cai": "cai bap",
  "muop huong": "muop",
  "trai ot": "ot",
  "ot tuoi": "ot",
  "tom tuoi": "tom",
  "hanh tim": "hanh kho",
};

/** Quy tên đã chuẩn hoá về tên chuẩn. Không có trong bảng thì giữ nguyên. */
export function canonicalIngredient(normalized: string): string {
  return INGREDIENT_ALIASES[normalized] ?? normalized;
}
