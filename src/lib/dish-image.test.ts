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

describe("khớp tên chính xác", () => {
  it("khớp đúng tên món có ảnh, trả kèm ghi công", () => {
    const v = resolveDishVisual("Cá kho tộ", "MON_MAN");
    expect(v.slug).toBe("ca-kho-to");
    expect(v.imageUrl).toBe("/dishes/ca-kho-to.jpg");
    expect(v.credit).toBeTruthy();
  });

  it("bỏ qua khác biệt dấu và hoa thường", () => {
    expect(resolveDishVisual("CÁ KHO TỘ", "MON_MAN").slug).toBe("ca-kho-to");
    expect(resolveDishVisual("ca kho to", "MON_MAN").slug).toBe("ca-kho-to");
  });

  it("khớp tên đúng thì không cần trùng vai trò", () => {
    // Tầng 1 tin tên tuyệt đối; chỉ tầng khớp chứa mới cần vai trò canh gác.
    expect(resolveDishVisual("Cá kho tộ", "CANH_SUP").slug).toBe("ca-kho-to");
  });
});

describe("khớp qua alias", () => {
  it("alias trỏ đúng món", () => {
    const v = resolveDishVisual("Cá kho", "MON_MAN");
    expect(v.slug).toBe("ca-kho-to");
    expect(v.imageUrl).toBe("/dishes/ca-kho-to.jpg");
  });

  it("alias của món chưa có ảnh vẫn khớp nhưng rơi về fallback ảnh", () => {
    const v = resolveDishVisual("sườn heo xào chua ngọt", "MON_MAN");
    expect(v.slug).toBe("suon-xao-chua-ngot");
    expect(v.imageUrl).toBeNull();
    expect(v.emoji).toBe(ROLE_VISUAL.MON_MAN.emoji);
  });
});

describe("biến thể ngoặc đơn", () => {
  // "Thịt kho tàu (thịt kho trứng)" chuẩn hoá thành chuỗi dính
  // "thit kho tau thit kho trung" -> không tách ngoặc thì món phổ biến nhất
  // trong catalog, lại đang CÓ ảnh, sẽ trượt sạch cả ba tầng.
  it("khớp phần ngoài ngoặc", () => {
    const v = resolveDishVisual("Thịt kho tàu", "MON_MAN");
    expect(v.slug).toBe("thit-kho-tau");
    expect(v.imageUrl).toBe("/dishes/thit-kho-tau.jpg");
  });

  it("khớp phần trong ngoặc", () => {
    expect(resolveDishVisual("Chả giò", "MON_CUON").slug).toBe("nem-ran");
    expect(resolveDishVisual("Nem rán", "MON_CUON").slug).toBe("nem-ran");
  });

  it("vẫn khớp cả tên gốc đầy đủ", () => {
    expect(resolveDishVisual("Nem rán (chả giò)", "MON_CUON").slug).toBe(
      "nem-ran",
    );
  });
});

describe("khớp chứa có canh gác", () => {
  it("tên AI dài chứa trọn tên catalog, đúng vai trò -> trúng", () => {
    const v = resolveDishVisual("Thịt kho tàu kiểu miền Nam", "MON_MAN");
    expect(v.slug).toBe("thit-kho-tau");
    expect(v.imageUrl).toBe("/dishes/thit-kho-tau.jpg");
  });

  it("chứa nhưng SAI vai trò -> trượt", () => {
    // Cùng chuỗi trên, chỉ đổi vai trò. Vai trò là chốt chặn chính chống gán
    // nhầm ảnh cho món chỉ trùng chữ.
    const v = resolveDishVisual("Thịt kho tàu kiểu miền Nam", "TRANG_MIENG");
    expect(v.slug).toBeNull();
    expect(v.imageUrl).toBeNull();
  });

  it("khoá ngắn dưới ngưỡng không được dùng để khớp chứa", () => {
    // "Cá" quá ngắn, nếu lọt sẽ nuốt mọi món có chữ cá.
    expect(resolveDishVisual("Cá", "MON_MAN").slug).toBeNull();
  });

  it("không khớp giữa từ", () => {
    // Chuỗi con "com ga" nằm trong "comgaxx" nhưng không phải ranh giới từ.
    expect(resolveDishVisual("Bánh comgaxx nướng", "COM_BUN_PHO").slug).toBeNull();
  });

  it("khoá dài được ưu tiên hơn khoá ngắn", () => {
    const v = resolveDishVisual("Món canh chua cá đặc biệt", "CANH_SUP");
    expect(v.slug).toBe("canh-chua-ca");
  });

  it("tên rỗng hoặc chỉ ký tự lạ trả fallback, không nổ", () => {
    expect(resolveDishVisual("", "MON_MAN").slug).toBeNull();
    expect(resolveDishVisual("!!!", "MON_MAN").slug).toBeNull();
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
