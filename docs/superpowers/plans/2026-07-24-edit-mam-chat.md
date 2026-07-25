# Chỉnh sửa mâm — nút nhanh + chat có trí nhớ (Giai đoạn 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép chỉnh sửa từng món trong mâm sau khi tạo — nút thao tác nhanh (đổi món/đổi đạm/điều chỉnh nhanh), xóa tức thì, thêm món, và chat tự do có trí nhớ cấp món lẫn cấp mâm — chạy ngầm qua hàng đợi dùng chung 1 GPU với việc tạo menu.

**Architecture:** `EditJob` model riêng, đi qua bộ điều phối `pumpJobs` được tổng quát hoá để đếm concurrency chung với `GenerationJob`. `AIProvider.editMeal()` nhận `EditContext` (trạng thái mâm + lịch sử chat + lệnh) trả `{dishes}` rồi `applyEdit` cập nhật DB. Chat lưu ở `chatHistory Json` trên `MealDish`/`PlannedMeal`.

**Tech Stack:** Next.js 16.2.9, React 19, Prisma 6 + Postgres, zod 4, vitest.

## Global Constraints

- Next.js **16.2.9** breaking: `params`/`searchParams` async; `useActionState` từ `react`; server action file mở đầu `"use server"`; đọc `node_modules/next/dist/docs/` trước khi viết client component/route (AGENTS.md).
- **1 GPU** → pump PHẢI đếm RUNNING chung của `GenerationJob` + `EditJob`, không vượt `CONCURRENCY`.
- Đa provider: `editMeal` chỉ thêm ở interface + `AnthropicProvider` + `OpenAICompatibleProvider` (Ollama kế thừa); prompt/schema dùng chung.
- DB Postgres remote, **không áp migration tay** — `docker-entrypoint.sh` chạy `prisma migrate deploy` khi deploy. GĐ 2 phụ thuộc bảng `MealDish` của GĐ 1 (migration `20260724120000` phải áp trước; thứ tự timestamp đảm bảo).
- Text người dùng thấy: tiếng Việt.
- Sau mỗi task đụng Prisma: `npx prisma generate`; đảm bảo `yarn build` + `yarn test` xanh.

---

### Task 1: Schema `EditJob` + `chatHistory` + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260724130000_edit_mam_chat/migration.sql`

**Interfaces:**
- Produces: model `EditJob`, enum `EditScope { DISH, MEAL, ADD }`, cột `MealDish.chatHistory Json`, `PlannedMeal.chatHistory Json`, quan hệ `PlannedMeal.editJobs`.

- [ ] **Step 1: Sửa `prisma/schema.prisma`**

Trong `model PlannedMeal`, thêm 2 dòng (sau `dishes MealDish[]`):
```prisma
  editJobs    EditJob[]
  chatHistory Json      @default("[]") // lịch sử chat cấp mâm: [{role, content}]
```

Trong `model MealDish`, thêm (sau `position Int @default(0)`):
```prisma
  chatHistory Json @default("[]") // lịch sử chat của món: [{role, content}]
```

Thêm model + enum mới (đặt sau `model MealDish`, trước `enum MealType`):
```prisma
model EditJob {
  id       String @id @default(cuid())
  familyId String
  family   Family @relation(fields: [familyId], references: [id], onDelete: Cascade)

  plannedMealId String
  plannedMeal   PlannedMeal @relation(fields: [plannedMealId], references: [id], onDelete: Cascade)

  scope       EditScope
  mealDishId  String? // món đích khi scope=DISH
  instruction String
  useHistory  Boolean @default(false)

  status     JobStatus @default(PENDING)
  error      String?
  createdAt  DateTime  @default(now())
  startedAt  DateTime?
  finishedAt DateTime?

  @@index([familyId, status])
  @@index([plannedMealId])
}

enum EditScope {
  DISH
  MEAL
  ADD
}
```

Trong `model Family`, thêm quan hệ ngược (sau `generationJobs GenerationJob[]`):
```prisma
  editJobs EditJob[]
```

- [ ] **Step 2: Viết migration SQL**

Tạo `prisma/migrations/20260724130000_edit_mam_chat/migration.sql`:
```sql
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
```

- [ ] **Step 3: Validate + generate**

Run: `npx prisma validate && npx prisma generate`
Expected: "schema is valid" + client generated. (Không áp lên DB.)

- [ ] **Step 4: Build**

Run: `yarn build`
Expected: xanh (thay đổi thuần bổ sung, không phá code cũ).

- [ ] **Step 5: Commit**
```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): EditJob + chatHistory cho MealDish/PlannedMeal"
```

---

### Task 2: AI `editMeal` — schema, types, prompt, adapters

**Files:**
- Modify: `src/lib/ai/schema.ts` (aiEditSchema, parseEditJson)
- Modify: `src/lib/ai/schema.test.ts` (test parseEditJson)
- Modify: `src/lib/ai/types.ts` (ChatTurn, EditScopeStr, EditDishView, EditContext, AIProvider.editMeal)
- Modify: `src/lib/ai/prompt.ts` (buildEditPrompt)
- Modify: `src/lib/ai/anthropic.ts` (editMeal)
- Modify: `src/lib/ai/openai-compatible.ts` (editMeal)

**Interfaces:**
- Consumes: `aiDishSchema`, `AiDish` (GĐ 1).
- Produces:
  - `parseEditJson(text): AiEditResult` với `AiEditResult = { dishes: AiDish[] }`.
  - `EditContext`, `ChatTurn`, `EditDishView`, `EditScopeStr` (types.ts).
  - `AIProvider.editMeal(ctx: EditContext): Promise<AiEditResult>`.
  - `buildEditPrompt(ctx: EditContext): { system: string; user: string }`.

- [ ] **Step 1: Test thất bại cho `parseEditJson`**

Thêm vào cuối `src/lib/ai/schema.test.ts`:
```ts
import { parseEditJson } from "./schema";

describe("parseEditJson", () => {
  it("parse danh sách dishes", () => {
    const json = JSON.stringify({
      dishes: [
        { name: "Canh chua cá", dishRole: "CANH_SUP", servings: 4, cookMinutes: 25, steps: ["nấu"], nutritionLabels: ["nhiều rau"], ingredients: [{ name: "cá", quantity: 300, unit: "g" }] },
      ],
    });
    const r = parseEditJson(json);
    expect(r.dishes[0].name).toBe("Canh chua cá");
  });

  it("từ chối khi dishes rỗng", () => {
    expect(() => parseEditJson(JSON.stringify({ dishes: [] }))).toThrow();
  });
});
```

