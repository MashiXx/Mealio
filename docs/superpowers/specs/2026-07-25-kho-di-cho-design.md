# Thiết kế: Kho thực phẩm ↔ Thực đơn ↔ Đi chợ (Giai đoạn 4)

Ngày: 2026-07-25
Trạng thái: đã brainstorm & chốt hướng.

## Bối cảnh

Một người nội trợ chạy vòng lặp: nhìn kho còn gì → lên thực đơn → ra danh sách đi
chợ → mua về nhập kho → nấu → trừ kho. Mealio hiện chỉ làm **một mắt xích**: sinh
thực đơn. Các mắt xích khác đã có bảng trong DB nhưng không có code:

| Thành phần | Bảng | Thực tế |
|---|---|---|
| Kho thực phẩm | `PantryItem` | Chỉ **đọc** ở `menu.ts`. Không trang, không action ghi → luôn rỗng |
| Đi chợ | `ShoppingList`, `ShoppingItem` | Không một dòng code nào đụng tới |
| Hồ sơ ăn uống | `EatingProfile` | Tạo một lần ở `onboarding.ts`, không sửa được |

Hệ quả: luật trong prompt *"tận dụng thực phẩm đang có trong kho"*
(`src/lib/ai/prompt.ts:71`) **chưa bao giờ có tác dụng** — khối kho gửi cho AI
luôn rỗng. Sau khi có thực đơn cũng không có gì dẫn tới việc đi chợ.

## Mục tiêu

1. Kho nhà **nhập được**, nhẹ tay đến mức người ta chịu dùng.
2. Sinh thực đơn **dựa trên kho**, hai chế độ do người dùng chọn.
3. Danh sách đi chợ **tự sinh** từ phần thiếu; tick "đã mua" thì vào kho.
4. Nấu xong, đồ tươi **tự rời kho**.

## Quyết định khi brainstorm

- Kho chỉ ghi **"đang có gì"** + hạn dùng tuỳ chọn, **không quản số lượng**. Mỗi ô
  phải nhập là một lý do bỏ cuộc, và đó là lý do kho đang rỗng.
- **Đi chợ thì có số lượng** — lấy từ công thức, không lấy từ kho. Nhìn tủ lạnh là
  biết còn cà chua hay không, nhưng ra chợ phải biết mua bao nhiêu.
- Một cờ `IngredientKind` quyết định **ba** hành vi (verify / đi chợ / rời kho).
- **Cả hai chế độ đều do AI nghĩ món.** Khác nhau ở chỗ kho là ràng buộc hay gợi ý.
- Model có thể không tuân luật → **code verify lại**, chỉ verify nguyên liệu chính.
- Kho món (`src/data/catalog`) có nguyên liệu thật — dùng làm **gợi ý mềm** theo
  nguyên liệu trùng với kho nhà.

---

## 1. Thay đổi dữ liệu

```prisma
enum IngredientKind {
  MAIN       // thịt, cá, trứng, đậu, rau củ
  SEASONING  // gia vị, đồ khô, rau thơm, chanh, ớt
}

model Ingredient {
  // ...
  kind IngredientKind @default(MAIN)
}

model PantryItem {
  // BỎ: quantity, unit — không bao giờ hiển thị, giữ lại chỉ tạo nợ
  // GIỮ: expiresAt
}

model PlannedMeal {
  // ...
  cookedAt DateTime?   // kích hoạt việc đồ tươi rời kho
}

model GenerationJob {
  // ...
  pantryMode PantryMode @default(FLEXIBLE)
}

enum PantryMode {
  AVAILABLE_ONLY   // kho là danh sách trắng
  FLEXIBLE         // kho là gợi ý
}

model ShoppingList {
  // ...
  closedAt DateTime?   // mỗi gia đình một danh sách đang mở
}
```

`ShoppingItem` giữ nguyên — `quantity`, `unit`, `purchased` đều đúng nhu cầu.

`PantryItem` đang rỗng hoàn toàn trên mọi môi trường nên bỏ cột không mất dữ liệu.

Migration: `20260725170000_pantry_shopping`.

### Phân loại MAIN / SEASONING

Gán tự động lúc `ingredient.upsert` dựa trên danh sách tĩnh mới
**`src/data/seasonings.ts`** (mắm, muối, đường, dầu ăn, tỏi, hành khô, tiêu, nước
tương, giấm, hành lá, ngò, ớt, chanh, gừng, sả…). So khớp bằng `normalizeIngredient`.
Người dùng đổi được tay trên trang kho.

**Đánh đổi đã chấp nhận:** món cần tương đen mà nhà hết thì app không nhắc. Đổi lại
không bị hỏi mua muối mỗi tuần. Gia vị vẫn hiện đủ trong nguyên liệu của món ở bảng
chính, và thêm tay vào danh sách đi chợ được.

### Bảng đồng nghĩa

**`src/data/ingredient-aliases.ts`** cho các cặp hay gặp (hành lá/hành hoa,
ngò/rau mùi, đậu phụ/đậu hũ). Không cố giải bài toán khớp ngữ nghĩa: "thịt ba chỉ"
và "thịt lợn" vẫn là hai thứ khác nhau.

