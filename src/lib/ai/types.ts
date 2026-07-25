import type { AiMenu, AiEditResult, MemberRecognition } from "./schema";

export type ImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif";

export interface MemberImage {
  base64: string; // dữ liệu ảnh base64 (không kèm tiền tố data:)
  mediaType: ImageMediaType;
}

export type MealTypeStr = "BREAKFAST" | "LUNCH" | "DINNER";

export type DishRoleStr =
  | "MON_MAN"
  | "MON_XAO"
  | "CANH_SUP"
  | "RAU_LUOC"
  | "LAU"
  | "COM_BUN_PHO"
  | "MON_CUON"
  | "TRANG_MIENG"
  | "DO_CHUA";

export interface MenuSlot {
  date: string; // yyyy-mm-dd
  mealType: MealTypeStr;
  dishRoles: DishRoleStr[]; // cơ cấu mâm do server tính
}

export type EditScopeStr = "DISH" | "MEAL" | "ADD";

// type (không phải interface) để có index signature ngầm -> gán được vào Prisma Json.
export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export interface EditDishView {
  name: string;
  dishRole: DishRoleStr;
  nutritionLabels: string[];
  ingredientNames: string[];
}

export interface MenuMember {
  name: string;
  ageGroup: string;
  allergies: string[];
  dietaryRestrictions: string[];
  likes: string[];
  dislikes: string[];
}

export interface MenuProfile {
  cuisineRegion: string;
  spiceLevel: string;
  budgetLevel: string;
  maxCookMinutes: number;
  healthGoals: string[];
  notes?: string | null;
}

/** Tham chiếu few-shot rút từ kho món dùng chung (đã lọc theo dị ứng/kiêng). */
export interface CatalogReference {
  dishNames: string[];
  setMenus: { name: string; dishNames: string[] }[];
}

export interface MenuContext {
  familySize: number;
  members: MenuMember[];
  profile: MenuProfile;
  // Kho không định lượng nữa: chỉ cần biết có gì và thứ nào sắp hết hạn. `kind`
  // đi kèm để phía gọi dựng được KindLookup mà không phải truy vấn DB lần nữa.
  pantry: { name: string; expiringSoon: boolean; kind: "MAIN" | "SEASONING" }[];
  recentRecipeNames: string[]; // tránh lặp lại
  availableRecipeNames: string[]; // kho công thức đã có để ưu tiên tái dùng
  slots: MenuSlot[];
  catalogReference?: CatalogReference; // gợi ý món Việt tham khảo cho AI
  // Kho là danh sách trắng (AVAILABLE_ONLY) hay chỉ gợi ý ưu tiên (FLEXIBLE).
  pantryMode: "AVAILABLE_ONLY" | "FLEXIBLE";
  retryNote?: string; // câu nhắc khi sinh lại do vi phạm kho
}

/** Ngữ cảnh cho một lần SỬA mâm (per-món hoặc cả mâm). */
export interface EditContext {
  scope: EditScopeStr;
  mealType: MealTypeStr;
  servings: number;
  members: MenuMember[];
  profile: MenuProfile;
  currentDishes: EditDishView[]; // trạng thái hiện tại của mâm (nguồn chân lý)
  targetRole?: DishRoleStr; // vai trò món đích khi scope=DISH
  history: ChatTurn[]; // 4-5 lượt gần nhất; rỗng nếu không dùng
  instruction: string; // lệnh mới
  recentRecipeNames: string[]; // tránh lặp
  catalogReference?: CatalogReference;
}

/** Kết quả kiểm tra kết nối nhẹ: danh sách model id endpoint báo là khả dụng. */
export interface TestConnectionResult {
  models: string[];
}

/** Giao diện chung cho mọi nhà cung cấp AI (adapter). */
export interface AIProvider {
  generateMenu(ctx: MenuContext): Promise<AiMenu>;
  editMeal(ctx: EditContext): Promise<AiEditResult>;
  recognizeMember(image: MemberImage): Promise<MemberRecognition>;
  /**
   * Gọi thử endpoint bằng lệnh liệt kê model (tốn ~0 token) để xác nhận
   * kết nối + xác thực. Ném lỗi khi không kết nối được / auth sai.
   */
  testConnection(): Promise<TestConnectionResult>;
}