- [ ] **Step 2: Chạy — FAIL**

Run: `yarn test src/lib/ai/schema.test.ts`
Expected: FAIL (`parseEditJson` chưa tồn tại).

- [ ] **Step 3: Thêm schema**

Trong `src/lib/ai/schema.ts`, sau khối `aiMenuSchema`/types, thêm:
```ts
export const aiEditSchema = z.object({
  dishes: z.array(aiDishSchema).min(1),
});
export type AiEditResult = z.infer<typeof aiEditSchema>;

/** Validate JSON kết quả sửa mâm. */
export function parseEditJson(text: string): AiEditResult {
  const result = aiEditSchema.safeParse(extractJson(text));
  if (!result.success) {
    throw new Error(
      "JSON sửa mâm không đúng cấu trúc: " + result.error.message,
    );
  }
  return result.data;
}
```

- [ ] **Step 4: Chạy — PASS**

Run: `yarn test src/lib/ai/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Thêm types**

Trong `src/lib/ai/types.ts`, thêm (sau `DishRoleStr`):
```ts
export type EditScopeStr = "DISH" | "MEAL" | "ADD";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface EditDishView {
  name: string;
  dishRole: DishRoleStr;
  nutritionLabels: string[];
  ingredientNames: string[];
}

export interface EditContext {
  scope: EditScopeStr;
  mealType: MealTypeStr;
  servings: number;
  members: MenuMember[];
  profile: MenuProfile;
  currentDishes: EditDishView[];
  targetRole?: DishRoleStr; // khi scope=DISH
  history: ChatTurn[]; // 4-5 lượt gần nhất; rỗng nếu không dùng
  instruction: string;
  recentRecipeNames: string[];
  catalogReference?: CatalogReference;
}
```
Và bổ sung method vào interface `AIProvider`:
```ts
  editMeal(ctx: EditContext): Promise<AiEditResult>;
```
Cập nhật import type ở đầu file: `import type { AiMenu, AiEditResult, MemberRecognition } from "./schema";`

- [ ] **Step 6: `buildEditPrompt`**

Trong `src/lib/ai/prompt.ts`, thêm import type `EditContext` vào dòng import types và thêm hàm mới ở cuối file:
```ts
export function buildEditPrompt(ctx: EditContext): {
  system: string;
  user: string;
} {
  const scopeRule =
    ctx.scope === "DISH"
      ? `Chỉ thay ĐÚNG 1 MÓN có vai trò "${DISH_ROLE_LABEL[ctx.targetRole ?? "MON_MAN"]}". Trả về đúng 1 phần tử trong dishes, khác hẳn món hiện tại, vẫn hợp vai trò đó.`
      : ctx.scope === "ADD"
        ? "Đề xuất ĐÚNG 1 MÓN MỚI bổ sung cho mâm (không trùng món đang có, cân bằng thêm cho mâm). Trả về đúng 1 phần tử trong dishes."
        : "Viết lại DANH SÁCH ĐẦY ĐỦ các món của mâm sau khi áp yêu cầu (có thể thêm/bớt/đổi món). Trả về toàn bộ dishes của mâm.";

  const system = [
    "Bạn vừa là CHUYÊN GIA DINH DƯỠNG, vừa là ĐẦU BẾP gia đình người Việt giàu kinh nghiệm.",
    "Nhiệm vụ: CHỈNH SỬA mâm cơm theo yêu cầu người dùng, giữ cân bằng dinh dưỡng và đúng ẩm thực Việt.",
    "QUY TẮC BẮT BUỘC:",
    "- TUYỆT ĐỐI không dùng nguyên liệu gây dị ứng; tôn trọng kiêng khem.",
    "- Không lặp lại món đã ăn gần đây; tránh trùng nguyên liệu chính với các món còn lại trong mâm.",
    "- Gắn nhãn dinh dưỡng cho từng món; công thức bằng tiếng Việt.",
    `- ${scopeRule}`,
    "CHỈ trả về JSON, KHÔNG giải thích, KHÔNG markdown.",
    `Cấu trúc JSON: {"dishes":[{"name":"string","dishRole":"MON_MAN|MON_XAO|CANH_SUP|RAU_LUOC|LAU|COM_BUN_PHO|MON_CUON|TRANG_MIENG|DO_CHUA","servings":number,"cookMinutes":number,"steps":["string"],"nutritionLabels":["string"],"ingredients":[{"name":"string","quantity":number,"unit":"string"}]}]}`,
  ].join("\n");

  const p = ctx.profile;
  const membersText =
    ctx.members
      .map((m, i) => {
        const parts = [`  ${i + 1}. ${m.name} (${m.ageGroup})`];
        if (m.allergies.length) parts.push(`dị ứng: ${m.allergies.join(", ")}`);
        if (m.dietaryRestrictions.length)
          parts.push(`kiêng: ${m.dietaryRestrictions.join(", ")}`);
        if (m.dislikes.length) parts.push(`ghét: ${m.dislikes.join(", ")}`);
        return parts.join(" — ");
      })
      .join("\n") || "  (chưa có thông tin thành viên)";

  const currentText = ctx.currentDishes
    .map(
      (d) =>
        `  - [${DISH_ROLE_LABEL[d.dishRole] ?? d.dishRole}] ${d.name} — nguyên liệu: ${d.ingredientNames.join(", ") || "?"}`,
    )
    .join("\n");

  const historyText = ctx.history.length
    ? ctx.history
        .map((t) => `  ${t.role === "user" ? "Người dùng" : "Trợ lý"}: ${t.content}`)
        .join("\n")
    : "";

  const user = [
    `Bữa: ${MEALTYPE_LABEL[ctx.mealType] ?? ctx.mealType} · ${ctx.servings} người`,
    "",
    "Thành viên & hạn chế:",
    membersText,
    "",
    "Mâm hiện tại:",
    currentText || "  (mâm trống)",
    "",
    historyText ? "Lịch sử trao đổi (cũ → mới):" : "",
    historyText,
    historyText ? "" : "",
    `YÊU CẦU MỚI: ${ctx.instruction}`,
    "",
    "Món đã ăn gần đây (TRÁNH lặp):",
    ctx.recentRecipeNames.length
      ? ctx.recentRecipeNames.map((n) => `  - ${n}`).join("\n")
      : "  (chưa có)",
    "",
    catalogReferenceText(ctx.catalogReference),
    "Trả về JSON đúng cấu trúc đã nêu.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { system, user };
}
```
LƯU Ý: `catalogReferenceText` hiện nhận `ctx: MenuContext`. Refactor nó nhận trực tiếp `ref?: CatalogReference` để dùng lại cho cả 2 prompt:
- Đổi chữ ký: `function catalogReferenceText(ref: CatalogReference | undefined): string {` và bỏ dòng `const ref = ctx.catalogReference;`.
- Trong `buildMenuPrompt`, đổi lời gọi `catalogReferenceText(ctx)` → `catalogReferenceText(ctx.catalogReference)`.
- Thêm import type: `import type { MenuContext, EditContext, CatalogReference } from "./types";`

- [ ] **Step 7: `editMeal` trong Anthropic adapter**

Trong `src/lib/ai/anthropic.ts`:
- Thêm vào import prompt: `import { buildMenuPrompt, buildRecognitionPrompt, buildEditPrompt } from "./prompt";`
- Thêm vào import schema: `parseEditJson, type AiEditResult` và `EditContext` vào import types.
- Thêm method (sau `generateMenu`):
```ts
  async editMeal(ctx: EditContext): Promise<AiEditResult> {
    const { system, user } = buildEditPrompt(ctx);
    const msg = await this.client().messages.create({
      model: this.model,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
    });
    return parseEditJson(this.textOf(msg));
  }
```

- [ ] **Step 8: `editMeal` trong OpenAI-compatible adapter**

Trong `src/lib/ai/openai-compatible.ts`:
- Cập nhật import prompt: thêm `buildEditPrompt`.
- Cập nhật import schema: thêm `parseEditJson, type AiEditResult`; import types thêm `EditContext`.
- Thêm method (sau `generateMenu`):
```ts
  async editMeal(ctx: EditContext): Promise<AiEditResult> {
    const { system, user } = buildEditPrompt(ctx);
    const res = await this.client().chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    });
    return parseEditJson(res.choices[0]?.message?.content ?? "");
  }