---

## 2. Module `src/lib/pantry.ts`

Một chỗ duy nhất trả lời "món này nấu được không, thiếu gì". Thuần logic, không
chạm DB — để test được bằng vitest như `meal-structure.ts`.

```ts
type PantrySet = Set<string>;            // các normalized đang có
type Need = { name: string; quantity: number; unit: string };

/** Nguyên liệu MAIN của món mà kho không có. SEASONING luôn bỏ qua. */
function missingFor(needs: Need[], pantry: PantrySet, kindOf: (n: string) => IngredientKind): Need[]

/** Món trong kho món có nguyên liệu chính trùng kho nhà — dùng làm gợi ý mềm. */
function suggestFromPantry(dishes: CatalogDish[], pantry: PantrySet): CatalogDish[]

/** Gộp nhu cầu nhiều món: trùng nguyên liệu thì cộng, khác đơn vị thì tách dòng. */
function mergeNeeds(needs: Need[]): Need[]
```

Dùng chung cho cả bước verify lúc sinh thực đơn lẫn việc tính danh sách đi chợ.

---

## 3. Trang `/pantry` — kho nhà

Thêm vào nav ở `src/app/(app)/layout.tsx`, đặt giữa "Tạo thực đơn" và "Kho món".

- Danh sách phẳng, nhóm **Đồ tươi** trước, **Gia vị & đồ khô** sau.
- Ô "thêm nhanh": gõ tên, Enter là xong. Không hỏi số lượng, không hỏi đơn vị.
  Hạn dùng là ô phụ, bỏ trống được.
- Mỗi dòng: nút xoá (đã hết), sửa hạn dùng, đổi MAIN ↔ SEASONING.
- Sắp hết hạn (≤ 2 ngày) hiện nhãn cảnh báo — dữ liệu này cũng vào prompt để AI
  ưu tiên dùng trước.

Server actions mới trong `src/lib/actions/pantry.ts`: `addPantryItemAction`,
`removePantryItemAction`, `updatePantryItemAction`.

---

## 4. Sinh thực đơn hai chế độ

Chế độ chọn ở `NewMenuForm` → `startGenerationAction` lưu vào
`GenerationJob.pantryMode` → `jobs.ts` truyền xuống `buildMenuContext`.

### 4.1 Khối kho trong prompt

Thay `pantryText` hiện tại (`prompt.ts:96-98`) — bỏ số lượng, tách gia vị:

**FLEXIBLE** (kho là gợi ý):
```
Thực phẩm nhà đang có (ưu tiên dùng, được phép mua thêm):
  - cá thu
  - đậu phụ            ⚠ nên dùng trước 27/07
```

**AVAILABLE_ONLY** (kho là danh sách trắng):
```
NGUYÊN LIỆU ĐƯỢC PHÉP DÙNG — nhà chỉ có bấy nhiêu:
  - cá thu
  - đậu phụ
  - cà chua
Gia vị luôn có, dùng thoải mái: mắm, muối, đường, dầu, tỏi, hành khô, tiêu.

LUẬT CỨNG: KHÔNG dùng bất kỳ nguyên liệu nào ngoài hai danh sách trên.
Nghĩ món Việt quen thuộc từ đúng những thứ này.
```

### 4.2 Gợi ý mềm từ kho món

Ở cả hai chế độ, `suggestFromPantry` lọc kho món theo nguyên liệu trùng rồi đưa
tên vào khối "Món Việt tham khảo" đã có. Nhà có cá thu thì gợi ý "cá thu kho, cá
thu sốt cà" để model bám món Việt thật thay vì bịa. Đây là lần đầu nguyên liệu
thật trong kho món được dùng tới.

### 4.3 Verify sau khi sinh — chỉ nguyên liệu chính

```
AI trả mâm
  → missingFor(nguyên liệu MAIN của từng món, kho)
     rỗng  → lưu
     có    → sinh lại MỘT lần, nói rõ sai ở đâu:
              "Món 'Bò xào cần tỏi' dùng thịt bò và cần tây không có trong kho.
               Chỉ được dùng: cá thu, đậu phụ, cà chua."
            → vẫn sai → GIỮ mâm, đánh dấu món đó "cần mua thêm: thịt bò"
                        và đẩy đúng phần thiếu sang danh sách đi chợ
```

Chỉ áp cho `AVAILABLE_ONLY`. Chỉ sinh lại **một** lần — vi phạm hai lần thì giữ
mâm còn hơn bắt người dùng chờ thêm một vòng Ollama trên CPU.

Ở chế độ này danh sách đi chợ thường **rỗng** — đó là mục đích.

### 4.4 Khi kho quá nghèo

Kho rỗng mà chọn `AVAILABLE_ONLY` → chặn ngay ở form, không tạo job.

Kho có nhưng AI trả về **ít món hơn số vai trò yêu cầu** (nhà chỉ còn trứng thì
không nặn ra đủ mặn + canh + rau được): giữ mâm với số món trả về, không lấp bừa,
và hiện thông báo trên bảng chính:

