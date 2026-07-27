import { describe, it, expect } from "vitest";
import { ingredientGroup, GROUP_ORDER, GROUP_LABEL } from "./ingredient-group";

describe("ingredientGroup", () => {
  it("gia vị hỏi đúng nguồn chung, không tự dựng bảng riêng", () => {
    expect(ingredientGroup("nước mắm")).toBe("GIA_VI");
    expect(ingredientGroup("hành lá")).toBe("GIA_VI");
    // hành hoa -> hành lá qua bảng đồng nghĩa của matchKey
    expect(ingredientGroup("hành hoa")).toBe("GIA_VI");
  });

  // Bẫy chính: bỏ dấu xong "cá" và "cà" đều thành "ca".
  it("phân biệt được cá và cà sau khi bỏ dấu", () => {
    expect(ingredientGroup("cá diêu hồng")).toBe("THIT_CA");
    expect(ingredientGroup("cá basa")).toBe("THIT_CA");
    expect(ingredientGroup("cà chua")).toBe("RAU_CU");
    expect(ingredientGroup("cà rốt")).toBe("RAU_CU");
    expect(ingredientGroup("cà tím")).toBe("RAU_CU");
  });

  // Bẫy thứ hai: dưa hấu / dưa leo / dừa cùng bắt đầu bằng "dua".
  it("phân biệt được dưa hấu, dưa leo và dừa", () => {
    expect(ingredientGroup("dưa hấu")).toBe("TRAI_CAY");
    expect(ingredientGroup("dưa leo")).toBe("RAU_CU");
    expect(ingredientGroup("nước dừa tươi")).toBe("KHAC");
  });

  it("đậu hũ là đạm, đậu bắp là rau", () => {
    expect(ingredientGroup("đậu hũ trắng")).toBe("THIT_CA");
    expect(ingredientGroup("đậu phụ")).toBe("THIT_CA");
    expect(ingredientGroup("đậu bắp")).toBe("RAU_CU");
  });

  // Toàn bộ danh sách đi chợ trong task.txt, đúng nhóm mà bản gốc xếp.
  it("xếp đúng nhóm cho danh sách đi chợ thật", () => {
    const thit = [
      "Sườn heo non",
      "Thịt nạc vai heo",
      "Tôm tươi",
      "Phi lê ức gà",
      "Thịt thăn bò",
      "Gà ta thả vườn",
      "Tai heo",
    ];
    const rau = [
      "Bông cải xanh",
      "Khoai tây",
      "Bầu",
      "Nấm đông cô",
      "Xà lách",
      "Su hào",
      "Cải ngọt",
      "Hành tây",
      "Cải bó xôi",
      "Mướp đắng",
      "Giá đỗ",
      "Rau hẹ",
      "Bí đỏ",
      "Bắp cải trắng",
    ];
    const qua = [
      "Thanh long ruột đỏ",
      "Xoài chín",
      "Cam tươi",
      "Chuối tiêu",
      "Lê tươi",
      "Táo xanh",
    ];
    for (const n of thit) expect([n, ingredientGroup(n)]).toEqual([n, "THIT_CA"]);
    for (const n of rau) expect([n, ingredientGroup(n)]).toEqual([n, "RAU_CU"]);
    for (const n of qua) expect([n, ingredientGroup(n)]).toEqual([n, "TRAI_CAY"]);
  });

  it("không biết thì về Khác chứ không đoán bừa", () => {
    expect(ingredientGroup("rong biển khô")).toBe("KHAC");
    expect(ingredientGroup("xyz lạ hoắc")).toBe("KHAC");
    expect(ingredientGroup("")).toBe("KHAC");
  });
});

describe("GROUP_ORDER", () => {
  it("phủ đủ mọi nhóm và không lặp", () => {
    expect(new Set(GROUP_ORDER).size).toBe(GROUP_ORDER.length);
    expect(GROUP_ORDER.length).toBe(Object.keys(GROUP_LABEL).length);
  });
});
