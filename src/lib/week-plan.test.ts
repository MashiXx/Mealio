import { describe, it, expect } from "vitest";
import { verifyWeekPlan } from "./week-plan";
import type { AiWeekPlan } from "./ai/schema";
import type { MenuSlot } from "./ai/types";

const slot = (date: string, roles: string[]): MenuSlot =>
  ({ date, mealType: "DINNER", dishRoles: roles }) as MenuSlot;

const dish = (name: string, dishRole: string, mainProtein: string) => ({
  name,
  dishRole,
  mainProtein,
  nutritionLabels: [] as string[],
});

const meal = (date: string, dishes: ReturnType<typeof dish>[]) => ({
  date,
  mealType: "DINNER" as const,
  dishes,
});

const plan = (meals: ReturnType<typeof meal>[]): AiWeekPlan =>
  ({ meals }) as unknown as AiWeekPlan;

describe("verifyWeekPlan", () => {
  it("khung đúng mọi luật thì không vi phạm", () => {
    const slots = [
      slot("2026-07-27", ["MON_MAN", "CANH_SUP"]),
      slot("2026-07-28", ["MON_MAN", "CANH_SUP"]),
    ];
    const p = plan([
      meal("2026-07-27", [
        dish("Cá kho tộ", "MON_MAN", "CA"),
        dish("Canh chua cá", "CANH_SUP", "CA"),
      ]),
      meal("2026-07-28", [
        dish("Thịt kho tàu", "MON_MAN", "THIT_HEO"),
        dish("Canh khoai mỡ", "CANH_SUP", "RAU_CU"),
      ]),
    ]);
    expect(verifyWeekPlan(p, slots)).toEqual([]);
  });

  it("R1: thiếu một bữa đã yêu cầu", () => {
    const slots = [
      slot("2026-07-27", ["MON_MAN"]),
      slot("2026-07-28", ["MON_MAN"]),
    ];
    const p = plan([meal("2026-07-27", [dish("Cá kho tộ", "MON_MAN", "CA")])]);
    expect(verifyWeekPlan(p, slots).some((x) => x.includes("2026-07-28"))).toBe(
      true,
    );
  });

  it("R1: sai vai trò trong một bữa", () => {
    const slots = [slot("2026-07-27", ["MON_MAN", "CANH_SUP"])];
    const p = plan([
      meal("2026-07-27", [
        dish("Cá kho tộ", "MON_MAN", "CA"),
        dish("Rau muống xào tỏi", "MON_XAO", "RAU_CU"),
      ]),
    ]);
    expect(verifyWeekPlan(p, slots).length).toBeGreaterThan(0);
  });

  it("R2: trả về ngày ngoài danh sách yêu cầu", () => {
    const slots = [slot("2026-07-27", ["MON_MAN"])];
    const p = plan([
      meal("2026-07-27", [dish("Cá kho tộ", "MON_MAN", "CA")]),
      meal("2026-07-29", [dish("Thịt kho tàu", "MON_MAN", "THIT_HEO")]),
    ]);
    expect(verifyWeekPlan(p, slots).some((x) => x.includes("2026-07-29"))).toBe(
      true,
    );
  });

  it("R3: hai món trùng tên khác ngày", () => {
    const slots = [
      slot("2026-07-27", ["MON_MAN"]),
      slot("2026-07-28", ["MON_MAN"]),
    ];
    const p = plan([
      meal("2026-07-27", [dish("Cá kho tộ", "MON_MAN", "CA")]),
      meal("2026-07-28", [dish("Cá kho tộ", "MON_MAN", "THIT_HEO")]),
    ]);
    expect(verifyWeekPlan(p, slots).some((x) => x.includes("lặp"))).toBe(true);
  });

  it("R3: trùng tên nhưng khác dấu/hoa thường vẫn là lặp", () => {
    const slots = [
      slot("2026-07-27", ["MON_MAN"]),
      slot("2026-07-28", ["MON_MAN"]),
    ];
    const p = plan([
      meal("2026-07-27", [dish("Cá kho tộ", "MON_MAN", "CA")]),
      meal("2026-07-28", [dish("CA KHO TO", "MON_MAN", "THIT_HEO")]),
    ]);
    expect(verifyWeekPlan(p, slots).some((x) => x.includes("lặp"))).toBe(true);
  });

  it("R3 THA vai trò DO_CHUA — dưa cà ăn quanh năm", () => {
    const slots = [
      slot("2026-07-27", ["MON_MAN", "DO_CHUA"]),
      slot("2026-07-28", ["MON_MAN", "DO_CHUA"]),
    ];
    const p = plan([
      meal("2026-07-27", [
        dish("Cá kho tộ", "MON_MAN", "CA"),
        dish("Dưa cải chua", "DO_CHUA", "RAU_CU"),
      ]),
      meal("2026-07-28", [
        dish("Thịt kho tàu", "MON_MAN", "THIT_HEO"),
        dish("Dưa cải chua", "DO_CHUA", "RAU_CU"),
      ]),
    ]);
    expect(verifyWeekPlan(p, slots)).toEqual([]);
  });

  it("R4: món mặn hai ngày LIỀN cùng đạm chính", () => {
    const slots = [
      slot("2026-07-27", ["MON_MAN"]),
      slot("2026-07-28", ["MON_MAN"]),
    ];
    const p = plan([
      meal("2026-07-27", [dish("Cá kho tộ", "MON_MAN", "CA")]),
      meal("2026-07-28", [dish("Cá basa chiên sả", "MON_MAN", "CA")]),
    ]);
    expect(verifyWeekPlan(p, slots).some((x) => x.includes("Đạm chính"))).toBe(
      true,
    );
  });

  it("R4: cùng đạm nhưng CÁCH một ngày thì không sao", () => {
    const slots = [
      slot("2026-07-27", ["MON_MAN"]),
      slot("2026-07-28", ["MON_MAN"]),
      slot("2026-07-29", ["MON_MAN"]),
    ];
    const p = plan([
      meal("2026-07-27", [dish("Cá kho tộ", "MON_MAN", "CA")]),
      meal("2026-07-28", [dish("Thịt kho tàu", "MON_MAN", "THIT_HEO")]),
      meal("2026-07-29", [dish("Cá basa chiên sả", "MON_MAN", "CA")]),
    ]);
    expect(verifyWeekPlan(p, slots)).toEqual([]);
  });

  it("khoảng chỉ có 1 ngày thì R4 không bao giờ kích hoạt", () => {
    const slots = [slot("2026-07-27", ["MON_MAN", "MON_MAN"])];
    const p = plan([
      meal("2026-07-27", [
        dish("Cá kho tộ", "MON_MAN", "CA"),
        dish("Cá basa chiên sả", "MON_MAN", "CA"),
      ]),
    ]);
    expect(verifyWeekPlan(p, slots)).toEqual([]);
  });

  it("khung rỗng thì báo vi phạm chứ không ném lỗi", () => {
    const slots = [slot("2026-07-27", ["MON_MAN"])];
    expect(() => verifyWeekPlan(plan([]), slots)).not.toThrow();
    expect(verifyWeekPlan(plan([]), slots).length).toBeGreaterThan(0);
  });
});
