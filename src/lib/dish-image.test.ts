import { describe, it, expect } from "vitest";
import { resolveDishVisual, pickHeroDish, ROLE_VISUAL } from "./dish-image";

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

describe("resolveDishVisual gắn ảnh khi khớp được món", () => {
  it("món có ảnh trả imageUrl kèm ghi công", () => {
    const v = resolveDishVisual("Cá kho tộ", "MON_MAN");
    expect(v.slug).toBe("ca-kho-to");
    expect(v.imageUrl).toBe("/dishes/ca-kho-to.jpg");
    expect(v.credit).toBeTruthy();
  });

  // Fixture phải là món CHƯA có ảnh. Nếu sau này ghim được ảnh cho ga-kho-gung
  // thì đổi sang một slug khác còn trống trong image-credits.json.
  it("món khớp nhưng chưa có ảnh rơi về fallback, slug vẫn điền", () => {
    const v = resolveDishVisual("thịt gà kho gừng", "MON_MAN");
    expect(v.slug).toBe("ga-kho-gung");
    expect(v.imageUrl).toBeNull();
    expect(v.emoji).toBe(ROLE_VISUAL.MON_MAN.emoji);
  });

  it("món hoàn toàn lạ rơi về fallback, slug null", () => {
    const v = resolveDishVisual("Món AI bịa chưa từng có", "CANH_SUP");
    expect(v.slug).toBeNull();
    expect(v.imageUrl).toBeNull();
  });
});

describe("pickHeroDish", () => {
  const d = (id: string, name: string, dishRole: string) => ({
    id,
    name,
    dishRole,
  });

  it("chọn theo thứ tự ưu tiên vai trò khi không món nào có ảnh", () => {
    const dishes = [
      d("1", "Món canh lạ", "CANH_SUP"),
      d("2", "Món mặn lạ", "MON_MAN"),
      d("3", "Món rau lạ", "RAU_LUOC"),
    ];
    expect(pickHeroDish(dishes)?.id).toBe("2");
  });

  it("ưu tiên món CÓ ảnh thật hơn món cùng nhóm không ảnh", () => {
    const dishes = [
      d("1", "Món mặn AI bịa", "MON_MAN"),
      d("2", "Canh chua cá", "CANH_SUP"),
    ];
    expect(pickHeroDish(dishes)?.id).toBe("2");
  });

  it("không để tráng miệng/đồ chua làm hero dù có ảnh", () => {
    const dishes = [
      d("1", "Món mặn AI bịa", "MON_MAN"),
      d("2", "Chè chuối", "TRANG_MIENG"),
    ];
    expect(pickHeroDish(dishes)?.id).toBe("1");
  });

  it("mâm một món trả chính món đó", () => {
    expect(pickHeroDish([d("1", "Món lạ", "RAU_LUOC")])?.id).toBe("1");
  });

  it("mâm rỗng trả null", () => {
    expect(pickHeroDish([])).toBeNull();
  });
});

describe("bất biến toàn catalog", () => {
  it("mọi món có ảnh đều có ghi công", async () => {
    const { allDishes } = await import("@/data/catalog");
    for (const d of allDishes) {
      if (d.imageUrl) expect(d.imageCredit, `món ${d.slug}`).toBeTruthy();
    }
  });
});
