import { describe, it, expect } from "vitest";
import { resolveDishVisual, ROLE_VISUAL } from "./dish-image";

describe("fallback khi không khớp món nào", () => {
  it("món lạ hoàn toàn trả emoji + gradient theo vai trò, slug null", () => {
    const v = resolveDishVisual("Món do AI bịa ra chưa từng có", "CANH_SUP");
    expect(v.slug).toBeNull();
    expect(v.imageUrl).toBeNull();
    expect(v.credit).toBeNull();
    expect(v.emoji).toBe(ROLE_VISUAL.CANH_SUP.emoji);
    expect(v.gradientClass).toBe(ROLE_VISUAL.CANH_SUP.gradientClass);
  });

  it("vai trò lạ không ném lỗi, dùng emoji trung tính", () => {
    const v = resolveDishVisual("Món lạ", "VAI_TRO_KHONG_TON_TAI");
    expect(v.emoji).toBe("🍽️");
    expect(v.gradientClass).toContain("bg-gradient");
  });

  it("đủ 9 vai trò đều có emoji và gradient riêng", () => {
    const roles = [
      "MON_MAN",
      "MON_XAO",
      "CANH_SUP",
      "RAU_LUOC",
      "LAU",
      "COM_BUN_PHO",
      "MON_CUON",
      "TRANG_MIENG",
      "DO_CHUA",
    ];
    for (const r of roles) {
      expect(ROLE_VISUAL[r]).toBeDefined();
      expect(ROLE_VISUAL[r].emoji).toBeTruthy();
      expect(ROLE_VISUAL[r].gradientClass).toContain("bg-gradient");
    }
  });
});
