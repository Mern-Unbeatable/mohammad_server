-- AlterTable
ALTER TABLE "FeedPost" ADD COLUMN     "isRepost" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sharedPostId" TEXT;

-- CreateIndex
CREATE INDEX "FeedPost_sharedPostId_idx" ON "FeedPost"("sharedPostId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedPost_authorId_sharedPostId_key" ON "FeedPost"("authorId", "sharedPostId");

-- AddForeignKey
ALTER TABLE "FeedPost" ADD CONSTRAINT "FeedPost_sharedPostId_fkey" FOREIGN KEY ("sharedPostId") REFERENCES "FeedPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