```
(`OllamaProvider` kế thừa `OpenAICompatibleProvider` nên tự có `editMeal` — kiểm tra `src/lib/ai/ollama.ts` không override thiếu.)

- [ ] **Step 9: Test + build**

Run: `yarn test && yarn build`
Expected: PASS + build xanh (interface `AIProvider` có `editMeal`, mọi adapter thoả).

- [ ] **Step 10: Commit**
```bash
git add src/lib/ai/schema.ts src/lib/ai/schema.test.ts src/lib/ai/types.ts src/lib/ai/prompt.ts src/lib/ai/anthropic.ts src/lib/ai/openai-compatible.ts
git commit -m "feat(ai): editMeal + buildEditPrompt + parseEditJson"
```

---

### Task 3: Edit engine — `edit.ts` + DRY helper

**Files:**
- Create: `src/lib/edit.ts`
- Modify: `src/lib/menu.ts` (dùng `createRecipeFromDish` cho DRY)

**Interfaces:**
- Consumes: `AiDish`, `AiEditResult` (schema), `EditContext` (types), `planMealStructure` không cần ở đây.
- Produces:
  - `createRecipeFromDish(tx: Prisma.TransactionClient, familyId: string, dish: AiDish): Promise<string>` (trả recipeId).
  - `buildEditContext(job: EditJob): Promise<EditContext>`.
  - `applyEdit(job: EditJob, result: AiEditResult): Promise<void>`.

- [ ] **Step 1: Tạo `src/lib/edit.ts`**
```ts
import { prisma } from "./db";
import { normalizeIngredient } from "./normalize";
import { buildCatalogReference } from "./catalog";
import type { AiDish, AiEditResult } from "./ai/schema";
import type {
  ChatTurn,
  EditContext,
  EditDishView,
  MealTypeStr,
  MenuMember,
  MenuProfile,
} from "./ai/types";
import type { EditJob, Prisma } from "@prisma/client";

const HISTORY_TURNS = 10; // ~5 lượt hỏi-đáp

/** Tạo Recipe (+ upsert Ingredient) từ 1 món AI trả về. Trả recipeId. Dùng chung
 *  cho saveMenu (tạo mới) và applyEdit (sửa). */
export async function createRecipeFromDish(
  tx: Prisma.TransactionClient,
  familyId: string,
  dish: AiDish,
): Promise<string> {
  const recipeIngredients: {
    ingredientId: string;
    quantity: number;
    unit: string;
  }[] = [];

  for (const ing of dish.ingredients) {
    const normalized = normalizeIngredient(ing.name);
    if (!normalized) continue;
    const ingredient = await tx.ingredient.upsert({
      where: { familyId_normalized: { familyId, normalized } },
      create: {
        familyId,
        name: ing.name.trim(),
        normalized,
        defaultUnit: ing.unit,
      },
      update: {},
    });
    recipeIngredients.push({
      ingredientId: ingredient.id,
      quantity: ing.quantity,
      unit: ing.unit,
    });
  }

  const recipe = await tx.recipe.create({
    data: {
      familyId,
      name: dish.name,
      source: "AI",
      servings: dish.servings,
      cookMinutes: dish.cookMinutes,
      steps: dish.steps,
      nutritionLabels: dish.nutritionLabels,
      ingredients: { create: recipeIngredients },
    },
  });
  return recipe.id;
}

/** Ép Json chatHistory về ChatTurn[] an toàn. */
function asHistory(json: unknown): ChatTurn[] {
  return Array.isArray(json) ? (json as ChatTurn[]) : [];
}

