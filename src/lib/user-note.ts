// Chuẩn hoá "gợi ý cho lần này" người dùng gõ ở form tạo thực đơn.
//
// Cắt ở SERVER chứ không chỉ đặt maxLength trên input: maxLength là gợi ý giao
// diện, ai gọi thẳng server action vẫn nhét được chuỗi dài tuỳ ý và làm phình
// prompt.

/** Số ký tự tối đa của một gợi ý. Đủ cho vài câu, không đủ để nhồi prompt. */
export const USER_NOTE_MAX = 300;

/**
 * Trim, cắt về `USER_NOTE_MAX`, và quy chuỗi rỗng/toàn khoảng trắng về null.
 * null có nghĩa "không có gợi ý" — prompt sẽ bỏ hẳn khối đó thay vì in dòng trống.
 */
export function normalizeUserNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, USER_NOTE_MAX);
}
