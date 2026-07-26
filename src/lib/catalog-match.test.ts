import { describe, it, expect } from "vitest";
import { findCatalogDish } from "./catalog-match";

describe("khớp tên chính xác", () => {
  it("khớp đúng tên món", () => {
    expect(findCatalogDish("Cá kho tộ", "MON_MAN")?.slug).toBe("ca-kho-to");
  });

  it("bỏ qua khác biệt dấu và hoa thường", () => {
    expect(findCatalogDish("CÁ KHO TỘ", "MON_MAN")?.slug).toBe("ca-kho-to");
    expect(findCatalogDish("ca kho to", "MON_MAN")?.slug).toBe("ca-kho-to");
  });

  it("khớp tên đúng thì không cần trùng vai trò", () => {
    expect(findCatalogDish("Cá kho tộ", "CANH_SUP")?.slug).toBe("ca-kho-to");
  });
});

describe("khớp qua alias", () => {
  it("alias trỏ đúng món", () => {
    expect(findCatalogDish("Cá kho", "MON_MAN")?.slug).toBe("ca-kho-to");
  });

  it("alias của món khác cũng khớp", () => {
    expect(findCatalogDish("thịt gà kho gừng", "MON_MAN")?.slug).toBe(
      "ga-kho-gung",
    );
  });
});

describe("biến thể ngoặc đơn", () => {
  // "Thịt kho tàu (thịt kho trứng)" chuẩn hoá thành chuỗi dính
  // "thit kho tau thit kho trung" -> không tách ngoặc thì món phổ biến nhất
  // trong catalog sẽ trượt sạch cả ba tầng.
  it("khớp phần ngoài ngoặc", () => {
    expect(findCatalogDish("Thịt kho tàu", "MON_MAN")?.slug).toBe(
      "thit-kho-tau",
    );
  });

  it("khớp phần trong ngoặc", () => {
    expect(findCatalogDish("Chả giò", "MON_CUON")?.slug).toBe("nem-ran");
    expect(findCatalogDish("Nem rán", "MON_CUON")?.slug).toBe("nem-ran");
  });

  it("vẫn khớp cả tên gốc đầy đủ", () => {
    expect(findCatalogDish("Nem rán (chả giò)", "MON_CUON")?.slug).toBe(
      "nem-ran",
    );
  });
});

describe("khớp chứa có canh gác", () => {
  it("tên dài chứa trọn tên catalog, đúng vai trò -> trúng", () => {
    expect(findCatalogDish("Thịt kho tàu kiểu miền Nam", "MON_MAN")?.slug).toBe(
      "thit-kho-tau",
    );
  });

  it("chứa nhưng SAI vai trò -> trượt", () => {
    // Vai trò là chốt chặn chính chống gán nhầm cho món chỉ trùng chữ.
    expect(
      findCatalogDish("Thịt kho tàu kiểu miền Nam", "TRANG_MIENG"),
    ).toBeNull();
  });

  it("khoá ngắn dưới ngưỡng không được dùng để khớp chứa", () => {
    expect(findCatalogDish("Cá", "MON_MAN")).toBeNull();
  });

  it("không khớp giữa từ", () => {
    expect(findCatalogDish("Bánh comgaxx nướng", "COM_BUN_PHO")).toBeNull();
  });

  it("khoá dài được ưu tiên hơn khoá ngắn", () => {
    expect(findCatalogDish("Món canh chua cá đặc biệt", "CANH_SUP")?.slug).toBe(
      "canh-chua-ca",
    );
  });

  it("tên rỗng hoặc chỉ ký tự lạ trả null, không nổ", () => {
    expect(findCatalogDish("", "MON_MAN")).toBeNull();
    expect(findCatalogDish("!!!", "MON_MAN")).toBeNull();
  });
});

describe("dữ liệu dùng được cho việc nở khung", () => {
  it("món khớp mang đủ nguyên liệu và các bước", () => {
    const d = findCatalogDish("Cá kho tộ", "MON_MAN");
    expect(d).not.toBeNull();
    expect(d!.ingredients.length).toBeGreaterThan(0);
    expect(d!.steps.length).toBeGreaterThan(0);
    expect(d!.cookMinutes).toBeGreaterThan(0);
  });
});
