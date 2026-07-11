import { PrismaClient, type Prisma } from "@prisma/client";
import { allDishes, allSetMenus } from "../src/data/catalog";

// Seed kho món dùng chung vào DB từ nguồn chân lý src/data/catalog/*.
// Idempotent: upsert theo slug nên chạy lại nhiều lần vẫn an toàn (đồng bộ DB
// với dữ liệu file). Chạy: `yarn db:seed` (cần DATABASE_URL).

const prisma = new PrismaClient();

async function main() {
  console.log(
    `Seeding ${allDishes.length} món và ${allSetMenus.length} set menu...`,
  );

  // 1) Upsert từng món theo slug.
  for (const d of allDishes) {
    const data = {
      name: d.name,
      aliases: d.aliases,
      dishRole: d.dishRole,
      region: d.region,
      mealTypes: d.mealTypes,
      servings: d.servings,
      cookMinutes: d.cookMinutes,
      difficulty: d.difficulty,
      budgetLevel: d.budgetLevel,
      steps: d.steps,
      ingredients: d.ingredients as unknown as Prisma.InputJsonValue,
      nutritionLabels: d.nutritionLabels,
      tags: d.tags,
      notes: d.notes ?? null,
      imageUrl: d.imageUrl ?? null,
      imageCredit: d.imageCredit ?? null,
    };
    await prisma.catalogDish.upsert({
      where: { slug: d.slug },
      create: { slug: d.slug, ...data },
      update: data,
    });
  }

  // Bản đồ slug -> id để nối set menu.
  const dishes = await prisma.catalogDish.findMany({
    select: { id: true, slug: true },
  });
  const idBySlug = new Map(dishes.map((x) => [x.slug, x.id]));

  // 2) Upsert set menu + dựng lại danh sách món (xoá cũ, tạo lại theo thứ tự).
  for (const m of allSetMenus) {
    const menu = await prisma.catalogSetMenu.upsert({
      where: { slug: m.slug },
      create: {
        slug: m.slug,
        name: m.name,
        occasion: m.occasion,
        region: m.region,
        servings: m.servings,
        note: m.note ?? null,
      },
      update: {
        name: m.name,
        occasion: m.occasion,
        region: m.region,
        servings: m.servings,
        note: m.note ?? null,
      },
    });

    await prisma.catalogSetMenuItem.deleteMany({
      where: { setMenuId: menu.id },
    });
    await prisma.catalogSetMenuItem.createMany({
      data: m.dishSlugs
        .map((slug, position) => ({ dishId: idBySlug.get(slug), position }))
        .filter(
          (x): x is { dishId: string; position: number } =>
            x.dishId !== undefined,
        )
        .map((x) => ({ ...x, setMenuId: menu.id })),
    });
  }

  const [dishCount, menuCount] = await Promise.all([
    prisma.catalogDish.count(),
    prisma.catalogSetMenu.count(),
  ]);
  console.log(`Xong. DB có ${dishCount} món, ${menuCount} set menu.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
