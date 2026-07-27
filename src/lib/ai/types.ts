import type {
  AiMenu,
  AiWeekPlan,
  AiEditResult,
  AiMealPrep,
  MemberRecognition,
} from "./schema";

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
  /**
   * Khung cả khoảng ngày ở dạng gọn, để lời gọi NỞ của một ngày vẫn biết các
   * ngày khác ăn gì mà không lặp nguyên liệu chính. null/undefined = luồng một
   * ngày, prompt không đổi gì.
   *
   * Dùng trường RIÊNG chứ không mượn retryNote: retryNote mang nghĩa "lần trước
   * sai, sửa đi" và prompt đặt nó ở vị trí sửa lỗi — nhồi khung tuần vào đó sẽ
   * khiến mọi lời gọi nở trông như một lần sinh lại sau lỗi.
   */
  planContext?: string | null;
  /**
   * Ý muốn riêng cho LẦN NÀY do người dùng gõ ("nay thèm đồ ngọt").
   *
   * KHÔNG được thắng luật dị ứng/kiêng khem — xem cách đặt trong prompt: nó nằm
   * ở phần user dưới nhãn "ý muốn", còn luật an toàn nằm ở phần system kèm câu
   * nói rõ luật an toàn thắng khi mâu thuẫn.
   */
  userNote?: string | null;
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

/**
 * Ngữ cảnh xin mẹo meal prep cho cả đợt. Cố ý GỌN: chỉ tên món, nguyên liệu
 * dùng nhiều và mốc thời gian — không kèm công thức đầy đủ, vì mẹo là chuyện sắp
 * xếp công việc chứ không phải chuyện nấu từng món.
 */
export interface MealPrepContext {
  familySize: number;
  days: number;
  dishNames: string[];
  topIngredients: string[];
  /** Thời gian nấu hiện tại của một mâm; mẹo cần kéo xuống thấp hơn mốc này. */
  maxCookMinutes: number;
}

/** Kết quả kiểm tra kết nối nhẹ: danh sách model id endpoint báo là khả dụng. */
export interface TestConnectionResult {
  models: string[];
}

/** Giao diện chung cho mọi nhà cung cấp AI (adapter). */
export interface AIProvider {
  /**
   * Pha 1 của sinh nhiều ngày: khung cho cả khoảng (chỉ tên món + vai trò + đạm
   * chính + nhãn dinh dưỡng). Cho model thấy trọn khoảng ngày trong một lượt mà
   * output vẫn nhỏ hơn một ngày đầy đủ công thức.
   */
  generateWeekPlan(ctx: MenuContext): Promise<AiWeekPlan>;
  generateMenu(ctx: MenuContext): Promise<AiMenu>;
  editMeal(ctx: EditContext): Promise<AiEditResult>;
  /** Mẹo chuẩn bị trước cho cả đợt. Gọi THEO YÊU CẦU, không nằm trong luồng job. */
  mealPrepTips(ctx: MealPrepContext): Promise<AiMealPrep>;
  recognizeMember(image: MemberImage): Promise<MemberRecognition>;
  /**
   * Gọi thử endpoint bằng lệnh liệt kê model (tốn ~0 token) để xác nhận
   * kết nối + xác thực. Ném lỗi khi không kết nối được / auth sai.
   */
  testConnection(): Promise<TestConnectionResult>;
}
