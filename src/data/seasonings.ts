import { normalizeIngredient } from "@/lib/normalize";

// Nguyên liệu coi như LUÔN CÓ trong bếp: gia vị, đồ khô, rau thơm ăn kèm.
// Không bị verify, không vào danh sách đi chợ tự động, không rời kho sau khi nấu.
//
// NGUỒN CHÂN LÝ DUY NHẤT, viết ở dạng CÓ DẤU. Hai chỗ tiêu thụ nó cần hai dạng
// khác nhau nên đừng tách thành hai mảng: prompt gửi AI in nguyên văn có dấu
// (bảo model "gia vị luôn có" mà viết "nuoc mam" thì đọc như lỗi), còn isSeasoning
// so khớp trên dạng đã chuẩn hoá. Trước đây prompt hardcode 7 thứ trong khi bảng
// này có 36 -> prompt vô tình CẤM gừng, sả, hành lá, chanh, ớt, đẩy model sang vi
// phạm chính cái luật cứng vừa đặt ra.
//
// CẢNH BÁO BẪY TRÙNG DẤU: normalizeIngredient() bỏ hết dấu tiếng Việt, nên hai
// từ khác nghĩa có thể trùng khoá sau chuẩn hoá — vd "ngô" (bắp, nguyên liệu
// chính) và "ngò" (rau mùi, gia vị) cùng ra "ngo"; "mè", "me" (quả me nấu canh
// chua), "mẻ" cùng ra "me". Trước khi thêm một mục mới, kiểm tra xem bản không
// dấu của nó có trùng với một nguyên liệu CHÍNH phổ biến khác không — nếu có,
// ĐỪNG thêm vào đây. Bỏ sót thì cùng lắm dư một dòng trong danh sách đi chợ
// (thấy được, sửa được bằng nút "đổi nhóm"); thêm nhầm thì nguyên liệu chính
// biến mất khỏi danh sách đi chợ một cách âm thầm và người dùng không có cách
// nào biết. Vì vậy "ngò" và "mè" CỐ Ý vắng mặt — đừng thêm lại.
export const SEASONINGS_VI: readonly string[] = [
  "muối", "đường", "nước mắm", "nước tương", "xì dầu", "dầu ăn", "dầu mè",
  "tiêu", "hạt tiêu", "bột ngọt", "hạt nêm", "bột canh", "giấm", "mì chính",
  "tỏi", "hành khô", "gừng", "sả", "ớt", "chanh",
  "hành lá", "thì là", "rau răm", "tía tô", "lá chanh",
  "bột nghệ", "bột cà ri", "ngũ vị hương", "mật ong", "tương ớt", "tương cà",
  "rượu nấu", "bột năng", "bột bắp", "dầu hào", "đậu phộng rang",
];

const SEASONING_SET = new Set(SEASONINGS_VI.map(normalizeIngredient));

/** name phải là chuỗi ĐÃ chuẩn hoá + đã qua canonicalIngredient. */
export function isSeasoning(canonicalName: string): boolean {
  return SEASONING_SET.has(canonicalName);
}
