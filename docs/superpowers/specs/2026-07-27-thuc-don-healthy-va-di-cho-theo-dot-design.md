# Thiết kế: Thực đơn healthy theo nhu cầu thật & Đi chợ theo đợt

Ngày: 2026-07-27
Trạng thái: đã brainstorm & chốt hướng.

## Bối cảnh

Người dùng đưa một prompt Gemini kèm kết quả (`task.txt`) và nói "đây đúng là cái
tôi cần". Đối chiếu với app: phần lớn **nền tảng đã có** — món Việt qua catalog,
dị ứng/kiêng theo từng thành viên, ngân sách, vùng khẩu vị, số lượng + đơn vị khi
đi chợ, cơ cấu 3-4 món, luật không trùng đạm hai ngày liền. Thứ khiến kết quả
Gemini "đúng ý" hơn phần nhiều là **những điều app chưa nói với AI**, không phải
kiến trúc thiếu.

Chín khoảng trống, nằm ở bốn hệ độc lập:

| # | task.txt đòi | Hiện trạng |
|---|---|---|
| 1 | Ưu tiên hấp/luộc/áp chảo/kho ít dầu/nướng, hạn chế chiên rán | Không có khái niệm phương pháp nấu |
| 2 | Không lặp nguyên liệu chính quá 2 lần/tuần | R4 chỉ chặn hai ngày **liền nhau** |
| 3 | Ghi chú món chuẩn bị trước được | Không có |
| 4 | Đi chợ theo đợt 2 ngày/lần | Một danh sách gộp duy nhất |
| 5 | Nhóm Thịt-Cá / Rau củ / Trái cây / Gia vị | `IngredientKind` chỉ có `MAIN`, `SEASONING` |
| 6 | Mâm 4 món = đạm + rau + canh + tráng miệng | Mâm 4 món = mặn + xào + rau luộc + canh |
| 7 | Tổng hợp nguyên liệu dùng nhiều trong tuần | Không có |
| 8 | 5 mẹo meal prep | Không có |
| 9 | Ông bà: mềm, dễ nhai, ít muối | `ageGroup` vào prompt nhưng không thành luật nào |

## Quyết định phạm vi (người dùng đã chốt)

- **Làm hết cả bốn hệ**, không làm từng đợt rời.
- **Chốt cứng theo task.txt**, KHÔNG thêm màn hình cài đặt: ưu tiên healthy, mâm
  4 món có tráng miệng, đi chợ 2 ngày một đợt là hằng số trong code. Đổi ý thì
  sửa code. Đánh đổi này người dùng chọn để tránh phình schema và UI cài đặt.

## Thứ tự thực thi

A → D → B → C. Ba migration: `Recipe.prepAheadNote` (pha D),
`ShoppingItem.batchIndex` (pha B), `MealPlan.summaryJson` (pha C).

---

# Pha A — Chất lượng mâm

## A1. Phương pháp nấu

Thêm luật vào phần **system** của cả `buildMenuPrompt` và `buildWeekPlanPrompt`:

- Ưu tiên: hấp, luộc, áp chảo, kho ít dầu, nướng.
- Hạn chế: chiên/rán ngập dầu, thực phẩm chế biến sẵn, quá nhiều tinh bột, quá
  nhiều dầu mỡ.

**Chỉ prompt, KHÔNG verify.** "Hạn chế" là mức độ chứ không phải luật nhị phân.
Bắt tên món theo từ khoá "chiên/rán" sẽ đánh oan "chả rán" hay "bò né áp chảo" và
đốt một vòng sinh lại cho thứ không sai hẳn — cùng lập luận đã dùng để miễn trừ
`DO_CHUA` khỏi R3.

## A2. Không lặp đạm quá 2 lần/tuần (R5)

Thêm R5 vào `verifyWeekPlan`: đếm `mainProtein` trên các món `MON_MAN` trong toàn
khoảng, vượt ngưỡng thì báo vi phạm.

Ngưỡng **không** cố định bằng 2:

