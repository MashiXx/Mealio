// Nhãn tiếng Việt cho các enum của Prisma, dùng cho dropdown/hiển thị ở UI.
// Giữ đồng bộ với prisma/schema.prisma.

export const AGE_GROUPS = [
  { value: "BABY", label: "Em bé (< 2 tuổi)" },
  { value: "CHILD", label: "Trẻ em" },
  { value: "TEEN", label: "Thiếu niên" },
  { value: "ADULT", label: "Người lớn" },
  { value: "SENIOR", label: "Người cao tuổi" },
] as const;

export const CUISINE_REGIONS = [
  { value: "MIEN_BAC", label: "Miền Bắc" },
  { value: "MIEN_TRUNG", label: "Miền Trung" },
  { value: "MIEN_NAM", label: "Miền Nam" },
  { value: "KHONG_CO_KHAU_VI", label: "Linh hoạt (không cố định)" },
] as const;

export const SPICE_LEVELS = [
  { value: "NONE", label: "Không cay" },
  { value: "MILD", label: "Cay nhẹ" },
  { value: "MEDIUM", label: "Cay vừa" },
  { value: "HOT", label: "Cay nhiều" },
] as const;

export const BUDGET_LEVELS = [
  { value: "LOW", label: "Tiết kiệm" },
  { value: "MEDIUM", label: "Trung bình" },
  { value: "HIGH", label: "Thoải mái" },
] as const;

export const MEAL_TYPES = [
  { value: "BREAKFAST", label: "Bữa sáng" },
  { value: "LUNCH", label: "Bữa trưa" },
  { value: "DINNER", label: "Bữa tối" },
] as const;

export const AI_PROVIDERS = [
  { value: "ANTHROPIC", label: "Anthropic (Claude)" },
  { value: "OPENAI_COMPATIBLE", label: "OpenAI-compatible (OpenAI, tự host…)" },
  { value: "OLLAMA", label: "Ollama (tự host)" },
] as const;

export const MEAL_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  MEAL_TYPES.map((m) => [m.value, m.label]),
);
