# Kho món ăn gia đình (Dish Catalog) — Thiết kế

Ngày: 2026-07-11

## Mục tiêu

Xây bộ dữ liệu **món ăn gia đình Việt/Á** có công thức, phân nhóm, chỉ mục,
ghi chú và ảnh minh họa (giấy phép mở), dùng cho hai việc:

1. **Seed DB** làm kho gợi ý dùng chung (mọi gia đình), để app đề xuất/lọc món
   nhanh mà không bắt buộc gọi AI.
2. **Tham chiếu few-shot cho AI**: rút một tập món liên quan chèn vào prompt để
   AI sinh thực đơn bám sát món Việt thật, chất lượng hơn.

Bao gồm cả **set menu** (mâm cơm hoàn chỉnh: cơm + món mặn + canh + rau…), là
phần "gợi ý đầy đủ một bữa" cho người dùng.

## Quyết định đã chốt (brainstorm với chủ dự án)

- Mục đích: **seed DB lẫn tham chiếu AI**.
- Ảnh: **tải ảnh giấy phép mở** (Wikimedia Commons / CC) về `public/dishes/`,
  trỏ đường dẫn nội bộ; món chưa có ảnh hợp lệ để `imageUrl = null` (fallback
  emoji theo nhóm), bổ sung sau — không dùng ảnh vi phạm bản quyền.
- Nội dung công thức: **soạn lại bằng lời riêng** (tham chiếu web cho chính xác),
  tránh sao chép nguyên văn.
- Phạm vi: món gia đình Việt/Á, "càng nhiều càng tốt" — làm theo **mẻ có kiểm
  soát chất lượng**, kiến trúc mở rộng dễ. Mẻ đầu ~50–70 món + ~15 set menu.

## Kiến trúc (hướng A)

**Nguồn chân lý = file TypeScript** trong `src/data/catalog/`, validate bằng zod
lúc import. **Copy vào DB** qua model catalog toàn cục (không gắn `familyId`) để
duyệt/lọc/adopt. **AI few-shot** đọc thẳng từ file TS (lọc trong bộ nhớ).

### Model Prisma (toàn cục, không `familyId`)

- `CatalogDish`: slug (unique), name, aliases[], dishRole, region, mealTypes[],
  servings, cookMinutes, difficulty, budgetLevel, steps[], ingredients (Json:
  `[{name,quantity,unit}]`), nutritionLabels[], tags[], notes?, imageUrl?,
  imageCredit?.
- `CatalogSetMenu`: slug, name, occasion, region, servings, note?, items[].
- `CatalogSetMenuItem`: liên kết set menu ↔ dish (slug/id).
- Enum mới: `DishRole` (MON_MAN, MON_XAO, CANH_SUP, RAU_LUOC, LAU, COM_BUN_PHO,
  MON_CUON, TRANG_MIENG, DO_CHUA), `Difficulty` (EASY, MEDIUM, HARD).
- Tái dùng enum sẵn có: `CuisineRegion`, `MealType`, `BudgetLevel`.

Ingredients lưu Json (không nối `Ingredient` per-family) — catalog là dữ liệu
dùng chung, không cần chuẩn hoá kho; khớp shape `aiIngredientSchema`.

### File dữ liệu

- `src/data/catalog/types.ts` — zod + type `CatalogDishData`, `SetMenuData`.
- `src/data/catalog/dishes/*.ts` — món chia theo vai trò (mon-man, mon-xao,
  canh, rau, lau, com-bun-pho, cuon, trang-mieng, do-chua). Mỗi file 1 mảng.
- `src/data/catalog/set-menus.ts` — set menu tham chiếu dish theo slug.
- `src/data/catalog/index.ts` — gộp + validate toàn bộ + index (bySlug, byRole,
  byRegion, theo tag) + kiểm tra slug trùng và slug set-menu trỏ tới dish tồn tại.

### Seed & tích hợp

- `prisma/seed.ts` (chạy bằng `tsx`, cấu hình `prisma.seed` + script `db:seed`):
  upsert `CatalogDish` theo slug, dựng lại set menu.
- AI: `buildCatalogReference(ctx)` trong `src/lib/catalog.ts` — loại món chứa
  nguyên liệu dị ứng / phạm kiêng khem, ưu tiên đúng vùng khẩu vị, chọn tập đa
  dạng; `buildMenuPrompt` chèn thêm "Món tham khảo" + "Gợi ý mâm".
- Adopt: action chép 1 `CatalogDish` thành `Recipe` của gia đình (Json ingredients
  → upsert `Ingredient` + `RecipeIngredient`), tái dùng logic kiểu `saveMenu`.

## Phân nhóm / chỉ mục / ghi chú

- **dishRole** (vai trò trong mâm), **region** (Bắc/Trung/Nam/Á khác qua tags),
  **mealTypes** (sáng/trưa/tối), **nutritionLabels** (tái dùng nhãn hiện có),
  **tags** lọc an toàn (chứa hải sản/đậu phộng/trứng/bò/heo/gà; chay…),
  **difficulty**, **budgetLevel**, **cookMinutes**, **notes** (mẹo/biến tấu).
- Chỉ mục dựng trong `index.ts` để tra cứu O(1) theo slug/role/tag.

## Tuân thủ bản quyền

- Công thức viết lại bằng lời riêng.
- Ảnh chỉ lấy nguồn giấy phép mở; lưu `imageCredit` (tác giả + giấy phép +
  URL nguồn) để tuân CC-BY. Thiếu ảnh hợp lệ thì bỏ trống.

## Ngoài phạm vi (mẻ sau)

- UI trang duyệt catalog / trang chi tiết món.
- Ảnh đầy đủ cho 100% món.
- Catalog do người dùng tự đóng góp.
