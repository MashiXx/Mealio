CREATE TYPE "EditScope" AS ENUM ('DISH', 'MEAL', 'ADD');

ALTER TABLE "MealDish" ADD COLUMN "chatHistory" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "PlannedMeal" ADD COLUMN "chatHistory" JSONB NOT NULL DEFAULT '[]';

CREATE TABLE "EditJob" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "plannedMealId" TEXT NOT NULL,
    "scope" "EditScope" NOT NULL,
    "mealDishId" TEXT,
    "instruction" TEXT NOT NULL,
    "useHistory" BOOLEAN NOT NULL DEFAULT false,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "EditJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EditJob_familyId_status_idx" ON "EditJob"("familyId", "status");
CREATE INDEX "EditJob_plannedMealId_idx" ON "EditJob"("plannedMealId");
ALTER TABLE "EditJob" ADD CONSTRAINT "EditJob_familyId_fkey"
  FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EditJob" ADD CONSTRAINT "EditJob_plannedMealId_fkey"
  FOREIGN KEY ("plannedMealId") REFERENCES "PlannedMeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
