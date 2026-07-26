# Thiết kế: Sinh thực đơn nhiều ngày (Giai đoạn 5A)

Ngày: 2026-07-26
Trạng thái: đã brainstorm & chốt hướng.

## Bối cảnh

Sinh thực đơn hiện làm **một ngày một lần**: form có đúng một ô `<input type="date">`,
`GenerationJob.date` là một cột `DateTime` đơn, và `runGenerationJob` dựng slot
bằng `job.mealTypes.map(m => ({ date: ymd(job.date), mealType: m }))`
(`src/lib/jobs.ts:154`). Muốn cả tuần thì phải bấm bảy lần.

Điều bất ngờ khi khảo sát: **lõi đã đa ngày sẵn**.

| Thành phần | Trạng thái |
|---|---|
| `buildMenuContext(familyId, rawSlots, …)` | nhận **danh sách slot, mỗi slot mang ngày riêng** |
| `saveMenu` | lặp `menu.meals`, mỗi meal có `date` riêng, xoá-rồi-tạo theo (ngày, bữa) |
| `aiMealSchema` | đã có trường `date` |
| `MealPlan` (`startDate`, `endDate`, `meals`) | **bảng chết — không một dòng code nào đụng tới** |

Nút thắt chỉ nằm ở tầng job và form.

## Vì sao không lặp từng ngày độc lập

Cách rẻ nhất là tạo bảy job, mỗi job một ngày. Chống lặp món có vẻ tự có: chạy
tuần tự (`MENU_GEN_CONCURRENCY` mặc định 1) nên ngày 3 nhìn thấy recipe của ngày
1-2 qua `recentRecipeNames`.

Nhưng tín hiệu đó quá yếu cho yêu cầu thật:

- `recentRecipeNames` chỉ là **12 cái tên**, không mang vai trò, không mang đạm
  chính, không mang nhãn dinh dưỡng. Luật trong prompt cũng chỉ là một câu mềm
  `"- Không lặp lại các món đã ăn gần đây."` (`src/lib/ai/prompt.ts:66`).
- Nó **chỉ nhìn về sau**. Ngày 1 không biết ngày 7 sẽ có gì, nên không thể xoay
  vòng đạm hay cân dinh dưỡng cho cả tuần — chỉ tránh trùng với quá khứ.

Yêu cầu người dùng nêu rõ: *AI phải đánh giá được thực đơn các ngày trong quan hệ
với nhau*. Điều đó đòi model **thấy trọn khoảng ngày trong một lượt**.

Còn gọi AI đúng một lần cho cả tuần với đầy đủ công thức thì bất khả thi: 7 ngày
× 2 bữa × ~3 món ≈ 42 món kèm nguyên liệu và các bước. Prompt khổng lồ, tỉ lệ
hỏng cao, và dự án hỗ trợ Ollama tự host trên CPU — nơi *một* vòng sinh đã mất
hàng phút (ghi chú sẵn có ở `src/lib/jobs.ts:169`).

## Mục tiêu

1. Sinh một lượt cho **1 tới 7 ngày**.
2. AI **thấy cả khoảng ngày cùng lúc** để xoay vòng đạm, tránh lặp, cân dinh dưỡng.
3. Prompt mỗi lượt vẫn đủ nhỏ để Ollama trên CPU chạy được.
4. Hỏng giữa chừng vẫn giữ được các ngày đã xong.

## Quyết định khi brainstorm

- **Hai pha: dựng khung tuần rồi nở từng ngày.** Pha 1 cho AI thấy trọn khoảng
  ngày nhưng chỉ đòi khung (tên món + vai trò + đạm chính + nhãn dinh dưỡng),
  không nguyên liệu, không cách làm. Pha 2 nở từng ngày.
- **Món khớp catalog thì lấy công thức từ catalog, không gọi AI.** Đổi hành vi
  hiện tại (AI tự viết công thức mỗi lần) và người dùng đã chốt giữ. Công thức
  catalog là công thức thật, đã kiểm, lại cắt phần lớn lời gọi AI ở pha 2.
- **Một job mang cả khoảng ngày**, không phải bảy job. Giữ nguyên được chốt "mỗi
  nhà một job đang chạy", dashboard vẫn một thẻ, và tiến độ hiện dạng "3/7 ngày".
