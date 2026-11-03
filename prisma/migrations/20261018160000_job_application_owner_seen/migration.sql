-- AlterTable
ALTER TABLE "JobApplication" ADD COLUMN "ownerSeenAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "JobApplication_jobId_ownerSeenAt_idx" ON "JobApplication"("jobId", "ownerSeenAt");
