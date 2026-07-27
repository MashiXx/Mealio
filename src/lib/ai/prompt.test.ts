import { describe, it, expect } from "vitest";
import { ageNotesBlock, buildMenuPrompt, buildWeekPlanPrompt } from "./prompt";
import type { MenuContext, MenuMember } from "./types";

const member = (ageGroup: string, over: Partial<MenuMember> = {}): MenuMember => ({
  name: "A",
  ageGroup,
  allergies: [],
  dietaryRestrictions: [],
  likes: [],
  dislikes: [],
  ...over,
});

const ctx = (over: Partial<MenuContext> = {}): MenuContext => ({
  familySize: 6,
  members: [member("ADULT")],
  profile: {
    cuisineRegion: "MIEN_BAC",
    spiceLevel: "MEDIUM",
    budgetLevel: "MEDIUM",
    maxCookMinutes: 45,
    healthGoals: [],
    notes: null,
  },
  pantry: [],
  recentRecipeNames: [],
  availableRecipeNames: [],
  slots: [
    { date: "2026-07-27", mealType: "DINNER", dishRoles: ["MON_MAN", "CANH_SUP"] },
  ],
  pantryMode: "FLEXIBLE",
  ...over,
});

describe("ageNotesBlock", () => {
  it("nhà toàn người lớn thì không sinh lưu ý nào", () => {
    expect(ageNotesBlock([member("ADULT")])).toBe("");
  });

  it("có người cao tuổi thì nhắc món mềm và ít muối", () => {
    const got = ageNotesBlock([member("ADULT"), member("SENIOR")]);
    expect(got).toContain("NGƯỜI CAO TUỔI");
    expect(got).toContain("giảm muối");
  });

  it("trẻ em và thiếu niên gộp chung một lưu ý, không nhân đôi", () => {
    const got = ageNotesBlock([member("CHILD"), member("TEEN")]);
    const hits = got.split("\n").filter((l) => l.includes("TRẺ ĐANG LỚN"));
    expect(hits).toHaveLength(1);
  });

  it("nhà nhiều thế hệ gộp đủ các lưu ý", () => {
    const got = ageNotesBlock([
      member("SENIOR"),
      member("ADULT"),
      member("CHILD"),
      member("BABY"),
    ]);
    expect(got).toContain("NGƯỜI CAO TUỔI");
    expect(got).toContain("TRẺ ĐANG LỚN");
    expect(got).toContain("EM BÉ");
  });
});

// Hai prompt sinh (một ngày và khung nhiều ngày) là hai hàm RIÊNG, rất dễ sửa
// cái này quên cái kia. Các test dưới đây chốt cả hai cùng lúc.
describe("luật healthy có mặt ở CẢ HAI prompt sinh", () => {
  for (const [name, build] of [
    ["buildMenuPrompt", buildMenuPrompt],
    ["buildWeekPlanPrompt", buildWeekPlanPrompt],
  ] as const) {
    it(`${name}: ưu tiên hấp/luộc/áp chảo/kho ít dầu/nướng`, () => {
      const { system } = build(ctx());
      expect(system).toContain("HẤP");
      expect(system).toContain("LUỘC");
      expect(system).toContain("ÁP CHẢO");
      expect(system).toContain("KHO ÍT DẦU");
      expect(system).toContain("NƯỚNG");
    });

    it(`${name}: hạn chế chiên rán và đồ chế biến sẵn`, () => {
      const { system } = build(ctx());
      expect(system).toContain("chiên/rán ngập dầu");
      expect(system).toContain("chế biến sẵn");
    });

    it(`${name}: lưu ý nhóm tuổi vào phần user khi nhà có ông bà`, () => {
      const { user } = build(ctx({ members: [member("SENIOR")] }));
      expect(user).toContain("NGƯỜI CAO TUỔI");
    });

    it(`${name}: nhà toàn người lớn thì không chèn khối lưu ý tuổi`, () => {
      const { user } = build(ctx());
      expect(user).not.toContain("Lưu ý theo độ tuổi");
    });

    it(`${name}: nêu thời gian nấu cho CẢ MÂM chứ không chỉ từng món`, () => {
      const { user } = build(ctx());
      expect(user).toContain("Cả mâm nên nấu xong trong khoảng 45 phút");
    });
  }
});
