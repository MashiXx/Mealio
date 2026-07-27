-- Ghi chú "chuẩn bị trước" cho một công thức ("chiều ướp sẵn thịt, tối chỉ kho").
-- Cột nullable nên công thức cũ đọc nguyên vẹn; không cần data migration.
ALTER TABLE "Recipe" ADD COLUMN "prepAheadNote" TEXT;
