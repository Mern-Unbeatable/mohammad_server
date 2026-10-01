-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "listingId" TEXT;

-- CreateIndex
CREATE INDEX "Message_listingId_idx" ON "Message"("listingId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
