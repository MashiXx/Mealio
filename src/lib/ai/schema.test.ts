import { describe, it, expect } from "vitest";
import {
  parseMenuJson,
  parseEditJson,
  parseWeekPlanJson,
  MAIN_PROTEINS,
} from "./schema";

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

describe("parseWeekPlanJson", () => {
  const ok = {
    meals: [
      {
        date: "2026-07-27",
        mealType: "DINNER",
        dishes: [
          {
            name: "Cá kho tộ",
            dishRole: "MON_MAN",
            mainProtein: "CA",
            nutritionLabels: ["giàu đạm"],
          },
        ],
      },
    ],
  };

  it("nhận khung hợp lệ", () => {
    const p = parseWeekPlanJson(JSON.stringify(ok));
    expect(p.meals[0].dishes[0].mainProtein).toBe("CA");
  });

  it("nutritionLabels thiếu thì mặc định mảng rỗng", () => {
    const noLabels = {
      meals: [
        {
          date: "2026-07-27",
          mealType: "DINNER",
          dishes: [
            { name: "Cá kho tộ", dishRole: "MON_MAN", mainProtein: "CA" },
          ],
        },
      ],
    };
    expect(
      parseWeekPlanJson(JSON.stringify(noLabels)).meals[0].dishes[0]
        .nutritionLabels,
    ).toEqual([]);
  });

  it("mainProtein ngoài enum thì ném lỗi", () => {
    const bad = JSON.parse(JSON.stringify(ok));
    bad.meals[0].dishes[0].mainProtein = "THIT";
    expect(() => parseWeekPlanJson(JSON.stringify(bad))).toThrow();
  });

  it("thiếu mainProtein thì ném lỗi — đây là trục bắt lặp, không được để trống", () => {
    const bad = JSON.parse(JSON.stringify(ok));
    delete bad.meals[0].dishes[0].mainProtein;
    expect(() => parseWeekPlanJson(JSON.stringify(bad))).toThrow();
  });

  it("khung không có bữa nào thì ném lỗi", () => {
    expect(() => parseWeekPlanJson(JSON.stringify({ meals: [] }))).toThrow();
  });

  it("enum đạm chính đủ 8 giá trị", () => {
    expect(MAIN_PROTEINS).toHaveLength(8);
  });
});