> Kho hiện đủ nấu 2/3 món cho bữa tối. Thêm rau xanh hoặc đồ tươi vào kho, hoặc
> chuyển sang chế độ Thoải mái.

Không coi đây là job FAILED — mâm hai món vẫn dùng được, chỉ cần nói thật.

---

## 5. Trang `/shopping` — đi chợ

Sau khi mâm được lưu (cả hai chế độ):

```
gom RecipeIngredient MAIN của các món trong mâm
  → trừ những gì kho đang có          (missingFor)
  → gộp trùng, cộng số lượng cùng đơn vị  (mergeNeeds)
  → ghi vào ShoppingList đang mở của gia đình
```

"Đang mở" = bản ghi có `closedAt = null`. Chưa có thì tạo mới ngay lúc đó, nên
người dùng không bao giờ phải tự tạo danh sách. Nguyên liệu đã nằm trong danh sách
mà chưa mua thì không thêm dòng trùng — cộng dồn số lượng vào dòng cũ.

Trang là danh sách phẳng, tick từng dòng khi mua. **Tick "đã mua" thì nguyên liệu
vào kho ngay** — đây là chỗ khép vòng, và là cách kho được nuôi mà không phải nhập
tay. Bấm "Xong buổi chợ" thì `closedAt = now()`, lần sau mở danh sách mới.

Thêm tay được một dòng bất kỳ (hết chai nước mắm thì tự thêm).

Server actions trong `src/lib/actions/shopping.ts`: `togglePurchasedAction`,
`addShoppingItemAction`, `closeShoppingListAction`.

---

## 6. Đánh dấu đã nấu

Nút "Đã nấu" trên `MealCard` ở bảng chính → `cookedAt = now()` → xoá những
`PantryItem` mà nguyên liệu của nó **vừa là `MAIN` vừa xuất hiện trong
`RecipeIngredient` của một món thuộc mâm đó**. Nguyên liệu trong kho không liên
quan tới mâm thì không đụng tới. Gia vị ở lại kể cả khi món có dùng.

Không có số lượng nên không thể trừ một phần — đã nấu nghĩa là hết. Người dùng
thêm lại tay nếu còn thừa. Đây là đánh đổi đã chấp nhận khi chọn kho không định
lượng.

`cookedAt` cũng là dữ liệu thật cho `/history`: hiện lịch sử chỉ suy từ ngày, không
biết bữa đó có thật sự nấu hay không.

---

## 7. Kiểm thử

Vitest, thuần logic, không cần DB — theo đúng cách `meal-structure.test.ts` và
`schema.test.ts` đang làm.

- **`pantry.test.ts`** — `missingFor` khớp tên có dấu/không dấu, qua bảng đồng
  nghĩa, SEASONING không bao giờ bị coi là thiếu; `suggestFromPantry` chỉ trả món
  có nguyên liệu chính trùng; `mergeNeeds` cộng đúng khi cùng đơn vị và tách dòng
  khi khác đơn vị.
- **`verify.test.ts`** — phát hiện đúng món dùng nguyên liệu MAIN ngoài kho, không
  báo nhầm gia vị, mâm hợp lệ thì trả rỗng.

Phần gọi AI giữ nguyên hiện trạng, không test.

---

## 8. Tiêu chí hoàn thành

- [ ] Thêm được nguyên liệu vào kho bằng một ô gõ + Enter, không hỏi số lượng.
- [ ] Chọn "Nấu bằng đồ có sẵn" với kho gồm cá thu + đậu phụ + cà chua → thực đơn
      chỉ dùng đúng những thứ đó (+ gia vị), danh sách đi chợ rỗng.
- [ ] Chọn "Thoải mái" → thực đơn phong phú hơn, phần thiếu xuất hiện đầy đủ ở
      `/shopping` kèm số lượng.
- [ ] Tick "đã mua" ở `/shopping` → nguyên liệu xuất hiện ngay trong `/pantry`.
- [ ] Bấm "Đã nấu" → đồ tươi của mâm rời kho, gia vị ở lại.
- [ ] Kho rỗng mà chọn "Đồ có sẵn" → chặn ở form kèm lời nhắc, không tạo job.
- [ ] Kho không đủ lấp vai trò món → báo rõ thiếu bao nhiêu, không sinh bừa.
- [ ] `yarn test` xanh, `tsc --noEmit` sạch, `yarn lint` sạch.

---

## 9. Ngoài phạm vi

- Định lượng kho (số lượng, đơn vị, tự trừ theo công thức).
- Theo dõi dinh dưỡng bằng số; nhìn lại cân bằng dinh dưỡng theo tuần.
- Gợi ý kiểu "mua thêm 2 thứ là nấu được thêm 6 món".
- Trang sửa `EatingProfile` (đang thiếu, nhưng là việc riêng).
- Khớp nguyên liệu theo ngữ nghĩa ngoài bảng đồng nghĩa tĩnh.
