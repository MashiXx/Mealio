import { normalizeIngredient } from "./normalize";
import { matchKey, staticKind } from "./pantry";

// Phân nhóm nguyên liệu để xếp danh sách đi chợ theo quầy: Thịt-Cá, Rau củ,
// Trái cây, Gia vị, Khác.
//
// KHÔNG mở rộng enum IngredientKind cho việc này. Cột đó đang lái logic kho
// (`MAIN` = "có đồ để nấu" ở chế độ AVAILABLE_ONLY, dùng trong missingFor và ở
// hai chốt chặn kho rỗng), nên nhét THIT_CA/RAU_CU vào là làm hỏng nghĩa của nó
// ở mọi chỗ đang so `kind === "MAIN"`. Đây là bảng tra THUẦN, không đụng schema.
//
// ĐỘ RỦI RO THẤP HƠN HẲN bảng gia vị: xếp nhầm nhóm chỉ làm một dòng hiện sai
// mục — thấy được và vô hại. Bảng gia vị thì xếp nhầm là nguyên liệu chính biến
// mất âm thầm khỏi danh sách đi chợ. Vì vậy ở đây được phép đoán rộng tay hơn.

export type IngredientGroup =
  | "THIT_CA"
  | "RAU_CU"
  | "TRAI_CAY"
  | "GIA_VI"
  | "KHAC";

export const GROUP_LABEL: Record<IngredientGroup, string> = {
  THIT_CA: "Thịt / Cá / Hải sản",
  RAU_CU: "Rau củ",
  TRAI_CAY: "Trái cây",
  GIA_VI: "Gia vị",
  KHAC: "Khác",
};

/** Thứ tự hiển thị, bám theo đường đi thường gặp trong chợ. */
export const GROUP_ORDER: IngredientGroup[] = [
  "THIT_CA",
  "RAU_CU",
  "TRAI_CAY",
  "GIA_VI",
  "KHAC",
];

/**
 * Khoá HAI TỪ, tra trước khoá một từ.
 *
 * Đây là chỗ gỡ bẫy trùng dấu: bỏ dấu xong "cá" và "cà" đều thành "ca", "dưa
 * hấu" và "dừa" và "dưa leo" đều bắt đầu bằng "dua". Một từ đầu là không đủ để
 * phân biệt, nên các ca đó phải khai bằng hai từ.
 */
const TWO_TOKEN: Record<string, IngredientGroup> = {
  // "ca" — cá (đạm) và cà (rau củ) đụng nhau sau khi bỏ dấu.
  "ca chua": "RAU_CU",
  "ca rot": "RAU_CU",
  "ca tim": "RAU_CU",
  "ca phao": "RAU_CU",
  "ca na": "RAU_CU",
  // "dua" — dưa hấu (trái cây), dưa leo / dưa cải (rau củ), dừa (khác).
  "dua hau": "TRAI_CAY",
  "dua luoi": "TRAI_CAY",
  "dua leo": "RAU_CU",
  "dua chuot": "RAU_CU",
  "dua cai": "RAU_CU",
  "dua gang": "RAU_CU",
  // "dau" — đậu hũ/đậu phụ là đạm, còn đậu bắp/đậu que là rau.
  "dau hu": "THIT_CA",
  "dau phu": "THIT_CA",
  "dau bap": "RAU_CU",
  "dau que": "RAU_CU",
  "dau co": "RAU_CU",
  // Từ đầu quá chung, phải kèm từ thứ hai mới rõ.
  "phi le": "THIT_CA",
  "tai heo": "THIT_CA",
  "ba chi": "THIT_CA",
  "nac vai": "THIT_CA",
  "thanh long": "TRAI_CAY",
  "xa lach": "RAU_CU",
  "bong cai": "RAU_CU",
  "sup lo": "RAU_CU",
  "su hao": "RAU_CU",
  "bo sua": "KHAC",
  "rong bien": "KHAC",
};

/** Khoá MỘT TỪ, chỉ dùng khi từ đầu đã đủ rõ nghĩa. */
const FIRST_TOKEN: Record<string, IngredientGroup> = {
  // Thịt / cá / hải sản
  thit: "THIT_CA",
  ca: "THIT_CA", // đã trừ các ca "cà ..." ở bảng hai từ
  tom: "THIT_CA",
  cua: "THIT_CA",
  muc: "THIT_CA",
  ngheu: "THIT_CA",
  oc: "THIT_CA",
  luon: "THIT_CA",
  ech: "THIT_CA",
  tep: "THIT_CA",
  suon: "THIT_CA",
  ga: "THIT_CA",
  vit: "THIT_CA",
  ngan: "THIT_CA",
  heo: "THIT_CA",
  lon: "THIT_CA",
  trung: "THIT_CA",
  gio: "THIT_CA",
  nem: "THIT_CA",
  // Rau củ
  rau: "RAU_CU",
  cai: "RAU_CU",
  khoai: "RAU_CU",
  bau: "RAU_CU",
  bi: "RAU_CU",
  muop: "RAU_CU",
  nam: "RAU_CU",
  gia: "RAU_CU",
  he: "RAU_CU",
  bap: "RAU_CU",
  ngo: "RAU_CU",
  sen: "RAU_CU",
  mang: "RAU_CU",
  hanh: "RAU_CU", // hành lá/khô là gia vị, đã bị isSeasoning bắt trước
  cu: "RAU_CU",
  // Trái cây
  chuoi: "TRAI_CAY",
  xoai: "TRAI_CAY",
  cam: "TRAI_CAY",
  tao: "TRAI_CAY",
  le: "TRAI_CAY",
  buoi: "TRAI_CAY",
  nho: "TRAI_CAY",
  oi: "TRAI_CAY",
  man: "TRAI_CAY",
  nhan: "TRAI_CAY",
  mit: "TRAI_CAY",
  quyt: "TRAI_CAY",
  kiwi: "TRAI_CAY",
};

/**
 * Nhóm của một nguyên liệu theo TÊN. Không biết thì trả "KHAC" — thà xếp vào
 * mục Khác còn hơn đoán bừa vào một quầy sai.
 */
export function ingredientGroup(name: string): IngredientGroup {
  // Gia vị hỏi ĐÚNG nguồn mà cả kho lẫn danh sách đi chợ đang dùng, để ba nơi
  // không trôi lệch nhau.
  if (staticKind(matchKey(name)) === "SEASONING") return "GIA_VI";

  const tokens = normalizeIngredient(name).split(" ").filter(Boolean);
  if (tokens.length === 0) return "KHAC";

  if (tokens.length >= 2) {
    const two = TWO_TOKEN[`${tokens[0]} ${tokens[1]}`];
    if (two) return two;
  }
  return FIRST_TOKEN[tokens[0]] ?? "KHAC";
}
