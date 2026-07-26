import { describe, it, expect } from "vitest";
import { normalizeUserNote, USER_NOTE_MAX } from "./user-note";

describe("normalizeUserNote", () => {
  it("giữ nguyên chuỗi thường, đã trim hai đầu", () => {
    expect(normalizeUserNote("  nay thèm đồ ngọt  ")).toBe("nay thèm đồ ngọt");
  });

  it("chuỗi rỗng hoặc toàn khoảng trắng thành null", () => {
    expect(normalizeUserNote("")).toBeNull();
    expect(normalizeUserNote("   ")).toBeNull();
    expect(normalizeUserNote("\n\t ")).toBeNull();
  });

  it("giá trị không phải chuỗi thành null, không nổ", () => {
    expect(normalizeUserNote(undefined)).toBeNull();
    expect(normalizeUserNote(null)).toBeNull();
    expect(normalizeUserNote(123)).toBeNull();
    expect(normalizeUserNote({})).toBeNull();
  });

  it("cắt chuỗi dài về đúng giới hạn", () => {
    const long = "a".repeat(USER_NOTE_MAX + 50);
    expect(normalizeUserNote(long)).toHaveLength(USER_NOTE_MAX);
  });

  it("chuỗi đúng bằng giới hạn thì không bị cắt", () => {
    const exact = "b".repeat(USER_NOTE_MAX);
    expect(normalizeUserNote(exact)).toBe(exact);
  });

  it("trim TRƯỚC khi cắt, để khoảng trắng thừa không ăn mất nội dung", () => {
    const note = "c".repeat(USER_NOTE_MAX);
    expect(normalizeUserNote(`   ${note}   `)).toBe(note);
  });
});
