-- Sinh thực đơn nhiều ngày. Cả ba cột đều có DEFAULT nên job cũ đọc được
-- nguyên vẹn như job một ngày; không cần data migration.
ALTER TABLE "GenerationJob" ADD COLUMN "days" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "GenerationJob" ADD COLUMN "doneDays" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GenerationJob" ADD COLUMN "mealPlanId" TEXT;
