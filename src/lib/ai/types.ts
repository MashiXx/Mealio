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

export interface MenuContext {
  familySize: number;
  members: MenuMember[];
  profile: MenuProfile;
  pantry: MenuPantryItem[];
  recentRecipeNames: string[]; // tránh lặp lại
  availableRecipeNames: string[]; // kho công thức đã có để ưu tiên tái dùng
  slots: MenuSlot[];
}

/** Giao diện chung cho mọi nhà cung cấp AI (adapter). */
export interface AIProvider {
  generateMenu(ctx: MenuContext): Promise<AiMenu>;
  recognizeMember(image: MemberImage): Promise<MemberRecognition>;
}
