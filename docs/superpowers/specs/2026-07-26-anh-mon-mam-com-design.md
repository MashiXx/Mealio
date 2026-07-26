# Thiết kế: Ảnh món ăn & bố cục mâm cơm

Ngày: 2026-07-26
Trạng thái: đã brainstorm & chốt hướng.

## Bối cảnh

Mâm cơm ở dashboard hiện là một danh sách chữ: nhãn vai trò, tên món, số phút,
một dòng nguyên liệu, `<details>` cách làm. Không có ảnh, không có trọng tâm thị
giác — người dùng mô tả là "nhàm chán".

Nghịch lý: hạ tầng ảnh **đã có sẵn và đang chạy**, chỉ là dashboard không với tới
được.

| Thành phần | Nơi có | Thực tế |
|---|---|---|
| Tải ảnh giấy phép mở | `scripts/fetch_dish_images.py`, `pin_images.py` | Chạy được, đã tải 27 ảnh |
| Ảnh tĩnh | `public/dishes/*.jpg` | 27 file |
| Ghi công | `src/data/catalog/image-credits.json` | 27 mục, overlay vào món ở `index.ts:78` |
| Hiển thị ảnh | `CatalogBrowser.tsx:107` | Chỉ trang **Kho món ăn** |
| Mâm ở dashboard | `MealCard.tsx` | **Không một dòng nào đụng tới ảnh** |

Nguyên nhân gốc: mâm không render món catalog. Nó render `Recipe` do AI sinh, và
`Recipe` **không có khoá ngoại nào trỏ về `CatalogDish`** (`prisma/schema.prisma:225`).
Kho có ảnh cũng vô ích vì không có đường nối tên món AI → slug catalog.

Hai vấn đề phụ đi kèm:

- Ảnh mới phủ **27/69 món** catalog (39%).
- `imageCredit` được tính ở `index.ts:81` nhưng **không hiển thị ở bất kỳ đâu**.
  Ảnh CC BY / CC BY-SA bắt buộc ghi công → đây là lỗi tuân thủ giấy phép, và
  càng thêm ảnh thì càng nặng.

## Mục tiêu

1. Mâm cơm có ảnh, có trọng tâm — nhìn ra được bữa ăn chứ không phải bảng chữ.
2. Món không có ảnh vẫn **trông tử tế**, không để ô xám.
3. Sửa lỗi ghi công giấy phép.
4. Không migration, không đụng luồng AI.

## Quyết định khi brainstorm

- **Khớp lúc đọc, không lưu vào DB.** Không cần migration, và toàn bộ mâm cũ
  trong Lịch sử đẹp lên ngay mà không phải backfill. Đánh đổi: khớp lại mỗi lần
  render — chấp nhận được vì chỉ là tra Map trong bộ nhớ.
- **Nguồn ảnh chỉ Wikimedia Commons** (mở rộng cái đang có) + fallback gradient.
  Không AI sinh ảnh (tốn tiền, ảnh món Việt hay sai chi tiết), không upload của
  người dùng ở lần này (thêm nút, resize client, dọn file — để sau).
- **Bố cục hero + lưới thumbnail**, không phải mâm tròn nhìn từ trên. Mâm tròn
  đặc trưng hơn nhưng không co giãn được từ 2 tới 6 món, chật trên mobile, và
  không còn chỗ đặt nút thao tác.
- **Fallback phải đẹp là yêu cầu bắt buộc, không phải phụ.** Commons không có
  ảnh tốt cho mọi món nhà Việt; dự kiến sau khi mở rộng vẫn còn ~15-25% món
  catalog không ảnh, chưa kể món AI bịa ra ngoài catalog thì luôn không ảnh.
  Nếu fallback xấu thì mâm trông vá víu, tệ hơn hiện tại.
- **Khớp chứa phải có canh gác.** Không có chốt chặn thì tên catalog ngắn sẽ
  nuốt mọi món (`"cá"` khớp mọi món có chữ cá). Thà bỏ sót còn hơn gán nhầm ảnh.