- **Code verify khung**, đúng lệ repo: model có thể phớt lờ luật cứng thì code
  kiểm lại. Sinh lại **đúng một vòng** rồi thôi — y hệt cách `AVAILABLE_ONLY`
  đang làm (`src/lib/jobs.ts:193-226`), vì bắt người dùng chờ vòng Ollama thứ ba
  tệ hơn là nhận một khung chưa hoàn hảo.
- **Đánh thức `MealPlan`.** Bảng đã có sẵn đúng hình dạng cần (`startDate`,
  `endDate`, `meals`); sinh nhiều ngày chính là lý do nó tồn tại.

---

## 1. Khung tuần — schema AI mới

Thêm vào `src/lib/ai/schema.ts`, **không đụng** `aiMenuSchema` sẵn có (pha 2 vẫn
dùng nó):

```ts
/** Trục đạm chính — dùng để xoay vòng và bắt lặp giữa các ngày. Cố ý HẸP:
 *  enum mở thì model trả về "thịt" và "thịt heo" là hai giá trị khác nhau,
 *  luật "hai ngày liền không trùng đạm" mất tác dụng. */
export const MAIN_PROTEINS = [
  "THIT_HEO", "THIT_BO", "THIT_GA", "CA",
  "TOM_CUA", "TRUNG", "DAU_PHU", "RAU_CU",
] as const;

export const aiPlanDishSchema = z.object({
  name: z.string().min(1),
  dishRole: z.enum(DISH_ROLES),
  mainProtein: z.enum(MAIN_PROTEINS),
  nutritionLabels: z.array(z.string()).default([]),
});

export const aiPlanMealSchema = z.object({
  date: z.string(),                                  // yyyy-mm-dd
  mealType: z.enum(["BREAKFAST", "LUNCH", "DINNER"]),
  dishes: z.array(aiPlanDishSchema).min(1),
});

export const aiWeekPlanSchema = z.object({
  meals: z.array(aiPlanMealSchema).min(1),
});
export type AiWeekPlan = z.infer<typeof aiWeekPlanSchema>;
```

Ước lượng kích thước: 7 ngày × 2 bữa × 3 món = 42 dòng, mỗi dòng 4 trường ngắn.
Nhỏ hơn **một** ngày đầy đủ công thức của luồng hiện tại.

## 2. Provider: thêm một lời gọi, không sửa lời gọi cũ

`src/lib/ai/types.ts` thêm `generateWeekPlan(ctx: MenuContext): Promise<AiWeekPlan>`
vào interface provider. Ba adapter (`anthropic.ts`, `openai-compatible.ts`,
`ollama.ts`) đều cài, dùng lại đúng đường gọi JSON-schema sẵn có của từng cái —
chỉ đổi schema và prompt.

Prompt khung dựng ở `src/lib/ai/prompt.ts` (hàm mới `buildWeekPlanPrompt`), tái
dùng nguyên các khối đã có: hồ sơ gia đình, dị ứng/kiêng, kho nhà, tham chiếu
catalog. Thêm phần riêng của khung:

- Bảng slot đầy đủ: mỗi (ngày, bữa) kèm danh sách vai trò từ `planMealStructure`.
- Luật cứng: không lặp tên món trong cả khoảng; món mặn hai ngày liền không cùng
  `mainProtein`; trải đều nhãn dinh dưỡng.
- Nhắc rõ **chỉ trả khung**, không nguyên liệu, không các bước.

## 3. Verify khung — `src/lib/week-plan.ts` (mới)

Hàm thuần, không chạm DB, test bằng vitest:

```ts
export function verifyWeekPlan(plan: AiWeekPlan, slots: MenuSlot[]): string[];
```

Trả về danh sách vi phạm bằng tiếng Việt (khuôn giống `verifyMenuAgainstPantry`):

| Luật | Nội dung |
|---|---|
| R1 | Mỗi slot đã yêu cầu phải có mặt, và multiset vai trò phải khớp `slot.dishRoles` |
| R2 | Không có (ngày, bữa) nào ngoài danh sách slot đã yêu cầu |
| R3 | Không hai món trùng tên (so sánh qua `normalizeIngredient`) trong cả khoảng, **trừ vai trò `DO_CHUA`** |
| R4 | Món `MON_MAN` của hai ngày **liên tiếp** không cùng `mainProtein` |