/** Dựng EditContext từ một EditJob (nạp mâm, dishes, hồ sơ, lịch sử chat). */
export async function buildEditContext(job: EditJob): Promise<EditContext> {
  const [meal, members, profile, recentRecipes] = await Promise.all([
    prisma.plannedMeal.findUnique({
      where: { id: job.plannedMealId },
      include: {
        dishes: {
          orderBy: { position: "asc" },
          include: { recipe: { include: { ingredients: { include: { ingredient: true } } } } },
        },
      },
    }),
    prisma.familyMember.findMany({ where: { familyId: job.familyId } }),
    prisma.eatingProfile.findUnique({ where: { familyId: job.familyId } }),
    prisma.recipe.findMany({
      where: { familyId: job.familyId },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { name: true },
    }),
  ]);
  if (!meal) throw new Error("Không tìm thấy mâm cần sửa.");

  const menuMembers: MenuMember[] = members.map((m) => ({
    name: m.name,
    ageGroup: m.ageGroup,
    allergies: m.allergies,
    dietaryRestrictions: m.dietaryRestrictions,
    likes: m.likes,
    dislikes: m.dislikes,
  }));
  const menuProfile: MenuProfile = {
    cuisineRegion: profile?.cuisineRegion ?? "KHONG_CO_KHAU_VI",
    spiceLevel: profile?.spiceLevel ?? "MEDIUM",
    budgetLevel: profile?.budgetLevel ?? "MEDIUM",
    maxCookMinutes: profile?.maxCookMinutes ?? 60,
    healthGoals: profile?.healthGoals ?? [],
    notes: profile?.notes ?? null,
  };

  const currentDishes: EditDishView[] = meal.dishes.map((d) => ({
    name: d.recipe.name,
    dishRole: d.dishRole,
    nutritionLabels: d.recipe.nutritionLabels,
    ingredientNames: d.recipe.ingredients.map((ri) => ri.ingredient.name),
  }));

  const targetDish =
    job.scope === "DISH" && job.mealDishId
      ? meal.dishes.find((d) => d.id === job.mealDishId)
      : undefined;

  // Lịch sử chat: DISH lấy từ MealDish đích, MEAL lấy từ PlannedMeal.
  let history: ChatTurn[] = [];
  if (job.useHistory) {
    if (job.scope === "DISH" && targetDish) {
      history = asHistory(targetDish.chatHistory);
    } else if (job.scope === "MEAL") {
      history = asHistory(meal.chatHistory);
    }
    history = history.slice(-HISTORY_TURNS);
  }

  return {
    scope: job.scope,
    mealType: meal.mealType as MealTypeStr,
    servings: meal.servings,
    members: menuMembers,
    profile: menuProfile,
    currentDishes,
    targetRole: targetDish?.dishRole,
    history,
    instruction: job.instruction,
    recentRecipeNames: recentRecipes.map((r) => r.name),
    catalogReference: buildCatalogReference(menuMembers, menuProfile),
  };
}

/** Ghi thêm lượt trợ lý vào chatHistory của MealDish hoặc PlannedMeal. */
async function appendAssistant(
  tx: Prisma.TransactionClient,
  target: "mealDish" | "plannedMeal",
  id: string,
  content: string,
): Promise<void> {
  if (target === "mealDish") {
    const row = await tx.mealDish.findUnique({ where: { id }, select: { chatHistory: true } });
    if (!row) return;
    const next = [...asHistory(row.chatHistory), { role: "assistant", content }];
    await tx.mealDish.update({ where: { id }, data: { chatHistory: next } });
  } else {
    const row = await tx.plannedMeal.findUnique({ where: { id }, select: { chatHistory: true } });
    if (!row) return;
    const next = [...asHistory(row.chatHistory), { role: "assistant", content }];
    await tx.plannedMeal.update({ where: { id }, data: { chatHistory: next } });
  }
}

/** Áp kết quả sửa vào DB theo scope. */
export async function applyEdit(job: EditJob, result: AiEditResult): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      if (job.scope === "DISH") {
        if (!job.mealDishId) return;
        const exists = await tx.mealDish.findUnique({ where: { id: job.mealDishId } });
        if (!exists) return; // món đã bị xóa trong lúc chờ
        const dish = result.dishes[0];
        const recipeId = await createRecipeFromDish(tx, job.familyId, dish);
        await tx.mealDish.update({ where: { id: job.mealDishId }, data: { recipeId } });
        if (job.useHistory)
          await appendAssistant(tx, "mealDish", job.mealDishId, `Đã đổi thành: ${dish.name}`);
      } else if (job.scope === "MEAL") {
        await tx.mealDish.deleteMany({ where: { plannedMealId: job.plannedMealId } });
        let position = 0;
        for (const dish of result.dishes) {
          const recipeId = await createRecipeFromDish(tx, job.familyId, dish);
          await tx.mealDish.create({
            data: { plannedMealId: job.plannedMealId, recipeId, dishRole: dish.dishRole, position: position++ },
          });
        }
        if (job.useHistory)
          await appendAssistant(
            tx,
            "plannedMeal",
            job.plannedMealId,
            `Mâm mới: ${result.dishes.map((d) => d.name).join(", ")}`,
          );
      } else {
        // ADD
        const agg = await tx.mealDish.aggregate({
          where: { plannedMealId: job.plannedMealId },
          _max: { position: true },
        });
        const dish = result.dishes[0];
        const recipeId = await createRecipeFromDish(tx, job.familyId, dish);
        await tx.mealDish.create({
          data: {
            plannedMealId: job.plannedMealId,
            recipeId,
            dishRole: dish.dishRole,
            position: (agg._max.position ?? -1) + 1,
          },
        });
      }
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}
```

- [ ] **Step 2: DRY `saveMenu` dùng `createRecipeFromDish`**

Trong `src/lib/menu.ts`: thêm import `import { createRecipeFromDish } from "./edit";` và trong `saveMenu`, thay khối tạo `recipeIngredients` + `tx.recipe.create` (bên trong `for (const dish of meal.dishes)`) bằng:
```ts
        const recipeId = await createRecipeFromDish(tx, familyId, dish);

        await tx.mealDish.create({
          data: {
            plannedMealId: planned.id,
            recipeId,
            dishRole: dish.dishRole,
            position: position++,
          },
        });
