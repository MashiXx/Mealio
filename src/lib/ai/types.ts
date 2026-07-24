import type { AiMenu, MemberRecognition } from "./schema";

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

export interface MenuPantryItem {
  name: string;
  quantity: number;
  unit: string;
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
  pantry: MenuPantryItem[];
  recentRecipeNames: string[]; // tránh lặp lại
  availableRecipeNames: string[]; // kho công thức đã có để ưu tiên tái dùng
  slots: MenuSlot[];
  catalogReference?: CatalogReference; // gợi ý món Việt tham khảo cho AI
}

/** Kết quả kiểm tra kết nối nhẹ: danh sách model id endpoint báo là khả dụng. */
export interface TestConnectionResult {
  models: string[];
}

/** Giao diện chung cho mọi nhà cung cấp AI (adapter). */
export interface AIProvider {
  generateMenu(ctx: MenuContext): Promise<AiMenu>;
  recognizeMember(image: MemberImage): Promise<MemberRecognition>;
  /**
   * Gọi thử endpoint bằng lệnh liệt kê model (tốn ~0 token) để xác nhận
   * kết nối + xác thực. Ném lỗi khi không kết nối được / auth sai.
   */
  testConnection(): Promise<TestConnectionResult>;
}