R3 tha `DO_CHUA` vì dưa cà là thứ ăn kèm quanh năm — bắt mỗi ngày một loại đồ
chua khác nhau là luật vô lý, và nó sẽ đốt vòng sinh lại cho một "vi phạm" mà
người dùng còn chẳng coi là vi phạm.

R4 chỉ xét ngày liên tiếp chứ không cấm trùng toàn khoảng: cấm tuyệt đối thì 7
ngày cần 7 loại đạm khác nhau trong khi enum chỉ có 8 giá trị, và nhà ăn chay sẽ
không có lời giải nào.

Vi phạm → sinh lại **một** vòng với `retryNote` (cơ chế `MenuContext.retryNote`
đã có sẵn, `src/lib/menu.ts:23`). Vi phạm tiếp thì **nhận luôn** khung đó — giữ
đúng lập luận ở `src/lib/jobs.ts:193-196`.

## 4. Nở khung thành công thức — `src/lib/expand-plan.ts` (mới)

Với mỗi ngày trong khung:

1. Từng món thử `findCatalogDish(name, dishRole)`. Khớp → dựng `AiDish` từ dữ
   liệu catalog (`ingredients`, `steps`, `cookMinutes`, `nutritionLabels`),
   **không gọi AI**.
2. Các món còn lại của ngày đó gom thành **một** lời gọi AI (`generateMenu` sẵn
   có, với `ctx.slots` thu hẹp còn đúng các món chưa nở).
3. Ngày nào nở xong thì gọi `saveMenu` **ngay cho ngày đó** rồi tăng
   `GenerationJob.doneDays`. Đây là thứ khiến hỏng giữa chừng vẫn giữ được phần
   trước.

Trường hợp cả 7 ngày đều khớp catalog hoàn toàn → tổng cộng đúng **một** lời gọi
AI cho cả tuần.

### Chốt chặn dị ứng khi lấy công thức catalog (BẮT BUỘC)

`buildCatalogReference` đã lọc dị ứng/kiêng khem **trước khi** đưa tên món vào
prompt, nhưng `findCatalogDish` khớp theo tên trên **toàn bộ** catalog — kể cả
món đã bị lọc. Nếu model tự nghĩ ra một cái tên trùng với món chứa nguyên liệu
gây dị ứng, ta sẽ nạp thẳng danh sách nguyên liệu có chất gây dị ứng vào mâm,
trong khi bản thân AI có thể đã viết công thức tránh nó.

Nên trước khi dùng công thức catalog, đối chiếu `dish.tags` với `excludeTags` từ
`deriveDietConstraints(members)` (đã có ở `src/lib/catalog.ts:30`). Phạm luật →
**bỏ đường catalog cho món đó**, đẩy sang lời gọi AI ở bước 2. Cùng cách xử lý
với `vegetarianOnly`.

Đây là ràng buộc an toàn, không phải tối ưu — không có nó thì việc rẽ sang
catalog biến thành một đường vòng qua bộ lọc dị ứng.

### Ngữ cảnh khung cho lời gọi nở

`MenuContext` thêm trường tuỳ chọn:

```ts
/** Khung cả khoảng ngày ở dạng gọn, để lời gọi nở của MỘT ngày vẫn biết các
 *  ngày khác ăn gì mà không lặp nguyên liệu chính. null = luồng một ngày. */
planContext?: string | null;
```

Dùng trường **riêng**, không mượn `retryNote`: `retryNote` mang nghĩa "lần trước
sai, sửa đi" và prompt đặt nó ở vị trí sửa lỗi. Nhồi khung tuần vào đó sẽ khiến
mọi lời gọi nở trông như một lần sinh lại sau lỗi.

### Khi một ngày nở hỏng

Ném lỗi ra ngoài để `runGenerationJob` bắt, rồi ghi job `FAILED` với thông điệp
nêu đúng ngày hỏng:

> Đã tạo xong 4/7 ngày. Ngày 16/07 lỗi: &lt;lý do&gt;. Các ngày đã tạo vẫn giữ nguyên.

Bốn ngày đầu đã `saveMenu` xong nên vẫn nằm trên dashboard.

## 5. Tách bộ khớp tên — `src/lib/catalog-match.ts` (mới)

`src/lib/dish-image.ts` đang giữ chỉ mục khớp tên món → catalog (khớp tên, alias,
biến thể ngoặc đơn, khớp chứa có canh gác), nhưng đó là logic **catalog**, không
phải logic **ảnh**. Pha 2 cần đúng bộ đó.

