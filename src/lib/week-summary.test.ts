import { describe, it, expect } from "vitest";
import { topIngredients, parseWeekSummary } from "./week-summary";

const dish = (...names: string[]) => ({
  recipe: { ingredients: names.map((name) => ({ ingredient: { name } })) },
});
const meal = (...dishes: ReturnType<typeof dish>[]) => ({ dishes });

describe("topIngredients", () => {
  it("đếm theo số MÓN và xếp nhiều nhất lên trước", () => {
    const got = topIngredients([
      meal(dish("thịt heo", "cà chua"), dish("thịt heo")),
      meal(dish("thịt heo"), dish("cà rốt")),
    ]);
    expect(got[0]).toEqual({ name: "thịt heo", dishCount: 3 });
  });

  // Gia vị có mặt ở gần như mọi món nên xếp hạng chúng không nói lên điều gì.
  it("bỏ qua gia vị", () => {
    const got = topIngredients([
      meal(dish("nước mắm", "tỏi", "cà rốt"), dish("nước mắm", "tỏi")),
    ]);
    expect(got.map((x) => x.name)).toEqual(["cà rốt"]);
  });

  it("một món khai trùng nguyên liệu chỉ tính một lần", () => {
    const got = topIngredients([meal(dish("cà chua", "cà chua", "cà chua"))]);
    expect(got).toEqual([{ name: "cà chua", dishCount: 1 }]);
  });

  it("gộp tên đồng nghĩa về một mục", () => {
    // matchKey quy "đậu hũ" về "đậu phụ"
    const got = topIngredients([meal(dish("đậu hũ"), dish("đậu phụ"))]);
    expect(got).toHaveLength(1);
    expect(got[0].dishCount).toBe(2);
  });

  it("cắt đúng số lượng yêu cầu", () => {
    const got = topIngredients(
      [meal(dish("thịt heo"), dish("cà rốt"), dish("bí đỏ"), dish("su hào"))],
      2,
    );
    expect(got).toHaveLength(2);
  });

  it("không có mâm nào thì trả mảng rỗng, không ném lỗi", () => {
    expect(topIngredients([])).toEqual([]);
  });
});

describe("parseWeekSummary", () => {
  it("đọc được dữ liệu đúng dạng", () => {
    expect(parseWeekSummary({ tips: ["a", "b"] })).toEqual({ tips: ["a", "b"] });
  });

  it("chưa có hoặc hỏng thì trả null chứ không ném", () => {
    expect(parseWeekSummary(null)).toBeNull();
    expect(parseWeekSummary({})).toBeNull();
    expect(parseWeekSummary({ tips: "không phải mảng" })).toBeNull();
    expect(parseWeekSummary({ tips: [] })).toBeNull();
  });

  it("lọc bỏ phần tử rác lẫn trong mảng", () => {
    expect(parseWeekSummary({ tips: ["a", 1, null, "b"] })).toEqual({
      tips: ["a", "b"],
    });
  });
});