```
Xóa vòng lặp upsert Ingredient + `tx.recipe.create` cũ trong `saveMenu` (giờ nằm trong helper). Bỏ import `normalizeIngredient` khỏi menu.ts nếu không còn dùng chỗ khác (kiểm tra: `buildMenuContext` không dùng nó → xóa import).

- [ ] **Step 3: Build**

Run: `yarn build`
Expected: xanh.

- [ ] **Step 4: Commit**
```bash
git add src/lib/edit.ts src/lib/menu.ts
git commit -m "feat(edit): buildEditContext + applyEdit + createRecipeFromDish (DRY)"
```

---

### Task 4: Bộ điều phối chung cho GenerationJob + EditJob

**Files:**
- Modify: `src/lib/jobs.ts`

**Interfaces:**
- Consumes: `buildEditContext`, `applyEdit` (Task 3); `provider.editMeal` (Task 2).
- Produces: `getActiveEditJobs(familyId)`, `getRecentFailedEditJobs(familyId)`; pump đếm chung 2 model.

- [ ] **Step 1: Import edit engine**

Trong `src/lib/jobs.ts`, thêm:
```ts
import { buildEditContext, applyEdit } from "./edit";
import type { GenerationJob, EditJob } from "@prisma/client";
```
(gộp `EditJob` vào import type sẵn có của `GenerationJob`.)

- [ ] **Step 2: Đếm RUNNING chung + fail stale cả 2**

Thay `failStaleRunning` bằng bản áp cho cả 2 model, và thêm `countRunning`:
```ts
async function failStaleRunning(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_MS);
  const data = {
    status: "FAILED" as const,
    error: "Quá thời gian xử lý (server có thể đã khởi động lại). Vui lòng thử lại.",
    finishedAt: new Date(),
  };
  await prisma.generationJob.updateMany({
    where: { status: "RUNNING", startedAt: { lt: cutoff } },
    data,
  });
  await prisma.editJob.updateMany({
    where: { status: "RUNNING", startedAt: { lt: cutoff } },
    data,
  });
}

async function countRunning(): Promise<number> {
  const [g, e] = await Promise.all([
    prisma.generationJob.count({ where: { status: "RUNNING" } }),
    prisma.editJob.count({ where: { status: "RUNNING" } }),
  ]);
  return g + e;
}
```

- [ ] **Step 3: `pumpOnce` chọn PENDING cũ nhất giữa 2 hàng**

Thay toàn bộ thân vòng `for(;;)` trong `pumpOnce` bằng:
```ts
async function pumpOnce(): Promise<void> {
  await failStaleRunning();

  for (;;) {
    if ((await countRunning()) >= CONCURRENCY) return;

    const [nextGen, nextEdit] = await Promise.all([
      prisma.generationJob.findFirst({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } }),
      prisma.editJob.findFirst({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } }),
    ]);
    if (!nextGen && !nextEdit) return;

    const pickEdit =
      nextEdit && (!nextGen || nextEdit.createdAt < nextGen.createdAt);

    if (pickEdit) {
      const claimed = await prisma.editJob.updateMany({
        where: { id: nextEdit!.id, status: "PENDING" },
        data: { status: "RUNNING", startedAt: new Date() },
      });
      if (claimed.count === 0) continue;
      void runEditJob(nextEdit!.id).finally(() => void pumpJobs());
    } else {
      const claimed = await prisma.generationJob.updateMany({
        where: { id: nextGen!.id, status: "PENDING" },
        data: { status: "RUNNING", startedAt: new Date() },
      });
      if (claimed.count === 0) continue;
      void runGenerationJob(nextGen!.id).finally(() => void pumpJobs());
    }
  }
}
```

- [ ] **Step 4: Đổi tên `runJob` → `runGenerationJob` + thêm `runEditJob`**

Đổi tên hàm `runJob` hiện tại thành `runGenerationJob` (chỉ đổi tên khai báo; lời gọi đã sửa ở Step 3). Thêm ngay sau nó:
```ts
async function runEditJob(jobId: string): Promise<void> {
  const job = await prisma.editJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  try {
    const provider = await getAIProvider(job.familyId);
    const ctx = await buildEditContext(job);
    const result = await provider.editMeal(ctx);
    await applyEdit(job, result);
    await prisma.editJob.update({
      where: { id: jobId },
      data: { status: "DONE", finishedAt: new Date() },
    });
  } catch (e) {
    await prisma.editJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        error:
          (e instanceof Error ? e.message : "Không sửa được mâm.") +
          " — thử lại hoặc kiểm tra AI.",
        finishedAt: new Date(),
      },
    });
  }
}
```

- [ ] **Step 5: Đọc trạng thái EditJob cho UI**

Thêm ở cuối `src/lib/jobs.ts`:
```ts
/** EditJob active (PENDING/RUNNING) của gia đình — để UI hiện spinner đúng chỗ. */
export async function getActiveEditJobs(familyId: string): Promise<
  Pick<EditJob, "id" | "plannedMealId" | "mealDishId" | "scope" | "status">[]
> {
  void pumpJobs();
  return prisma.editJob.findMany({
    where: { familyId, status: { in: [...ACTIVE_STATUSES] } },
    select: { id: true, plannedMealId: true, mealDishId: true, scope: true, status: true },
  });
}

/** EditJob FAILED gần đây còn trong hạn hiển thị. */
export async function getRecentFailedEditJobs(familyId: string): Promise<
  Pick<EditJob, "id" | "plannedMealId" | "error">[]
> {
  return prisma.editJob.findMany({
    where: {
      familyId,
      status: "FAILED",
      finishedAt: { gte: new Date(Date.now() - FAILED_VISIBLE_MS) },
    },
    orderBy: { finishedAt: "desc" },
    select: { id: true, plannedMealId: true, error: true },
  });
}
```

- [ ] **Step 6: Build**

Run: `yarn build`
Expected: xanh.

- [ ] **Step 7: Commit**
```bash
git add src/lib/jobs.ts
git commit -m "feat(jobs): hàng đợi chung GenerationJob + EditJob (1 GPU)"
```

---

### Task 5: Server actions sửa mâm

**Files:**
- Create: `src/lib/actions/edit.ts`

**Interfaces:**
- Consumes: `pumpJobs` (jobs), `requireFamily` (tenant), Prisma.
- Produces: `quickEditAction`, `chatDishAction`, `chatMealAction`, `addDishAction`, `deleteDishAction`, `ackEditJobAction`.

- [ ] **Step 1: Tạo `src/lib/actions/edit.ts`**
```ts
"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireFamily } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { pumpJobs } from "@/lib/jobs";
import type { ChatTurn } from "@/lib/ai/types";

const QUICK_EDIT: Record<string, string> = {
  "doi-mon": "Đổi sang một món KHÁC cùng loại (cùng vai trò), khác hẳn món hiện tại.",
  "doi-dam": "Giữ nguyên kiểu món nhưng đổi nguyên liệu chính/nguồn đạm sang loại khác.",
  "it-cay": "Điều chỉnh món ít cay hơn.",
  "it-dau": "Điều chỉnh món ít dầu mỡ hơn, thanh đạm hơn.",
  "nhanh-hon": "Điều chỉnh để nấu nhanh hơn, ít bước hơn.",
  "re-hon": "Điều chỉnh dùng nguyên liệu tiết kiệm hơn.",
};