---

## 1. Lớp khớp ảnh — `src/lib/dish-image.ts` (mới)

Module thuần, không đụng DB, không async. Dựng chỉ mục một lần lúc import.

```ts
export type DishVisual = {
  imageUrl: string | null;   // "/dishes/thit-kho-tau.jpg"
  credit: string | null;     // chuỗi ghi công, bắt buộc hiện khi có imageUrl
  emoji: string;             // fallback theo vai trò
  gradientClass: string;     // nền fallback, class Tailwind
  slug: string | null;       // slug catalog đã khớp (null nếu trượt)
};

export function resolveDishVisual(name: string, dishRole: string): DishVisual;
```

### Chỉ mục

Dựng từ `allDishes` (`@/data/catalog`), khoá qua `normalizeIngredient` từ
`@/lib/normalize`:

- `byName: Map<string, CatalogDishData>` — từ `dish.name` **cùng các biến thể
  ngoặc đơn** (xem dưới).
- `byAlias: Map<string, CatalogDishData>` — từ từng phần tử `dish.aliases`
  (trường đã có trong schema `types.ts:71` nhưng đang bỏ không). Alias trùng khoá
  với `byName` thì **bỏ qua**; alias trùng nhau thì món khai báo trước thắng.
- `containKeys: {key, dish}[]` — mọi khoá của `byName` và `byAlias` có
  **độ dài ≥ 6 ký tự**, sắp xếp giảm dần theo độ dài.

#### Biến thể ngoặc đơn (bắt buộc)

`normalizeIngredient` biến dấu ngoặc thành khoảng trắng, nên tên có ngoặc bị
dính thành một chuỗi vô dụng:

```
"Thịt kho tàu (thịt kho trứng)"  →  "thit kho tau thit kho trung"
"Nem rán (chả giò)"              →  "nem ran cha gio"
```

Hậu quả nếu không xử lý: AI trả `"Thịt kho tàu"` sẽ **trượt hoàn toàn** — không
khớp tên (chuỗi khác nhau), không khớp alias, không khớp chứa (khoá catalog dài
hơn tên AI nên phép chứa ngược chiều). Đây là món phổ biến bậc nhất **và đang có
ảnh**, trượt nó thì tính năng coi như hỏng.

Nên khi dựng chỉ mục, mỗi món nạp thêm 2 loại khoá tách từ tên gốc **trước khi**
chuẩn hoá:

- phần ngoài ngoặc: `name.replace(/\([^)]*\)/g, " ")` → `"thit kho tau"`
- từng phần trong ngoặc: `"thit kho trung"`, `"cha gio"`

Hiện catalog có đúng 2 món dạng này (`thit-kho-tau`, `nem-ran`), nhưng luật phải
nằm trong code chứ không sửa tay dữ liệu — món thêm sau vẫn đúng.

#### Ngưỡng độ dài khoá

Ngưỡng là **6 ký tự** (đã chuẩn hoá), không phải 8. Tên món ngắn nhất trong
catalog là `"pho bo"` và `"com ga"` (6); để ngưỡng 8 thì phở bò, bún chả, xôi
xéo, cháo gà, cơm gà **mất hẳn** khả năng khớp chứa, tức `"Phở bò tái nạm"` do AI
sinh sẽ không có ảnh. Ở mức 6, hai chốt chặn còn lại (biên từ + trùng vai trò) đã
đủ chặn khớp bừa.

### Thứ tự khớp

Dừng ở tầng đầu tiên trúng:

1. `byName.get(n)` với `n = normalizeIngredient(name)`
2. `byAlias.get(n)`
3. Duyệt `containKeys` (dài trước): trúng khi **cả hai** điều kiện đúng
   - `` ` ${n} ` `` chứa `` ` ${key} ` `` — đệm khoảng trắng hai đầu để chặn khớp
     giữa từ (`"ga"` không được khớp trong `"gao"`)
   - `dish.dishRole === dishRole`
