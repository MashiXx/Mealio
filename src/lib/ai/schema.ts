import { z } from "zod";

// Schema JSON mà AI phải trả về cho một thực đơn. Validate bằng zod để
// đảm bảo dữ liệu dùng được trước khi lưu DB.

export const aiIngredientSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().positive().default(1),
  unit: z.string().default("phần"),
});

export const aiDishSchema = z.object({
  name: z.string().min(1),
  dishRole: z.enum([
    "MON_MAN",
    "MON_XAO",
    "CANH_SUP",
    "RAU_LUOC",
    "LAU",
    "COM_BUN_PHO",
    "MON_CUON",
    "TRANG_MIENG",
    "DO_CHUA",
  ]),
  servings: z.number().int().positive().default(4),
  cookMinutes: z.number().int().positive().default(30),
  steps: z.array(z.string()).default([]),
  nutritionLabels: z.array(z.string()).default([]),
  ingredients: z.array(aiIngredientSchema).default([]),
});

export const aiMealSchema = z.object({
  date: z.string(), // yyyy-mm-dd
  mealType: z.enum(["BREAKFAST", "LUNCH", "DINNER"]),
  dishes: z.array(aiDishSchema).min(1),
});

export const aiMenuSchema = z.object({
  meals: z.array(aiMealSchema).min(1),
});

export type AiMenu = z.infer<typeof aiMenuSchema>;
export type AiMeal = z.infer<typeof aiMealSchema>;
export type AiDish = z.infer<typeof aiDishSchema>;

// Kết quả AI trả về khi SỬA mâm: danh sách món (1 món cho DISH/ADD, cả mâm cho MEAL).
export const aiEditSchema = z.object({
  dishes: z.array(aiDishSchema).min(1),
});
export type AiEditResult = z.infer<typeof aiEditSchema>;

// Kết quả nhận dạng thành viên từ ảnh. Chỉ nhóm tuổi là suy đoán tương đối
// tin cậy; suggestedLikes/notes là gợi ý mềm theo độ tuổi để người dùng tham khảo.
export const memberRecognitionSchema = z.object({
  ageGroup: z.enum(["BABY", "CHILD", "TEEN", "ADULT", "SENIOR"]),
  suggestedLikes: z.array(z.string()).default([]),
  notes: z.string().default(""),
});

export type MemberRecognition = z.infer<typeof memberRecognitionSchema>;

/** Rút object JSON từ text AI (chịu được ```json fences hoặc text thừa). */
function extractJson(text: string): unknown {
  let raw = text.trim();

  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();

  if (!raw.startsWith("{")) {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1) raw = raw.slice(start, end + 1);
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("AI trả về không phải JSON hợp lệ.");
  }
}

/** Validate JSON thực đơn theo aiMenuSchema. */
export function parseMenuJson(text: string): AiMenu {
  const result = aiMenuSchema.safeParse(extractJson(text));
  if (!result.success) {
    throw new Error(
      "JSON từ AI không đúng cấu trúc thực đơn: " + result.error.message,
    );
  }
  return result.data;
}

/** Validate JSON kết quả sửa mâm theo aiEditSchema. */
export function parseEditJson(text: string): AiEditResult {
  const result = aiEditSchema.safeParse(extractJson(text));
  if (!result.success) {
    throw new Error(
      "JSON sửa mâm không đúng cấu trúc: " + result.error.message,
    );
  }
  return result.data;
}

/** Validate JSON nhận dạng thành viên. */
export function parseRecognitionJson(text: string): MemberRecognition {
  const result = memberRecognitionSchema.safeParse(extractJson(text));
  if (!result.success) {
    throw new Error(
      "JSON nhận dạng không đúng cấu trúc: " + result.error.message,
    );
  }
  return result.data;
}
