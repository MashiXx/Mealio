import { describe, it, expect } from "vitest";
import { catalogDishToAiDish, canUseCatalogRecipe } from "./expand-plan";
import { getDishBySlug } from "@/data/catalog";

describe("catalogDishToAiDish", () => {
  it("chuyển đủ nguyên liệu, các bước và thời gian nấu", () => {
    const cat = getDishBySlug("ca-kho-to")!;
    const d = catalogDishToAiDish(cat, "MON_MAN", 4, ["giàu đạm"]);
    expect(d.name).toBe(cat.name);
    expect(d.dishRole).toBe("MON_MAN");
    expect(d.servings).toBe(4);
    expect(d.cookMinutes).toBe(cat.cookMinutes);
    expect(d.steps).toEqual(cat.steps);
    expect(d.ingredients.length).toBe(cat.ingredients.length);
    expect(d.ingredients[0]).toHaveProperty("name");
    expect(d.ingredients[0]).toHaveProperty("quantity");
    expect(d.ingredients[0]).toHaveProperty("unit");
  });

  it("giữ vai trò do KHUNG chỉ định, không lấy vai trò của catalog", () => {
    // Cơ cấu mâm đã được server chốt bằng planMealStructure; mâm phải nhận đúng
    // vai trò đã yêu cầu.
    const cat = getDishBySlug("ca-kho-to")!;
    expect(catalogDishToAiDish(cat, "CANH_SUP", 4, []).dishRole).toBe("CANH_SUP");
  });

  it("dùng nhãn dinh dưỡng của khung khi có, ngược lại lấy của catalog", () => {
    const cat = getDishBySlug("ca-kho-to")!;
    expect(
      catalogDishToAiDish(cat, "MON_MAN", 4, ["ít dầu mỡ"]).nutritionLabels,
    ).toEqual(["ít dầu mỡ"]);
    expect(catalogDishToAiDish(cat, "MON_MAN", 4, []).nutritionLabels).toEqual(
      cat.nutritionLabels,
    );
  });

  it("không chia sẻ mảng với dữ liệu catalog (tránh sửa nhầm nguồn tĩnh)", () => {
    const cat = getDishBySlug("ca-kho-to")!;
    const d = catalogDishToAiDish(cat, "MON_MAN", 4, []);
    d.steps.push("bước bịa");
    expect(cat.steps).not.toContain("bước bịa");
  });
});

describe("canUseCatalogRecipe — chốt chặn dị ứng", () => {
  it("cho phép khi không vướng ràng buộc nào", () => {
    const cat = getDishBySlug("ca-kho-to")!;
    expect(canUseCatalogRecipe(cat, new Set(), false)).toBe(true);
  });

  it("CHẶN món mang tag bị loại — chốt chống đi vòng qua bộ lọc dị ứng", () => {
    const cat = getDishBySlug("ca-kho-to")!;
    expect(cat.tags).toContain("chua-ca");
    expect(canUseCatalogRecipe(cat, new Set(["chua-ca"]), false)).toBe(false);
  });

  it("CHẶN món không phải món chay khi nhà ăn chay", () => {
    const cat = getDishBySlug("ca-kho-to")!;
    expect(canUseCatalogRecipe(cat, new Set(), true)).toBe(false);
  });
});