4. Trượt cả ba → fallback

Ví dụ: `"Thịt kho tàu kiểu miền Nam"` + `MON_MAN` → tầng 3 trúng `thit-kho-tau`
qua khoá biến thể `"thit kho tau"`. `"Cá kho"` + `MON_MAN` → tầng 2 trúng
`ca-kho-to` qua alias. `"Cá"` + `MON_MAN` → trượt (`"ca"` dưới ngưỡng 6).

### Kết quả

- Khớp được **và** món đó có `imageUrl` → trả ảnh + ghi công + slug.
- Khớp được nhưng món **chưa có ảnh** → trả fallback, `slug` vẫn điền.
- Trượt → fallback, `slug = null`.

Fallback lấy emoji + gradient theo `dishRole`; vai trò lạ dùng `🍽️` + gradient
trung tính.

### Bảng vai trò dùng chung

`ROLE_META` (emoji từng vai trò) hiện là bản sao cục bộ trong
`CatalogBrowser.tsx:34-44`. Dời sang `dish-image.ts`, bổ sung `gradientClass`,
sửa `CatalogBrowser` import từ đó. Nhãn tiếng Việt vẫn lấy từ `DISH_ROLE_LABEL`
(`src/lib/enums.ts`) — không nhân đôi nhãn.

---

## 2. `DishPhoto.tsx` (mới, cạnh `DishInfo.tsx`)

**Không** đặt `"use client"` — giống `DishInfo.tsx`, để dùng được cả ở dashboard
(client) lẫn history (server).

```tsx
<DishPhoto name={...} dishRole={...} size="hero" | "thumb" />
```

- Có `imageUrl`: `next/image` với `fill` + `object-cover`, `sizes` khác nhau theo
  `size`. Ảnh nằm trong `public/` nên **không cần** cấu hình `images.remotePatterns`
  trong `next.config.ts`.
- Không có: `gradientClass` + emoji cỡ lớn, độ mờ thấp, canh giữa.
- Có ghi công: dòng `credit` cỡ `text-[10px]` màu nhạt, đặt dưới ảnh ở `hero`.
  Ở `thumb` **không** nhồi chữ vào ô nhỏ — ghi công hiện ở nơi món được trình bày
  chi tiết: panel chi tiết (dashboard), thẻ món trong danh sách tĩnh (history),
  thẻ `DishCard` (Kho món).

---

## 3. Bố cục mâm — sửa `MealCard.tsx`

### Chọn món hero

Thứ tự ưu tiên vai trò:

```
MON_MAN → LAU → COM_BUN_PHO → MON_XAO → CANH_SUP → MON_CUON → RAU_LUOC → DO_CHUA → TRANG_MIENG
```

Sắp món theo `(chỉ số ưu tiên, position)`. Hero = **món đầu tiên có ảnh thật**
trong thứ tự đó. Ngoại lệ: nếu các món có ảnh đều thuộc nhóm đáy
(`TRANG_MIENG`, `DO_CHUA`) thì hero = món đầu theo ưu tiên bất kể có ảnh hay
không — chè làm ảnh bìa bữa tối là sai, thà để gradient món mặn.

### Cấu trúc

```
┌──────────────────────────────────┐
│ [Bữa tối] 4 người · 4 món · 45′  │  ← header giữ nguyên
│           [Đã nấu] [cảnh báo…]   │
│ ┌──────────────────────────────┐ │
│ │  ẢNH HERO (aspect 16/9)      │ │
│ │  [Món mặn] Thịt kho tàu      │ │  ← nhãn phủ trên scrim gradient đáy
│ └──────────────────────────────┘ │
│ ┌────┐ ┌────┐ ┌────┐             │  ← lưới: 2 cột mobile, 4 cột desktop
│ │canh│ │xào │ │rau │             │     ô vuông + tên dưới ảnh
│ └────┘ └────┘ └────┘             │
│ ┌──────────────────────────────┐ │
│ │ PANEL CHI TIẾT (món đang chọn)│ │
│ │ DishInfo + nút thao tác + chat│ │
│ └──────────────────────────────┘ │
│ [+ Thêm món] [Chat cả mâm]       │  ← giữ nguyên
└──────────────────────────────────┘
```

