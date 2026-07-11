import { z } from "zod";

// Kiểu dữ liệu + validate cho kho món ăn dùng chung (catalog). Đây là NGUỒN
// CHÂN LÝ: mọi món/set menu khai báo trong src/data/catalog/* phải khớp schema
// này. index.ts validate toàn bộ lúc import nên sai cấu trúc sẽ lỗi ngay khi build.

/** Vai trò của món trong mâm cơm — trục phân nhóm chính. */
export const DISH_ROLES = [
  "MON_MAN", // món mặn: kho, rán, nướng, hấp (đạm chính)
  "MON_XAO", // xào
  "CANH_SUP", // canh, súp, riêu
  "RAU_LUOC", // rau luộc, nộm/gỏi, salad
  "LAU", // lẩu
  "COM_BUN_PHO", // cơm, bún, phở, xôi, mì, cháo (món nước/tinh bột chính)
  "MON_CUON", // các món cuốn
  "TRANG_MIENG", // tráng miệng, chè, trái cây
  "DO_CHUA", // dưa, cà, đồ chua ăn kèm
] as const;
export type DishRole = (typeof DISH_ROLES)[number];

export const CUISINE_REGIONS = [
  "MIEN_BAC",
  "MIEN_TRUNG",
  "MIEN_NAM",
  "KHONG_CO_KHAU_VI",
] as const;
export type CuisineRegion = (typeof CUISINE_REGIONS)[number];

export const MEAL_TYPES = ["BREAKFAST", "LUNCH", "DINNER"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const BUDGET_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type BudgetLevel = (typeof BUDGET_LEVELS)[number];

export const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/**
 * Tag lọc an toàn/khẩu vị. Danh sách gợi ý — không giới hạn cứng nhưng nên dùng
 * đúng các nhãn này để lọc dị ứng/kiêng khem nhất quán với hồ sơ thành viên.
 * Quy ước: "chua-*" = chứa nguyên liệu (để LOẠI khi dị ứng); "chay" = thuần chay.
 */
export const COMMON_TAGS = [
  "chua-hai-san", // tôm, cua, mực, nghêu, cá...
  "chua-ca", // riêng cá
  "chua-dau-phong", // đậu phộng (lạc)
  "chua-trung", // trứng
  "chua-sua", // sữa, phô mai, bơ
  "chua-bo", // thịt bò
  "chua-heo", // thịt heo/lợn
  "chua-ga", // thịt gà/gia cầm
  "chua-dau-nanh", // đậu nành, đậu phụ, tương
  "chua-gluten", // bột mì, mì
  "chay", // thuần chay
  "man", // món mặn/đậm đưa cơm
] as const;

export const ingredientSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().positive().default(1),
  unit: z.string().default("phần"),
});
export type CatalogIngredient = z.infer<typeof ingredientSchema>;

export const catalogDishSchema = z.object({
  /** khoá ổn định, kebab-case không dấu, dùng làm id ngoại + tên file ảnh. */
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/, "slug chỉ gồm a-z 0-9 và dấu gạch ngang"),
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  dishRole: z.enum(DISH_ROLES),
  region: z.enum(CUISINE_REGIONS).default("KHONG_CO_KHAU_VI"),
  mealTypes: z.array(z.enum(MEAL_TYPES)).default([]),
  servings: z.number().int().positive().default(4),
  cookMinutes: z.number().int().positive().default(30),
  difficulty: z.enum(DIFFICULTIES).default("EASY"),
  budgetLevel: z.enum(BUDGET_LEVELS).default("MEDIUM"),
  steps: z.array(z.string().min(1)).min(1, "cần ít nhất 1 bước"),
  ingredients: z.array(ingredientSchema).min(1, "cần ít nhất 1 nguyên liệu"),
  nutritionLabels: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  notes: z.string().nullish().default(null),
  /** đường dẫn ảnh nội bộ, vd "/dishes/thit-kho-tau.jpg"; null nếu chưa có. */
  imageUrl: z.string().nullish().default(null),
  /** ghi công nguồn ảnh + giấy phép (bắt buộc nếu có imageUrl). */
  imageCredit: z.string().nullish().default(null),
});
export type CatalogDishData = z.infer<typeof catalogDishSchema>;
/** Kiểu đầu vào khi khai báo món (được phép bỏ qua các trường có default). */
export type CatalogDishInput = z.input<typeof catalogDishSchema>;

export const setMenuSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  /** dịp/bối cảnh: "com-ngay-thuong", "cuoi-tuan", "dai-khach", "chay", "tet"... */
  occasion: z.string().min(1),
  region: z.enum(CUISINE_REGIONS).default("KHONG_CO_KHAU_VI"),
  servings: z.number().int().positive().default(4),
  /** danh sách slug của CatalogDish tạo thành mâm. */
  dishSlugs: z.array(z.string()).min(2, "mâm cần ít nhất 2 món"),
  note: z.string().nullish().default(null),
});
export type SetMenuData = z.infer<typeof setMenuSchema>;
export type SetMenuInput = z.input<typeof setMenuSchema>;
