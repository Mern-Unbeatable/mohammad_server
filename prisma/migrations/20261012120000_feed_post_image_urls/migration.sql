-- AlterTable
ALTER TABLE "FeedPost" ADD COLUMN     "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill existing single images
UPDATE "FeedPost" SET "imageUrls" = ARRAY["imageUrl"] WHERE "imageUrl" IS NOT NULL;
