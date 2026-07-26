// Quy đổi giữa Date và chuỗi ngày "yyyy-mm-dd" — MỘT nguồn sự thật duy nhất.
//
// Bất biến của repo: PlannedMeal.date (và GenerationJob.date) luôn là nửa đêm
// theo giờ ĐỊA PHƯƠNG của máy chủ, xem saveMenu. Mọi chỗ quy đổi phải bám đúng
// giờ địa phương ở CẢ HAI chiều.
//
// Vì sao gom vào đây: trước đó chiều Date -> chuỗi bị chép làm hai bản ở
// dashboard và history, cả hai đều dùng toISOString() tức giờ UTC, trong khi
// chiều ngược lại lại parse theo giờ địa phương. Hai chiều lệch nhau thì nút
// "Xoá cả ngày" gửi lên một ngày mà truy vấn không khớp mâm nào -> bấm xong
// không có gì xảy ra, còn ngày hiển thị thì lùi một hôm.
//
// Lệch chỉ lộ ra ở múi giờ DƯƠNG: nửa đêm ở UTC+7 là 17:00 hôm trước theo UTC,
// nên toISOString() trả về hôm trước. Ở UTC (container prod hiện tại) và ở múi
// giờ âm thì hai cách tình cờ trùng nhau — đó là lý do lỗi này sống sót lâu.

/** Date -> "yyyy-mm-dd" theo giờ ĐỊA PHƯƠNG. Không dùng toISOString (giờ UTC). */
export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "yyyy-mm-dd" -> nửa đêm giờ ĐỊA PHƯƠNG, khớp cách date được lưu trong DB. */
export function localMidnight(key: string): Date {
  return new Date(`${key}T00:00:00`);
}
