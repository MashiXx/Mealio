-- Đợt đi chợ của một dòng: 0 = đợt đầu, 1 = đợt kế... Mỗi đợt gom 2 ngày.
-- NOT NULL DEFAULT 0 nên dòng cũ (và mọi dòng người dùng tự gõ) rơi vào đợt đầu,
-- không cần data migration.
ALTER TABLE "ShoppingItem" ADD COLUMN "batchIndex" INTEGER NOT NULL DEFAULT 0;
