-- AlterEnum
ALTER TYPE "AIProvider" ADD VALUE 'OLLAMA';

-- AlterTable
ALTER TABLE "AISettings" ADD COLUMN     "basicAuthEncrypted" TEXT;
