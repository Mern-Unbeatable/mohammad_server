-- CreateTable
CREATE TABLE "FeedCommentLike" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedCommentLike_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeedCommentLike_commentId_idx" ON "FeedCommentLike"("commentId");

-- CreateIndex
CREATE INDEX "FeedCommentLike_userId_idx" ON "FeedCommentLike"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedCommentLike_commentId_userId_key" ON "FeedCommentLike"("commentId", "userId");

-- AddForeignKey
ALTER TABLE "FeedCommentLike" ADD CONSTRAINT "FeedCommentLike_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "FeedComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedCommentLike" ADD CONSTRAINT "FeedCommentLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
