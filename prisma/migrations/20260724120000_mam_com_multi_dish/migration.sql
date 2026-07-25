-- 1) Khử trùng PlannedMeal theo (familyId, date, mealType): giữ bản mới nhất.
-- PlannedMeal KHÔNG có cột createdAt (xem migration init) nên xếp theo id:
-- cuid() có tiền tố timestamp -> thứ tự từ điển trùng thứ tự tạo.
DELETE FROM "PlannedMeal" p
USING "PlannedMeal" q
WHERE p."familyId" = q."familyId"
  AND p."date" = q."date"
  AND p."mealType" = q."mealType"
  AND p."id" < q."id";

-- 2) Bảng MealDish.
CREATE TABLE "MealDish" (
    "id" TEXT NOT NULL,
    "plannedMealId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "dishRole" "DishRole" NOT NULL DEFAULT 'MON_MAN',
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "MealDish_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MealDish_plannedMealId_idx" ON "MealDish"("plannedMealId");

-- 3) Chuyển mỗi PlannedMeal cũ thành 1 MealDish (id suy từ id gốc -> không trùng).
INSERT INTO "MealDish" ("id", "plannedMealId", "recipeId", "dishRole", "position")
SELECT 'mdmig_' || "id", "id", "recipeId", 'MON_MAN', 0
FROM "PlannedMeal";

-- 4) Khoá ngoại + ràng buộc duy nhất.
ALTER TABLE "MealDish"
  ADD CONSTRAINT "MealDish_plannedMealId_fkey"
  FOREIGN KEY ("plannedMealId") REFERENCES "PlannedMeal"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MealDish"
  ADD CONSTRAINT "MealDish_recipeId_fkey"
  FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "PlannedMeal_familyId_date_mealType_key"
  ON "PlannedMeal"("familyId", "date", "mealType");

-- 5) Bỏ cột recipeId cũ khỏi PlannedMeal.
ALTER TABLE "PlannedMeal" DROP COLUMN "recipeId";

-- 6) Thêm cột dishCount cho GenerationJob.
ALTER TABLE "GenerationJob" ADD COLUMN "dishCount" INTEGER;
