-- Phân loại nguyên liệu: MAIN bị verify/đi chợ/rời kho, SEASONING bỏ qua cả ba.
CREATE TYPE "IngredientKind" AS ENUM ('MAIN', 'SEASONING');
CREATE TYPE "PantryMode" AS ENUM ('AVAILABLE_ONLY', 'FLEXIBLE');

ALTER TABLE "Ingredient" ADD COLUMN "kind" "IngredientKind" NOT NULL DEFAULT 'MAIN';

-- Kho là danh sách "đang có gì", không định lượng. Bảng đang rỗng trên mọi môi
-- trường nên bỏ cột không mất dữ liệu.
ALTER TABLE "PantryItem" DROP COLUMN "quantity";
ALTER TABLE "PantryItem" DROP COLUMN "unit";

-- Khử trùng phòng trường hợp có dữ liệu: giữ dòng id lớn nhất mỗi (family, nguyên liệu).
DELETE FROM "PantryItem" p
USING "PantryItem" q
WHERE p."familyId" = q."familyId"
  AND p."ingredientId" = q."ingredientId"
  AND p."id" < q."id";

CREATE UNIQUE INDEX "PantryItem_familyId_ingredientId_key"
  ON "PantryItem"("familyId", "ingredientId");

ALTER TABLE "PlannedMeal" ADD COLUMN "cookedAt" TIMESTAMP(3);
ALTER TABLE "GenerationJob" ADD COLUMN "pantryMode" "PantryMode" NOT NULL DEFAULT 'FLEXIBLE';
ALTER TABLE "ShoppingList" ADD COLUMN "closedAt" TIMESTAMP(3);
