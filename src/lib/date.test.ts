import { describe, it, expect, afterEach } from "vitest";
import { ymd, localMidnight } from "./date";

// Test PHẢI tự ép TZ chứ không dựa vào máy chạy: container prod đang là UTC (chỗ
// mà lỗi lệch ngày tàng hình), còn máy dev ở UTC+7 (chỗ nó lộ ra). Không ép thì
// cùng một bộ test lúc xanh lúc đỏ tuỳ ai chạy — đúng kiểu lỗi này đã trốn được.

const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

function withTZ(tz: string, fn: () => void): void {
  process.env.TZ = tz;
  fn();
}

describe("ymd", () => {
  // Ca đã làm hỏng nút "Xoá cả ngày": ở múi giờ DƯƠNG, nửa đêm địa phương rơi vào
  // hôm trước tính theo UTC, nên công thức cũ (toISOString) trả về sai một ngày.
  it("giữ đúng ngày ở múi giờ dương (UTC+7)", () => {
    withTZ("Asia/Ho_Chi_Minh", () => {
      expect(ymd(new Date(2026, 6, 27))).toBe("2026-07-27");
    });
  });

  // Múi giờ âm vô tình vẫn đúng với công thức cũ — giữ ca này để bản sửa không
  // chỉ dịch lỗi sang phía bên kia.
  it("giữ đúng ngày ở múi giờ âm (UTC-4)", () => {
    withTZ("America/New_York", () => {
      expect(ymd(new Date(2026, 6, 27))).toBe("2026-07-27");
    });
  });

  it("giữ đúng ngày ở UTC", () => {
    withTZ("UTC", () => {
      expect(ymd(new Date(2026, 6, 27))).toBe("2026-07-27");
    });
  });

  it("đệm 0 cho tháng và ngày một chữ số", () => {
    withTZ("Asia/Ho_Chi_Minh", () => {
      expect(ymd(new Date(2026, 0, 5))).toBe("2026-01-05");
    });
  });
});

describe("localMidnight", () => {
  it("trả về đúng nửa đêm theo giờ địa phương", () => {
    withTZ("Asia/Ho_Chi_Minh", () => {
      const d = localMidnight("2026-07-27");
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(6);
      expect(d.getDate()).toBe(27);
      expect(d.getHours()).toBe(0);
    });
  });
});

describe("khứ hồi ymd <-> localMidnight", () => {
  // Đây là bất biến thật sự bị vi phạm: dashboard sinh chuỗi ngày cho nút xoá
  // bằng ymd, còn action đọc lại bằng localMidnight. Hai hàm lệch nhau thì câu
  // truy vấn không khớp mâm nào và nút xoá im lặng không làm gì.
  for (const tz of ["Asia/Ho_Chi_Minh", "UTC", "America/New_York"]) {
    it(`khớp nhau ở ${tz}`, () => {
      withTZ(tz, () => {
        for (const key of ["2026-07-27", "2026-01-01", "2026-12-31"]) {
          expect(ymd(localMidnight(key))).toBe(key);
        }
      });
    });
  }
});