```
cap = max(2, ceil(số món MON_MAN / số đạm được phép))
```

Số đạm được phép = `MAIN_PROTEINS` lọc theo kiêng khem của gia đình: nhà ăn chay
rụng hết `THIT_HEO`/`THIT_BO`/`THIT_GA`/`CA`/`TOM_CUA`, chỉ còn `DAU_PHU`,
`RAU_CU`, `TRUNG`. Hàm lọc là hàm thuần, nhận danh sách thành viên, test được.

Ép cứng ngưỡng 2 thì thực đơn 7 ngày của nhà ăn chay **không có lời giải** (3 đạm
không phủ nổi 7 bữa với trần 2), job sẽ sinh lại một vòng vô ích rồi vẫn nhận
khung vi phạm. Đây đúng là cái bẫy mà R4 đã ghi chú ("nhà ăn chay sẽ không có lời
giải nào").

## A3. Tráng miệng vào mâm 4 món

Trong `mainMealRoles`, đổi `extras` từ:

```
["MON_XAO", "RAU_LUOC", "TRANG_MIENG", "MON_MAN"]
```

thành:

```
["MON_XAO", "TRANG_MIENG", "RAU_LUOC", "MON_MAN"]
```

Kết quả: 3 món giữ nguyên (mặn + xào + canh), **4 món thành mặn + xào + canh +
tráng miệng**. `ROLE_RANK` lo thứ tự hiển thị nên không phải sửa gì thêm.

Đây là **đổi hành vi mặc định**: nhà từ 5 người trở lên đang tự động nhận 4 món
sẽ thấy rau luộc bị thay bằng tráng miệng. Đúng ý task.txt.

Phải sửa `meal-structure.test.ts`: ca ">=5 người: 4 món" và ca "override N=5".

## A4. Luật theo nhóm tuổi

Hàm thuần `ageNotesBlock(members)` trong `prompt.ts`, sinh luật từ `ageGroup` đã
có sẵn:

- Có `SENIOR` → món mềm, dễ nhai, ninh/hấp nhừ, ít muối, ít dầu mỡ.
- Có `CHILD` hoặc `TEEN` → đủ đạm và canxi cho trẻ đang lớn, không quá cay.
- Có `BABY` → món mềm, nhạt, cắt nhỏ.

Chèn vào phần user của cả hai prompt sinh. Thuần nên test được bằng vitest.

## A5. Thời gian theo bữa

Thêm một câu vào phần user: cả mâm nên nấu xong trong khoảng `maxCookMinutes`
phút, các món nấu song song được. Tái dùng knob sẵn có thay vì thêm trường —
`maxCookMinutes` hiện chỉ được diễn giải là "tối đa mỗi món".

---

# Pha D — Ghi chú chuẩn bị trước

- **Schema**: `Recipe.prepAheadNote String?` (nullable, migration).
- **Schema AI**: thêm `prepAheadNote: z.string().default("")` vào `aiDishSchema`.
  Có `.default` nên mọi đường gọi cũ và `catalogDishToAiDish` không gãy; món lấy
  từ catalog để rỗng.
- **Prompt**: đòi trường này trong cả `buildMenuPrompt` và `buildEditPrompt`, cập
  nhật chuỗi mô tả cấu trúc JSON.
- **Lưu**: `createRecipeFromDish` ghi xuống, chuỗi rỗng lưu thành `null`.
- **Hiển thị**: `DishInfo` hiện ghi chú khi có.

---

# Pha B — Đi chợ theo đợt

## Chia đợt

Thêm `ShoppingItem.batchIndex Int @default(0)` (migration).

`syncShopping` gom nhu cầu theo đợt **2 ngày**, tính từ ngày sớm nhất trong các
mâm sắp tới:

```
batchIndex = floor((ngày của mâm - ngày sớm nhất) / 2)
```

`mergeNeeds` chạy **trong từng đợt** thay vì gộp toàn cục — nếu không, cà chua
dùng ở ngày 1 và ngày 4 sẽ gộp thành một dòng và mất thông tin đợt.

## Vì sao KHÔNG tách thành nhiều `ShoppingList`

Hướng "mỗi đợt một danh sách" phá bất biến "một danh sách đang mở" mà
`lockFamily` đang bảo vệ, kéo theo phải định nghĩa lại `openListId`, `closedAt`
và chỗ đứng của dòng `manual`. Một cột `batchIndex` đạt cùng kết quả hiển thị mà
không đụng vào logic khoá.

Dòng `manual` (người dùng tự gõ) giữ `batchIndex = 0` — nó không thuộc mâm nào.

## Nhóm nguyên liệu

**KHÔNG** mở rộng `IngredientKind`. Cột đó đang lái logic kho (`MAIN` = "có đồ để
nấu" ở chế độ `AVAILABLE_ONLY`, dùng trong `missingFor` và chốt chặn kho rỗng ở
`actions/menu.ts` lẫn `jobs.ts`). Thêm `THIT_CA`/`RAU_CU` vào enum đó là làm hỏng
nghĩa của nó ở mọi chỗ đang so `kind === "MAIN"`.

Thay vào đó: hàm thuần `ingredientGroup(name)` tra bảng tĩnh, trả
`THIT_CA | RAU_CU | TRAI_CAY | GIA_VI | KHAC`. Đúng khuôn `staticKind` +
`src/data/seasonings.ts` đã có, **không cần schema**, test được bằng vitest.

Trang `/shopping` gom theo đợt rồi gom theo nhóm trong mỗi đợt.

---

# Pha C — Tóm tắt tuần

Tách đôi theo độ tin cậy:

- **Nguyên liệu dùng nhiều**: tính **thuần** từ `MealDish → Recipe →
  RecipeIngredient` của `MealPlan`, không gọi AI. Luôn đúng, không tốn gì.
  Đếm theo **số món** dùng nguyên liệu đó, và **bỏ qua gia vị**: muối, nước mắm,
  tỏi có mặt ở gần như mọi món nên đứng đầu bảng là chuyện hiển nhiên, xếp hạng
  chúng không nói lên điều gì về đợt này.
- **5 mẹo meal prep**: một lời gọi AI **theo yêu cầu**, kết quả lưu vào
  `MealPlan.summaryJson`. Prompt cố ý chỉ gửi TÊN món chứ không gửi công thức
  đầy đủ — mẹo là chuyện sắp xếp công việc, mà nhồi 14 công thức vào thì prompt
  phình vô ích và Ollama trên CPU không kham.

Không nhét vào `runPlanJob`: repo cố ý giữ mỗi job đúng **một** lời gọi AI để
không job nào chạm ngưỡng treo (xem `jobs.ts:213`). Thêm một lời gọi nữa vào đó
là phá chính bất biến vừa dựng ở đợt trước.

Chỗ đứng: một khối trên **Dashboard**, gắn với đợt có nhiều mâm sắp tới nhất —
đó là "tuần này" theo nghĩa người dùng hiểu, kể cả khi còn sót vài mâm lẻ của đợt
trước. Nhà chỉ sinh từng ngày lẻ thì không có `MealPlan` nên khối này ẩn hẳn.

---

## Rủi ro & đánh đổi đã chấp nhận

- **A3 đổi hành vi cho thực đơn đang có**: nhà ≥5 người sẽ thấy mâm auto khác đi.
  Chấp nhận vì đó là yêu cầu.
- **Chốt cứng thay vì cấu hình**: đổi ưu tiên healthy hay số ngày mỗi đợt đều
  phải sửa code. Người dùng chọn đánh đổi này để đi nhanh.
- **A1 không verify**: AI vẫn có thể trả món chiên rán. Chấp nhận, vì verify sẽ
  đánh oan nhiều hơn bắt đúng.
- **Pha C tốn thêm một lời gọi AI**, nhưng theo yêu cầu và có cache nên không
  đụng đường sinh thực đơn.
