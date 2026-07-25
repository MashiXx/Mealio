import { describe, it, expect } from "vitest";
import { planMealStructure } from "./meal-structure";

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
