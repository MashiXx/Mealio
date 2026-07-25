import { describe, it, expect } from "vitest";
import {
  matchKey,
  toPantrySet,
  missingFor,
  mergeNeeds,
  suggestFromPantry,
} from "./pantry";

describe("matchKey", () => {
  it("bỏ dấu và hạ chữ thường", () => {
    expect(matchKey("Cà Chua")).toBe("ca chua");
  });

  it("quy tên đồng nghĩa về tên chuẩn", () => {
    expect(matchKey("hành hoa")).toBe("hanh la");
    expect(matchKey("đậu hũ")).toBe("dau phu");
  });
});

describe("missingFor", () => {
  const pantry = toPantrySet(["cá thu", "đậu phụ", "cà chua"]);

  it("trả rỗng khi kho có đủ nguyên liệu chính", () => {
    const needs = [
      { name: "Cá thu", quantity: 500, unit: "g" },
      { name: "Cà chua", quantity: 2, unit: "quả" },
    ];
    expect(missingFor(needs, pantry)).toEqual([]);
  });

  it("chỉ ra nguyên liệu chính không có trong kho", () => {
    const needs = [
      { name: "Thịt bò", quantity: 300, unit: "g" },
      { name: "Cá thu", quantity: 500, unit: "g" },
    ];
    expect(missingFor(needs, pantry).map((n) => n.name)).toEqual(["Thịt bò"]);
  });

  it("không bao giờ coi gia vị là thiếu", () => {
    const needs = [
      { name: "Nước mắm", quantity: 2, unit: "thìa" },
      { name: "Tỏi", quantity: 3, unit: "tép" },
      { name: "Hành lá", quantity: 1, unit: "nhánh" },
    ];
    expect(missingFor(needs, pantry)).toEqual([]);
  });

  it("khớp qua bảng đồng nghĩa", () => {
    const needs = [{ name: "Đậu hũ", quantity: 1, unit: "bìa" }];
    expect(missingFor(needs, pantry)).toEqual([]);
  });
});

describe("mergeNeeds", () => {
  it("cộng số lượng khi cùng nguyên liệu và cùng đơn vị", () => {
    const merged = mergeNeeds([
      { name: "Cà chua", quantity: 2, unit: "quả" },
      { name: "cà chua", quantity: 3, unit: "quả" },
    ]);
    expect(merged).toEqual([{ name: "Cà chua", quantity: 5, unit: "quả" }]);
  });

  it("tách dòng khi khác đơn vị", () => {
    const merged = mergeNeeds([
      { name: "Thịt lợn", quantity: 300, unit: "g" },
      { name: "Thịt lợn", quantity: 1, unit: "kg" },
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe("suggestFromPantry", () => {
  const dishes = [
    { name: "Cá thu kho", ingredients: [{ name: "cá thu" }, { name: "riềng" }] },
    { name: "Bò xào", ingredients: [{ name: "thịt bò" }, { name: "cần tây" }] },
    { name: "Đậu sốt cà", ingredients: [{ name: "đậu phụ" }, { name: "cà chua" }] },
  ];

  it("chỉ giữ món có nguyên liệu chính trùng kho, nhiều trùng đứng trước", () => {
    const pantry = toPantrySet(["cá thu", "đậu phụ", "cà chua"]);
    expect(suggestFromPantry(dishes, pantry).map((d) => d.name)).toEqual([
      "Đậu sốt cà",
      "Cá thu kho",
    ]);
  });

  it("kho rỗng thì không gợi ý gì", () => {
    expect(suggestFromPantry(dishes, toPantrySet([]))).toEqual([]);
  });
});
