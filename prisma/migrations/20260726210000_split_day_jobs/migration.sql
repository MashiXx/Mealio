-- Tách đợt sinh nhiều ngày thành nhiều job nhỏ, mỗi job một lời gọi AI.
-- Job cũ trong DB mặc định SINGLE nên đọc nguyên vẹn; không cần data migration.

CREATE TYPE "GenerationJobKind" AS ENUM ('SINGLE', 'PLAN', 'EXPAND_DAY');

ALTER TABLE "GenerationJob"
  ADD COLUMN "kind" "GenerationJobKind" NOT NULL DEFAULT 'SINGLE',
  ADD COLUMN "parentJobId" TEXT,
  ADD COLUMN "dayOffset" INTEGER;

-- Khung thực đơn cả đợt; mỗi job-ngày đọc lại để không trùng món giữa các ngày.
ALTER TABLE "MealPlan" ADD COLUMN "planJson" JSONB;