Chuyển phần chỉ mục và hàm khớp sang `catalog-match.ts`, xuất:

```ts
export function findCatalogDish(name: string, dishRole: string): CatalogDishData | null;
```

`dish-image.ts` giữ nguyên API công khai (`resolveDishVisual`, `pickHeroDish`,
`ROLE_VISUAL`) nhưng gọi sang module mới. Test hiện có ở `dish-image.test.ts`
tách đôi: phần khớp tên sang `catalog-match.test.ts`, phần ảnh/hero ở lại.

## 6. Thay đổi dữ liệu

```prisma
model GenerationJob {
  date       DateTime  // GIỮ NGUYÊN nghĩa: ngày ĐẦU TIÊN của khoảng
  days       Int @default(1)   // số ngày, 1..7
  doneDays   Int @default(0)   // đã lưu xong mấy ngày, cho thẻ tiến độ
  mealPlanId String?           // MealPlan của lượt sinh này
}
```

`days` để `@default(1)` nên job cũ trong DB vẫn đọc được như job một ngày —
không cần data migration.

`MealPlan` giữ nguyên hình dạng, chỉ bắt đầu được ghi. Thời điểm tạo: **ngay sau
khi khung tuần qua verify**, trước lần `saveMenu` đầu tiên — lúc đó mới biết chắc
khoảng ngày là hợp lệ, mà vẫn kịp để mọi `PlannedMeal` gắn được `mealPlanId`.
Ghi id vào `GenerationJob.mealPlanId` rồi truyền xuống `saveMenu` cho từng ngày.

`PlannedMeal.mealPlanId` có `onDelete: SetNull` nên xoá `MealPlan` không kéo theo
mâm — an toàn.

## 7. Server action & form

`startGenerationAction` nhận thêm `days`:

- Hợp lệ 1..7; ngoài khoảng → lỗi `"Số ngày phải từ 1 đến 7."`
- Chốt `AVAILABLE_ONLY` + kho rỗng giữ nguyên.
- Chốt "đang có job chạy" giữ nguyên.
- **Mới: `AVAILABLE_ONLY` chỉ cho `days = 1`.**

### Vì sao "Nấu bằng đồ có sẵn" bị giới hạn 1 ngày

Hai lý do, một sản phẩm một kỹ thuật.

Về sản phẩm: nấu bảy ngày liên tiếp thuần bằng kho hiện có là yêu cầu không có
lời giải — kho cạn sau một hai bữa. Cho chọn rồi trả về mâm hụt món suốt năm ngày
cuối là hứa điều làm không được.

Về kỹ thuật: nhánh `AVAILABLE_ONLY` hiện verify kết quả `generateMenu` bằng
`verifyMenuAgainstPantry` (`src/lib/jobs.ts:215`). Ở luồng hai pha, `generateMenu`
chỉ còn nở phần món **không** khớp catalog, nên verify tại đó là soi nhầm đối
tượng; mà bỏ hẳn verify thì chế độ này mất chốt kiểm — hồi quy chức năng. Giới
hạn 1 ngày khiến hai chế độ không bao giờ gặp nhau: `days = 1` đi **nguyên** đường
cũ (giữ cả verify kho), `days > 1` luôn là `FLEXIBLE` và đi đường hai pha.

Đây cũng chính là cách bảo đảm tiêu chí "chọn 1 ngày → hành vi y hệt hiện tại":
không phải tin vào suy luận, mà vì đường cũ không bị đụng tới một dòng nào.

`NewMenuForm` thêm một nhóm nút chọn nhanh **1 ngày · 3 ngày · 5 ngày · 7 ngày**
cạnh ô ngày, kèm dòng nhắc khoảng ngày sẽ sinh ("12/07 → 18/07").

Cảnh báo thời gian phải hiện ngay ở form, không giấu: chọn 7 ngày thì nói thẳng
"có thể mất 10-20 phút nếu dùng Ollama tự host". Người dùng bấm rồi mới biết phải
chờ 20 phút là trải nghiệm tệ hơn nhiều so với một dòng chữ.

## 8. Dashboard

Thẻ job đang chạy đổi từ "Đang tạo thực đơn cho ngày X" thành dạng có tiến độ khi
`days > 1`:

> Đang tạo thực đơn 12/07 → 18/07 — **xong 3/7 ngày**. Bạn có thể rời trang.

