-- AlterTable
ALTER TABLE "FeedComment" ADD COLUMN "parentCommentId" TEXT;

-- CreateIndex
CREATE INDEX "FeedComment_parentCommentId_idx" ON "FeedComment"("parentCommentId");

-- AddForeignKey
ALTER TABLE "FeedComment" ADD CONSTRAINT "FeedComment_parentCommentId_fkey" FOREIGN KEY ("parentCommentId") REFERENCES "FeedComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
