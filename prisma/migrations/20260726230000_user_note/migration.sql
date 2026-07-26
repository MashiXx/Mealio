-- Gợi ý riêng cho một lần sinh thực đơn ("nay thèm đồ ngọt", "tuần này ăn gà").
-- Cột nullable nên job cũ đọc nguyên vẹn; không cần data migration.
ALTER TABLE "GenerationJob" ADD COLUMN "userNote" TEXT;
