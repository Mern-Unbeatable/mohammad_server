-- Add destination configuration fields to advertisements.
CREATE TYPE "AdDestinationMode" AS ENUM ('INTERNAL', 'EXTERNAL');

ALTER TABLE "Advertisement"
ADD COLUMN "destinationMode" "AdDestinationMode" NOT NULL DEFAULT 'INTERNAL',
ADD COLUMN "destinationResourceId" TEXT,
ADD COLUMN "destinationUrl" TEXT;
