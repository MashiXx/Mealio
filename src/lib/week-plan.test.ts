import { describe, it, expect } from "vitest";
import { verifyWeekPlan, allowedProteins } from "./week-plan";
import type { AiWeekPlan } from "./ai/schema";
import type { MenuSlot, MenuMember } from "./ai/types";

const member = (over: Partial<MenuMember> = {}): MenuMember =>
  ({
    name: "A",
    ageGroup: "ADULT",
    allergies: [],
    dietaryRestrictions: [],
    likes: [],
    dislikes: [],
    ...over,
  }) as MenuMember;

/** 7 ngày liên tiếp từ 2026-07-27, mỗi ngày một bữa tối một món mặn. */
const WEEK = [
  "2026-07-27",
  "2026-07-28",
  "2026-07-29",
  "2026-07-30",
  "2026-07-31",
  "2026-08-01",
  "2026-08-02",
];
const weekSlots = () => WEEK.map((d) => slot(d, ["MON_MAN"]));
const weekPlan = (proteins: string[]) =>
  plan(
    WEEK.map((d, i) => meal(d, [dish(`Món số ${i + 1}`, "MON_MAN", proteins[i])])),
  );

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

  // R5 — "không lặp nguyên liệu chính quá 2 lần/tuần" của task.txt.
  it("R5: một đạm dùng 3 lần trong tuần là vi phạm", () => {
    const p = weekPlan([
      "CA",
      "THIT_HEO",
      "CA",
      "THIT_GA",
      "CA",
      "THIT_BO",
      "DAU_PHU",
    ]);
    expect(
      verifyWeekPlan(p, weekSlots()).some((x) => x.includes("3 lần")),
    ).toBe(true);
  });

  it("R5: đúng 2 lần thì không sao", () => {
    const p = weekPlan([
      "CA",
      "THIT_HEO",
      "CA",
      "THIT_GA",
      "TRUNG",
      "THIT_BO",
      "DAU_PHU",
    ]);
    expect(verifyWeekPlan(p, weekSlots())).toEqual([]);
  });

  // Chốt chặn quan trọng nhất của R5: nhà ăn chay chỉ còn 3 đạm, ép cứng ngưỡng
  // 2 thì thực đơn 7 ngày KHÔNG có lời giải và job sinh lại một vòng vô ích.
  it("R5: nhà ăn chay được nới ngưỡng theo số đạm còn lại", () => {
    const chay = [member({ dietaryRestrictions: ["ăn chay"] })];
    const p = weekPlan([
      "DAU_PHU",
      "TRUNG",
      "DAU_PHU",
      "TRUNG",
      "DAU_PHU",
      "RAU_CU",
      "TRUNG",
    ]);
    expect(verifyWeekPlan(p, weekSlots(), chay)).toEqual([]);
  });

  it("R5: nhà ăn chay vượt cả ngưỡng đã nới thì vẫn vi phạm", () => {
    const chay = [member({ dietaryRestrictions: ["ăn chay"] })];
    const p = weekPlan([
      "DAU_PHU",
      "TRUNG",
      "DAU_PHU",
      "TRUNG",
      "DAU_PHU",
      "RAU_CU",
      "DAU_PHU",
    ]);
    expect(
      verifyWeekPlan(p, weekSlots(), chay).some((x) => x.includes("4 lần")),
    ).toBe(true);
  });
});

describe("allowedProteins", () => {
  it("không kiêng gì thì được cả 8 loại", () => {
    expect(allowedProteins([member()])).toHaveLength(8);
  });

  it("dị ứng hải sản và kiêng bò thì rụng đúng hai loại", () => {
    const got = allowedProteins([
      member({ allergies: ["hải sản"] }),
      member({ dietaryRestrictions: ["không ăn thịt bò"] }),
    ]);
    expect(got).not.toContain("TOM_CUA");
    expect(got).not.toContain("THIT_BO");
    expect(got).toContain("CA");
  });

  it("ăn chay chỉ còn đạm thực vật và trứng", () => {
    const got = allowedProteins([member({ dietaryRestrictions: ["ăn chay"] })]);
    expect([...got].sort()).toEqual(["DAU_PHU", "RAU_CU", "TRUNG"]);
  });

  it("kiêng hết mọi thứ vẫn còn ít nhất một loại, không bao giờ rỗng", () => {
    const got = allowedProteins([
      member({
        allergies: ["hải sản", "cá", "trứng", "đậu nành"],
        dietaryRestrictions: ["ăn chay"],
      }),
    ]);
    expect(got.length).toBeGreaterThan(0);
  });
});
