import { describe, it, expect } from "vitest";
import { parseMenuJson, parseEditJson } from "./schema";

describe("parseMenuJson (nhiều món)", () => {
  it("parse mâm 2 món có dishRole", () => {
    const json = JSON.stringify({
      meals: [
        {
          date: "2026-07-25",
          mealType: "DINNER",
          dishes: [
            { name: "Thịt kho", dishRole: "MON_MAN", servings: 4, cookMinutes: 40, steps: ["kho"], nutritionLabels: ["giàu đạm"], ingredients: [{ name: "thịt", quantity: 300, unit: "g" }] },
            { name: "Canh cải", dishRole: "CANH_SUP", servings: 4, cookMinutes: 15, steps: ["nấu"], nutritionLabels: ["nhiều rau"], ingredients: [{ name: "cải", quantity: 1, unit: "bó" }] },
          ],
        },
      ],
    });
    const menu = parseMenuJson(json);
    expect(menu.meals[0].dishes).toHaveLength(2);
    expect(menu.meals[0].dishes[1].dishRole).toBe("CANH_SUP");
  });

  it("từ chối dish thiếu dishRole", () => {
    const json = JSON.stringify({
      meals: [{ date: "2026-07-25", mealType: "LUNCH", dishes: [{ name: "X", servings: 2, cookMinutes: 10, steps: [], nutritionLabels: [], ingredients: [] }] }],
    });
    expect(() => parseMenuJson(json)).toThrow();
  });
});

describe("parseEditJson", () => {
  it("parse danh sách dishes", () => {
    const json = JSON.stringify({
      dishes: [
        { name: "Canh chua cá", dishRole: "CANH_SUP", servings: 4, cookMinutes: 25, steps: ["nấu"], nutritionLabels: ["nhiều rau"], ingredients: [{ name: "cá", quantity: 300, unit: "g" }] },
      ],
    });
    const r = parseEditJson(json);
    expect(r.dishes[0].name).toBe("Canh chua cá");
  });

  it("từ chối khi dishes rỗng", () => {
    expect(() => parseEditJson(JSON.stringify({ dishes: [] }))).toThrow();
  });
});
