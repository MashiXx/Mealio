-- CreateEnum
CREATE TYPE "DishRole" AS ENUM ('MON_MAN', 'MON_XAO', 'CANH_SUP', 'RAU_LUOC', 'LAU', 'COM_BUN_PHO', 'MON_CUON', 'TRANG_MIENG', 'DO_CHUA');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateTable
CREATE TABLE "CatalogDish" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dishRole" "DishRole" NOT NULL,
    "region" "CuisineRegion" NOT NULL DEFAULT 'KHONG_CO_KHAU_VI',
    "mealTypes" "MealType"[] DEFAULT ARRAY[]::"MealType"[],
    "servings" INTEGER NOT NULL DEFAULT 4,
    "cookMinutes" INTEGER NOT NULL DEFAULT 30,
    "difficulty" "Difficulty" NOT NULL DEFAULT 'EASY',
    "budgetLevel" "BudgetLevel" NOT NULL DEFAULT 'MEDIUM',
    "steps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ingredients" JSONB NOT NULL,
    "nutritionLabels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "imageUrl" TEXT,
    "imageCredit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogDish_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogSetMenu" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "occasion" TEXT NOT NULL,
    "region" "CuisineRegion" NOT NULL DEFAULT 'KHONG_CO_KHAU_VI',
    "servings" INTEGER NOT NULL DEFAULT 4,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogSetMenu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogSetMenuItem" (
    "id" TEXT NOT NULL,
    "setMenuId" TEXT NOT NULL,
    "dishId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CatalogSetMenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogDish_slug_key" ON "CatalogDish"("slug");

-- CreateIndex
CREATE INDEX "CatalogDish_dishRole_idx" ON "CatalogDish"("dishRole");

-- CreateIndex
CREATE INDEX "CatalogDish_region_idx" ON "CatalogDish"("region");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogSetMenu_slug_key" ON "CatalogSetMenu"("slug");

-- CreateIndex
CREATE INDEX "CatalogSetMenuItem_setMenuId_idx" ON "CatalogSetMenuItem"("setMenuId");

-- CreateIndex
CREATE INDEX "CatalogSetMenuItem_dishId_idx" ON "CatalogSetMenuItem"("dishId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogSetMenuItem_setMenuId_dishId_key" ON "CatalogSetMenuItem"("setMenuId", "dishId");

-- AddForeignKey
ALTER TABLE "CatalogSetMenuItem" ADD CONSTRAINT "CatalogSetMenuItem_setMenuId_fkey" FOREIGN KEY ("setMenuId") REFERENCES "CatalogSetMenu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogSetMenuItem" ADD CONSTRAINT "CatalogSetMenuItem_dishId_fkey" FOREIGN KEY ("dishId") REFERENCES "CatalogDish"("id") ON DELETE CASCADE ON UPDATE CASCADE;