### Panel chi tiết

State `selectedDishId` trong `MealCard`, mặc định là id món hero. Bấm hero hoặc
bất kỳ ô thumbnail nào → đổi món đang chọn. Panel hiện đúng nội dung cũ của thẻ
món: `DishInfo`, nhóm nút (Đổi món, Đổi đạm, Điều chỉnh nhanh ▾, Chat, Xóa), và
`ChatBox` khi mở.

**Đánh đổi đã chấp nhận:** trước đây nguyên liệu mọi món phơi sẵn, liếc một cái
là thấy cả mâm; giờ phải bấm từng món. Đổi lấy bố cục gọn và có ảnh.

Quy tắc biên:

- Mâm 1 món: chỉ hero, bỏ lưới, panel ngay dưới.
- Món đang bận (`busyDishIds`): ô thumbnail mờ đi + spinner phủ, giống cách
  `opacity-60` đang làm.
- Món đang chọn bị xoá → `selectedDishId` quay về món hero.
- Nút Xóa vẫn khoá khi mâm chỉ còn 1 món (giữ nguyên luật hiện tại).

---

## 4. Trang Lịch sử — `history/page.tsx`

Là server component, không có state. **Không** dùng panel bấm-để-chọn ở đây.
Thay vào đó: chèn hero + lưới thumbnail làm phần đầu thị giác, rồi **giữ nguyên**
danh sách `DishInfo` tĩnh bên dưới như hiện tại. Khác dashboard một chút nhưng
không phải thêm client component chỉ để xem lại mâm cũ.

---

## 5. Trang Kho món — `CatalogBrowser.tsx`

- `DishCard`: thêm dòng ghi công dưới ảnh (sửa lỗi tuân thủ ở mục Bối cảnh).
- Phần **Mâm cơm gợi ý** hiện chỉ liệt kê tên món bằng chữ
  (`CatalogBrowser.tsx:315`). Đổi sang hero + lưới thumbnail dùng chung
  `DishPhoto`. Dữ liệu đã sẵn: `getSetMenuDishes()` trả `CatalogDishData` kèm
  `imageUrl`. Cần bổ sung `dishRole` + `imageUrl` vào type `BrowseSetMenu`
  (hiện chỉ có `dishNames: string[]`) và map thêm ở `catalog/page.tsx`.
- Xoá `ROLE_META` cục bộ, import từ `dish-image.ts`.

---

## 6. Mở rộng phủ ảnh

1. Bổ sung 42 slug còn thiếu vào bảng `SEARCH` trong `fetch_dish_images.py`.
2. Chạy `probe_images.py` để liệt kê ứng viên + giấy phép, **soi bằng mắt** xem
   có đúng món không.
3. Món nào có ảnh đúng → ghim tên File chính xác vào `PINS` của `pin_images.py`
   rồi chạy; món nào Commons không có ảnh tốt → **bỏ qua**, để fallback lo.

Dự kiến thêm được khoảng 25-35 món. Không đặt chỉ tiêu phủ 100%: ghim ảnh sai
món tệ hơn nhiều so với gradient sạch sẽ.

Bất biến sẵn có ở `index.ts:84` (có `imageUrl` mà thiếu `imageCredit` thì ném
lỗi lúc build) giữ nguyên — nó là thứ bắt lỗi ghi công thiếu.

---

## 7. Kiểm thử

`src/lib/dish-image.test.ts` (vitest, theo khuôn `pantry.test.ts`):

