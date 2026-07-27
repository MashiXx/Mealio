import { describe, it, expect } from "vitest";
import { planMealStructure, fitDishesToPlan } from "./meal-structure";
import type { DishRoleStr } from "./ai/types";

const dish = (name: string, dishRole: DishRoleStr) => ({ name, dishRole });
const rolesOf = (ds: { dishRole: DishRoleStr }[]) => ds.map((d) => d.dishRole);

describe("planMealStructure", () => {
  it("bữa sáng luôn 1 món COM_BUN_PHO, bỏ qua override", () => {
    expect(planMealStructure("BREAKFAST", 4)).toEqual(["COM_BUN_PHO"]);
    expect(planMealStructure("BREAKFAST", 4, 3)).toEqual(["COM_BUN_PHO"]);
  });

  it("<=2 người: 2 món (mặn + canh)", () => {
    expect(planMealStructure("LUNCH", 2)).toEqual(["MON_MAN", "CANH_SUP"]);
    expect(planMealStructure("DINNER", 1)).toEqual(["MON_MAN", "CANH_SUP"]);
  });

  it("3-4 người: 3 món, sắp theo thứ tự mâm", () => {
    expect(planMealStructure("LUNCH", 4)).toEqual([
      "MON_MAN",
      "MON_XAO",
      "CANH_SUP",
    ]);
  });

  it(">=5 người: 4 món", () => {
    expect(planMealStructure("DINNER", 6)).toEqual([
      "MON_MAN",
      "MON_XAO",
      "RAU_LUOC",
      "CANH_SUP",
    ]);
  });

  it("override chỉ áp cho bữa chính; N=1 chỉ món mặn", () => {
    expect(planMealStructure("LUNCH", 4, 1)).toEqual(["MON_MAN"]);
  });

  it("override N=5 thêm tráng miệng, sắp đúng thứ tự", () => {
    expect(planMealStructure("LUNCH", 2, 5)).toEqual([
      "MON_MAN",
      "MON_XAO",
      "RAU_LUOC",
      "CANH_SUP",
      "TRANG_MIENG",
    ]);
  });

  it("override ngoài 1..5 hoặc số người lỗi -> quay về auto", () => {
    expect(planMealStructure("LUNCH", 4, 99)).toEqual([
      "MON_MAN",
      "MON_XAO",
      "CANH_SUP",
    ]);
    expect(planMealStructure("LUNCH", 0)).toEqual(["MON_MAN", "CANH_SUP"]);
  });
});

describe("fitDishesToPlan", () => {
  // Ca người dùng gặp: chọn 3 món, khung ra mặn/xào/canh, AI trả đủ 3 rồi thêm
  // một món luộc vào cuối. Trước đây saveMenu ghi cả 4.
  it("cắt món AI trả thêm ngoài khung", () => {
    const got = fitDishesToPlan(
      [
        dish("Cá kho tộ", "MON_MAN"),
        dish("Bắp cải xào đậu phụ", "MON_XAO"),
        dish("Canh rau củ", "CANH_SUP"),
        dish("Rau muống luộc", "RAU_LUOC"),
      ],
      ["MON_MAN", "MON_XAO", "CANH_SUP"],
    );
    expect(got.map((d) => d.name)).toEqual([
      "Cá kho tộ",
      "Bắp cải xào đậu phụ",
      "Canh rau củ",
    ]);
  });

  it("xếp lại theo đúng thứ tự vai trò đã yêu cầu", () => {
    const got = fitDishesToPlan(
      [dish("Canh", "CANH_SUP"), dish("Kho", "MON_MAN"), dish("Xào", "MON_XAO")],
      ["MON_MAN", "MON_XAO", "CANH_SUP"],
    );
    expect(rolesOf(got)).toEqual(["MON_MAN", "MON_XAO", "CANH_SUP"]);
  });

  // Không được biến mâm thừa món thành mâm HỤT món: AI trả đủ 3 nhưng lệch vai
  // trò thì vẫn giữ 3, chỉ chặn ở trần. Khớp vai trò trước, còn chỗ mới lấp.
  it("AI trả trùng vai trò: vẫn giữ đủ số món của khung", () => {
    const got = fitDishesToPlan(
      [dish("Kho", "MON_MAN"), dish("Rang", "MON_MAN"), dish("Canh", "CANH_SUP")],
      ["MON_MAN", "MON_XAO", "CANH_SUP"],
    );
    expect(got).toHaveLength(3);
    expect(got.map((d) => d.name)).toContain("Rang");
  });

  it("AI trả ít hơn khung thì để nguyên, không bịa thêm", () => {
    const got = fitDishesToPlan(
      [dish("Kho", "MON_MAN"), dish("Canh", "CANH_SUP")],
      ["MON_MAN", "MON_XAO", "CANH_SUP"],
    );
    expect(got).toHaveLength(2);
  });

  it("bữa sáng 1 món: bỏ món AI thêm kèm", () => {
    const got = fitDishesToPlan(
      [dish("Phở bò", "COM_BUN_PHO"), dish("Chè", "TRANG_MIENG")],
      ["COM_BUN_PHO"],
    );
    expect(got.map((d) => d.name)).toEqual(["Phở bò"]);
  });

  // Bữa AI trả về ngoài danh sách slot thì không có khung để đối chiếu — giữ
  // nguyên, cùng lập luận với dishCount = null trong saveMenu.
  it("không có khung thì giữ nguyên", () => {
    const ds = [dish("Kho", "MON_MAN"), dish("Canh", "CANH_SUP")];
    expect(fitDishesToPlan(ds, [])).toEqual(ds);
  });
});
