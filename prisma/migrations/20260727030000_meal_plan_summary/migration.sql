-- Tóm tắt cả đợt: mẹo meal prep do AI sinh theo yêu cầu, lưu lại để không phải
-- gọi AI mỗi lần mở trang. Nullable nên đợt cũ đọc nguyên vẹn.
-- Phần "nguyên liệu dùng nhiều" KHÔNG lưu ở đây: nó tính thuần từ mâm nên luôn
-- đúng, lưu lại chỉ tạo thêm một bản sao có thể lệch.
ALTER TABLE "MealPlan" ADD COLUMN "summaryJson" JSONB;
