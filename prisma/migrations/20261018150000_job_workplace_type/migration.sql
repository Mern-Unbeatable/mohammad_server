-- CreateEnum
CREATE TYPE "WorkplaceType" AS ENUM ('ON_SITE', 'REMOTE', 'HYBRID');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "workplaceType" "WorkplaceType" NOT NULL DEFAULT 'ON_SITE';