`JobPoller` đã refresh định kỳ nên tiến độ tự cập nhật, không cần cơ chế mới.

## 9. Kiểm thử

`src/lib/week-plan.test.ts` (vitest, khuôn theo `pantry.test.ts`):

| Ca | Kỳ vọng |
|---|---|
| Khung đúng mọi luật | không vi phạm |
| Thiếu một (ngày, bữa) đã yêu cầu | vi phạm R1 |
| Sai multiset vai trò trong một bữa | vi phạm R1 |
| Trả về ngày ngoài danh sách slot | vi phạm R2 |
| Hai món trùng tên khác ngày | vi phạm R3 |
| Trùng tên nhưng khác dấu/hoa thường | vẫn vi phạm R3 |
| Hai món `DO_CHUA` trùng tên khác ngày | **không** vi phạm (R3 tha `DO_CHUA`) |
| Món mặn hai ngày liền cùng `mainProtein` | vi phạm R4 |
| Cùng `mainProtein` nhưng cách một ngày | **không** vi phạm |
| Khoảng chỉ có 1 ngày | R4 không bao giờ kích hoạt |
| Khung rỗng / thiếu hết | vi phạm R1, không ném lỗi |

`src/lib/catalog-match.test.ts`: chuyển nguyên các ca khớp tên đang có ở
`dish-image.test.ts`, thêm ca cho `findCatalogDish` trả về đủ `ingredients` và
`steps` để pha 2 dùng được.

Phần nở khung (`expand-plan.ts`) chạm DB và AI nên **không** test bằng vitest,
đúng lệ repo (`shopping.ts` cũng vậy) — logic thuần đã nằm ở `week-plan.ts` và
`catalog-match.ts`.

## Ràng buộc & lưu ý kỹ thuật

- **Next.js 16.2.9 (breaking):** theo `AGENTS.md`, tra `node_modules/next/dist/docs/`
  trước khi sửa form/server action.
- **Đa provider:** thêm `generateWeekPlan` phải cài ở cả ba adapter. Model yếu
  (Ollama nhỏ) là ràng buộc thiết kế, không phải ca biên.
- **Migration remote:** thêm cột có `@default` nên an toàn; vẫn viết SQL tay theo
  lệ repo và chạy qua `DATABASE_URL`.
- **`saveMenu` theo từng ngày** thay vì một lần cuối — cần vì tiến độ và vì giữ
  phần đã xong. Nó vốn đã xoá-rồi-tạo theo (ngày, bữa) nên gọi nhiều lần an toàn.
  Chữ ký thêm một tham số tuỳ chọn `mealPlanId?: string | null` để gán vào
  `PlannedMeal`; bỏ trống thì hành vi y như cũ, nên luồng một ngày không đổi.
- **`syncShopping` gọi một lần sau khi xong cả khoảng**, không gọi mỗi ngày: nó
  quét lại toàn bộ mâm sắp tới nên gọi bảy lần là bảy lần làm cùng một việc.

## Tiêu chí hoàn thành

1. Chọn 7 ngày → một job duy nhất, dashboard hiện tiến độ tăng dần tới 7/7.
2. Thực đơn 7 ngày **không có hai món trùng tên**, và món mặn hai ngày liền không
   cùng đạm chính.
3. Món có trong catalog dùng đúng công thức catalog, không gọi AI.
4. Hỏng ở ngày 5 → bốn ngày đầu vẫn còn trên dashboard, job FAILED nêu rõ hỏng từ
   ngày nào.
5. Chọn 1 ngày → hành vi y hệt hiện tại (không hồi quy).
6. `yarn test`, `yarn lint`, `yarn build` sạch.

## Ngoài phạm vi (để lại cho 5B)

- **Đi chợ theo chu kỳ 2/3/7 ngày** — chọn ở trang Đi chợ, lưu mốc kết thúc trên
  `ShoppingList`, `syncShopping` lọc theo mốc đó.
- **Tách đồ tươi / đồ mua trước được** và nhãn "nấu ngày nào" cho từng dòng —
  cần thêm ngày sớm nhất vào `Need` và một cột trên `ShoppingItem`.
- Sinh quá 7 ngày.
- Sửa/sinh lại **một ngày** bên trong khoảng đã sinh (hiện vẫn dùng được luồng
  một ngày sẵn có, chỉ là không tham chiếu khung cũ).