/** Nạp MealDish thuộc gia đình hiện tại + thông tin mâm; null nếu không thuộc. */
async function ownDish(familyId: string, mealDishId: string) {
  return prisma.mealDish.findFirst({
    where: { id: mealDishId, plannedMeal: { familyId } },
    select: { id: true, plannedMealId: true, chatHistory: true },
  });
}

/** Đã có EditJob active cho đúng đích (món hoặc mâm) chưa? Chống spam. */
async function hasActiveFor(
  familyId: string,
  where: { mealDishId?: string; plannedMealId?: string },
): Promise<boolean> {
  const n = await prisma.editJob.count({
    where: { familyId, status: { in: ["PENDING", "RUNNING"] }, ...where },
  });
  return n > 0;
}

function asHistory(json: unknown): ChatTurn[] {
  return Array.isArray(json) ? (json as ChatTurn[]) : [];
}

export async function quickEditAction(mealDishId: string, kind: string): Promise<void> {
  const { familyId } = await requireFamily();
  const instruction = QUICK_EDIT[kind];
  if (!instruction) return;
  const dish = await ownDish(familyId, mealDishId);
  if (!dish) return;
  if (await hasActiveFor(familyId, { mealDishId })) return;

  await prisma.editJob.create({
    data: { familyId, plannedMealId: dish.plannedMealId, scope: "DISH", mealDishId, instruction, useHistory: false },
  });
  after(() => pumpJobs());
  revalidatePath("/dashboard");
}

export async function chatDishAction(mealDishId: string, message: string): Promise<void> {
  const { familyId } = await requireFamily();
  const text = message.trim();
  if (!text) return;
  const dish = await ownDish(familyId, mealDishId);
  if (!dish) return;
  if (await hasActiveFor(familyId, { mealDishId })) return;

  const history = [...asHistory(dish.chatHistory), { role: "user", content: text }];
  await prisma.mealDish.update({ where: { id: mealDishId }, data: { chatHistory: history } });
  await prisma.editJob.create({
    data: { familyId, plannedMealId: dish.plannedMealId, scope: "DISH", mealDishId, instruction: text, useHistory: true },
  });
  after(() => pumpJobs());
  revalidatePath("/dashboard");
}

export async function chatMealAction(plannedMealId: string, message: string): Promise<void> {
  const { familyId } = await requireFamily();
  const text = message.trim();
  if (!text) return;
  const meal = await prisma.plannedMeal.findFirst({
    where: { id: plannedMealId, familyId },
    select: { id: true, chatHistory: true },
  });
  if (!meal) return;
  if (await hasActiveFor(familyId, { plannedMealId })) return;

  const history = [...asHistory(meal.chatHistory), { role: "user", content: text }];
  await prisma.plannedMeal.update({ where: { id: plannedMealId }, data: { chatHistory: history } });
  await prisma.editJob.create({
    data: { familyId, plannedMealId, scope: "MEAL", instruction: text, useHistory: true },
  });
  after(() => pumpJobs());
  revalidatePath("/dashboard");
}

export async function addDishAction(plannedMealId: string): Promise<void> {
  const { familyId } = await requireFamily();
  const meal = await prisma.plannedMeal.findFirst({ where: { id: plannedMealId, familyId }, select: { id: true } });
  if (!meal) return;
  if (await hasActiveFor(familyId, { plannedMealId })) return;

  await prisma.editJob.create({
    data: {
      familyId,
      plannedMealId,
      scope: "ADD",
      instruction: "Thêm một món phù hợp để mâm cân bằng và đa dạng hơn.",
      useHistory: false,
    },
  });
  after(() => pumpJobs());
  revalidatePath("/dashboard");
}

export async function deleteDishAction(mealDishId: string): Promise<void> {
  const { familyId } = await requireFamily();
  const dish = await ownDish(familyId, mealDishId);
  if (!dish) return;
  // Không cho xóa món cuối cùng của mâm.
  const count = await prisma.mealDish.count({ where: { plannedMealId: dish.plannedMealId } });
  if (count <= 1) return;
  await prisma.mealDish.delete({ where: { id: mealDishId } });
  revalidatePath("/dashboard");
}

export async function ackEditJobAction(formData: FormData): Promise<void> {
  const { familyId } = await requireFamily();
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) return;
  await prisma.editJob.deleteMany({ where: { id: jobId, familyId, status: "FAILED" } });
  revalidatePath("/dashboard");
}
```

- [ ] **Step 2: Build**

Run: `yarn build`
Expected: xanh.

- [ ] **Step 3: Commit**
```bash
git add src/lib/actions/edit.ts
git commit -m "feat(edit): server actions quick/chat/add/delete/ack"
```

---

### Task 6: Giao diện sửa mâm trên dashboard

**Files:**
- Create: `src/app/(app)/dashboard/MealCard.tsx`
- Modify: `src/app/(app)/dashboard/page.tsx`

**Interfaces:**
- Consumes: actions (Task 5), `getActiveEditJobs`/`getRecentFailedEditJobs` (Task 4), `JobPoller`.

- [ ] **Step 1: Tạo `MealCard.tsx` (client component)**
```tsx
"use client";

import { useState, useTransition } from "react";
import {
  quickEditAction,
  chatDishAction,
  chatMealAction,
  addDishAction,
  deleteDishAction,
} from "@/lib/actions/edit";

type ChatTurn = { role: "user" | "assistant"; content: string };

export type DishView = {
  id: string;
  roleLabel: string;
  name: string;
  cookMinutes: number;
  nutritionLabels: string[];
  ingredients: string[];
  steps: string[];
  chatHistory: ChatTurn[];
};

export type MealView = {
  id: string;
  mealTypeLabel: string;
  servings: number;
  totalMinutes: number;
  chatHistory: ChatTurn[];
  dishes: DishView[];
};

const QUICK: { kind: string; label: string }[] = [
  { kind: "doi-mon", label: "Đổi món" },
  { kind: "doi-dam", label: "Đổi đạm" },
];
const TUNE: { kind: string; label: string }[] = [
  { kind: "it-cay", label: "Ít cay hơn" },
  { kind: "it-dau", label: "Ít dầu hơn" },
  { kind: "nhanh-hon", label: "Nhanh hơn" },
  { kind: "re-hon", label: "Rẻ hơn" },
];