| Ca | Kỳ vọng |
|---|---|
| Tên trùng khớp chính xác món có ảnh | trả đúng `imageUrl` + `credit` |
| Tên có dấu/hoa thường khác nhau | vẫn khớp (qua `normalizeIngredient`) |
| Khớp qua `aliases` | trả đúng slug |
| Tên AI dài chứa trọn tên catalog, đúng vai trò | tầng 3 trúng |
| Tên AI chứa tên catalog nhưng **sai vai trò** | **trượt** → fallback |
| `"Thịt kho tàu"` (tên catalog có ngoặc đơn) | khớp `thit-kho-tau`, có ảnh |
| `"Nem rán"` và `"Chả giò"` | cùng khớp `nem-ran` |
| Khoá catalog < 6 ký tự | **không** vào `containKeys`, trượt |
| Khớp giữa từ (vd `"ga"` trong `"gao"`) | **trượt** (đệm khoảng trắng) |
| Món khớp nhưng chưa có ảnh | fallback, `slug` vẫn điền |
| Món hoàn toàn lạ | fallback, `slug = null` |
| `dishRole` không nằm trong 9 vai trò | emoji `🍽️`, không ném lỗi |
| Mọi món có `imageUrl` đều có `credit` | bất biến toàn catalog |

Chọn hero là logic thuần → tách thành hàm xuất khẩu (`pickHeroDish`) và test
riêng: ưu tiên vai trò, ưu tiên món có ảnh, ngoại lệ nhóm đáy, mâm 1 món.

---

## Ràng buộc & lưu ý kỹ thuật

- **Next.js 16.2.9 (breaking):** đã đọc
  `node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md`.
  Ghi nhận:
  - `priority` **đã deprecated từ Next 16**, thay bằng `preload`; nhưng tài liệu
    khuyên "in most cases, you should use `loading="eager"` or
    `fetchPriority="high"` instead of `preload`" → ảnh hero dùng
    `loading="eager"`, **không** dùng `priority`.
  - `fill` yêu cầu phần tử cha có `position: relative | fixed | absolute`.
  - Prop `objectFit` đã bị bỏ từ v13 → dùng `className="object-cover"`, đúng như
    `CatalogBrowser.tsx:114` đang làm.
- `DishPhoto` và `DishInfo` **không** được đặt `"use client"` — chúng phải chạy
  được ở cả history (server) lẫn MealCard (client).
- Không migration, không đụng `prisma/schema.prisma`, không đụng
  `src/lib/ai/*` hay server actions.
- Ảnh Commons kích thước lệch nhau → luôn bọc trong khung có tỉ lệ cố định +
  `object-cover`, không để ảnh tự quyết chiều cao.

## Tiêu chí hoàn thành

1. Mâm ở dashboard hiện ảnh hero + lưới thumbnail; món không khớp được ảnh vẫn
   ra gradient + emoji đúng vai trò, không có ô xám trống.
2. Bấm ô bất kỳ → panel đổi đúng món; đủ 6 thao tác cũ (Đổi món, Đổi đạm, Điều
   chỉnh nhanh, Chat, Xóa, và + Thêm món cấp mâm) vẫn chạy.
3. Trang Lịch sử có hero + lưới, danh sách chi tiết bên dưới giữ nguyên.
4. Mâm cơm gợi ý ở Kho món có ảnh.
5. Mọi ảnh CC BY / CC BY-SA hiển thị ghi công ở giao diện.
6. `yarn test` pass, `yarn lint` sạch, `yarn build` pass.
7. Phủ ảnh catalog tăng từ 27 lên ít nhất 45 món, không có ảnh sai món.

## Ngoài phạm vi

- Người dùng tự chụp/tải ảnh món nhà mình (hạ tầng đã có ở
  `member-image.ts`, để lần sau).
- AI sinh ảnh.
- Lưu `catalogSlug` vào `Recipe` (chỉ cần khi có tính năng ghi đè ảnh thủ công).
- Bố cục mâm tròn nhìn từ trên.
- Panel bấm-để-chọn ở trang Lịch sử.
