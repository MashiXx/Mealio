import { describe, it, expect, afterEach } from "vitest";
import { aiTimeoutMs, staleJobMs } from "./timeout";

const KEY = "MEALIO_AI_TIMEOUT_MS";

afterEach(() => {
  delete process.env[KEY];
});

describe("aiTimeoutMs", () => {
  it("mặc định 8 phút khi không đặt env", () => {
    expect(aiTimeoutMs()).toBe(8 * 60 * 1000);
  });

  it("đọc được giá trị từ env", () => {
    process.env[KEY] = "300000";
    expect(aiTimeoutMs()).toBe(300000);
  });

  it("giá trị rác hoặc <= 0 rơi về mặc định", () => {
    for (const bad of ["abc", "0", "-1", ""]) {
      process.env[KEY] = bad;
      expect(aiTimeoutMs(), `env=${bad}`).toBe(8 * 60 * 1000);
    }
  });
});

describe("staleJobMs", () => {
  // Đây là bất biến giữ cho lỗi cũ không quay lại: reaper từng giết job đang
  // chạy đàng hoàng vì ngưỡng treo ngắn hơn thời gian AI cần.
  it("LUÔN dài hơn một lời gọi AI", () => {
    expect(staleJobMs()).toBeGreaterThan(aiTimeoutMs());
  });

  it("phủ được job hai lời gọi (đường một ngày có retry kho)", () => {
    expect(staleJobMs()).toBeGreaterThanOrEqual(aiTimeoutMs() * 2);
  });

  it("giữ quan hệ đó kể cả khi env chỉnh ngưỡng", () => {
    for (const v of ["60000", "600000", "1800000"]) {
      process.env[KEY] = v;
      expect(staleJobMs(), `env=${v}`).toBeGreaterThanOrEqual(
        aiTimeoutMs() * 2,
      );
    }
  });
});
