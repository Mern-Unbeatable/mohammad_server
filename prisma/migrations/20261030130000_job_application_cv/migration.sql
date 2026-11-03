-- AlterTable
ALTER TABLE "JobApplication"
    ADD COLUMN "cvKey" TEXT,
    ADD COLUMN "cvName" TEXT,
    ADD COLUMN "cvMime" TEXT,
    ADD COLUMN "cvSize" INTEGER;