function ChatBox({
  history,
  busy,
  onSend,
}: {
  history: ChatTurn[];
  busy: boolean;
  onSend: (msg: string) => void;
}) {
  const [msg, setMsg] = useState("");
  return (
    <div className="mt-2 rounded-lg bg-zinc-50 p-2">
      {history.length > 0 && (
        <div className="mb-2 space-y-1">
          {history.map((t, i) => (
            <p
              key={i}
              className={`text-xs ${t.role === "user" ? "text-zinc-700" : "text-emerald-700"}`}
            >
              <span className="font-medium">
                {t.role === "user" ? "Bạn: " : "Trợ lý: "}
              </span>
              {t.content}
            </p>
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const v = msg.trim();
          if (!v || busy) return;
          onSend(v);
          setMsg("");
        }}
        className="flex gap-2"
      >
        <input
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          disabled={busy}
          placeholder="Nhập yêu cầu chỉnh sửa…"
          className="flex-1 rounded border border-zinc-300 px-2 py-1 text-sm outline-none focus:border-emerald-500 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          Gửi
        </button>
      </form>
    </div>
  );
}

export function MealCard({
  meal,
  busyDishIds,
  mealBusy,
}: {
  meal: MealView;
  busyDishIds: string[];
  mealBusy: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [openChat, setOpenChat] = useState<string | null>(null);
  const [openMealChat, setOpenMealChat] = useState(false);
  const busySet = new Set(busyDishIds);
  const anyBusy = pending || mealBusy;

  const run = (fn: () => Promise<void>) => startTransition(() => void fn());

  return (
    <article className="rounded-xl border border-zinc-100 bg-zinc-50 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
          {meal.mealTypeLabel}
        </span>
        <span className="text-xs text-zinc-500">
          {meal.servings} người · {meal.dishes.length} món
          {meal.totalMinutes > 0 && ` · ~${meal.totalMinutes} phút`}
        </span>
        {mealBusy && (
          <span className="flex items-center gap-1 text-xs text-amber-600">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600" />
            đang cập nhật…
          </span>
        )}
      </div>

      <div className="space-y-3">
        {meal.dishes.map((dish) => {
          const dishBusy = busySet.has(dish.id) || pending;
          return (
            <div
              key={dish.id}
              className={`rounded-lg border border-zinc-200 bg-white p-3 ${busySet.has(dish.id) ? "opacity-60" : ""}`}
            >
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500">
                  {dish.roleLabel}
                </span>
                <h4 className="font-semibold">{dish.name}</h4>
                {busySet.has(dish.id) && (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600" />
                )}
              </div>
              <p className="text-xs text-zinc-500">
                {dish.cookMinutes} phút
                {dish.nutritionLabels.length > 0 &&
                  " · " + dish.nutritionLabels.join(", ")}
              </p>
              {dish.ingredients.length > 0 && (
                <p className="mt-2 text-sm text-zinc-600">
                  <span className="font-medium">Nguyên liệu: </span>
                  {dish.ingredients.join(", ")}
                </p>
              )}
              {dish.steps.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-medium text-emerald-700">
                    Cách làm ({dish.steps.length} bước)
                  </summary>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zinc-700">
                    {dish.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                </details>
              )}

              {/* Nút thao tác nhanh */}
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {QUICK.map((q) => (
                  <button
                    key={q.kind}
                    type="button"
                    disabled={dishBusy}
                    onClick={() => run(() => quickEditAction(dish.id, q.kind))}
                    className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:border-emerald-400 disabled:opacity-50"
                  >
                    {q.label}
                  </button>
                ))}
                <details className="relative">
                  <summary className="cursor-pointer rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:border-emerald-400">
                    Điều chỉnh nhanh ▾
                  </summary>
                  <div className="absolute z-10 mt-1 flex flex-col rounded-lg border border-zinc-200 bg-white p-1 shadow">
                    {TUNE.map((t) => (
                      <button
                        key={t.kind}
                        type="button"
                        disabled={dishBusy}
                        onClick={() => run(() => quickEditAction(dish.id, t.kind))}
                        className="whitespace-nowrap rounded px-2 py-1 text-left text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </details>
                <button
                  type="button"
                  disabled={dishBusy}
                  onClick={() =>
                    setOpenChat(openChat === dish.id ? null : dish.id)
                  }
                  className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:border-emerald-400 disabled:opacity-50"
                >
                  Chat
                </button>
                <button
                  type="button"
                  disabled={dishBusy || meal.dishes.length <= 1}
                  onClick={() => {
                    if (confirm(`Xóa món "${dish.name}"?`)) run(() => deleteDishAction(dish.id));
                  }}
                  className="rounded border border-red-200 px-2 py-1 text-xs text-red-500 hover:bg-red-50 disabled:opacity-40"
                >
                  Xóa
                </button>
              </div>

              {openChat === dish.id && (
                <ChatBox
                  history={dish.chatHistory}
                  busy={dishBusy}
                  onSend={(m) => run(() => chatDishAction(dish.id, m))}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Cấp mâm: thêm món + chat mâm */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={anyBusy}
          onClick={() => run(() => addDishAction(meal.id))}
          className="rounded border border-emerald-300 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
        >
          + Thêm món
        </button>
        <button
          type="button"
          disabled={anyBusy}
          onClick={() => setOpenMealChat((v) => !v)}
          className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:border-emerald-400 disabled:opacity-50"
        >
          Chat cả mâm
        </button>
      </div>
      {openMealChat && (
        <ChatBox
          history={meal.chatHistory}
          busy={anyBusy}
          onSend={(m) => run(() => chatMealAction(meal.id, m))}
        />
      )}
    </article>
  );
}
```

- [ ] **Step 2: Nối vào `dashboard/page.tsx`**

Thêm import:
```ts
import { getActiveJob, getRecentFailedJob, getQueuePosition, getActiveEditJobs, getRecentFailedEditJobs } from "@/lib/jobs";
import { MealCard, type MealView } from "./MealCard";
```
Sau khi có `activeJob`, thêm:
```ts
  const activeEditJobs = await getActiveEditJobs(familyId);
  const failedEditJobs = await getRecentFailedEditJobs(familyId);
```
Đổi include của `plannedMeal.findMany` để lấy `chatHistory` + `dishes.id`:
```ts
      include: {
        dishes: {
          orderBy: { position: "asc" },
          include: { recipe: { include: { ingredients: { include: { ingredient: true } } } } },
        },
      },
```
(giữ nguyên — `chatHistory` là scalar đã tự có trong `meal` và `dish`).

Thay khối render `byDay.get(key)!.map((meal) => { ... <article> ... })` bằng:
```tsx
                {byDay.get(key)!.map((meal) => {
                  const view: MealView = {
                    id: meal.id,
                    mealTypeLabel: MEAL_TYPE_LABEL[meal.mealType] ?? meal.mealType,
                    servings: meal.servings,
                    totalMinutes: meal.dishes.reduce(
                      (max, d) => Math.max(max, d.recipe.cookMinutes),
                      0,
                    ),
                    chatHistory: Array.isArray(meal.chatHistory)
                      ? (meal.chatHistory as MealView["chatHistory"])
                      : [],
                    dishes: meal.dishes.map((d) => ({
                      id: d.id,
                      roleLabel: DISH_ROLE_LABEL[d.dishRole] ?? d.dishRole,
                      name: d.recipe.name,
                      cookMinutes: d.recipe.cookMinutes,
                      nutritionLabels: d.recipe.nutritionLabels,
                      ingredients: d.recipe.ingredients.map(
                        (ri) => `${ri.ingredient.name} (${ri.quantity} ${ri.unit})`,
                      ),
                      steps: d.recipe.steps,
                      chatHistory: Array.isArray(d.chatHistory)
                        ? (d.chatHistory as MealView["chatHistory"])
                        : [],
                    })),
                  };
                  const jobsForMeal = activeEditJobs.filter(
                    (j) => j.plannedMealId === meal.id,
                  );
                  const busyDishIds = jobsForMeal
                    .filter((j) => j.mealDishId)
                    .map((j) => j.mealDishId as string);
                  const mealBusy = jobsForMeal.some(
                    (j) => j.scope === "MEAL" || j.scope === "ADD",
                  );
                  return (
                    <MealCard
                      key={meal.id}
                      meal={view}
                      busyDishIds={busyDishIds}
                      mealBusy={mealBusy}
                    />
                  );
                })}
```

- [ ] **Step 3: Poller chạy khi có edit job + thẻ lỗi edit**

Điều kiện render `<JobPoller/>`: hiện đang trong khối `{activeJob && (...)}`. Thêm một `<JobPoller/>` khi có edit job active — chèn ngay sau khối `{failedJob && ...}`:
```tsx
      {activeEditJobs.length > 0 && <JobPoller intervalMs={2500} />}

      {failedEditJobs.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-medium">Một số chỉnh sửa mâm thất bại.</p>
          {failedEditJobs.map((j) => (
            <div key={j.id} className="mt-2 flex items-center justify-between gap-3">
              <span className="text-red-600">{j.error}</span>
              <form action={ackEditJobAction}>
                <input type="hidden" name="jobId" value={j.id} />
                <button
                  type="submit"
                  className="rounded-lg border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-100"
                >
                  Bỏ qua
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
```
Thêm import action: `import { ackJobAction } from "@/lib/actions/menu";` đã có — thêm `import { ackEditJobAction } from "@/lib/actions/edit";`.

- [ ] **Step 4: Build**

Run: `yarn build`
Expected: xanh. Nếu lỗi type ở `meal.chatHistory` (Json), giữ cách ép `Array.isArray(...) ? (... as ...) : []` như trên.

- [ ] **Step 5: Commit**
```bash
git add "src/app/(app)/dashboard/MealCard.tsx" "src/app/(app)/dashboard/page.tsx"
git commit -m "feat(dashboard): UI chỉnh sửa mâm — nút nhanh, chat, thêm/xóa món"
```

---

### Task 7: Kiểm thử tổng thể

- [ ] **Step 1: Test + build sạch**

Run: `yarn test && yarn build`
Expected: mọi test PASS; build xanh.

- [ ] **Step 2: Đối chiếu tiêu chí GĐ 2 (sau deploy + migrate + AI cấu hình)**

1. Đổi món → đúng món đổi, món khác giữ nguyên.
2. Đổi đạm → cùng kiểu, đổi nguyên liệu chính.
3. Điều chỉnh nhanh → công thức đổi theo hướng đó.
4. Chat món 2-3 lượt → lượt sau hiểu ngữ cảnh; lịch sử hiển thị.
5. Chat mâm "thêm/bớt món" → số món đổi đúng.
6. Thêm món → mâm có thêm 1 món hợp lệ.
7. Xóa → tức thì; chặn xóa khi còn 1 món.
8. Không phạm dị ứng/kiêng.
9. Đang tạo menu mà sửa → edit xếp hàng, không vượt 1 GPU.

- [ ] **Step 3: Ghi chú kết quả** (mục nào chưa kiểm được vì chưa deploy/cấu hình AI).

---

## Self-Review (đã chạy)

**Spec coverage:**
- EditJob riêng + pump chung → Task 1 + Task 4. ✓
- chatHistory trí nhớ → Task 1 (cột) + Task 3 (nạp/ghi) + Task 5 (append user) + Task 6 (hiển thị). ✓
- editMeal + prompt/schema → Task 2. ✓
- applyEdit DISH/MEAL/ADD + delete tức thì → Task 3 + Task 5. ✓
- Nút nhanh/chat/thêm/xóa + poller → Task 6. ✓
- Migration áp khi deploy → Task 1. ✓

**Placeholder scan:** không có TBD/TODO; mọi step có code/lệnh cụ thể.

**Type consistency:** `EditScopeStr`/`EditScope` khớp ("DISH"|"MEAL"|"ADD"); `AiEditResult = {dishes: AiDish[]}` khớp `parseEditJson`/`editMeal`/`applyEdit`; `createRecipeFromDish(tx, familyId, dish)` dùng ở cả `saveMenu` và `applyEdit`; `getActiveEditJobs` trả `{plannedMealId, mealDishId, scope, status}` khớp cách `page.tsx` lọc `busyDishIds`/`mealBusy`; `MealView`/`DishView` khớp props `MealCard`.

## Ngoài phạm vi (GĐ 3)
Lịch sử ngày đã qua; undo; dọn recipe mồ côi; multi-turn streaming thật.
